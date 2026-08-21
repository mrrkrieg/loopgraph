import { describe, expect, it, vi } from "vitest";
import { validateStagingDeployment } from "./validate-staging";

const token = `observability.${"a".repeat(40)}.token`;

describe("staging deployment validation", () => {
  it("uses fresh workload request metadata and emits a body-free receipt", async () => {
    let allowedRequests = 0;
    const fetcher = vi.fn(async (input: URL | RequestInfo, init?: RequestInit) => {
      const url = new URL(input instanceof URL ? input : String(input));
      if (url.pathname === "/api/health/ready") {
        expect(new Headers(init?.headers).has("authorization")).toBe(false);
        return json({ status: "ready" });
      }
      const headers = new Headers(init?.headers);
      if (url.pathname === "/api/integrations") {
        expect(headers.has("authorization")).toBe(false);
        const cookie = headers.get("cookie");
        if (!cookie) return json({ error: "private-unauthenticated-body" }, 401);
        if (cookie === "foreign=1") return json({ error: "private-foreign-body" }, 403);
        if (cookie === "suspended=1") return json({ error: "private-suspended-body" }, 403);
        expect(cookie).toBe("allowed=1");
        allowedRequests += 1;
        const remaining = Math.max(0, 3 - allowedRequests);
        return json(
          allowedRequests <= 3 ? { integrations: [] } : { error: "private-quota-body" },
          allowedRequests <= 3 ? 200 : 429,
          {
            "x-ratelimit-limit": "3",
            "x-ratelimit-remaining": String(remaining),
            "x-ratelimit-reset": "1786924801",
            ...(allowedRequests > 3 ? { "retry-after": "1" } : {})
          }
        );
      }
      expect(headers.get("authorization")).toBe(`Bearer ${token}`);
      expect(headers.get("x-loopgraph-organization-id")).toBe(
        "123e4567-e89b-42d3-a456-426614174000"
      );
      expect(headers.get("x-loopgraph-project-key")).toBe("main");
      expect(headers.get("x-loopgraph-request-id")).toMatch(/^staging_/);
      if (url.pathname === "/api/operations/metrics") {
        return new Response([
          "loopgraph_ready 1",
          "loopgraph_security_audit_head_sequence 42",
          "loopgraph_operational_degraded 0",
          "loopgraph_app_lifecycle_recovery_pending 0",
          "loopgraph_app_lifecycle_recovery_stale 0",
          "loopgraph_app_lifecycle_recovery_oldest_age_seconds 0"
        ].join("\n"));
      }
      return json({
        integrity: {
          valid: true,
          headSequence: 43,
          headHash: "a".repeat(64)
        },
        events: [{ secret: "not-in-receipt" }]
      });
    });

    const receipt = await validateStagingDeployment({
      baseUrl: "https://staging.loopgraph.test",
      organizationId: "123e4567-e89b-42d3-a456-426614174000",
      projectKey: "main",
      observabilityToken: token,
      userCookies: {
        allowed: "allowed=1",
        foreignTenant: "foreign=1",
        suspended: "suspended=1"
      },
      expectedUserApiQuotaLimit: 3,
      maximumQuotaWaitSeconds: 5
    }, {
      fetcher: fetcher as typeof fetch,
      requestId: () => "123e4567-e89b-42d3-a456-426614174999",
      now: () => new Date("2026-08-17T00:00:00.000Z")
    });

    expect(receipt).toMatchObject({
      schemaVersion: "staging-validation/v4",
      targetOrigin: "https://staging.loopgraph.test",
      organizationId: "123e4567-e89b-42d3-a456-426614174000",
      projectKey: "main",
      auditCheckpoint: { headSequence: 43, headHash: "a".repeat(64) },
      results: [
        { name: "readiness", ok: true },
        { name: "operational_metrics", ok: true },
        { name: "audit_integrity", ok: true },
        { name: "unauthenticated_user_denial", status: 401, ok: true },
        { name: "cross_tenant_user_denial", status: 403, ok: true },
        { name: "suspended_user_denial", status: 403, ok: true },
        { name: "user_api_quota_saturation", status: 429, ok: true }
      ],
      quotaEvidence: {
        bucket: "admin",
        limit: 3,
        allowedRequests: 3,
        deniedStatus: 429,
        retryAfterSeconds: 1
      }
    });
    expect(JSON.stringify(receipt)).not.toContain(token);
    expect(JSON.stringify(receipt)).not.toContain("not-in-receipt");
    expect(JSON.stringify(receipt)).not.toContain("private-");
    expect(JSON.stringify(receipt)).not.toContain("allowed=1");
    expect(allowedRequests).toBe(4);
  });

  it("waits once for a partially consumed quota window and then proves a fresh window", async () => {
    let allowedRequests = 0;
    const sleep = vi.fn(async () => undefined);
    const fetcher = vi.fn(async (input: URL | RequestInfo, init?: RequestInit) => {
      const url = new URL(input instanceof URL ? input : String(input));
      if (url.pathname === "/api/health/ready") return json({ status: "ready" });
      if (url.pathname === "/api/operations/metrics") {
        return new Response([
          "loopgraph_ready 1",
          "loopgraph_security_audit_head_sequence 1",
          "loopgraph_operational_degraded 0",
          "loopgraph_app_lifecycle_recovery_pending 0",
          "loopgraph_app_lifecycle_recovery_stale 0",
          "loopgraph_app_lifecycle_recovery_oldest_age_seconds 0"
        ].join("\n"));
      }
      if (url.pathname === "/api/operations/audit-export") {
        return json({ integrity: { valid: true, headSequence: 1, headHash: "b".repeat(64) } });
      }
      const cookie = new Headers(init?.headers).get("cookie");
      if (!cookie) return json({ error: "unauthenticated" }, 401);
      if (cookie !== "allowed=1") return json({ error: "membership" }, 403);
      allowedRequests += 1;
      const states = [
        { status: 200, remaining: 1 },
        { status: 200, remaining: 2 },
        { status: 200, remaining: 1 },
        { status: 200, remaining: 0 },
        { status: 429, remaining: 0 }
      ];
      const state = states[allowedRequests - 1];
      if (!state) throw new Error("Unexpected allowed request");
      return json({}, state.status, {
        "x-ratelimit-limit": "3",
        "x-ratelimit-remaining": String(state.remaining),
        "x-ratelimit-reset": "1786924801",
        ...(state.status === 429 ? { "retry-after": "1" } : {})
      });
    });

    await expect(validateStagingDeployment({
      baseUrl: "https://staging.loopgraph.test",
      organizationId: "123e4567-e89b-42d3-a456-426614174000",
      projectKey: "main",
      observabilityToken: token,
      userCookies: {
        allowed: "allowed=1",
        foreignTenant: "foreign=1",
        suspended: "suspended=1"
      },
      expectedUserApiQuotaLimit: 3,
      maximumQuotaWaitSeconds: 5
    }, {
      fetcher: fetcher as typeof fetch,
      now: () => new Date("2026-08-17T00:00:00.000Z"),
      nowMs: () => Date.parse("2026-08-17T00:00:00.000Z"),
      sleep
    })).resolves.toMatchObject({
      quotaEvidence: { limit: 3, allowedRequests: 3, deniedStatus: 429 }
    });
    expect(sleep).toHaveBeenCalledOnce();
    expect(sleep).toHaveBeenCalledWith(1_100);
  });

  it("rejects insecure origins before making a request", async () => {
    const fetcher = vi.fn();
    await expect(validateStagingDeployment({
      baseUrl: "http://staging.loopgraph.test",
      organizationId: "123e4567-e89b-42d3-a456-426614174000",
      projectKey: "main",
      observabilityToken: token,
      userCookies: {
        allowed: "allowed=1",
        foreignTenant: "foreign=1",
        suspended: "suspended=1"
      },
      expectedUserApiQuotaLimit: 3
    }, { fetcher: fetcher as typeof fetch })).rejects.toThrow(/must use HTTPS/i);
    expect(fetcher).not.toHaveBeenCalled();
  });
});

function json(
  body: unknown,
  status = 200,
  headers: Record<string, string> = {}
) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers }
  });
}
