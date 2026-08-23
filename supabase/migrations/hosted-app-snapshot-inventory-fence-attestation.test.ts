import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("hosted App snapshot inventory fence attestation migration", () => {
  it("attests the exact enabled triggers and service-only reader without exposing catalogs", async () => {
    const sql = await readFile(
      "supabase/migrations/20260823003138_hosted_app_snapshot_inventory_fence_attestation.sql",
      "utf8"
    );

    expect(sql).toMatch(/create or replace function public\.loopgraph_app_snapshot_inventory_fence_status_get\(\)/i);
    expect(sql).toMatch(/language plpgsql[\s\S]*?stable[\s\S]*?security definer[\s\S]*?set search_path = ''/i);
    expect(sql).toMatch(/namespace_row\.nspname = 'storage'[\s\S]*?relation_row\.relname = 'objects'/i);
    expect(sql).toMatch(/trigger_row\.tgname = 'loopgraph_app_snapshot_inventory_generation'/i);
    expect(sql).toMatch(/namespace_row\.nspname = 'public'[\s\S]*?relation_row\.relname = 'loopgraph_app_installation_registries'/i);
    expect(sql).toMatch(/trigger_row\.tgname = 'loopgraph_app_snapshot_inventory_registry_generation'/i);
    expect(sql).toMatch(/trigger_row\.tgenabled in \('O', 'A'\)/i);
    expect(sql).toMatch(/not pg_catalog\.has_function_privilege\([\s\S]*?'anon'/i);
    expect(sql).toMatch(/not pg_catalog\.has_function_privilege\([\s\S]*?'authenticated'/i);
    expect(sql).toMatch(/pg_catalog\.has_function_privilege\([\s\S]*?'service_role'/i);
    expect(sql).toMatch(/mutationFunctionsTriggerOnly/i);
    expect(sql).toMatch(/mutationFunctionsHardened/i);
    expect(sql).toMatch(/count\(function_oid\) = 4/i);
    expect(sql).toMatch(/function_row\.prosecdef[\s\S]*?'search_path=""' = any\(function_row\.proconfig\)/i);
    expect(sql).toMatch(/revoke all on function public\.loopgraph_app_snapshot_inventory_fence_status_get\(\)[\s\S]*?from public, anon, authenticated/i);
    expect(sql).toMatch(/grant execute on function public\.loopgraph_app_snapshot_inventory_fence_status_get\(\)[\s\S]*?to service_role/i);
    expect(sql).not.toMatch(/return query|select \*/i);
  });
});
