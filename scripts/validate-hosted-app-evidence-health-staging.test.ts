import { describe, expect, it, vi } from "vitest";
import {
  validateHostedAppEvidenceHealthStaging,
  type HostedAppEvidenceHealthStagingConfig
} from "./validate-hosted-app-evidence-health-staging";

const config: HostedAppEvidenceHealthStagingConfig = {
  baseUrl: "https://staging.loopgraph.test",
  organizationId: "123e4567-e89b-42d3-a456-426614174000",
  projectKey: "main"
};

const tokens = {
  schedule: `schedule.${"a".repeat(40)}.token`,
  observability: `observability.${"b".repeat(40)}.token`
};

describe("hosted App evidence health staging validation", () => {
  it("proves authorization boundaries, replay protection, aggregate output, and metric parity", async () => {
    const acceptedRequestIds = new Set<string>();
    const fetcher = vi.fn(async (input: URL | RequestInfo, init?: RequestInit) => {
      const url = new URL(input instanceof URL ? input : String(input));
      const headers = new Headers(init?.headers);
      const authorization = headers.get("authorization");
      if (!authorization) return json({ error: "Unauthorized" }, 401);
      if (headers.get("x-loopgraph-organization-id") !== config.organizationId) {
        return json({ error: "Machine credential scope mismatch" }, 403);
      }
      if (url.pathname === "/api/operations/metrics") {
        expect(authorization).toBe(`Bearer ${tokens.observability}`);
        return new Response(metricsFixture(), {
          status: 200,
          headers: {
            "cache-control": "no-store",
            "content-type": "text/plain; version=0.0.4"
          }
        });
      }
      expect(url.pathname).toBe("/api/cron/app-evidence-health");
      expect(authorization).toBe(`Bearer ${tokens.schedule}`);
      const requestId = headers.get("x-loopgraph-request-id") ?? "";
      if (acceptedRequestIds.has(requestId)) {
        return json({ error: "replayed_request" }, 409);
      }
      acceptedRequestIds.add(requestId);
      return json(projectionFixture(), 202);
    });
    const nowMs = vi.fn()
      .mockReturnValueOnce(1_000)
      .mockReturnValueOnce(1_025);

    const receipt = await validateHostedAppEvidenceHealthStaging(config, tokens, {
      fetcher: fetcher as typeof fetch,
      requestId: () => "123e4567-e89b-42d3-a456-426614174999",
      now: () => new Date("2026-08-23T12:00:00.000Z"),
      nowMs
    });

    expect(receipt).toMatchObject({
      schemaVersion: "hosted-app-evidence-health-staging-validation/v1",
      targetOrigin: "https://staging.loopgraph.test",
      organizationId: config.organizationId,
      projectKey: config.projectKey,
      checkedAt: "2026-08-23T12:00:00.000Z",
      durationMs: 25,
      projection: {
        health: "degraded",
        totalInstallations: 5,
        totalMatched: 2,
        itemsReturned: 2,
        truncated: false
      },
      metrics: {
        health: 0,
        totalInstallations: 5,
        itemsReturned: 2,
        truncated: 0
      }
    });
    expect(receipt.checks.map((check) => check.name)).toEqual([
      "unauthenticated_denial",
      "cross_tenant_denial",
      "authorized_health_projection",
      "replay_denial",
      "aggregate_only_contract",
      "metrics_projection_parity"
    ]);
    const serialized = JSON.stringify(receipt);
    expect(serialized).not.toContain(tokens.schedule);
    expect(serialized).not.toContain(tokens.observability);
    expect(JSON.stringify({ projection: receipt.projection, metrics: receipt.metrics }))
      .not.toMatch(/installationId|appId|artifactDigest|credentialId|provider|payload/i);
  });

  it("rejects response fields outside the aggregate-only contract", async () => {
    const fetcher = stagedFetcher({ ...projectionFixture(), items: [{ appId: "secret" }] });
    await expect(validateHostedAppEvidenceHealthStaging(config, tokens, {
      fetcher,
      requestId: () => "123e4567-e89b-42d3-a456-426614174999",
      now: () => new Date("2026-08-23T12:00:00.000Z")
    })).rejects.toThrow(/outside its aggregate-only contract/i);
  });

  it("rejects metric drift from the schedule projection", async () => {
    const fetcher = stagedFetcher(projectionFixture(), metricsFixture().replace(
      "loopgraph_app_evidence_current 2",
      "loopgraph_app_evidence_current 3"
    ));
    await expect(validateHostedAppEvidenceHealthStaging(config, tokens, {
      fetcher,
      requestId: () => "123e4567-e89b-42d3-a456-426614174999",
      now: () => new Date("2026-08-23T12:00:00.000Z")
    })).rejects.toThrow(/do not match/i);
  });

  it("rejects insecure staging origins before sending a token", async () => {
    const fetcher = vi.fn();
    await expect(validateHostedAppEvidenceHealthStaging(
      { ...config, baseUrl: "http://staging.loopgraph.test" },
      tokens,
      { fetcher: fetcher as typeof fetch }
    )).rejects.toThrow(/must use HTTPS/i);
    expect(fetcher).not.toHaveBeenCalled();
  });
});

function stagedFetcher(
  projection: Record<string, unknown>,
  metrics = metricsFixture()
) {
  const acceptedRequestIds = new Set<string>();
  return vi.fn(async (input: URL | RequestInfo, init?: RequestInit) => {
    const url = new URL(input instanceof URL ? input : String(input));
    const headers = new Headers(init?.headers);
    if (!headers.has("authorization")) return json({ error: "Unauthorized" }, 401);
    if (headers.get("x-loopgraph-organization-id") !== config.organizationId) {
      return json({ error: "scope mismatch" }, 403);
    }
    if (url.pathname === "/api/operations/metrics") {
      return new Response(metrics, { headers: { "cache-control": "no-store" } });
    }
    const requestId = headers.get("x-loopgraph-request-id") ?? "";
    if (acceptedRequestIds.has(requestId)) return json({ error: "replayed" }, 409);
    acceptedRequestIds.add(requestId);
    return json(projection, 202);
  }) as typeof fetch;
}

function projectionFixture(): Record<string, unknown> {
  return {
    schemaVersion: "loopgraph-hosted-app-evidence-health/v1alpha1",
    workspaceId: "main",
    generatedAt: "2026-08-23T12:00:00.000Z",
    health: "degraded",
    totalInstallations: 5,
    totalMatched: 2,
    itemsReturned: 2,
    truncated: false,
    counts: {
      invalid: 0,
      expired: 0,
      renewSoon: 1,
      incomplete: 1,
      current: 2,
      notApplicable: 1
    }
  };
}

function metricsFixture() {
  return [
    "loopgraph_ready 1",
    "loopgraph_app_evidence_health 0",
    "loopgraph_app_evidence_installations_total 5",
    "loopgraph_app_evidence_invalid 0",
    "loopgraph_app_evidence_expired 0",
    "loopgraph_app_evidence_renew_soon 1",
    "loopgraph_app_evidence_incomplete 1",
    "loopgraph_app_evidence_current 2",
    "loopgraph_app_evidence_not_applicable 1",
    "loopgraph_app_evidence_items_returned 2",
    "loopgraph_app_evidence_plan_truncated 0",
    ""
  ].join("\n");
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "cache-control": "no-store",
      "content-type": "application/json"
    }
  });
}
