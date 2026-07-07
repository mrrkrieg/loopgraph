import { describe, expect, it } from "vitest";
import { buildDemoDiscoverySession } from "./discovery-engine";

describe("business discovery engine", () => {
  it("builds the Acme SaaS discovery pipeline with recommendations and plans", async () => {
    const session = await buildDemoDiscoverySession();
    expect(session.companyProfile?.name).toBe("Acme SaaS");
    expect(session.departmentProfiles.length).toBeGreaterThanOrEqual(5);
    expect(session.processInventory.length).toBe(5);
    expect(session.accessRequirements.length).toBeGreaterThan(0);
    expect(session.metricDefinitions.length).toBeGreaterThan(0);
    expect(session.undefinedMetrics.length).toBeGreaterThan(0);
    expect(session.humanRequirements.length).toBeGreaterThan(0);
    expect(session.recommendedLoops.map((loop) => loop.name)).toEqual([
      "Campaign Learning Loop",
      "Follow-Up Latency Loop",
      "Lead Qualification Loop",
      "Feedback Clustering Loop",
      "Customer Health Loop",
      "Daily Operating Review Loop"
    ]);
  });
});

