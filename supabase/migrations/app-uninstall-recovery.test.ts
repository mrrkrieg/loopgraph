import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("hosted App uninstall recovery migration", () => {
  it("accepts only bounded, digest-bound removal intent at the service-role commit boundary", async () => {
    const sql = await readFile("supabase/migrations/202608220005_app_uninstall_recovery.sql", "utf8");

    expect(sql).toContain("commit_loopgraph_app_installation_registry");
    expect(sql).toContain("'activation', 'rollout', 'uninstall', 'actor'");
    expect(sql).toContain("item.value->>'action' = 'uninstall'");
    expect(sql).toContain("item.value->>'status' <> 'completed' and item.value->'uninstall' is null");
    expect(sql).toContain("item.value->>'action' <> 'uninstall' and item.value->'uninstall' is not null");
    expect(sql).toContain("v_operation->>'action' = 'uninstall'");
    expect(sql).toContain("new or modified App uninstall operations require exact removal intent");
    expect(sql).toContain("'fromUpdatedAt', 'sourceInstallationDigest', 'sourceOwnershipDigest'");
    expect(sql).toContain("'reasonDigest', 'sourceWorkspaceRevision', 'sourceLoopInventoryDigest'");
    expect(sql).toContain("'remainingLoopInventoryDigest', 'remainingLoopIds'");
    expect(sql).toContain("'{uninstall,sourceInstallationDigest}'");
    expect(sql).toContain("'{uninstall,sourceOwnershipDigest}'");
    expect(sql).toContain("'{uninstall,reasonDigest}'");
    expect(sql).toContain("'{uninstall,sourceLoopInventoryDigest}'");
    expect(sql).toContain("'{uninstall,remainingLoopInventoryDigest}'");
    expect(sql).toContain("jsonb_array_length(item.value#>'{uninstall,remainingLoopIds}') > 100");
    expect(sql).toContain("item.value#>'{desired,loopIds}' @> item.value#>'{uninstall,remainingLoopIds}'");
    expect(sql).toContain("private.append_security_audit_event");
    expect(sql).toContain("from public, anon, authenticated, service_role");
    expect(sql).toContain("to service_role");
    expect(sql).not.toMatch(/['"]reason['"]/i);
    expect(sql).not.toContain("evidenceRefs");
  });
});
