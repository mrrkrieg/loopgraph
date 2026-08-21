import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { InstalledAppOperationsView } from "@/lib/app-platform/installed-app-operations";
import { InstalledAppActivityPanel, InstalledAppOutcomesPanel } from "./installed-app-operations";

describe("Installed App operations panels", () => {
  it("renders one App-owned event path, review burden, outcome, and value record", () => {
    const operations = populatedOperations();
    const html = renderToStaticMarkup(React.createElement(React.Fragment, null,
      React.createElement(InstalledAppActivityPanel, { operations }),
      React.createElement(InstalledAppOutcomesPanel, { operations })
    ));

    expect(html).toContain("Hermes activity for this App");
    expect(html).toContain("Hermes Brain → Lead Qualification");
    expect(html).toContain("waiting review");
    expect(html).toContain("75%");
    expect(html).toContain("12 min");
    expect(html).toContain("qualified meeting rate");
    expect(html).toContain("90 min");
  });

  it("explains an empty installation without inserting preview activity", () => {
    const operations: InstalledAppOperationsView = {
      activity: [],
      outcomes: [],
      valueEntries: [],
      summary: {
        incomingEvents: 0,
        totalRuns: 0,
        activeRuns: 0,
        waitingApproval: 0,
        completedRuns: 0,
        failedRuns: 0,
        observedOutcomes: 0,
        reviewedDecisions: 0,
        correctDecisions: 0,
        incompleteDecisions: 0,
        falsePositiveDecisions: 0,
        reviewMinutes: 0,
        observedNetMinutes: 0,
        observedCostMinutes: 0
      }
    };
    const html = renderToStaticMarkup(React.createElement(InstalledAppActivityPanel, { operations }));

    expect(html).toContain("No events have reached this App yet");
    expect(html).toContain("never mixed into this view");
    expect(html).not.toContain("Google Ads");
  });
});

function populatedOperations(): InstalledAppOperationsView {
  return {
    activity: [{
      id: "activity-1",
      eventId: "event-1",
      source: "HubSpot",
      eventType: "lead.created",
      problemSummary: "A new lead needs qualification and accountable routing.",
      department: "Sales",
      loopId: "lead-qualification",
      loopLabel: "Lead Qualification",
      routeJobId: "job-1",
      executionRuntime: "hermes",
      jobStatus: "waiting_review",
      runId: "run-1",
      taskCount: 4,
      completedTaskCount: 3,
      toolCallCount: 2,
      approvalCount: 1,
      outputCount: 1,
      observedOutcomeCount: 0,
      receivedAt: "2026-08-20T12:00:00.000Z",
      updatedAt: "2026-08-20T12:05:00.000Z",
      needsAttention: true
    }],
    outcomes: [{
      id: "outcome-1",
      loopId: "lead-qualification",
      metricKey: "qualified meeting rate",
      status: "improved",
      truthStatus: "observed",
      baseline: 10,
      observed: 12,
      relativeDeltaPct: 20,
      confidence: 0.9,
      guardrailsPassed: 2,
      guardrailCount: 2,
      missingReasons: [],
      evaluatedAt: "2026-08-20T12:10:00.000Z"
    }],
    valueEntries: [{
      id: "value-1",
      loopId: "lead-qualification",
      truthStatus: "observed",
      grossSavedMinutes: 110,
      observedCostMinutes: 20,
      netSavedMinutes: 90,
      hiddenCosts: { review: 10, rework: 5, botsitting: 3, escalation: 1, governance: 1 },
      recordedAt: "2026-08-20T12:15:00.000Z"
    }],
    summary: {
      incomingEvents: 1,
      totalRuns: 1,
      activeRuns: 0,
      waitingApproval: 1,
      completedRuns: 0,
      failedRuns: 0,
      observedOutcomes: 1,
      reviewedDecisions: 4,
      correctDecisions: 3,
      incompleteDecisions: 1,
      falsePositiveDecisions: 0,
      routingAccuracy: 0.75,
      reviewMinutes: 12,
      observedNetMinutes: 90,
      observedCostMinutes: 20,
      lastActivityAt: "2026-08-20T12:05:00.000Z"
    }
  };
}
