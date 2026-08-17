import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  path.resolve(process.cwd(), "supabase/migrations/202608170004_cli_session_administration.sql"),
  "utf8"
);

describe("CLI session administration migration", () => {
  it("restricts revocation to the service role and an active admin or owner", () => {
    expect(migration).toContain("auth.role() is distinct from 'service_role'");
    expect(migration).toContain("membership.status = 'active'");
    expect(migration).toContain("membership.role in ('admin', 'owner')");
    expect(migration).toContain("revoke all on function public.admin_revoke_cli_access_sessions");
    expect(migration).toContain("to service_role");
  });

  it("binds every target to the exact tenant and records an atomic audit event", () => {
    expect(migration).toContain("session.organization_id = p_organization_id");
    expect(migration).toContain("session.project_key = p_project_key");
    expect(migration).toContain("session.id = p_session_id");
    expect(migration).toContain("session.user_id = p_target_user_id");
    expect(migration).toContain("private.append_security_audit_event(");
    expect(migration).toContain("'cli.session.revoked'");
    expect(migration).toContain("'reason_sha256'");
    expect(migration).not.toContain("'reason', p_reason");
  });
});
