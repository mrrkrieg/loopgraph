import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("hosted App rollback recovery migration", () => {
  it("accepts only an exact bounded rollback rematerialization contract", async () => {
    const sql = await readFile("supabase/migrations/202608220006_app_rollback_recovery.sql", "utf8");

    expect(sql).toContain("commit_loopgraph_app_installation_registry");
    expect(sql).toContain("'install', 'uninstall', 'activate', 'pause', 'resume', 'rollback'");
    expect(sql).toContain("'activation', 'rollout', 'uninstall', 'rollback', 'actor'");
    expect(sql).toContain("item.value->>'action' not in ('uninstall', 'rollback')");
    expect(sql).toContain("item.value->>'action' = 'rollback' and item.value->>'status' = 'completed' and item.value->>'resultReceiptId' is null");
    expect(sql).toContain("item.value->>'action' = 'rollback'");
    expect(sql).toContain("jsonb_typeof(item.value->'rollback') is distinct from 'object'");
    expect(sql).toContain("'fromUpdatedAt', 'sourceArtifactDigest', 'sourceInstallationDigest'");
    expect(sql).toContain("'sourceOwnershipDigest', 'sourceWorkspaceRevision', 'sourceLoopInventoryDigest'");
    expect(sql).toContain("'sourceLoopIds', 'targetInstallationDigest', 'targetOwnershipDigest'");
    expect(sql).toContain("'targetLoopInventoryDigest', 'targetLoopIds'");
    expect(sql).toContain("jsonb_typeof(item.value#>'{rollback,sourceWorkspaceRevision}') is distinct from 'number'");
    expect(sql).toContain("count(*) <> count(distinct loop_id.value)");
    expect(sql).toContain("jsonb_array_length(item.value#>'{desired,loopIds}') <> jsonb_array_length(item.value#>'{rollback,targetLoopIds}')");
    expect(sql).toContain("item.value#>'{desired,loopIds}' @> item.value#>'{rollback,targetLoopIds}'");
    expect(sql).toContain("item.value#>'{rollback,targetLoopIds}' @> item.value#>'{desired,loopIds}'");
    expect(sql).toContain("item.value->>'action' <> 'rollback' and item.value->'rollback' is not null");
    expect(sql).toContain("App rollback operations require an exact rematerialization contract");
    expect(sql).toContain("private.append_security_audit_event");
    expect(sql).toContain("from public, anon, authenticated, service_role");
    expect(sql).toContain("to service_role");
  });
});
