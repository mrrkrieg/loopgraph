import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import {
  validateHostedCliAdminStaging,
  type HostedCliAdminStagingConfig,
  type HostedCliAdminStagingCredentials
} from "./validate-hosted-cli-admin-staging";

const config: HostedCliAdminStagingConfig = {
  baseUrl: "https://cli-admin.loopgraph.test",
  organizationId: "123e4567-e89b-42d3-a456-426614174000",
  projectKey: "main",
  targetSessionId: "123e4567-e89b-42d3-a456-426614174010"
};
const credentials: HostedCliAdminStagingCredentials = {
  aal1AdminCookie: "sb-test-auth-token=aal1-cookie-value",
  aal2AdminCookie: "sb-test-auth-token=aal2-cookie-value",
  targetAccessToken: `lgcli_access_${"a".repeat(43)}`,
  observabilityToken: `observability.${"o".repeat(40)}.token`
};
const correlationId = "cli_session_revoke_123e4567-e89b-42d3-a456-426614174099";
const reason = "Disposable staging CLI MFA revocation drill";

describe("hosted CLI administrator staging gate", () => {
  it("proves AAL1 denial, AAL2 exact revocation, access denial, and retained audit evidence", async () => {
    let revoked = false;
    const fetcher = vi.fn(async (input: URL | RequestInfo, init?: RequestInit) => {
      const url = new URL(input instanceof URL ? input : String(input));
      const headers = new Headers(init?.headers);
      const cookie = headers.get("cookie") ?? "";
      if (url.pathname === "/api/operations/metrics") {
        expect(headers.get("authorization")).toBe(`Bearer ${credentials.observabilityToken}`);
        return new Response("loopgraph_security_audit_head_sequence 70\n");
      }
      if (url.pathname === "/api/auth/cli-sessions" && init?.method === "DELETE") {
        expect(headers.get("origin")).toBe(config.baseUrl);
        const body = JSON.parse(String(init.body));
        expect(body).toEqual({
          scope: "session",
          sessionId: config.targetSessionId,
          reason
        });
        if (cookie === credentials.aal1AdminCookie) {
          expect(revoked).toBe(false);
          return json({
            error: "Multi-factor step-up authentication is required.",
            code: "step_up_required"
          }, 403);
        }
        expect(cookie).toBe(credentials.aal2AdminCookie);
        expect(revoked).toBe(false);
        revoked = true;
        return json({
          schemaVersion: "cli-session-revocation/v1",
          accepted: true,
          revokedCount: 1,
          correlationId
        });
      }
      if (url.pathname === "/api/auth/cli-sessions") {
        expect(cookie).toBe(credentials.aal2AdminCookie);
        expect(url.searchParams.get("offset")).toBe("0");
        expect(url.searchParams.get("limit")).toBe("100");
        return json({
          schemaVersion: "cli-session-admin/v1",
          sessions: [{
            id: config.targetSessionId,
            status: revoked ? "revoked" : "active"
          }],
          offset: 0,
          limit: 100,
          total: 1
        });
      }
      if (url.pathname === "/api/marketplace/client/catalog") {
        expect(revoked).toBe(true);
        expect(headers.get("authorization")).toBe(`Bearer ${credentials.targetAccessToken}`);
        return json({ error: "invalid_or_expired_session" }, 401);
      }
      if (url.pathname === "/api/operations/audit-export") {
        const reasonDigest = createHash("sha256").update(reason, "utf8").digest("hex");
        return json({
          schemaVersion: "loopgraph-security-audit-export/v2",
          organizationId: config.organizationId,
          projectKey: config.projectKey,
          afterSequence: 70,
          throughSequence: 71,
          integrity: { valid: true, headHash: "e".repeat(64) },
          events: [{
            event_type: "cli.session.revoked",
            outcome: "accepted",
            actor_type: "user",
            capability: "marketplace.consume",
            correlation_id: correlationId,
            source: "cli-session-admin",
            resource_type: "cli_access_session_session",
            resource_id: config.targetSessionId,
            metadata: {
              scope: "session",
              revoked_count: 1,
              reason_recorded: true,
              reason_sha256: reasonDigest
            }
          }],
          hasMore: false
        });
      }
      throw new Error(`Unexpected staging request ${url}`);
    });
    let requestSequence = 0;
    const receipt = await validateHostedCliAdminStaging(config, credentials, {
      fetcher: fetcher as typeof fetch,
      now: () => new Date("2026-08-23T15:00:00.000Z"),
      requestId: () => `123e4567-e89b-42d3-a456-${String(++requestSequence).padStart(12, "0")}`
    });

    expect(receipt).toMatchObject({
      schemaVersion: "hosted-cli-admin-staging-validation/v1",
      targetOrigin: config.baseUrl,
      organizationId: config.organizationId,
      projectKey: config.projectKey,
      controls: {
        aal1Denied: true,
        aal2Required: true,
        exactSessionScope: true,
        atomicAuditReceipt: true,
        disposableSessionRevoked: true
      },
      revocation: { revokedCount: 1, correlationId },
      auditEvidence: {
        afterSequence: 70,
        throughSequence: 71,
        headHash: "e".repeat(64),
        correlationId
      }
    });
    expect(receipt.checks.map((check) => check.name)).toEqual([
      "aal1_step_up_denial",
      "aal2_exact_session_revocation",
      "post_revocation_inventory",
      "revoked_cli_access_denial",
      "independent_audit_evidence"
    ]);
    const serialized = JSON.stringify(receipt);
    expect(serialized).not.toContain(credentials.aal1AdminCookie);
    expect(serialized).not.toContain(credentials.aal2AdminCookie);
    expect(serialized).not.toContain(credentials.targetAccessToken);
    expect(serialized).not.toContain(credentials.observabilityToken);
    expect(serialized).not.toContain(config.targetSessionId);
    expect(serialized).not.toContain(reason);
  });

  it("rejects unsafe origins, target identities, and credential projections before fetching", async () => {
    await expect(validateHostedCliAdminStaging({
      ...config,
      baseUrl: "http://cli-admin.loopgraph.test"
    }, credentials)).rejects.toThrow(/HTTPS origin/i);
    await expect(validateHostedCliAdminStaging({
      ...config,
      targetSessionId: "not-a-session"
    }, credentials)).rejects.toThrow(/target session ID/i);
    await expect(validateHostedCliAdminStaging(config, {
      ...credentials,
      aal2AdminCookie: "bad\ncookie"
    })).rejects.toThrow(/AAL2 administrator cookie/i);
  });
});

function json(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json" }
  });
}
