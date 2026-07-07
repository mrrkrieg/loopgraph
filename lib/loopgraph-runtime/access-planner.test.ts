import { describe, expect, it } from "vitest";
import { buildDemoDiscoverySession } from "./discovery-engine";

describe("access planner", () => {
  it("generates required access per recommended loop", async () => {
    const session = await buildDemoDiscoverySession();
    const byLoop = (name: string) => {
      const recommendation = session.recommendedLoops.find((loop) => loop.name === name);
      expect(recommendation).toBeTruthy();
      return session.accessRequirements
        .filter((access) => access.loopRecommendationId === recommendation?.id)
        .map((access) => access.integrationType)
        .sort();
    };

    expect(byLoop("Campaign Learning Loop")).toEqual(expect.arrayContaining(["ads", "analytics", "crm"]));
    expect(byLoop("Lead Qualification Loop")).toEqual(expect.arrayContaining(["crm"]));
    expect(byLoop("Customer Health Loop")).toEqual(expect.arrayContaining(["crm", "support", "usage"]));
  });
});

