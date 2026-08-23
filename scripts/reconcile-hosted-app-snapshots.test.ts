import type { SupabaseClient } from "@supabase/supabase-js";
import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { emptyAppInstallationRegistry } from "loopgraph/runtime";
import {
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
      schemaVersion: "hosted-app-snapshot-reconciliation/v1",
      checkedAt: "2026-08-22T20:00:00.000Z",
      durationMs: 25,
      scopeDigest: expect.stringMatching(/^sha256:[0-9a-f]{64}$/),
      registriesScanned: 1,
      detachedInstallations: 0,
      verifiedSnapshots: 0,
      missingSnapshots: 0,
      corruptSnapshots: 0,
      untrackedSnapshots: 0,
      unavailableSnapshots: 0,
      healthy: true,
      checks: [
        { name: "tenant_registry_scan", ok: true },
        { name: "pinned_scope_identity", ok: true },
        { name: "non_empty_inventory_policy", ok: true },
        { name: "durable_descriptor_authority", ok: true },
        { name: "exact_archive_verification", ok: true },
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
  });
});

function registryClient(rows: Array<{ workspace_id: string; registry_payload: unknown }>): SupabaseClient {
  const builder = {
    select: () => builder,
    eq: () => builder,
    order: () => builder,
    range: async () => ({ data: rows, error: null })
  };
  return { from: () => builder } as unknown as SupabaseClient;
}
