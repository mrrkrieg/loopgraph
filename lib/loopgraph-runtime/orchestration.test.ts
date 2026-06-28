import { describe, expect, it } from "vitest";
import { assertEdgeExecutable, assertOrchestrationLimits } from "./orchestration";

describe("orchestration", () => {
  it("blocks informational edge auto execution", () => {
    expect(() => assertEdgeExecutable("reports_to")).toThrow();
  });

  it("enforces parent child depth", () => {
    expect(() => assertOrchestrationLimits({ depth: 99, escalationReentryCount: 0 })).toThrow();
  });
});
