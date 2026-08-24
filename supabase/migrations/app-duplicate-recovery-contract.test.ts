import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("hosted App duplicate recovery migration", () => {
  it("accepts only an exact bounded derived-installation contract", async () => {
    const sql = await readFile("supabase/migrations/202608220011_app_duplicate_recovery.sql", "utf8");

    expect(sql).toContain("commit_loopgraph_app_installation_registry");
    expect(sql).toContain("'install', 'uninstall', 'activate', 'pause', 'resume', 'configure', 'overlay', 'repair', 'duplicate', 'update', 'rollback'");
    expect(sql).toContain("'activation', 'rollout', 'configure', 'overlay', 'repair', 'duplicate', 'uninstall', 'update', 'rollback', 'actor'");
    expect(sql).toContain("item.value->>'action' not in ('configure', 'overlay', 'repair', 'duplicate', 'uninstall', 'update', 'rollback')");
    expect(sql).toContain("item.value->>'action' = 'duplicate' and item.value->>'status' = 'completed' and item.value->>'resultReceiptId' is null");
    expect(sql).toContain("jsonb_typeof(item.value->'duplicate') is distinct from 'object'");
    expect(sql).toContain("'sourceOwnershipDigest', 'sourceFieldMappingsDigest', 'sourceWorkspaceRevision'");
    expect(sql).toContain("'derivedAppId', 'operationsDigest', 'targetInstallationId'");
    expect(sql).toContain("'targetLoopInventoryDigest', 'targetLoopIds'");
    expect(sql).toContain("item.value->>'action' <> 'duplicate' and item.value->'duplicate' is not null");
    expect(sql).toContain("App duplicate operations require an exact derived-installation contract");
    expect(sql).toContain("private.append_security_audit_event");
    expect(sql).toContain("from public, anon, authenticated, service_role");
    expect(sql).toContain("to service_role");
    expect(sql).not.toMatch(/followUpSlaMinutes|overlayOperations|accessToken|refreshToken/);
  });
});
