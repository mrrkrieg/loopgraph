import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("hosted App onboarding audit migration", () => {
  it("commits an exact bounded onboarding action to the security audit chain", async () => {
    const sql = await readFile("supabase/migrations/202608220001_app_onboarding_audit.sql", "utf8");

    expect(sql).toContain("commit_loopgraph_app_installation_registry_with_audit");
    expect(sql).toContain("public.commit_loopgraph_app_installation_registry(");
    expect(sql).toContain("private.append_security_audit_event");
    expect(sql).toContain("'app.onboarding_draft.saved'");
    expect(sql).toContain("'app.onboarding_draft.reset'");
    expect(sql).toContain("'app_onboarding_draft'");
    expect(sql).toContain("pg_column_size(p_audit_context) > 4096");
    expect(sql).toContain("'appIdDigest', 'presetIdDigest', 'draftRevision', 'presetChanged'");
    expect(sql).toContain("audited Loopgraph App installation commit must advance the registry revision");
    expect(sql).toContain("from public, anon, authenticated, service_role");
    expect(sql).toContain("to service_role");
    expect(sql).not.toContain("configuration");
    expect(sql).not.toContain("fieldMappingIds");
  });
});
