import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";
import {
  SupabaseConnectorFieldMappingStore,
  SupabaseProviderSchemaSnapshotStore
} from "./supabase-app-connector-metadata-store";

const scope = {
  organizationId: "123e4567-e89b-12d3-a456-426614174000",
  projectKey: "main",
  workspaceId: "acme"
};
const now = new Date("2026-08-21T15:00:00.000Z");

describe("Supabase App connector metadata stores", () => {
  it("rejects unsafe scopes and removes provider sample values before persistence", async () => {
    const fake = new MetadataSupabase();
    expect(() => new SupabaseProviderSchemaSnapshotStore(fake.client, { ...scope, projectKey: "../../escape" })).toThrow(/project key/);
    const store = new SupabaseProviderSchemaSnapshotStore(fake.client, scope);
    const saved = await store.save({
      connectionId: "hubspot-production",
      providerId: "hubspot",
      source: "provider_api",
      samplePolicy: "redacted_only",
      objects: [{
        objectType: "lead",
        fields: [{ name: "email", type: "string", writable: true, sampleValues: ["person@example.com"] }]
      }],
      inspectedBy: "admin@example.com",
      inspectedAt: now.toISOString(),
      expiresAt: "2026-08-22T15:00:00.000Z"
    });
    expect(saved.objects[0]?.fields[0]?.sampleValues).toEqual([]);
    expect(JSON.stringify(fake.rpc.mock.calls)).not.toContain("person@example.com");
    expect(await store.get("hubspot-production", now)).toEqual(saved);
  });

  it("persists confirmed mappings and updates installation ownership through bounded RPCs", async () => {
    const fake = new MetadataSupabase();
    const store = new SupabaseConnectorFieldMappingStore(fake.client, scope);
    const mapping = await store.saveConfirmed({
      connectionId: "hubspot-production",
      objectType: "lead",
      logicalField: "lead.email",
      providerField: "email",
      direction: "read",
      confidence: 0.99,
      confirmedBy: "admin@example.com",
      now
    });
    expect(mapping).toMatchObject({ verified: true, confirmedBy: "admin@example.com", dependentInstallationIds: [] });
    expect((await store.attachInstallation([mapping.id], "install.sales"))[0]?.dependentInstallationIds).toEqual(["install.sales"]);
    expect((await store.detachInstallation("install.sales", now))[0]?.dependentInstallationIds).toEqual([]);
    expect(fake.rpc.mock.calls.map(([name]) => name)).toEqual([
      "upsert_loopgraph_connector_field_mapping",
      "attach_loopgraph_connector_field_mappings",
      "detach_loopgraph_connector_field_mappings"
    ]);
  });
});

class MetadataSupabase {
  snapshots: unknown[] = [];
  mappings: Array<Record<string, unknown>> = [];
  rpc = vi.fn(async (name: string, args: Record<string, unknown>) => {
    if (name === "upsert_loopgraph_provider_schema_snapshot") {
      const snapshot = args.p_snapshot as Record<string, unknown>;
      this.snapshots = [...this.snapshots.filter((value) => (value as Record<string, unknown>).connectionId !== snapshot.connectionId), snapshot];
      return { data: snapshot, error: null };
    }
    if (name === "upsert_loopgraph_connector_field_mapping") {
      const mapping = args.p_mapping as Record<string, unknown>;
      this.mappings = [...this.mappings.filter((value) => value.id !== mapping.id), mapping];
      return { data: mapping, error: null };
    }
    if (name === "attach_loopgraph_connector_field_mappings") {
      const ids = new Set(args.p_mapping_ids as string[]);
      this.mappings = this.mappings.map((mapping) => ids.has(String(mapping.id))
        ? { ...mapping, dependentInstallationIds: [...new Set([...(mapping.dependentInstallationIds as string[]), String(args.p_installation_id)])] }
        : mapping);
      return { data: ids.size, error: null };
    }
    if (name === "detach_loopgraph_connector_field_mappings") {
      this.mappings = this.mappings.map((mapping) => ({
        ...mapping,
        dependentInstallationIds: (mapping.dependentInstallationIds as string[]).filter((id) => id !== args.p_installation_id)
      }));
      return { data: this.mappings.length, error: null };
    }
    return { data: null, error: { message: `unknown RPC ${name}` } };
  });

  client = {
    rpc: this.rpc,
    from: (table: string) => {
      const query = {
        select: () => query,
        eq: () => query,
        order: () => query,
        range: async () => ({
          data: (table === "loopgraph_provider_schema_snapshots" ? this.snapshots : this.mappings).map((payload) => ({ payload })),
          error: null
        })
      };
      return query;
    }
  } as unknown as SupabaseClient;
}
