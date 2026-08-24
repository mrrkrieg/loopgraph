import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("hosted App activation recovery migration", () => {
  it("accepts only exact metadata-only activation recovery authority", async () => {
    const sql = await readFile("supabase/migrations/202608220003_app_activation_recovery.sql", "utf8");

    expect(sql).toContain("commit_loopgraph_app_installation_registry");
    expect(sql).toContain("'install', 'uninstall', 'activate'");
    expect(sql).toContain("'approvalReceiptId', 'approvalDigest', 'fromState', 'targetMode'");
    expect(sql).toContain("^activation-approval\\.[0-9a-f]{16}$");
    expect(sql).toContain("^sha256:[0-9a-f]{64}$");
    expect(sql).toContain("jsonb_array_length(item.value#>'{desired,fieldMappingIds}') <> 0");
    expect(sql).toContain("jsonb_array_length(item.value#>'{desired,companyContextKeys}') <> 0");
    expect(sql).toContain("item.value->>'action' <> 'activate' and item.value->'activation' is not null");
    expect(sql).toContain("private.append_security_audit_event");
    expect(sql).toContain("from public, anon, authenticated, service_role");
    expect(sql).toContain("to service_role");
    expect(sql).not.toMatch(/['"]reason['"]/i);
    expect(sql).not.toContain("evidenceRefs");
  });
});
