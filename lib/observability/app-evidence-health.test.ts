import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const callLoopgraphAppTool = vi.hoisted(() => vi.fn());
const getActiveLoopgraphProjectRoot = vi.hoisted(() => vi.fn(() => "/runtime/org/main"));

vi.mock("@/lib/app-platform/tool-bridge", () => ({ callLoopgraphAppTool }));
vi.mock("@/lib/loopgraph-runtime/storage-resolver", () => ({ getActiveLoopgraphProjectRoot }));

import { getHostedAppEvidenceHealth } from "./app-evidence-health";

describe("hosted App evidence health", () => {
  beforeEach(() => {
    vi.stubEnv("LOOPGRAPH_HOSTED_PROJECT_KEY", "main");
    callLoopgraphAppTool.mockReset();
  });

  afterEach(() => vi.unstubAllEnvs());

  it.each([
    ["invalid", "blocked"],
    ["expired", "degraded"],
    ["renew_soon", "degraded"],
    ["incomplete", "healthy"],
    ["current", "healthy"]
  ] as const)("maps %s proof to %s without invoking a renewal action", async (status, health) => {
    callLoopgraphAppTool.mockResolvedValue(renewalPlan(status));
    const now = new Date("2026-08-23T08:00:00.000Z");

    const result = await getHostedAppEvidenceHealth({ now });

    expect(result).toMatchObject({
      workspaceId: "main",
      health,
      totalInstallations: 1,
      totalMatched: 1,
      itemsReturned: 1,
      truncated: false
    });
    expect(callLoopgraphAppTool).toHaveBeenCalledTimes(1);
    expect(callLoopgraphAppTool).toHaveBeenCalledWith(
      "loopgraph_apps_renewal_plan",
      { projectRoot: "/runtime/org/main", limit: 100 },
      { projectRoot: "/runtime/org/main", now }
    );
  });

  it("fails closed on a cross-workspace or stale projection", async () => {
    callLoopgraphAppTool.mockResolvedValue({
      ...renewalPlan("current"),
      workspaceId: "foreign"
    });
    await expect(getHostedAppEvidenceHealth({
      now: new Date("2026-08-23T08:00:00.000Z")
    })).rejects.toThrow("cross-workspace");

    callLoopgraphAppTool.mockResolvedValue({
      ...renewalPlan("current"),
      generatedAt: "2026-08-23T07:00:00.000Z"
    });
    await expect(getHostedAppEvidenceHealth({
      now: new Date("2026-08-23T08:00:00.000Z")
    })).rejects.toThrow("stale or future-dated");
  });
});

function renewalPlan(status: "invalid" | "expired" | "renew_soon" | "incomplete" | "current") {
  const counts = {
    notApplicable: 0,
    incomplete: status === "incomplete" ? 1 : 0,
    current: status === "current" ? 1 : 0,
    renewSoon: status === "renew_soon" ? 1 : 0,
    expired: status === "expired" ? 1 : 0,
    invalid: status === "invalid" ? 1 : 0
  };
  return {
    schemaVersion: "loopgraph-app-evidence-renewal-plan/v1alpha1",
    workspaceId: "main",
    companyId: "main",
    generatedAt: "2026-08-23T08:00:00.000Z",
    totalInstallations: 1,
    totalMatched: 1,
    counts,
    items: [{
      installationId: "install_sales",
      appId: "qualify-route-inbound-leads",
      artifactDigest: `sha256:${"a".repeat(64)}`,
      maturity: status === "current" ? "production_proven" : "connected",
      status,
      priority: status === "invalid" || status === "expired"
        ? "critical"
        : status === "renew_soon"
          ? "high"
          : status === "incomplete"
            ? "medium"
            : "none",
      affectedEvidence: [],
      nextAction: {
        kind: status === "invalid"
          ? "repair_evidence"
          : status === "expired" || status === "renew_soon"
            ? "renew_proof"
            : status === "incomplete"
              ? "complete_setup"
              : "monitor",
        summary: "Use the governed App evidence workflow."
      }
    }]
  };
}
