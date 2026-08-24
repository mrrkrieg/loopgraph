import { describe, expect, it } from "vitest";
import { deriveMarketplaceHistoricalPreviewStatus } from "./marketplace-preview";

describe("Marketplace historical preview status", () => {
  it("moves from installation through conformance into available and completed preview", () => {
    expect(deriveMarketplaceHistoricalPreviewStatus({ installed: false, connectionsReady: false, evaluations: [] })).toBe("requires_install");
    expect(deriveMarketplaceHistoricalPreviewStatus({ installed: true, connectionsReady: false, evaluations: [] })).toBe("requires_readiness");
    expect(deriveMarketplaceHistoricalPreviewStatus({
      installed: true,
      connectionsReady: true,
      evaluations: [{ level: "synthetic", status: "passed" }]
    })).toBe("available");
    expect(deriveMarketplaceHistoricalPreviewStatus({
      installed: true,
      connectionsReady: true,
      evaluations: [
        { level: "synthetic", status: "passed" },
        { level: "historical_replay", status: "passed" }
      ]
    })).toBe("completed");
  });

  it("does not treat failed or running evidence as readiness", () => {
    expect(deriveMarketplaceHistoricalPreviewStatus({
      installed: true,
      connectionsReady: true,
      evaluations: [
        { level: "synthetic", status: "failed" },
        { level: "historical_replay", status: "running" }
      ]
    })).toBe("requires_readiness");
  });

  it("requires healthy read connections as well as passing conformance", () => {
    expect(deriveMarketplaceHistoricalPreviewStatus({
      installed: true,
      connectionsReady: false,
      evaluations: [{ level: "synthetic", status: "passed" }]
    })).toBe("requires_readiness");
  });
});
