import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("hosted App overlay recovery migration", () => {
  it("accepts only an exact bounded graph-rematerialization contract", async () => {
    const sql = await readFile("supabase/migrations/202608220009_app_overlay_recovery.sql", "utf8");

    expect(sql).toContain("commit_loopgraph_app_installation_registry");
    expect(sql).toContain("'install', 'uninstall', 'activate', 'pause', 'resume', 'configure', 'overlay', 'update', 'rollback'");
    expect(sql).toContain("'activation', 'rollout', 'configure', 'overlay', 'uninstall', 'update', 'rollback', 'actor'");
    expect(sql).toContain("item.value->>'action' not in ('configure', 'overlay', 'uninstall', 'update', 'rollback')");
    expect(sql).toContain("item.value->>'action' = 'overlay' and item.value->>'status' = 'completed' and item.value->>'resultReceiptId' is null");
    expect(sql).toContain("jsonb_typeof(item.value->'overlay') is distinct from 'object'");
    expect(sql).toContain("'sourceOwnershipDigest', 'sourceWorkspaceRevision', 'sourceLoopInventoryDigest'");
    expect(sql).toContain("'sourceLoopIds', 'expectedOverlayRevision', 'operationsDigest'");
    expect(sql).toContain("'targetLoopInventoryDigest', 'targetLoopIds'");
    expect(sql).toContain("item.value#>>'{overlay,operationsDigest}'");
    expect(sql).toContain("jsonb_array_length(item.value#>'{desired,fieldMappingIds}') <> 0");
    expect(sql).toContain("jsonb_array_length(item.value#>'{desired,companyContextKeys}') <> 0");
    expect(sql).toContain("item.value->>'action' <> 'overlay' and item.value->'overlay' is not null");
    expect(sql).toContain("App overlay operations require an exact graph rematerialization contract");
    expect(sql).toContain("private.append_security_audit_event");
    expect(sql).toContain("from public, anon, authenticated, service_role");
    expect(sql).toContain("to service_role");
    expect(sql).not.toMatch(/qualificationThreshold|followUpSlaMinutes|disable_module/);
  });
});
