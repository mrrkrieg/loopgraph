import { describe, expect, it } from "vitest";
import { calculateNetSavings, scoreLoopHealth } from "./measurement";

describe("measurement", () => {
  it("subtracts observed hidden labor from gross savings", () => {
    const result = calculateNetSavings({
      grossSavedMinutes: 180,
      reviewMinutes: 48,
      reworkMinutes: 34,
      botsittingMinutes: 22
    });
    expect(result.netSavedMinutes).toBe(76);
    expect(result.labels.grossSaved).toBe("observed");
  });

  it("scores negative net value as Negative net value health", () => {
    expect(scoreLoopHealth(-10)).toBe("Negative net value");
  });
});
