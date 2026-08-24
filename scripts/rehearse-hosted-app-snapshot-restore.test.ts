import { mkdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { SupabaseClient } from "@supabase/supabase-js";
import { afterEach, describe, expect, it } from "vitest";
import {
  HOSTED_APP_SNAPSHOT_BUCKET,
  HOSTED_APP_SNAPSHOT_MEDIA_TYPE,
  MAX_HOSTED_APP_SNAPSHOT_BYTES
} from "../lib/db/adapters/supabase-app-snapshot-store";
import { rehearseHostedAppSnapshotRestore } from "./rehearse-hosted-app-snapshot-restore";

const temporaryDirectories: string[] = [];
const config = {
  sourceUrl: "https://snapshot-source.supabase.co",
  restoreUrl: "https://snapshot-restore.supabase.co",
  expectedRestoreOrigin: "https://snapshot-restore.supabase.co",
  confirmIsolatedRestore: true,
  organizationId: "123e4567-e89b-12d3-a456-426614174000",
  projectKey: "main"
};

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) =>
    rm(directory, { recursive: true, force: true })));
});

describe("hosted App snapshot restore rehearsal", () => {
  it("exports, restores, loads, and cleans one exact snapshot across separate origins", async () => {
    const source = new FakeHostedSnapshotStorage();
    const restore = new FakeHostedSnapshotStorage();
    let time = 1_000;
    const times = [
      new Date("2026-08-23T02:00:00.000Z"),
      new Date("2026-08-23T02:00:02.000Z")
    ];
    const receipt = await rehearseHostedAppSnapshotRestore(config, {
      sourceClient: source.adminClient,
      restoreClient: restore.adminClient,
      now: () => times.shift()!,
      nowMs: () => (time += 50),
      temporaryRoot
    });

    expect(receipt).toMatchObject({
      schemaVersion: "hosted-app-snapshot-restore-rehearsal/v1",
      sourceOrigin: config.sourceUrl,
      restoreOrigin: config.restoreUrl,
      organizationId: config.organizationId,
      projectKey: config.projectKey,
      durationMs: 50
    });
    expect(receipt.archiveSizeBytes).toBeGreaterThan(0);
    expect(receipt.snapshotIdentityDigest).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(receipt.artifactDigest).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(receipt.filesDigest).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(receipt.checks.map((check) => check.name)).toEqual([
      "separate_private_bounded_buckets",
      "source_archive_exported",
      "target_first_writer_restore",
      "isolated_target_exact_load",
      "source_preserved_after_target_cleanup",
      "cleanup_verified"
    ]);
    expect(source.objects.size).toBe(0);
    expect(restore.objects.size).toBe(0);
  });

  it("rejects the source origin as a restore target before touching storage", async () => {
    const source = new FakeHostedSnapshotStorage();
    const restore = new FakeHostedSnapshotStorage();
    await expect(rehearseHostedAppSnapshotRestore({
      ...config,
      restoreUrl: config.sourceUrl,
      expectedRestoreOrigin: config.sourceUrl
    }, {
      sourceClient: source.adminClient,
      restoreClient: restore.adminClient,
      temporaryRoot
    })).rejects.toThrow(/must be different/);
    expect(source.objects.size).toBe(0);
    expect(restore.objects.size).toBe(0);
  });

  it("fails closed and cleans both probes when restored bytes are corrupted", async () => {
    const source = new FakeHostedSnapshotStorage();
    const restore = new FakeHostedSnapshotStorage({ corruptUploads: true });
    await expect(rehearseHostedAppSnapshotRestore(config, {
      sourceClient: source.adminClient,
      restoreClient: restore.adminClient,
      temporaryRoot
    })).rejects.toThrow();
    expect(source.objects.size).toBe(0);
    expect(restore.objects.size).toBe(0);
  });

  it("requires explicit confirmation and the protected target identity", async () => {
    const source = new FakeHostedSnapshotStorage();
    const restore = new FakeHostedSnapshotStorage();
    await expect(rehearseHostedAppSnapshotRestore({
      ...config,
      confirmIsolatedRestore: false
    }, {
      sourceClient: source.adminClient,
      restoreClient: restore.adminClient,
      temporaryRoot
    })).rejects.toThrow(/confirmation/);
    await expect(rehearseHostedAppSnapshotRestore({
      ...config,
      expectedRestoreOrigin: "https://unexpected.supabase.co"
    }, {
      sourceClient: source.adminClient,
      restoreClient: restore.adminClient,
      temporaryRoot
    })).rejects.toThrow(/protected expected origin/);
  });

  it("rejects a restore bucket that is not JSON-only", async () => {
    const source = new FakeHostedSnapshotStorage();
    const restore = new FakeHostedSnapshotStorage({ extraMediaType: true });
    await expect(rehearseHostedAppSnapshotRestore(config, {
      sourceClient: source.adminClient,
      restoreClient: restore.adminClient,
      temporaryRoot
    })).rejects.toThrow(/restore bucket is not private and bounded/);
  });
});

async function temporaryRoot(prefix: string) {
  const directory = path.join(os.tmpdir(), `${prefix}${temporaryDirectories.length}`);
  await rm(directory, { recursive: true, force: true });
  await mkdir(directory, { recursive: true });
  temporaryDirectories.push(directory);
  return directory;
}

class FakeHostedSnapshotStorage {
  readonly objects = new Map<string, { bytes: Buffer; mediaType: string }>();
  readonly adminClient: SupabaseClient;

  constructor(private readonly options: { corruptUploads?: boolean; extraMediaType?: boolean } = {}) {
    this.adminClient = {
      storage: {
        getBucket: async (bucket: string) => bucket === HOSTED_APP_SNAPSHOT_BUCKET
          ? {
              data: {
                id: bucket,
                name: bucket,
                public: false,
                file_size_limit: MAX_HOSTED_APP_SNAPSHOT_BYTES,
                allowed_mime_types: this.options.extraMediaType
                  ? [HOSTED_APP_SNAPSHOT_MEDIA_TYPE, "text/plain"]
                  : [HOSTED_APP_SNAPSHOT_MEDIA_TYPE]
              },
              error: null
            }
          : { data: null, error: { message: "not found" } },
        from: (bucket: string) => {
          if (bucket !== HOSTED_APP_SNAPSHOT_BUCKET) throw new Error(`unexpected bucket ${bucket}`);
          return {
            list: async (prefix: string) => ({
              data: [...new Set([...this.objects.keys()]
                .filter((key) => key.startsWith(`${prefix}/`))
                .map((key) => key.slice(prefix.length + 1).split("/", 1)[0]!))]
                .map((name) => ({ name })),
              error: null
            }),
            upload: async (
              key: string,
              body: Blob | Buffer | Uint8Array,
              options: { contentType: string; upsert: boolean }
            ) => {
              if (!options.upsert && this.objects.has(key)) {
                return { data: null, error: { statusCode: 409, message: "already exists" } };
              }
              const bytes = await bodyBytes(body);
              if (this.options.corruptUploads && bytes.length > 0) bytes[0] = bytes[0]! ^ 0xff;
              this.objects.set(key, { bytes, mediaType: options.contentType });
              return { data: { path: key }, error: null };
            },
            download: async (key: string) => {
              const object = this.objects.get(key);
              return object
                ? { data: new Blob([Uint8Array.from(object.bytes)], { type: object.mediaType }), error: null }
                : { data: null, error: { statusCode: 404, message: "not found" } };
            },
            remove: async (keys: string[]) => {
              for (const key of keys) this.objects.delete(key);
              return { data: keys.map((name) => ({ name })), error: null };
            }
          };
        }
      }
    } as unknown as SupabaseClient;
  }
}

async function bodyBytes(body: Blob | Buffer | Uint8Array) {
  if (Buffer.isBuffer(body)) return Buffer.from(body);
  if (body instanceof Uint8Array) return Buffer.from(body);
  return Buffer.from(await body.arrayBuffer());
}
