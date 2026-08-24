import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("hosted company context migration", () => {
  it("keeps approved context tenant scoped, revision bound, secret checked, and audited", async () => {
    const sql = await readFile("supabase/migrations/202608210004_hosted_company_context.sql", "utf8");
    expect(sql).toContain("primary key (organization_id, project_key, workspace_id, company_id)");
    expect(sql).toContain("enable row level security");
    expect(sql).toContain("revoke all on public.loopgraph_company_contexts from public, anon, authenticated, service_role");
    expect(sql).toContain("p_expected_revision + 1");
    expect(sql).toContain("Loopgraph company context revision conflict");
    expect(sql).toContain("invalid or secret-bearing Loopgraph company context");
    expect(sql).toContain("github_pat_");
    expect(sql).toContain("jsonb_array_length(p_context->'values') > 500");
    expect(sql).toContain("private.append_security_audit_event");
    expect(sql).toContain("app.company_context.");
    expect(sql.match(/security definer\nset search_path = ''/g)).toHaveLength(1);
  });
});
