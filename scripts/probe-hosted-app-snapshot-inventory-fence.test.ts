import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";
import {
  hostedAppSnapshotFenceProbeScopeDigest,
  probeHostedAppSnapshotInventoryFence
} from "./probe-hosted-app-snapshot-inventory-fence";

const scope = {
  supabaseUrl: "https://snapshot-staging.supabase.co",
  organizationId: "123e4567-e89b-42d3-a456-426614174000"
};
const config = {
  ...scope,
  expectedScopeDigest: hostedAppSnapshotFenceProbeScopeDigest(scope),
  allowMutation: true
};
const suffix = "0123456789abcdef01234567";

describe("hosted App snapshot inventory fence probe", () => {
  it("actively proves registry and Storage mutation advances without emitting probe identity", async () => {
    const harness = probeClient();
    let clock = 100;
    const receipt = await probeHostedAppSnapshotInventoryFence(config, {
      client: harness.client,
      probeSuffix: () => suffix,
      now: () => new Date("2026-08-23T04:00:00.000Z"),
      nowMs: () => (clock += 25)
    });

    expect(receipt).toEqual({
      schemaVersion: "hosted-app-snapshot-fence-probe/v1",
      checkedAt: "2026-08-23T04:00:00.000Z",
      durationMs: 25,
      scopeDigest: config.expectedScopeDigest,
      healthy: true,
      checks: [
        { name: "registry_insert_advanced", ok: true },
        { name: "registry_update_advanced", ok: true },
        { name: "registry_delete_advanced", ok: true },
        { name: "storage_upload_advanced", ok: true },
        { name: "storage_replace_advanced", ok: true },
        { name: "storage_delete_advanced", ok: true },
        { name: "probe_authority_clean", ok: true },
        { name: "probe_generation_clean", ok: true }
      ]
    });
    expect(harness.calls).toEqual(["registry", "generation", "upload", "generation", "update", "generation", "remove", "generation", "cleanup"]);
    const serialized = JSON.stringify(receipt);
    expect(serialized).not.toContain(scope.supabaseUrl);
    expect(serialized).not.toContain(scope.organizationId);
    expect(serialized).not.toContain(suffix);
  });

  it("requires an explicit mutation confirmation and independently pinned staging scope", async () => {
    const harness = probeClient();
    await expect(probeHostedAppSnapshotInventoryFence({ ...config, allowMutation: false }, {
      client: harness.client
    })).rejects.toThrow(/explicitly enabled/i);
    await expect(probeHostedAppSnapshotInventoryFence({
      ...config,
      expectedScopeDigest: `sha256:${"f".repeat(64)}`
    }, {
      client: harness.client
    })).rejects.toThrow(/pinned staging scope/i);
    expect(harness.calls).toEqual([]);
  });

  it("removes an uploaded probe object and generation row when replacement fails", async () => {
    const harness = probeClient({ failUpdate: true });
    await expect(probeHostedAppSnapshotInventoryFence(config, {
      client: harness.client,
      probeSuffix: () => suffix
    })).rejects.toThrow(/replace failed/i);
    expect(harness.calls).toEqual(["registry", "generation", "upload", "generation", "update", "remove", "cleanup"]);
  });

  it("rejects a malformed probe identity before privileged calls", async () => {
    const harness = probeClient();
    await expect(probeHostedAppSnapshotInventoryFence(config, {
      client: harness.client,
      probeSuffix: () => "not-random"
    })).rejects.toThrow(/identity is invalid/i);
    expect(harness.calls).toEqual([]);
  });
});

function probeClient(options: { failUpdate?: boolean } = {}) {
  let generation = 0;
  const calls: string[] = [];
  const client = {
    rpc: async (name: string, args: Record<string, unknown>) => {
      expect(args.p_project_key).toMatch(/^fence_probe_[0-9a-f]{24}$/);
      if (name === "loopgraph_app_snapshot_registry_fence_probe") {
        calls.push("registry");
        return {
          data: {
            schemaVersion: "hosted-app-snapshot-registry-fence-probe/v1",
            insertAdvanced: true,
            updateAdvanced: true,
            deleteAdvanced: true,
            registryClean: true,
            generationClean: true
          },
          error: null
        };
      }
      if (name === "loopgraph_app_snapshot_inventory_generation_get") {
        calls.push("generation");
        return { data: generation, error: null };
      }
      if (name === "loopgraph_app_snapshot_storage_fence_probe_cleanup") {
        calls.push("cleanup");
        generation = 0;
        return { data: true, error: null };
      }
      return { data: null, error: new Error("unexpected RPC") };
    },
    storage: {
      from: () => ({
        upload: async (key: string) => {
          calls.push("upload");
          expect(key).toMatch(/^123e4567-e89b-42d3-a456-426614174000\/fence_probe_[0-9a-f]{24}\/fence-probe-/);
          generation += 1;
          return { data: { path: key }, error: null };
        },
        update: async () => {
          calls.push("update");
          if (options.failUpdate) return { data: null, error: new Error("replace failed") };
          generation += 1;
          return { data: { path: "opaque" }, error: null };
        },
        remove: async () => {
          calls.push("remove");
          generation += 1;
          return { data: [], error: null };
        }
      })
    }
  } as unknown as SupabaseClient;
  return { client, calls };
}
