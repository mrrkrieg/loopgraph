import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

const sql = await readFile(
  "supabase/migrations/202608170001_hosted_marketplace_machine_delivery.sql",
  "utf8"
);

describe("hosted marketplace machine delivery migration", () => {
  it("keeps organization visibility and machine delivery service-only", () => {
    expect(sql).toContain("private.can_organization_read_marketplace_app");
    expect(sql).toContain("app.owner_organization_id = p_organization_id");
    expect(sql).toContain("catalog_access.grantee_organization_id = p_organization_id");
    expect(sql).toContain("app.visibility in ('public', 'official')");
    expect(sql).toMatch(/search_marketplace_apps_for_organization[\s\S]*?auth\.role\(\) is distinct from 'service_role'/);
    expect(sql).toMatch(/list_marketplace_versions_for_organization[\s\S]*?auth\.role\(\) is distinct from 'service_role'/);
    expect(sql).toMatch(/get_marketplace_delivery_for_organization[\s\S]*?auth\.role\(\) is distinct from 'service_role'/);
  });

  it("returns no object keys from catalog functions and binds delivery to one digest", () => {
    const searchSection = sql.split("create or replace function public.search_marketplace_apps_for_organization")[1]!
      .split("create or replace function public.list_marketplace_versions_for_organization")[0]!;
    const listSection = sql.split("create or replace function public.list_marketplace_versions_for_organization")[1]!
      .split("create or replace function public.get_marketplace_delivery_for_organization")[0]!;
    expect(searchSection).not.toContain("artifact_object_key");
    expect(listSection).not.toContain("artifact_object_key");
    expect(sql).toContain("and v.artifact_digest = p_artifact_digest");
    expect(sql).toContain("and v.release_status in ('active', 'deprecated')");
    expect(sql).toContain("and v.verified_at is not null");
  });
});
