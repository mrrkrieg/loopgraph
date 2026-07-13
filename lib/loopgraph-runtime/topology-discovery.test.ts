import { describe, expect, it } from "vitest";
import { buildSemanticTopology } from "loopgraph/core";
import { buildDemoDiscoverySession } from "./discovery-engine";
import { tryMaterializeLoopRecommendation } from "./loop-materializer";

describe("discovery topology integration", () => {
  it("shows accepted materialized loops and excludes rejected recommendations", async () => {
    const session = await buildDemoDiscoverySession();
    const accepted = { ...session.recommendedLoops[0], status: "accepted" as const };
    const rejected = { ...session.recommendedLoops[1], status: "rejected" as const };
    const departmentProfile = session.departmentProfiles.find((department) => department.id === accepted.departmentId);
    const acceptedResult = tryMaterializeLoopRecommendation({
      recommendation: accepted,
      companyProfile: session.companyProfile!,
      departmentProfile: departmentProfile!,
      accessRequirements: session.accessRequirements.filter((access) => access.loopRecommendationId === accepted.id),
      metricDefinitions: session.metricDefinitions.filter((metric) => metric.loopRecommendationId === accepted.id),
      humanRequirements: session.humanRequirements.filter((human) => human.loopRecommendationId === accepted.id)
    });
    const rejectedResult = tryMaterializeLoopRecommendation({
      recommendation: rejected,
      companyProfile: session.companyProfile!,
      departmentProfile: session.departmentProfiles.find((department) => department.id === rejected.departmentId)!,
      accessRequirements: [],
      metricDefinitions: [],
      humanRequirements: []
    });

    expect(acceptedResult.ok).toBe(true);
    expect(rejectedResult.ok).toBe(false);
    const topology = buildSemanticTopology({
      loopSpecs: acceptedResult.ok ? [acceptedResult.spec] : [],
      options: {
        companyName: "Acme SaaS",
        sourceLabel: "Discovery",
        generatedAt: new Date(0).toISOString()
      }
    });
    expect(topology.nodes.some((node) => node.label === "Campaign Learning Loop")).toBe(true);
    expect(topology.nodes.some((node) => node.label === "Follow-Up Latency Loop")).toBe(false);
  });
});

