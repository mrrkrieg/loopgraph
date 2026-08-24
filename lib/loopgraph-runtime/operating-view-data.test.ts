import { describe, expect, it } from "vitest";
import {
  buildHostedOperatingPreview,
  summarizeValue,
  type ValueEntryView
} from "./operating-view-data";

describe("operating view data", () => {
  it("keeps observed, modeled, and incomplete value separate", () => {
    const entries: ValueEntryView[] = [
      entry("observed", 120, 20),
      entry("modeled", 90, 10),
      entry("incomplete", 0, 5)
    ];

    expect(summarizeValue(entries)).toMatchObject({
      observedNetMinutes: 100,
      modeledNetMinutes: 80,
      incompleteNetMinutes: -5,
      observedCostMinutes: 20,
      truthCounts: { observed: 1, modeled: 1, incomplete: 1 }
    });
  });

  it("provides a rich but explicitly preview-only operating story", () => {
    const preview = buildHostedOperatingPreview();

    expect(preview.mode).toBe("preview");
    expect(preview.opportunities[0]).toMatchObject({
      department: "Product",
      kind: "Create loop"
    });
    expect(preview.changes.some((change) => change.operation === "Split")).toBe(true);
    expect(preview.controller.runs[0]?.decisions.length).toBeGreaterThan(0);
    expect(preview.learning.bindings.length).toBeGreaterThanOrEqual(4);
    expect(preview.learning.routing).toMatchObject({
      attempts: {
        total: 86,
        evidenceAcknowledged: 82,
        staleEvidenceRejected: 3
      },
      evaluations: {
        total: 48,
        passed: 45
      },
      humanFeedback: {
        corrections: 5
      }
    });
    expect(preview.learning.routing.loops).toEqual(expect.arrayContaining([
      expect.objectContaining({ loopId: "product_activation_recovery" }),
      expect.objectContaining({ loopId: "marketing_ads" })
    ]));
    expect(preview.value.truthCounts).toEqual({
      observed: 2,
      modeled: 1,
      incomplete: 1
    });
  });
});

function entry(
  truthStatus: ValueEntryView["truthStatus"],
  grossSavedMinutes: number,
  observedCostMinutes: number
): ValueEntryView {
  return {
    id: `entry-${truthStatus}`,
    loopId: `loop-${truthStatus}`,
    truthStatus,
    grossSavedMinutes,
    observedCostMinutes,
    netSavedMinutes: grossSavedMinutes - observedCostMinutes,
    hiddenCosts: {
      review: observedCostMinutes,
      rework: 0,
      botsitting: 0,
      escalation: 0,
      governance: 0
    },
    recordedAt: "2026-07-28T00:00:00.000Z"
  };
}
