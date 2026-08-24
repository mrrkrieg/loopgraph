import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("hosted App rollout recovery migration", () => {
  it("accepts only exact metadata-only pause and resume transitions", async () => {
    const sql = await readFile("supabase/migrations/202608220004_app_rollout_recovery.sql", "utf8");

    expect(sql).toContain("commit_loopgraph_app_installation_registry");
    expect(sql).toContain("'install', 'uninstall', 'activate', 'pause', 'resume'");
    expect(sql).toContain("'fromState', 'fromMode', 'fromUpdatedAt', 'targetState', 'targetMode'");
    expect(sql).toContain("'{rollout,fromUpdatedAt}'");
    expect(sql).toContain("item.value->>'action' = 'pause'");
    expect(sql).toContain("item.value->>'action' = 'resume'");
    expect(sql).toContain("item.value->>'action' not in ('pause', 'resume') and item.value->'rollout' is not null");
    expect(sql).toContain("jsonb_array_length(item.value#>'{desired,fieldMappingIds}') <> 0");
    expect(sql).toContain("jsonb_array_length(item.value#>'{desired,companyContextKeys}') <> 0");
    expect(sql).toContain("private.append_security_audit_event");
    expect(sql).toContain("from public, anon, authenticated, service_role");
    expect(sql).toContain("to service_role");
    expect(sql).not.toMatch(/['"]reason['"]/i);
    expect(sql).not.toContain("evidenceRefs");
  });
});
