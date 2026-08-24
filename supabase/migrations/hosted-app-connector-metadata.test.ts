import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("hosted App connector metadata migration", () => {
  it("keeps schemas and mappings tenant scoped, sample-free, service-role-only, and audited", async () => {
    const sql = await readFile("supabase/migrations/202608210003_hosted_app_connector_metadata.sql", "utf8");
    expect(sql).toContain("primary key (organization_id, project_key, workspace_id, connection_id)");
    expect(sql).toContain("primary key (organization_id, project_key, workspace_id, mapping_id)");
    expect(sql.match(/enable row level security/g)).toHaveLength(2);
    expect(sql).toContain("revoke all on public.loopgraph_provider_schema_snapshots from public, anon, authenticated, service_role");
    expect(sql).toContain("revoke all on public.loopgraph_connector_field_mappings from public, anon, authenticated, service_role");
    expect(sql).toContain("jsonb_path_exists(p_snapshot, '$.objects[*].fields[*].sampleValues[*]')");
    expect(sql).toContain("stale Loopgraph field mapping would drop installation ownership");
    expect(sql).toContain("private.append_security_audit_event");
    expect(sql).toContain("app.provider_schema.recorded");
    expect(sql).toContain("app.field_mapping.confirmed");
    expect(sql.match(/security definer\nset search_path = ''/g)).toHaveLength(4);
  });
});
