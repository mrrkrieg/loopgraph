import { describe, expect, it } from "vitest";
import { validateLoopSpec } from "loopgraph/core";
import { buildDemoDiscoverySession } from "./discovery-engine";
import { tryMaterializeLoopRecommendation } from "./loop-materializer";

describe("loop materializer", () => {
  it("materializes an accepted recommendation into a valid LoopSpec", async () => {
    const session = await buildDemoDiscoverySession();
    const recommendation = { ...session.recommendedLoops[0], status: "accepted" as const };
    const departmentProfile = session.departmentProfiles.find((department) => department.id === recommendation.departmentId);
    const result = tryMaterializeLoopRecommendation({
      recommendation,
      companyProfile: session.companyProfile!,
      departmentProfile: departmentProfile!,
      accessRequirements: session.accessRequirements.filter((access) => access.loopRecommendationId === recommendation.id),
      metricDefinitions: session.metricDefinitions.filter((metric) => metric.loopRecommendationId === recommendation.id),
      humanRequirements: session.humanRequirements.filter((human) => human.loopRecommendationId === recommendation.id)
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(() => validateLoopSpec(result.spec)).not.toThrow();
      expect(result.spec.metadata.labels?.recommendationId).toBe(recommendation.id);
    }
  });

  it("does not materialize rejected recommendations", async () => {
    const session = await buildDemoDiscoverySession();
    const recommendation = { ...session.recommendedLoops[0], status: "rejected" as const };
    const result = tryMaterializeLoopRecommendation({
      recommendation,
      companyProfile: session.companyProfile!,
      departmentProfile: session.departmentProfiles[0],
      accessRequirements: [],
      metricDefinitions: [],
      humanRequirements: []
    });

    expect(result.ok).toBe(false);
  });
});

