import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("hosted App verification registry migration", () => {
  it("keeps verifier trust tenant scoped, service-role-only, immutable, and audited", async () => {
    const sql = await readFile("supabase/migrations/202608210001_hosted_app_verification_registry.sql", "utf8");
    expect(sql).toContain("primary key (organization_id, project_key, workspace_id, verifier_id, key_id)");
    expect(sql).toContain("primary key (organization_id, project_key, workspace_id, receipt_id)");
    expect(sql.match(/enable row level security/g)).toHaveLength(3);
    expect(sql).toContain("revoke all on public.loopgraph_app_verifier_keys from public, anon, authenticated, service_role");
    expect(sql).toContain("p_key ?| array['privateKey', 'privateKeyPem', 'secret', 'token']");
    expect(sql).toContain("p_receipt ?| array['privateKey', 'privateKeyPem', 'secret', 'token']");
    expect(sql).toContain("Loopgraph App verifier key identity conflict");
    expect(sql).toContain("immutable Loopgraph App verification receipt conflict");
    expect(sql).toContain("active trusted Loopgraph App verifier key not found");
    expect(sql).toContain("private.append_security_audit_event");
    expect(sql).toContain("app.verifier_trust.added");
    expect(sql).toContain("app.verifier_trust.revoked");
    expect(sql).toContain("app.verification_receipt.imported");
    expect(sql.match(/security definer\nset search_path = ''/g)).toHaveLength(3);
  });
});
