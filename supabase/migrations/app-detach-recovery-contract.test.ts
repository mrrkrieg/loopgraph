import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("hosted App detach recovery migration", () => {
  it("accepts only an exact bounded immutable-snapshot contract", async () => {
    const sql = await readFile("supabase/migrations/202608220012_app_detach_recovery.sql", "utf8");

    expect(sql).toContain("commit_loopgraph_app_installation_registry");
    expect(sql).toContain("'install', 'uninstall', 'activate', 'pause', 'resume', 'configure', 'overlay', 'repair', 'duplicate', 'detach', 'update', 'rollback'");
    expect(sql).toContain("'activation', 'rollout', 'configure', 'overlay', 'repair', 'duplicate', 'detach', 'uninstall', 'update', 'rollback', 'actor'");
    expect(sql).toContain("item.value->>'action' not in ('configure', 'overlay', 'repair', 'duplicate', 'detach', 'uninstall', 'update', 'rollback')");
    expect(sql).toContain("item.value->>'action' = 'detach' and item.value->>'status' = 'completed' and item.value->>'resultReceiptId' is null");
    expect(sql).toContain("jsonb_typeof(item.value->'detach') is distinct from 'object'");
    expect(sql).toContain("'sourceOwnershipDigest', 'sourceWorkspaceRevision', 'sourceLoopInventoryDigest'");
    expect(sql).toContain("'sourceLoopIds', 'snapshotPath', 'snapshotArtifactDigest', 'snapshotFilesDigest'");
    expect(sql).toContain("'targetLoopInventoryDigest', 'targetLoopIds'");
    expect(sql).toContain("item.value->>'action' <> 'detach' and item.value->'detach' is not null");
    expect(sql).toContain("App detach operations require an exact immutable-snapshot contract");
    expect(sql).toContain("private.append_security_audit_event");
    expect(sql).toContain("from public, anon, authenticated, service_role");
    expect(sql).toContain("to service_role");
    expect(sql).not.toMatch(/overlayOperations|configurationValues|accessToken|refreshToken/);
  });
});
