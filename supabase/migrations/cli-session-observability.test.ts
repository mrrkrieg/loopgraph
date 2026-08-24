import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const sql = readFileSync(
  new URL("./20260823093000_cli_session_observability.sql", import.meta.url),
  "utf8"
).toLowerCase();

describe("CLI session observability migration", () => {
  it("exposes only tenant-scoped aggregate security posture to the service role", () => {
    expect(sql).toContain("get_cli_session_security_snapshot");
    expect(sql).toContain("auth.role() is distinct from 'service_role'");
    expect(sql).toContain("session.organization_id = p_organization_id");
    expect(sql).toContain("session.project_key = p_project_key");
    expect(sql).toContain("cli_refresh_reuse_detected_24h");
    expect(sql).toContain("cli_refresh_reuse_unrevoked");
    expect(sql).toContain("cli_device_authorizations_oldest_pending_seconds");
    expect(sql).toContain("from public, anon, authenticated");
    expect(sql).toContain("to service_role");
  });

  it("does not project credential, user, device, or fingerprint identities", () => {
    const projection = sql.slice(sql.indexOf("return jsonb_build_object"));
    expect(projection).not.toContain("access_token_hash',");
    expect(projection).not.toContain("refresh_token_hash',");
    expect(projection).not.toContain("user_id',");
    expect(projection).not.toContain("device_code_hash',");
    expect(projection).not.toContain("request_fingerprint_hash',");
  });
});
