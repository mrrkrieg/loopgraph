import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("hosted App snapshot inventory generation migration", () => {
  it("fences registry and private-bucket mutations behind a service-only generation read", async () => {
    const sql = await readFile(
      "supabase/migrations/20260823003137_hosted_app_snapshot_inventory_generation.sql",
      "utf8"
    );

    expect(sql).toMatch(/create table if not exists public\.loopgraph_app_snapshot_inventory_generations/i);
    expect(sql).toMatch(/after insert or update or delete on storage\.objects/i);
    expect(sql).toMatch(/after insert or update or delete on public\.loopgraph_app_installation_registries/i);
    expect(sql).toMatch(/old\.registry_payload[\s\S]*?new\.registry_payload/i);
    expect(sql).toMatch(/loopgraph_app_snapshot_inventory_generation_advance\([\s\S]*?old\.organization_id[\s\S]*?old\.project_key/i);
    expect(sql).toMatch(/old\.bucket_id = 'loopgraph-app-snapshots'/i);
    expect(sql).toMatch(/new\.bucket_id = 'loopgraph-app-snapshots'/i);
    expect(sql).toMatch(/on conflict \(organization_id, project_key\) do update/i);
    expect(sql).toMatch(/generation\s*=\s*public\.loopgraph_app_snapshot_inventory_generations\.generation \+ 1/i);
    expect(sql).toMatch(/security definer[\s\S]*?set search_path = ''/i);
    expect(sql).toMatch(/revoke all on table[\s\S]*?from public, anon, authenticated/i);
    expect(sql).toMatch(/grant execute on function public\.loopgraph_app_snapshot_inventory_generation_get\(uuid, text\)[\s\S]*?to service_role/i);
    expect(sql).toMatch(/revoke all on function public\.loopgraph_app_snapshot_inventory_generation_bump_registry\(\)[\s\S]*?from public, anon, authenticated/i);
    expect(sql).not.toMatch(/grant\s+(select|insert|update|delete|all)\s+on\s+table[\s\S]*?to\s+(anon|authenticated|public)/i);
  });
});
