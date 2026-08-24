import { afterEach, describe, expect, it, vi } from "vitest";

const authorizeCronApiRequest = vi.hoisted(() => vi.fn(async () => null));
const getHostedAppEvidenceHealth = vi.hoisted(() => vi.fn());
const emitOperationalLog = vi.hoisted(() => vi.fn());

vi.mock("@/lib/auth/hosted-config", () => ({
  getHostedOrganizationId: () => "123e4567-e89b-12d3-a456-426614174000"
}));
vi.mock("@/lib/observability/app-evidence-health", () => ({ getHostedAppEvidenceHealth }));
vi.mock("@/lib/observability/operational-log", () => ({ emitOperationalLog }));
vi.mock("@/lib/loopgraph-runtime/worker-api-auth", () => ({ authorizeCronApiRequest }));

import { GET } from "./route";

describe("App evidence health schedule", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.clearAllMocks();
  });

  it("uses a distinct read-only schedule capability and emits aggregate health only", async () => {
    vi.stubEnv("LOOPGRAPH_HOSTED_PROJECT_KEY", "main");
    getHostedAppEvidenceHealth.mockResolvedValue({
      schemaVersion: "loopgraph-hosted-app-evidence-health/v1alpha1",
      workspaceId: "main",
      generatedAt: "2026-08-23T08:00:00.000Z",
      health: "degraded",
      totalInstallations: 4,
      totalMatched: 4,
      itemsReturned: 4,
      truncated: false,
      counts: {
        notApplicable: 0,
        incomplete: 1,
        current: 1,
        renewSoon: 1,
        expired: 1,
        invalid: 0
      }
    });

    const response = await GET(new Request("https://loopgraph.local/api/cron/app-evidence-health"));

    expect(response.status).toBe(202);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(authorizeCronApiRequest).toHaveBeenCalledWith(
      expect.any(Request),
      "schedule.app_evidence_health"
    );
    expect(getHostedAppEvidenceHealth).toHaveBeenCalledTimes(1);
    expect(emitOperationalLog).toHaveBeenCalledWith(expect.objectContaining({
      level: "warn",
      event: "app.evidence_health.observed",
      capability: "schedule.app_evidence_health",
      metadata: expect.objectContaining({ expired: 1, renewSoon: 1 })
    }));
    expect(JSON.stringify(emitOperationalLog.mock.calls[0]?.[0])).not.toMatch(
      /installationId|appId|credential|provider|payload/i
    );
  });

  it("fails without returning internal error details", async () => {
    getHostedAppEvidenceHealth.mockRejectedValue(new Error("database secret detail"));

    const response = await GET(new Request("https://loopgraph.local/api/cron/app-evidence-health"));

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({
      error: "App evidence health is temporarily unavailable"
    });
    expect(JSON.stringify(emitOperationalLog.mock.calls[0]?.[0])).not.toContain("database secret detail");
  });
});
