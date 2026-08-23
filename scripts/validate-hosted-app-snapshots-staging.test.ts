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
import { validateHostedAppSnapshotsStaging } from "./validate-hosted-app-snapshots-staging";

const temporaryDirectories: string[] = [];
const config = {
  supabaseUrl: "https://snapshot-staging.supabase.co",
  organizationId: "123e4567-e89b-12d3-a456-426614174000",
  projectKey: "main",
  workspaceId: "snapshot-gate-test"
};

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) =>
    rm(directory, { recursive: true, force: true })));
});

describe("hosted App snapshot staging validation", () => {
  it("proves private storage, first-writer identity, and exact cross-replica recovery", async () => {
    const storage = new FakeHostedSnapshotStorage();
    let time = 1_000;
    const receipt = await validateHostedAppSnapshotsStaging(config, {
      adminClient: storage.adminClient,
      authenticatedClient: storage.authenticatedClient,
      now: () => new Date("2026-08-23T00:00:00.000Z"),
      nowMs: () => (time += 25),
      temporaryRoot
    });

    expect(receipt).toMatchObject({
      schemaVersion: "hosted-app-snapshot-staging-validation/v1",
      targetOrigin: config.supabaseUrl,
      organizationId: config.organizationId,
      projectKey: config.projectKey,
      durationMs: 25
    });
    expect(receipt.snapshotIdentityDigest).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(receipt.artifactDigest).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(receipt.filesDigest).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(receipt.checks.map((check) => check.name)).toEqual([
      "private_bounded_bucket",
      "immutable_first_writer",
      "authenticated_download_denial",
      "authenticated_insert_denial",
      "authenticated_update_denial",
      "authenticated_delete_denial",
      "cross_replica_exact_recovery",
      "cleanup_verified"
    ]);
    expect(storage.objects.size).toBe(0);
  });

  it("fails when a broad client policy exposes the archive", async () => {
    const storage = new FakeHostedSnapshotStorage({ exposeReads: true });
    await expect(validateHostedAppSnapshotsStaging(config, {
      adminClient: storage.adminClient,
      authenticatedClient: storage.authenticatedClient,
      temporaryRoot
    })).rejects.toThrow(/unexpectedly downloaded/);
    expect(storage.objects.size).toBe(0);
  });

  it("rejects an untrusted target origin before touching storage", async () => {
    const storage = new FakeHostedSnapshotStorage();
    await expect(validateHostedAppSnapshotsStaging({
      ...config,
      supabaseUrl: "http://snapshot-staging.supabase.co/path"
    }, {
      adminClient: storage.adminClient,
      authenticatedClient: storage.authenticatedClient,
      temporaryRoot
    })).rejects.toThrow(/HTTPS origin/);
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
  readonly authenticatedClient: SupabaseClient;

  constructor(private readonly options: { exposeReads?: boolean } = {}) {
    this.adminClient = this.client("admin");
    this.authenticatedClient = this.client("authenticated");
  }

  private client(role: "admin" | "authenticated") {
    const allowed = role === "admin";
    return {
      storage: {
        getBucket: async (bucket: string) => bucket === HOSTED_APP_SNAPSHOT_BUCKET
          ? {
              data: {
                id: bucket,
                name: bucket,
                public: false,
                file_size_limit: MAX_HOSTED_APP_SNAPSHOT_BYTES,
                allowed_mime_types: [HOSTED_APP_SNAPSHOT_MEDIA_TYPE]
              },
              error: null
            }
          : { data: null, error: { message: "not found" } },
        from: (bucket: string) => {
          if (bucket !== HOSTED_APP_SNAPSHOT_BUCKET) throw new Error(`unexpected bucket ${bucket}`);
          return {
            list: async (prefix: string) => allowed
              ? {
                  data: [...new Set([...this.objects.keys()]
                    .filter((key) => key.startsWith(`${prefix}/`))
                    .map((key) => key.slice(prefix.length + 1).split("/", 1)[0]!))]
                    .map((name) => ({ name })),
                  error: null
                }
              : { data: [], error: null },
            upload: async (key: string, body: Blob | Buffer, options: { contentType: string; upsert: boolean }) => {
              if (!allowed) return { data: null, error: { statusCode: 403, message: "denied" } };
              if (!options.upsert && this.objects.has(key)) {
                return { data: null, error: { statusCode: 409, message: "already exists" } };
              }
              this.objects.set(key, {
                bytes: await bodyBytes(body),
                mediaType: options.contentType
              });
              return { data: { path: key }, error: null };
            },
            update: async (key: string, body: Blob | Buffer, options: { contentType: string }) => {
              if (!allowed) return { data: null, error: { statusCode: 403, message: "denied" } };
              this.objects.set(key, { bytes: await bodyBytes(body), mediaType: options.contentType });
              return { data: { path: key }, error: null };
            },
            download: async (key: string) => {
              const object = this.objects.get(key);
              if (!allowed && !this.options.exposeReads) {
                return { data: null, error: { statusCode: 403, message: "denied" } };
              }
              return object
                ? { data: new Blob([Uint8Array.from(object.bytes)], { type: object.mediaType }), error: null }
                : { data: null, error: { statusCode: 404, message: "not found" } };
            },
            remove: async (keys: string[]) => {
              if (!allowed) return { data: [], error: { statusCode: 403, message: "denied" } };
              for (const key of keys) this.objects.delete(key);
              return { data: keys.map((name) => ({ name })), error: null };
            }
          };
        }
      }
    } as unknown as SupabaseClient;
  }
}

async function bodyBytes(body: Blob | Buffer) {
  return Buffer.isBuffer(body)
    ? Buffer.from(body)
    : Buffer.from(await body.arrayBuffer());
}
