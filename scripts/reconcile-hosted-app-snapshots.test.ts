import type { SupabaseClient } from "@supabase/supabase-js";
import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { canonicalAppDigest } from "loopgraph/core";
import { emptyAppInstallationRegistry } from "loopgraph/runtime";
import {
  assertHostedAppSnapshotReconciliationScope,
  hostedAppSnapshotReconciliationScopeDigest,
  reconcileHostedAppSnapshotRegistries,
  reconcileHostedAppSnapshots
} from "./reconcile-hosted-app-snapshots";

const scope = {
  supabaseUrl: "https://snapshot-production.supabase.co",
  organizationId: "123e4567-e89b-12d3-a456-426614174000",
  projectKey: "main"
};
const config = {
  ...scope,
  expectedScopeDigest: hostedAppSnapshotReconciliationScopeDigest(scope),
  expectedUnreferencedInventoryDigest: canonicalAppDigest({ objectKeyDigests: [] }),
  allowEmptyInventory: true
};

describe("hosted App snapshot reconciliation", () => {
  it("scans only the exact tenant/project and emits an aggregate-only receipt", async () => {
    const client = registryClient([{
      workspace_id: "workspace-a",
      registry_payload: emptyAppInstallationRegistry("workspace-a")
    }]);
    let timestamp = 100;
    const receipt = await reconcileHostedAppSnapshots(config, {
      client,
      now: () => new Date("2026-08-22T20:00:00.000Z"),
      nowMs: () => (timestamp += 25)
    });

    expect(receipt).toEqual({
      schemaVersion: "hosted-app-snapshot-reconciliation/v2",
      checkedAt: "2026-08-22T20:00:00.000Z",
      durationMs: 25,
      scopeDigest: expect.stringMatching(/^sha256:[0-9a-f]{64}$/),
      inventoryPasses: 2,
      inventoryGeneration: 0,
      inventoryGenerationDigest: expect.stringMatching(/^sha256:[0-9a-f]{64}$/),
      registriesScanned: 1,
      detachedInstallations: 0,
      verifiedSnapshots: 0,
      missingSnapshots: 0,
      corruptSnapshots: 0,
      untrackedSnapshots: 0,
      unavailableSnapshots: 0,
      storageObjects: 0,
      referencedStorageObjects: 0,
      unreferencedSnapshots: 0,
      malformedStorageObjects: 0,
      unreferencedInventoryDigest: canonicalAppDigest({ objectKeyDigests: [] }),
      healthy: true,
      checks: [
        { name: "tenant_registry_scan", ok: true },
        { name: "pinned_scope_identity", ok: true },
        { name: "non_empty_inventory_policy", ok: true },
        { name: "durable_descriptor_authority", ok: true },
        { name: "exact_archive_verification", ok: true },
        { name: "stable_cross_store_inventory", ok: true },
        { name: "exact_storage_inventory", ok: true },
        { name: "pinned_unreferenced_retention", ok: true },
        { name: "aggregate_only_receipt", ok: true }
      ]
    });
    const serialized = JSON.stringify(receipt);
    expect(serialized).not.toContain(config.supabaseUrl);
    expect(serialized).not.toContain(config.organizationId);
    expect(serialized).not.toContain(config.projectKey);
    expect(serialized).not.toContain("workspace-a");
  });

  it("rejects duplicate workspace authorities before storage verification", async () => {
    const registry = emptyAppInstallationRegistry("workspace-a");
    await expect(reconcileHostedAppSnapshotRegistries(
      [registry, registry],
      () => ({}) as never
    )).rejects.toThrow(/duplicate workspace registry/);
  });

  it("rejects an unsafe control-plane origin before inventory access", async () => {
    await expect(reconcileHostedAppSnapshots({
      ...config,
      supabaseUrl: "http://snapshot-production.supabase.co/path?token=secret"
    }, {
      client: registryClient([])
    })).rejects.toThrow(/HTTPS origin/);
  });

  it("verifies the pinned origin before a privileged client can be created", () => {
    expect(() => assertHostedAppSnapshotReconciliationScope({
      ...scope,
      supabaseUrl: "https://wrong-project.supabase.co",
      expectedScopeDigest: config.expectedScopeDigest
    })).toThrow(/pinned identity/);
  });

  it("rejects a drifted scope and requires an explicit empty-inventory policy", async () => {
    await expect(reconcileHostedAppSnapshots({
      ...config,
      expectedScopeDigest: `sha256:${"f".repeat(64)}`
    }, {
      client: registryClient([])
    })).rejects.toThrow(/pinned identity/);

    const receipt = await reconcileHostedAppSnapshots({
      ...config,
      allowEmptyInventory: false
    }, {
      client: registryClient([]),
      now: () => new Date("2026-08-22T20:00:00.000Z"),
      nowMs: () => 100
    });
    expect(receipt.healthy).toBe(false);
    expect(receipt.checks).toContainEqual({ name: "non_empty_inventory_policy", ok: false });
  });

  it("blocks an unreviewed retained object without exposing its Storage identity", async () => {
    const digest = "a".repeat(64);
    const client = registryClient([], [
      `${scope.organizationId}/${scope.projectKey}/workspace-a/${digest}/${digest}/${digest}.loopgraph-pack.json`
    ]);
    const receipt = await reconcileHostedAppSnapshots(config, {
      client,
      now: () => new Date("2026-08-22T20:00:00.000Z"),
      nowMs: () => 100
    });

    expect(receipt).toMatchObject({
      storageObjects: 1,
      referencedStorageObjects: 0,
      unreferencedSnapshots: 1,
      malformedStorageObjects: 0,
      healthy: false
    });
    expect(receipt.unreferencedInventoryDigest).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(receipt.checks).toContainEqual({ name: "pinned_unreferenced_retention", ok: false });
    expect(JSON.stringify(receipt)).not.toContain("workspace-a");
  });

  it("accepts the exact independently reviewed retained-object digest", async () => {
    const digest = "b".repeat(64);
    const objectKey =
      `${scope.organizationId}/${scope.projectKey}/workspace-b/${digest}/${digest}/${digest}.loopgraph-pack.json`;
    const first = await reconcileHostedAppSnapshots(config, {
      client: registryClient([], [objectKey]),
      now: () => new Date("2026-08-22T20:00:00.000Z"),
      nowMs: () => 100
    });
    const reviewed = await reconcileHostedAppSnapshots({
      ...config,
      expectedUnreferencedInventoryDigest: first.unreferencedInventoryDigest
    }, {
      client: registryClient([], [objectKey]),
      now: () => new Date("2026-08-22T20:00:00.000Z"),
      nowMs: () => 100
    });

    expect(reviewed).toMatchObject({
      storageObjects: 1,
      referencedStorageObjects: 0,
      unreferencedSnapshots: 1,
      malformedStorageObjects: 0,
      healthy: true
    });
    expect(reviewed.checks).toContainEqual({ name: "pinned_unreferenced_retention", ok: true });
    expect(JSON.stringify(reviewed)).not.toContain("workspace-b");
  });

  it("repeats the full registry and Storage scan when offset pagination changes", async () => {
    const digest = "c".repeat(64);
    const objectKeys = Array.from({ length: 100 }, (_, index) =>
      `${scope.organizationId}/${scope.projectKey}/workspace-${index.toString().padStart(3, "0")}` +
      `/${digest}/${digest}/${digest}.loopgraph-pack.json`
    );
    const addedObject =
      `${scope.organizationId}/${scope.projectKey}/workspace-000a` +
      `/${digest}/${digest}/${digest}.loopgraph-pack.json`;
    let inserted = false;
    const client = registryClient([], objectKeys, {
      onList: (prefix, offset, bumpGeneration) => {
        if (!inserted && prefix === `${scope.organizationId}/${scope.projectKey}` && offset === 0) {
          inserted = true;
          objectKeys.push(addedObject);
          bumpGeneration();
        }
      }
    });

    const receipt = await reconcileHostedAppSnapshots({
      ...config,
      expectedUnreferencedInventoryDigest: retentionDigestForObjectKeys([...objectKeys, addedObject])
    }, {
      client,
      now: () => new Date("2026-08-22T20:00:00.000Z"),
      nowMs: () => 100
    });

    expect(receipt).toMatchObject({
      inventoryPasses: 3,
      storageObjects: 101,
      unreferencedSnapshots: 101,
      malformedStorageObjects: 0,
      healthy: true
    });
  });

  it("repeats the full pass when registry authority changes after the registry read", async () => {
    const rows = [{
      workspace_id: "workspace-a",
      registry_payload: emptyAppInstallationRegistry("workspace-a")
    }];
    let inserted = false;
    const client = registryClient(rows, [], {
      onList: (prefix, offset, bumpGeneration) => {
        if (!inserted && prefix === `${scope.organizationId}/${scope.projectKey}` && offset === 0) {
          inserted = true;
          rows.push({
            workspace_id: "workspace-b",
            registry_payload: emptyAppInstallationRegistry("workspace-b")
          });
          bumpGeneration();
        }
      }
    });

    const receipt = await reconcileHostedAppSnapshots(config, {
      client,
      now: () => new Date("2026-08-22T20:00:00.000Z"),
      nowMs: () => 100
    });

    expect(receipt).toMatchObject({
      inventoryPasses: 3,
      inventoryGeneration: 1,
      registriesScanned: 2,
      healthy: true
    });
  });

  it("fails closed when the cross-store inventory never stabilizes", async () => {
    const digest = "d".repeat(64);
    const objectKeys: string[] = [];
    let reads = 0;
    const client = registryClient([], objectKeys, {
      onRegistryRead: (bumpGeneration) => {
        const workspace = `workspace-${reads.toString().padStart(3, "0")}`;
        objectKeys.push(
          `${scope.organizationId}/${scope.projectKey}/${workspace}` +
          `/${digest}/${digest}/${digest}.loopgraph-pack.json`
        );
        reads += 1;
        bumpGeneration();
      }
    });

    await expect(reconcileHostedAppSnapshots(config, { client }))
      .rejects.toThrow(/bounded stability window/i);
  });

  it("keeps the privileged workflow schedule-only and commit-pinned", async () => {
    const workflow = await readFile(".github/workflows/app-snapshot-reconciliation.yml", "utf8");
    expect(workflow).not.toContain("workflow_dispatch");
    expect(workflow).toContain("github.ref == 'refs/heads/loopgraph/canvas-first'");
    expect(workflow).toContain('ref: "${{ github.sha }}"');
    expect(workflow).toContain("persist-credentials: false");
    expect(workflow).toMatch(/actions\/checkout@[0-9a-f]{40}/);
    expect(workflow).toMatch(/actions\/setup-node@[0-9a-f]{40}/);
    expect(workflow).toMatch(/actions\/upload-artifact@[0-9a-f]{40}/);
    expect(workflow).not.toMatch(/uses:\s+actions\/[a-z-]+@v\d/);
    expect(workflow).toContain("LOOPGRAPH_EXPECTED_APP_SNAPSHOT_UNREFERENCED_INVENTORY_DIGEST");
  });
});

function registryClient(
  rows: Array<{ workspace_id: string; registry_payload: unknown }>,
  objectKeys: string[] = [],
  hooks: {
    onRegistryRead?: (bumpGeneration: () => void) => void;
    onList?: (prefix: string, offset: number, bumpGeneration: () => void) => void;
  } = {}
): SupabaseClient {
  let generation = objectKeys.length;
  const bumpGeneration = () => { generation += 1; };
  const builder = {
    select: () => builder,
    eq: () => builder,
    order: () => builder,
    range: async () => {
      hooks.onRegistryRead?.(bumpGeneration);
      return { data: rows, error: null };
    }
  };
  return {
    from: () => builder,
    rpc: async () => ({ data: generation, error: null }),
    storage: {
      from: () => ({
        list: async (prefix: string, options?: { limit?: number; offset?: number }) => {
          const entries = new Map<string, { id: string | null; name: string }>();
          for (const key of objectKeys) {
            if (!key.startsWith(`${prefix}/`)) continue;
            const suffix = key.slice(prefix.length + 1);
            const [name, ...remaining] = suffix.split("/");
            if (name) entries.set(name, { id: remaining.length === 0 ? key : null, name });
          }
          const sorted = [...entries.values()].sort((left, right) => left.name.localeCompare(right.name));
          const offset = options?.offset ?? 0;
          const limit = options?.limit ?? sorted.length;
          hooks.onList?.(prefix, offset, bumpGeneration);
          return { data: sorted.slice(offset, offset + limit), error: null };
        }
      })
    }
  } as unknown as SupabaseClient;
}

function retentionDigestForObjectKeys(objectKeys: string[]) {
  return canonicalAppDigest({
    objectKeyDigests: objectKeys
      .map((objectKey) => canonicalAppDigest({ objectKey }))
      .sort()
  });
}
