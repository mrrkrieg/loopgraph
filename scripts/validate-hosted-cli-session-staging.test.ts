import { describe, expect, it, vi } from "vitest";
import {
  validateHostedCliSessionStaging,
  type HostedCliSessionStagingConfig,
  type HostedCliSessionStagingCredentials
} from "./validate-hosted-cli-session-staging";

const config: HostedCliSessionStagingConfig = {
  primaryBaseUrl: "https://cli-primary.loopgraph.test",
  replicaBaseUrl: "https://cli-replica.loopgraph.test",
  organizationId: "123e4567-e89b-42d3-a456-426614174000",
  projectKey: "main",
  requestRateLimit: 3
};
const credentials: HostedCliSessionStagingCredentials = {
  disposableRefreshToken: `lgcli_refresh_${"r".repeat(43)}`,
  suspendedAccessToken: `lgcli_access_${"s".repeat(43)}`,
  revokedAccessToken: `lgcli_access_${"v".repeat(43)}`,
  observabilityToken: `observability.${"o".repeat(40)}.token`
};
const firstRotation = tokens("a", "m");
const secondRotation = tokens("b", "n");

describe("hosted CLI session staging gate", () => {
  it("proves bounded issuance, cross-replica rotation, replay revocation, and tenant audit evidence", async () => {
    let deviceRequests = 0;
    let pollRequests = 0;
    let initialRefreshRequests = 0;
    let acceptedCatalogRequests = 0;
    let acceptedRequestId = "";
    let familyRevoked = false;
    const fetcher = vi.fn(async (input: URL | RequestInfo, init?: RequestInit) => {
      const url = new URL(input instanceof URL ? input : String(input));
      const headers = new Headers(init?.headers);
      const authorization = headers.get("authorization") ?? "";
      if (url.pathname === "/api/operations/metrics") {
        expect(authorization).toBe(`Bearer ${credentials.observabilityToken}`);
        return new Response("loopgraph_security_audit_head_sequence 41\n");
      }
      if (url.pathname === "/api/operations/audit-export") {
        expect(authorization).toBe(`Bearer ${credentials.observabilityToken}`);
        return json({
          schemaVersion: "loopgraph-security-audit-export/v2",
          organizationId: config.organizationId,
          projectKey: config.projectKey,
          afterSequence: 41,
          throughSequence: 42,
          integrity: { valid: true, headHash: "e".repeat(64) },
          events: [{
            event_type: "machine.request.authorized",
            capability: "marketplace.consume",
            request_id: acceptedRequestId
          }],
          hasMore: false
        });
      }
      if (url.pathname === "/api/auth/device/code") {
        deviceRequests += 1;
        if (deviceRequests > 5) return oauthError("slow_down", 429);
        return json({
          device_code: `lgdc_${String(deviceRequests).repeat(43)}`,
          user_code: "ABCD-EFGH",
          verification_uri: `${url.origin}/device`,
          verification_uri_complete: `${url.origin}/device?user_code=ABCD-EFGH`,
          expires_in: 600,
          interval: 5
        });
      }
      if (url.pathname === "/api/auth/device/token") {
        pollRequests += 1;
        return pollRequests === 1
          ? oauthError("authorization_pending", 400)
          : oauthError("slow_down", 429);
      }
      if (url.pathname === "/api/auth/device/refresh") {
        const body = JSON.parse(String(init?.body)) as { refresh_token: string };
        if (body.refresh_token === credentials.disposableRefreshToken) {
          initialRefreshRequests += 1;
          if (initialRefreshRequests === 1) return json(firstRotation);
          familyRevoked = true;
          return oauthError("refresh_token_reused", 400);
        }
        if (body.refresh_token === firstRotation.refresh_token) return json(secondRotation);
        return oauthError("invalid_grant", 400);
      }
      if (url.pathname === "/api/marketplace/client/catalog") {
        if (authorization === `Bearer ${credentials.suspendedAccessToken}`) {
          return json({ error: "membership_required" }, 403);
        }
        if (authorization === `Bearer ${credentials.revokedAccessToken}` || familyRevoked) {
          return json({ error: "invalid_or_expired_session" }, 401);
        }
        expect(authorization).toBe(`Bearer ${secondRotation.access_token}`);
        const timestamp = Date.parse(headers.get("x-loopgraph-timestamp") ?? "");
        if (timestamp < Date.parse("2026-08-23T11:55:00.000Z")) {
          return json({ error: "invalid_or_stale_request_metadata" }, 400);
        }
        acceptedCatalogRequests += 1;
        if (acceptedCatalogRequests > config.requestRateLimit) {
          return json({ error: "rate_limited" }, 429);
        }
        acceptedRequestId ||= headers.get("x-loopgraph-request-id") ?? "";
        return json({
          schemaVersion: "hosted-marketplace-machine-search/v1",
          query: { limit: 1 },
          results: []
        });
      }
      throw new Error(`Unexpected staging request ${url}`);
    });
    let requestSequence = 0;
    const receipt = await validateHostedCliSessionStaging(config, credentials, {
      fetcher: fetcher as typeof fetch,
      now: () => new Date("2026-08-23T12:00:00.000Z"),
      requestId: () => `123e4567-e89b-42d3-a456-${String(++requestSequence).padStart(12, "0")}`
    });

    expect(receipt).toMatchObject({
      schemaVersion: "hosted-cli-session-staging-validation/v1",
      primaryOrigin: "https://cli-primary.loopgraph.test",
      replicaOrigin: "https://cli-replica.loopgraph.test",
      organizationId: config.organizationId,
      projectKey: "main",
      controls: {
        deviceFingerprintLimit: 5,
        requestRateLimit: 3,
        crossReplica: true,
        disposableSessionRevoked: true
      },
      auditEvidence: {
        afterSequence: 41,
        throughSequence: 42,
        headHash: "e".repeat(64),
        requestId: acceptedRequestId
      }
    });
    expect(receipt.checks.map((check) => check.name)).toEqual([
      "device_issuance_saturation",
      "polling_slow_down",
      "primary_refresh_rotation",
      "cross_replica_refresh_rotation",
      "stale_request_metadata_denial",
      "suspended_membership_denial",
      "revoked_session_denial",
      "request_rate_saturation",
      "refresh_replay_family_revocation",
      "independent_audit_evidence"
    ]);
    expect(JSON.stringify(receipt)).not.toContain(credentials.disposableRefreshToken);
    expect(JSON.stringify(receipt)).not.toContain(secondRotation.access_token);
    expect(JSON.stringify(receipt)).not.toContain(credentials.observabilityToken);
  });

  it("rejects one-origin or unbounded staging configurations before using a credential", async () => {
    await expect(validateHostedCliSessionStaging({
      ...config,
      replicaBaseUrl: config.primaryBaseUrl
    }, credentials)).rejects.toThrow(/distinct primary and replica/i);
    await expect(validateHostedCliSessionStaging({
      ...config,
      requestRateLimit: 100
    }, credentials)).rejects.toThrow(/2 through 20/i);
  });
});

function tokens(accessCharacter: string, refreshCharacter: string) {
  return {
    access_token: `lgcli_access_${accessCharacter.repeat(43)}`,
    token_type: "Bearer" as const,
    expires_in: 900,
    refresh_token: `lgcli_refresh_${refreshCharacter.repeat(43)}`,
    refresh_expires_at: "2026-09-22T12:00:00.000Z",
    scope: "marketplace.consume",
    organization_id: config.organizationId,
    project_key: config.projectKey
  };
}

function json(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json" }
  });
}

function oauthError(error: string, status: number) {
  return json({ error, error_description: error }, status);
}
