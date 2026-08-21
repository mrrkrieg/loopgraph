import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("hosted App installation registry migration", () => {
  it("keeps App lifecycle state tenant scoped, leased, bounded, and audited", async () => {
    const sql = await readFile("supabase/migrations/202608210002_hosted_app_installation_registry.sql", "utf8");
    expect(sql).toContain("primary key (organization_id, project_key, workspace_id)");
    expect(sql).toContain("enable row level security");
    expect(sql).toContain("revoke all on public.loopgraph_app_installation_registries from public, anon, authenticated, service_role");
    expect(sql).toContain("pg_column_size(registry_payload) <= 8388608");
    expect(sql).toContain("acquire_loopgraph_app_installation_lease");
    expect(sql).toContain("Loopgraph App installation registry revision conflict");
    expect(sql).toContain("Loopgraph App installation registry is already being mutated");
    expect(sql).toContain("Loopgraph App installation mutation lease is invalid or expired");
    expect(sql).toContain("mutation changed content without advancing revision");
    expect(sql).toContain("private.append_security_audit_event");
    expect(sql).toContain("app.installation_registry.committed");
    expect(sql.match(/security definer\nset search_path = ''/g)).toHaveLength(3);
  });
});
