import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("hosted App snapshot inventory fence probe migration", () => {
  it("uses a reserved random scope, proves all registry mutations, and cleans probe authority", async () => {
    const sql = await readFile(
      "supabase/migrations/20260823003139_hosted_app_snapshot_inventory_fence_probe.sql",
      "utf8"
    );
    expect(sql).toMatch(/create or replace function public\.loopgraph_app_snapshot_registry_fence_probe\(\s*p_organization_id uuid,\s*p_project_key text\s*\)/i);
    expect(sql).toMatch(/p_project_key !~ '\^fence_probe_\[a-f0-9\]\{24\}\$'/i);
    expect(sql).toMatch(/insert into public\.loopgraph_app_installation_registries/i);
    expect(sql).toMatch(/set revision = 1,[\s\S]*?registry_payload = registry_payload/i);
    expect(sql).toMatch(/delete from public\.loopgraph_app_installation_registries/i);
    expect(sql).toMatch(/v_after_insert <= v_before/i);
    expect(sql).toMatch(/v_after_update <= v_after_insert/i);
    expect(sql).toMatch(/v_after_delete <= v_after_update/i);
    expect(sql).toMatch(/delete from public\.loopgraph_app_snapshot_inventory_generations/i);
    expect(sql).toMatch(/from storage\.objects[\s\S]*?bucket_id = 'loopgraph-app-snapshots'/i);
    expect(sql).toMatch(/security definer[\s\S]*?set search_path = ''/i);
    expect(sql).toMatch(/revoke all on function public\.loopgraph_app_snapshot_registry_fence_probe\(uuid, text\)[\s\S]*?from public, anon, authenticated/i);
    expect(sql).toMatch(/grant execute on function public\.loopgraph_app_snapshot_registry_fence_probe\(uuid, text\)[\s\S]*?to service_role/i);
  });
});
