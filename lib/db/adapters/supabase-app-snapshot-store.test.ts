import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  appSnapshotFilesDigest,
  loadLoopPackDirectory
} from "loopgraph/runtime";
import { afterEach, describe, expect, it } from "vitest";
import {
  HOSTED_APP_SNAPSHOT_BUCKET,
  SupabaseAppSnapshotStore,
  inventoryHostedAppSnapshotObjects
} from "./supabase-app-snapshot-store";

const temporaryDirectories: string[] = [];
const scope = {
  organizationId: "123e4567-e89b-12d3-a456-426614174000",
  projectKey: "main",
  workspaceId: "acme"
};

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) =>
    rm(directory, { recursive: true, force: true })));
});

describe("Supabase App snapshot store", () => {
  it("rejects unsafe tenant namespaces", () => {
    const storage = new FakeSnapshotStorage();
    expect(() => new SupabaseAppSnapshotStore(storage.client, { ...scope, organizationId: "../other" }, "/tmp/app"))
      .toThrow(/organization ID/);
    expect(() => new SupabaseAppSnapshotStore(storage.client, { ...scope, projectKey: "../../escape" }, "/tmp/app"))
      .toThrow(/project key/);
    expect(() => new SupabaseAppSnapshotStore(storage.client, { ...scope, workspaceId: "other/workspace" }, "/tmp/app"))
      .toThrow(/workspace ID/);
  });

  it("uses first-writer-wins immutable storage and loads from a second replica", async () => {
    const storage = new FakeSnapshotStorage();
    const firstRoot = await temporaryRoot("loopgraph-snapshot-first-");
    const secondRoot = await temporaryRoot("loopgraph-snapshot-second-");
    const source = await loadLoopPackDirectory(path.resolve(
      process.cwd(),
      "packs/official/product/turn-feedback-into-product-problems"
    ));
    const descriptor = {
      snapshotPath: ".loopgraph/apps/private-snapshots/private.product-feedback/1.0.0",
      artifactDigest: source.artifact.digest,
      filesDigest: appSnapshotFilesDigest(source)
    };
    const first = new SupabaseAppSnapshotStore(storage.client, scope, firstRoot);
    await first.materialize({ ...descriptor, operationId: "detach-1", source });
    await first.materialize({ ...descriptor, operationId: "detach-1", source });

    expect(storage.objects.size).toBe(1);
    expect(await first.exists(descriptor)).toBe(true);
    const second = new SupabaseAppSnapshotStore(storage.client, scope, secondRoot);
    const loaded = await second.loadExact(descriptor);
    expect(loaded.artifact.digest).toBe(source.artifact.digest);
    expect(appSnapshotFilesDigest(loaded)).toBe(descriptor.filesDigest);
  });

  it("rejects a logical-path takeover and remote archive tampering", async () => {
    const storage = new FakeSnapshotStorage();
    const projectRoot = await temporaryRoot("loopgraph-snapshot-tamper-");
    const source = await loadLoopPackDirectory(path.resolve(
      process.cwd(),
      "packs/official/product/turn-feedback-into-product-problems"
    ));
    const descriptor = {
      snapshotPath: ".loopgraph/apps/private-snapshots/private.product-feedback/1.0.0",
      artifactDigest: source.artifact.digest,
      filesDigest: appSnapshotFilesDigest(source)
    };
    const store = new SupabaseAppSnapshotStore(storage.client, scope, projectRoot);
    await store.materialize({ ...descriptor, operationId: "detach-1", source });
    expect(await store.exists({
      ...descriptor,
      artifactDigest: `sha256:${"1".repeat(64)}`,
      filesDigest: `sha256:${"2".repeat(64)}`
    })).toBe(true);

    const [key, object] = [...storage.objects.entries()][0]!;
    storage.objects.set(key, { ...object, bytes: Buffer.from("tampered") });
    await expect(store.assertExact(descriptor)).rejects.toThrow(/snapshot|archive|JSON/i);
  });

  it("keeps identical snapshot identities isolated by tenant", async () => {
    const storage = new FakeSnapshotStorage();
    const projectRoot = await temporaryRoot("loopgraph-snapshot-tenant-");
    const source = await loadLoopPackDirectory(path.resolve(
      process.cwd(),
      "packs/official/product/turn-feedback-into-product-problems"
    ));
    const descriptor = {
      snapshotPath: ".loopgraph/apps/private-snapshots/private.product-feedback/1.0.0",
      artifactDigest: source.artifact.digest,
      filesDigest: appSnapshotFilesDigest(source)
    };
    await new SupabaseAppSnapshotStore(storage.client, scope, projectRoot)
      .materialize({ ...descriptor, operationId: "detach-1", source });
    await new SupabaseAppSnapshotStore(storage.client, {
      ...scope,
      organizationId: "123e4567-e89b-12d3-a456-426614174001"
    }, projectRoot).materialize({ ...descriptor, operationId: "detach-1", source });

    expect(storage.objects.size).toBe(2);
    expect([...storage.objects.keys()].every((key) => key.startsWith("123e4567-"))).toBe(true);
  });

  it("repairs a damaged disposable cache from the exact remote archive", async () => {
    const storage = new FakeSnapshotStorage();
    const projectRoot = await temporaryRoot("loopgraph-snapshot-cache-");
    const source = await loadLoopPackDirectory(path.resolve(
      process.cwd(),
      "packs/official/product/turn-feedback-into-product-problems"
    ));
    const descriptor = {
      snapshotPath: ".loopgraph/apps/private-snapshots/private.product-feedback/1.0.0",
      artifactDigest: source.artifact.digest,
      filesDigest: appSnapshotFilesDigest(source)
    };
    const store = new SupabaseAppSnapshotStore(storage.client, scope, projectRoot);
    await store.materialize({ ...descriptor, operationId: "detach-1", source });
    const loaded = await store.loadExact(descriptor);
    await rm(loaded.root, { recursive: true, force: true });
    await mkdir(loaded.root, { recursive: true });
    await writeFile(path.join(loaded.root, "looppack.yaml"), "tampered");

    const recovered = await store.loadExact(descriptor);

    expect(recovered.artifact.digest).toBe(source.artifact.digest);
    expect(appSnapshotFilesDigest(recovered)).toBe(descriptor.filesDigest);
  });

  it("inventories only exact tenant objects and projects paths to opaque digests", async () => {
    const storage = new FakeSnapshotStorage();
    const projectRoot = await temporaryRoot("loopgraph-snapshot-inventory-");
    const source = await loadLoopPackDirectory(path.resolve(
      process.cwd(),
      "packs/official/product/turn-feedback-into-product-problems"
    ));
    const descriptor = {
      snapshotPath: ".loopgraph/apps/private-snapshots/private.product-feedback/1.0.0",
      artifactDigest: source.artifact.digest,
      filesDigest: appSnapshotFilesDigest(source)
    };
    await new SupabaseAppSnapshotStore(storage.client, scope, projectRoot)
      .materialize({ ...descriptor, operationId: "detach-inventory", source });
    storage.objects.set(
      `${scope.organizationId}/${scope.projectKey}/acme/unexpected/archive.json`,
      { bytes: Buffer.from("unexpected"), mediaType: "application/json" }
    );
    storage.objects.set(
      `123e4567-e89b-12d3-a456-426614174001/${scope.projectKey}/acme/unexpected/archive.json`,
      { bytes: Buffer.from("foreign"), mediaType: "application/json" }
    );

    const inventory = await inventoryHostedAppSnapshotObjects(storage.client, scope);

    expect(inventory).toEqual({
      objectKeyDigests: [expect.stringMatching(/^sha256:[a-f0-9]{64}$/)],
      malformedObjects: 1
    });
    expect(JSON.stringify(inventory)).not.toContain(scope.organizationId);
    expect(JSON.stringify(inventory)).not.toContain(scope.projectKey);
    expect(JSON.stringify(inventory)).not.toContain("acme");
  });
});

async function temporaryRoot(prefix: string): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), prefix));
  temporaryDirectories.push(root);
  return root;
}

class FakeSnapshotStorage {
  readonly objects = new Map<string, { bytes: Buffer; mediaType: string }>();

  readonly client = {
    storage: {
      from: (bucket: string) => {
        if (bucket !== HOSTED_APP_SNAPSHOT_BUCKET) throw new Error(`unexpected bucket ${bucket}`);
        return {
          list: async (
            prefix: string,
            options?: { limit?: number; offset?: number }
          ) => {
            const entries = new Map<string, { id: string | null; name: string }>();
            for (const key of this.objects.keys()) {
              if (!key.startsWith(`${prefix}/`)) continue;
              const suffix = key.slice(prefix.length + 1);
              const [name, ...remaining] = suffix.split("/");
              if (!name) continue;
              entries.set(name, { id: remaining.length === 0 ? key : null, name });
            }
            const sorted = [...entries.values()].sort((left, right) => left.name.localeCompare(right.name));
            const offset = options?.offset ?? 0;
            const limit = options?.limit ?? sorted.length;
            return { data: sorted.slice(offset, offset + limit), error: null };
          },
          upload: async (key: string, body: Buffer, options: { contentType: string; upsert: boolean }) => {
            if (options.upsert) throw new Error("snapshot uploads must not upsert");
            if (this.objects.has(key)) {
              return { data: null, error: { statusCode: 409, message: "Asset Already Exists" } };
            }
            this.objects.set(key, { bytes: Buffer.from(body), mediaType: options.contentType });
            return { data: { path: key }, error: null };
          },
          download: async (key: string) => {
            const object = this.objects.get(key);
            return object
              ? { data: new Blob([Uint8Array.from(object.bytes)], { type: object.mediaType }), error: null }
              : { data: null, error: { statusCode: 404, message: "not found" } };
          }
        };
      }
    }
  } as unknown as SupabaseClient;
}
