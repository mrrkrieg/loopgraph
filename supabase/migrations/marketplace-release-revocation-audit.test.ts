import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  path.resolve(
    process.cwd(),
    "supabase/migrations/20260823140000_marketplace_release_revocation_audit.sql"
  ),
  "utf8"
);

describe("marketplace release revocation audit migration", () => {
  it("requires service role plus an active administrator in the owning tenant", () => {
    expect(migration).toContain("auth.role() is distinct from 'service_role'");
    expect(migration).toContain("membership.status = 'active'");
    expect(migration).toContain("membership.role in ('admin', 'owner')");
    expect(migration).toContain("app.owner_organization_id = p_organization_id");
    expect(migration).toContain("to service_role");
    expect(migration).toContain(
      "revoke all on function public.set_private_marketplace_release_status"
    );
  });

  it("commits the monotonic transition and reason digest with one audit event", () => {
    expect(migration).toContain("for update of version");
    expect(migration).toContain("v_release.release_status = 'deprecated'");
    expect(migration).toContain("private.append_security_audit_event(");
    expect(migration).toContain("'marketplace.release.status_changed'");
    expect(migration).toContain("'reason_sha256'");
    expect(migration).not.toContain("'reason', p_reason");
  });
});
