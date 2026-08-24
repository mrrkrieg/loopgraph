import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("hosted App update recovery migration", () => {
  it("accepts only an exact bounded reviewed update contract", async () => {
    const sql = await readFile("supabase/migrations/202608220007_app_update_recovery.sql", "utf8");

    expect(sql).toContain("commit_loopgraph_app_installation_registry");
    expect(sql).toContain("'install', 'uninstall', 'activate', 'pause', 'resume', 'update', 'rollback'");
    expect(sql).toContain("'activation', 'rollout', 'uninstall', 'update', 'rollback', 'actor'");
    expect(sql).toContain("item.value->>'action' not in ('uninstall', 'update', 'rollback')");
    expect(sql).toContain("item.value->>'action' = 'update' and item.value->>'status' = 'completed' and item.value->>'resultReceiptId' is null");
    expect(sql).toContain("item.value->>'action' = 'update'");
    expect(sql).toContain("jsonb_typeof(item.value->'update') is distinct from 'object'");
    expect(sql).toContain("'fromUpdatedAt', 'sourceArtifactDigest', 'sourceInstallationDigest'");
    expect(sql).toContain("'sourceLoopIds', 'planDigest', 'approvedPermissionCapabilities'");
    expect(sql).toContain("'targetInstallationDigest', 'targetOwnershipDigest'");
    expect(sql).toContain("jsonb_typeof(item.value#>'{update,sourceWorkspaceRevision}') is distinct from 'number'");
    expect(sql).toContain("jsonb_typeof(item.value#>'{update,approvedPermissionCapabilities}') is distinct from 'array'");
    expect(sql).toContain("jsonb_array_length(item.value#>'{update,approvedPermissionCapabilities}') > 100");
    expect(sql).toContain("count(distinct capability.value)");
    expect(sql).toContain("jsonb_array_length(item.value#>'{desired,loopIds}') <> jsonb_array_length(item.value#>'{update,targetLoopIds}')");
    expect(sql).toContain("item.value#>'{desired,loopIds}' @> item.value#>'{update,targetLoopIds}'");
    expect(sql).toContain("item.value#>'{update,targetLoopIds}' @> item.value#>'{desired,loopIds}'");
    expect(sql).toContain("item.value->>'action' <> 'update' and item.value->'update' is not null");
    expect(sql).toContain("App update operations require an exact reviewed upgrade contract");
    expect(sql).toContain("private.append_security_audit_event");
    expect(sql).toContain("from public, anon, authenticated, service_role");
    expect(sql).toContain("to service_role");
  });
});
