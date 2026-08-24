import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("hosted App configure recovery migration", () => {
  it("accepts only an exact bounded confirmed-value contract", async () => {
    const sql = await readFile("supabase/migrations/202608220008_app_configure_recovery.sql", "utf8");

    expect(sql).toContain("commit_loopgraph_app_installation_registry");
    expect(sql).toContain("'install', 'uninstall', 'activate', 'pause', 'resume', 'configure', 'update', 'rollback'");
    expect(sql).toContain("'activation', 'rollout', 'configure', 'uninstall', 'update', 'rollback', 'actor'");
    expect(sql).toContain("item.value->>'action' not in ('configure', 'uninstall', 'update', 'rollback')");
    expect(sql).toContain("item.value->>'action' = 'configure' and item.value->>'status' = 'completed' and item.value->>'resultReceiptId' is null");
    expect(sql).toContain("item.value->>'action' = 'configure'");
    expect(sql).toContain("jsonb_typeof(item.value->'configure') is distinct from 'object'");
    expect(sql).toContain("'fromUpdatedAt', 'sourceConfigurationDigest', 'sourceInstallationDigest'");
    expect(sql).toContain("'valuesDigest', 'targetConfigurationDigest', 'targetInstallationDigest'");
    expect(sql).toContain("item.value#>>'{configure,valuesDigest}'");
    expect(sql).toContain("jsonb_array_length(item.value#>'{desired,loopIds}') <> 0");
    expect(sql).toContain("jsonb_array_length(item.value#>'{desired,fieldMappingIds}') <> 0");
    expect(sql).toContain("jsonb_array_length(item.value#>'{desired,companyContextKeys}') <> 0");
    expect(sql).toContain("item.value->>'action' <> 'configure' and item.value->'configure' is not null");
    expect(sql).toContain("App configure operations require an exact confirmed-value contract");
    expect(sql).toContain("private.append_security_audit_event");
    expect(sql).toContain("from public, anon, authenticated, service_role");
    expect(sql).toContain("to service_role");
    expect(sql).not.toMatch(/followUpSlaMinutes|customerFacingPolicy/);
  });
});
