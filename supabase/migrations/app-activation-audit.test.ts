import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("hosted App activation audit migration", () => {
  it("atomically records bounded approval and consumption events without review content", async () => {
    const sql = await readFile("supabase/migrations/202608220002_app_activation_audit.sql", "utf8");

    expect(sql).toContain("commit_loopgraph_app_installation_registry_with_audit");
    expect(sql).toContain("public.commit_loopgraph_app_installation_registry(");
    expect(sql).toContain("private.append_security_audit_event");
    expect(sql).toContain("'app.activation.approved'");
    expect(sql).toContain("'app.activation.consumed'");
    expect(sql).toContain("'app_activation_approval'");
    expect(sql).toContain("^activation-approval\\.[0-9a-f]{16}$");
    expect(sql).toContain("pg_column_size(p_audit_context) > 4096");
    expect(sql).toContain("'installationIdDigest', 'appIdDigest', 'artifactDigest', 'approvalDigest'");
    expect(sql).toContain("'fromState', 'requestedMode', 'evidenceRefCount', 'expiresAt'");
    expect(sql).toContain("audited Loopgraph App installation commit must advance the registry revision");
    expect(sql).toContain("from public, anon, authenticated, service_role");
    expect(sql).toContain("to service_role");
    expect(sql).not.toMatch(/['"]reason['"]/i);
    expect(sql).not.toContain("evidenceRefs");
    expect(sql).not.toMatch(/installationId['"]/);
  });

  it("preserves the bounded onboarding event contract replaced by the migration", async () => {
    const sql = await readFile("supabase/migrations/202608220002_app_activation_audit.sql", "utf8");
    expect(sql).toContain("'app.onboarding_draft.saved'");
    expect(sql).toContain("'app.onboarding_draft.reset'");
    expect(sql).toContain("'app_onboarding_draft'");
    expect(sql).toContain("'appIdDigest', 'presetIdDigest', 'draftRevision', 'presetChanged'");
  });
});
