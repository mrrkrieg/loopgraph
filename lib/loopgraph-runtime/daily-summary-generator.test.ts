import { describe, expect, it } from "vitest";
import { buildDemoDiscoverySession } from "./discovery-engine";
import { generateDailySummary } from "./daily-summary-generator";
import { tryMaterializeLoopRecommendation } from "./loop-materializer";

describe("daily summary generator", () => {
  it("marks missing access and undefined metrics in loop status", async () => {
    const session = await buildDemoDiscoverySession();
    const accepted = session.recommendedLoops.slice(0, 2).map((recommendation) => ({ ...recommendation, status: "accepted" as const }));
    const specs = accepted.flatMap((recommendation) => {
      const departmentProfile = session.departmentProfiles.find((department) => department.id === recommendation.departmentId);
      const result = tryMaterializeLoopRecommendation({
        recommendation,
        companyProfile: session.companyProfile!,
        departmentProfile: departmentProfile!,
        accessRequirements: session.accessRequirements.filter((access) => access.loopRecommendationId === recommendation.id),
        metricDefinitions: session.metricDefinitions.filter((metric) => metric.loopRecommendationId === recommendation.id),
        humanRequirements: session.humanRequirements.filter((human) => human.loopRecommendationId === recommendation.id)
      });
      return result.ok ? [result.spec] : [];
    });

    const summary = generateDailySummary({
      companyId: session.companyId,
      loopSpecs: specs,
      traces: [],
      cases: [],
      reviews: [],
      accessRequirements: session.accessRequirements,
      metricDefinitions: session.metricDefinitions,
      undefinedMetrics: session.undefinedMetrics,
      improvements: []
    });

    expect(summary.netSavedMinutes).toBeLessThan(summary.grossSavedMinutes);
    expect(summary.loops.map((loop) => loop.status)).toContain("missing_access");
    expect(summary.recommendedActions.some((action) => action.targetType === "access")).toBe(true);
  });
});

