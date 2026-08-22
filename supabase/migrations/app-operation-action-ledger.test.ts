import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("App operation action ledger migration", () => {
  it("stores only bounded tenant-scoped App ownership records behind one audited RPC", async () => {
    const sql = await readFile("supabase/migrations/202608210007_app_operation_action_ledger.sql", "utf8");
    expect(sql).toContain("primary key (organization_id, project_key, workspace_id, action_id)");
    expect(sql).toContain("enable row level security");
    expect(sql).toContain("revoke all on public.loopgraph_app_operation_actions from public, anon, authenticated, service_role");
    expect(sql).toContain("grant select on public.loopgraph_app_operation_actions to service_role");
    expect(sql).not.toContain("grant insert on public.loopgraph_app_operation_actions");
    expect(sql).not.toContain("grant update on public.loopgraph_app_operation_actions");
    expect(sql).toContain("record_loopgraph_app_operation_action");
    expect(sql).toContain("p_action->>'status' <> 'prepared'");
    expect(sql).toContain("pg_column_size(p_action) > 65536");
    expect(sql).toContain("'canonicalInput'");
    expect(sql).toContain("prepared App action identity conflict");
    expect(sql).toContain("private.append_security_audit_event");
    expect(sql).toContain("app.operation_action.prepared");
    expect(sql).toContain("security definer\nset search_path = ''");
  });
});
