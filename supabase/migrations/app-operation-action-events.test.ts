import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("App operation action events migration", () => {
  it("keeps approval and commit evidence append-only, bounded, tenant-scoped, and receipt-bound", async () => {
    const sql = await readFile("supabase/migrations/202608210008_app_operation_action_events.sql", "utf8");
    expect(sql).toContain("foreign key (organization_id, project_key, workspace_id, action_id)");
    expect(sql).toContain("references public.loopgraph_app_operation_actions");
    expect(sql).toContain("enable row level security");
    expect(sql).toContain("revoke all on public.loopgraph_app_operation_action_events from public, anon, authenticated, service_role");
    expect(sql).toContain("grant select on public.loopgraph_app_operation_action_events to service_role");
    expect(sql).not.toContain("grant insert on public.loopgraph_app_operation_action_events");
    expect(sql).not.toContain("grant update on public.loopgraph_app_operation_action_events");
    expect(sql).toContain("record_loopgraph_app_operation_action_event");
    expect(sql).toContain("for share");
    expect(sql).toContain("does not match its immutable parent");
    expect(sql).toContain("connector_action_approvals approval");
    expect(sql).toContain("App action approval event does not match a Connector Broker approval receipt");
    expect(sql).toContain("App action commit event does not match its assigned Hermes agent");
    expect(sql).toContain("connector_operation_receipts operation_receipt");
    expect(sql).toContain("App action commit event does not match a Connector Broker receipt");
    expect(sql).toContain("'canonicalInput'");
    expect(sql).toContain("private.append_security_audit_event");
    expect(sql).toContain("security definer\nset search_path = ''");
  });
});
