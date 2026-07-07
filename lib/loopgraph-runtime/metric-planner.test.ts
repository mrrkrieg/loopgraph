import { describe, expect, it } from "vitest";
import { buildDemoDiscoverySession } from "./discovery-engine";

describe("metric planner", () => {
  it("detects undefined metrics for missing integrations and missing baselines", async () => {
    const session = await buildDemoDiscoverySession();
    const undefinedKeys = session.undefinedMetrics.map((metric) => metric.metricKey);
    expect(undefinedKeys).toContain("cost_per_qualified_customer");
    expect(undefinedKeys).toContain("relationship_time");
    expect(undefinedKeys).toContain("strategic_account_relationship_time");
    expect(undefinedKeys).toContain("net_saved_minutes");

    const cpqc = session.undefinedMetrics.find((metric) => metric.metricKey === "cost_per_qualified_customer");
    expect(cpqc).toMatchObject({
      reason: "missing_integration",
      suggestedIntegration: "crm"
    });

    const netSaved = session.undefinedMetrics.find((metric) => metric.metricKey === "net_saved_minutes");
    expect(netSaved?.reason).toBe("missing_baseline");
  });
});

