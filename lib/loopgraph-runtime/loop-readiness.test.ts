import { describe, expect, it } from "vitest";
import { buildDemoDiscoverySession } from "./discovery-engine";
import { calculateLoopReadiness } from "./loop-readiness";

describe("loop readiness", () => {
  it("caps readiness when metrics or verifiers are missing", async () => {
    const session = await buildDemoDiscoverySession();
    const recommendation = session.recommendedLoops[0];

    expect(calculateLoopReadiness({ ...recommendation, metricDrafts: [] }).level).toBe("L1");
    expect(calculateLoopReadiness({ ...recommendation, verifierDraft: [] }).level).toBe("L1");
  });

  it("allows L2 with approval, verifier, and explicit access", async () => {
    const session = await buildDemoDiscoverySession();
    const recommendation = session.recommendedLoops[0];
    const readiness = calculateLoopReadiness({
      ...recommendation,
      accessRequirements: recommendation.accessRequirements.map((access) => ({ ...access, status: "connected" })),
      undefinedMetrics: recommendation.undefinedMetrics.filter((metric) => metric.metricKey !== recommendation.metricDrafts[0]?.key)
    });
    expect(readiness.level).toBe("L2");
  });

  it("allows low-risk loops to reach L3 when access and primary metrics are ready", async () => {
    const session = await buildDemoDiscoverySession();
    const recommendation = session.recommendedLoops.find((loop) => loop.name === "Feedback Clustering Loop");
    expect(recommendation).toBeTruthy();
    const readiness = calculateLoopReadiness({
      ...recommendation!,
      accessRequirements: recommendation!.accessRequirements.map((access) => ({ ...access, status: "connected" })),
      allowedActions: recommendation!.allowedActions.map((action) => ({ ...action, riskLevel: "low", requiresApproval: false })),
      undefinedMetrics: recommendation!.undefinedMetrics.filter((metric) => metric.metricKey !== recommendation!.metricDrafts[0]?.key)
    });
    expect(readiness.level).toBe("L3");
  });

  it("blocks risky autonomous writes without approval", async () => {
    const session = await buildDemoDiscoverySession();
    const recommendation = session.recommendedLoops[0];
    const readiness = calculateLoopReadiness({
      ...recommendation,
      readiness: { ...recommendation.readiness, level: "L4" },
      allowedActions: [{ key: "external.write", label: "External write", riskLevel: "critical", requiresApproval: false }]
    });
    expect(readiness.level).toBe("L2");
    expect(readiness.blockers).toContain("High-risk external write requires approval");
  });
});

