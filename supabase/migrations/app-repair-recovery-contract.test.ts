import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("hosted App repair recovery migration", () => {
  it("accepts only an exact bounded pinned-artifact regeneration contract", async () => {
    const sql = await readFile("supabase/migrations/202608220010_app_repair_recovery.sql", "utf8");

    expect(sql).toContain("commit_loopgraph_app_installation_registry");
    expect(sql).toContain("'install', 'uninstall', 'activate', 'pause', 'resume', 'configure', 'overlay', 'repair', 'update', 'rollback'");
    expect(sql).toContain("'activation', 'rollout', 'configure', 'overlay', 'repair', 'uninstall', 'update', 'rollback', 'actor'");
    expect(sql).toContain("item.value->>'action' not in ('configure', 'overlay', 'repair', 'uninstall', 'update', 'rollback')");
    expect(sql).toContain("item.value->>'action' = 'repair' and item.value->>'status' = 'completed' and item.value->>'resultReceiptId' is null");
    expect(sql).toContain("jsonb_typeof(item.value->'repair') is distinct from 'object'");
    expect(sql).toContain("'sourceOwnershipDigest', 'sourceWorkspaceRevision', 'sourceLoopInventoryDigest'");
    expect(sql).toContain("'sourceLoopIds', 'targetInstallationDigest', 'targetOwnershipDigest'");
    expect(sql).toContain("'targetLoopInventoryDigest', 'targetLoopIds'");
    expect(sql).toContain("item.value->>'action' <> 'repair' and item.value->'repair' is not null");
    expect(sql).toContain("App repair operations require an exact regeneration contract");
    expect(sql).toContain("private.append_security_audit_event");
    expect(sql).toContain("from public, anon, authenticated, service_role");
    expect(sql).toContain("to service_role");
    expect(sql).not.toMatch(/qualificationThreshold|followUpSlaMinutes|repairReason/);
  });
});
