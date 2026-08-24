import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("Connector action revocation migration", () => {
  it("revokes one exact action and its unused approvals behind a service-role transaction", async () => {
    const sql = await readFile("supabase/migrations/202608210009_connector_action_revocation.sql", "utf8");
    expect(sql).toContain("revoke_connector_prepared_action");
    expect(sql).toContain("for update");
    expect(sql).toContain("committed actions cannot be revoked");
    expect(sql).toContain("action commit is in progress and requires reconciliation");
    expect(sql).toContain("set status = 'revoked'");
    expect(sql).toContain("connector_action_approvals");
    expect(sql).toContain("append_connector_security_audit_event");
    expect(sql).toContain("reasonDigest");
    expect(sql).toContain("App action revocation is not backed by a revoked Connector Broker action");
    expect(sql).toContain("grant execute on function public.revoke_connector_prepared_action");
    expect(sql).toContain("to service_role");
    expect(sql).not.toContain("to authenticated");
  });
});
