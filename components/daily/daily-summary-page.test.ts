import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { DailySummaryPage } from "./daily-summary-page";
import type { DailySummary } from "@/lib/loopgraph-core/daily-summary";

describe("DailySummaryPage", () => {
  it("renders daily operating summary cards", () => {
    const html = renderToStaticMarkup(React.createElement(DailySummaryPage, { summary: dailySummary() }));

    expect(html).toContain("Company Health");
    expect(html).toContain("Loops Ran");
    expect(html).toContain("Recommended Next Actions");
  });
});

function dailySummary(): DailySummary {
  return {
    id: "daily_1",
    companyId: "company_1",
    date: "2026-07-12",
    companyHealth: 82,
    netSavedMinutes: 120,
    grossSavedMinutes: 180,
    reviewMinutes: 20,
    reworkMinutes: 10,
    botsittingMinutes: 8,
    escalationMinutes: 5,
    governanceMinutes: 4,
    departments: [{
      departmentId: "sales",
      name: "Sales",
      health: 80,
      activeLoopCount: 1,
      blockedLoopCount: 0,
      openReviewCount: 0,
      undefinedMetricCount: 0,
      summary: "Sales loops are healthy."
    }],
    loops: [{
      loopId: "lead-qualification",
      loopName: "Lead Qualification Loop",
      departmentId: "sales",
      departmentName: "Sales",
      status: "healthy",
      readinessLevel: "L4",
      mainMetric: {
        label: "Qualified lead rate",
        status: "observed"
      },
      openReviewCount: 0,
      escalationCount: 0,
      undefinedMetricCount: 0,
      netSavedMinutes: 30,
      botsittingMinutes: 4,
      summary: "Loop ran normally.",
      nextAction: "Monitor"
    }],
    openReviews: [],
    escalations: [],
    undefinedMetrics: [],
    recommendedActions: [{
      id: "action_1",
      priority: "low",
      label: "Monitor healthy loop",
      reason: "No attention needed.",
      targetType: "loop",
      targetId: "lead-qualification"
    }],
    generatedAt: "2026-07-12T00:00:00.000Z"
  };
}
