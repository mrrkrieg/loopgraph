import { describe, expect, it } from "vitest";
import type { AppEvalRun } from "loopgraph/core";
import type { AgentOperationsActivityRow } from "loopgraph/runtime";
import { buildInstalledAppOperationsView } from "./installed-app-operations";

describe("installed App operations view", () => {
  it("scopes activity, outcomes, value, failures, and review burden to owned loops", () => {
    const result = buildInstalledAppOperationsView({
      app: {
        id: "loopgraph.sales.qualify-route-inbound-leads",
        name: "Qualify and Route Inbound Leads",
        department: "Sales"
      },
      loops: [
        { id: "lead-qualification", name: "Lead Qualification" },
        { id: "lead-routing", name: "Lead Routing" }
      ],
      activity: [
        activity({ id: "run-2", eventId: "event-1", loopId: "lead-routing", jobStatus: "waiting_review", updatedAt: "2026-08-20T12:02:00.000Z" }),
        activity({ id: "run-1", eventId: "event-1", loopId: "lead-qualification", jobStatus: "completed", updatedAt: "2026-08-20T12:01:00.000Z" }),
        activity({ id: "other", eventId: "event-2", loopId: "another-app", jobStatus: "failed", updatedAt: "2026-08-20T12:03:00.000Z" })
      ],
      evaluations: [historicalEvaluation()],
      outcomes: [
        outcome("qualified-meeting-rate", "lead-qualification"),
        { ...outcome("modeled-qualified-meeting-rate", "lead-qualification"), truthStatus: "modeled" },
        outcome("other", "another-app")
      ],
      valueEntries: [
        valueEntry("lead-value", "lead-routing", 90, 20),
        valueEntry("other-value", "another-app", 1_000, 0)
      ]
    });

    expect(result.activity.map((row) => row.id)).toEqual(["run-2", "run-1"]);
    expect(result.outcomes.map((outcome) => outcome.id)).toEqual(["qualified-meeting-rate", "modeled-qualified-meeting-rate"]);
    expect(result.valueEntries.map((entry) => entry.id)).toEqual(["lead-value"]);
    expect(result.topology.nodes).toEqual(expect.arrayContaining([
      expect.objectContaining({ label: "Hermes Brain", kind: "management" }),
      expect.objectContaining({ label: "Sales", kind: "department" }),
      expect.objectContaining({ label: "Installed App", subtitle: "Qualify and Route Inbound Leads", kind: "rollup" }),
      expect.objectContaining({ label: "Lead Qualification", kind: "loop" }),
      expect.objectContaining({ label: "HubSpot", kind: "data_source" }),
      expect.objectContaining({ label: "1 approval", kind: "review" }),
      expect.objectContaining({ label: "Qualified meeting rate", kind: "metric" })
    ]));
    expect(result.topology.edges).toEqual(expect.arrayContaining([
      expect.objectContaining({ source: "installed-app:hermes", target: "installed-app:department:sales", kind: "routes" }),
      expect.objectContaining({ source: "installed-app:department:sales", target: "installed-app:app:loopgraph-sales-qualify-route-inbound-leads", kind: "owns" }),
      expect.objectContaining({ source: "installed-app:app:loopgraph-sales-qualify-route-inbound-leads", target: "installed-app:loop:lead-qualification", kind: "contains" }),
      expect.objectContaining({ source: "installed-app:source:hubspot", target: "installed-app:hermes", kind: "event" }),
      expect.objectContaining({ source: "installed-app:outcome:qualified-meeting-rate", target: "installed-app:hermes", kind: "learning_return" })
    ]));
    expect(result.summary).toMatchObject({
      incomingEvents: 1,
      totalRuns: 2,
      waitingApproval: 1,
      completedRuns: 1,
      failedRuns: 0,
      observedOutcomes: 1,
      reviewedDecisions: 3,
      correctDecisions: 1,
      incompleteDecisions: 1,
      falsePositiveDecisions: 1,
      routingAccuracy: 1 / 3,
      reviewMinutes: 6,
      observedNetMinutes: 90,
      observedCostMinutes: 20,
      lastActivityAt: "2026-08-20T12:02:00.000Z"
    });
  });

  it("never leaks global operations into an installation with no owned loops", () => {
    const result = buildInstalledAppOperationsView({
      app: { id: "empty-app", name: "Empty App", department: "Sales" },
      loops: [],
      activity: [activity({ id: "global", eventId: "event-global", loopId: "global-loop", jobStatus: "completed", updatedAt: "2026-08-20T12:00:00.000Z" })],
      evaluations: [],
      outcomes: [outcome("global-outcome", "global-loop")],
      valueEntries: [valueEntry("global-value", "global-loop", 50, 5)]
    });

    expect(result.activity).toEqual([]);
    expect(result.outcomes).toEqual([]);
    expect(result.valueEntries).toEqual([]);
    expect(result.topology.nodes).toEqual(expect.arrayContaining([
      expect.objectContaining({ label: "Hermes Brain" }),
      expect.objectContaining({ label: "Sales" }),
      expect.objectContaining({ label: "Installed App", subtitle: "Empty App" })
    ]));
    expect(result.summary.totalRuns).toBe(0);
    expect(result.summary.routingAccuracy).toBeUndefined();
  });
});

function activity(input: Pick<AgentOperationsActivityRow, "id" | "eventId" | "loopId" | "jobStatus" | "updatedAt">): AgentOperationsActivityRow {
  return {
    ...input,
    source: "HubSpot",
    eventType: "lead.created",
    department: "Sales",
    loopLabel: input.loopId,
    routeJobId: `job-${input.id}`,
    executionRuntime: "hermes",
    runId: input.id,
    taskCount: 2,
    completedTaskCount: input.jobStatus === "completed" ? 2 : 1,
    toolCallCount: 1,
    approvalCount: input.jobStatus === "waiting_review" ? 1 : 0,
    outputCount: 1,
    observedOutcomeCount: input.jobStatus === "completed" ? 1 : 0,
    receivedAt: "2026-08-20T12:00:00.000Z",
    needsAttention: input.jobStatus === "waiting_review"
  };
}

function historicalEvaluation(): AppEvalRun {
  return {
    schemaVersion: "loopgraph-app-eval/v1alpha1",
    id: "historical-evaluation",
    installationId: "installed-sales",
    appId: "loopgraph.sales.qualify-route-inbound-leads",
    appVersion: "1.0.0",
    artifactDigest: `sha256:${"a".repeat(64)}`,
    level: "historical_replay",
    status: "passed",
    replay: true,
    writeBlocked: true,
    startedAt: "2026-08-20T11:00:00.000Z",
    completedAt: "2026-08-20T11:05:00.000Z",
    scenarios: [
      { id: "correct", status: "passed", humanLabel: "correct", reviewMinutes: 1, evidenceRefs: [] },
      { id: "incomplete", status: "passed", humanLabel: "incomplete", reviewMinutes: 2, evidenceRefs: [] },
      { id: "false-positive", status: "passed", humanLabel: "false_positive", reviewMinutes: 3, evidenceRefs: [] }
    ],
    metrics: {},
    evidenceRefs: []
  };
}

function outcome(id: string, loopId: string) {
  return {
    id,
    loopId,
    metricKey: id,
    status: "improved",
    truthStatus: "observed" as const,
    baseline: 10,
    observed: 12,
    relativeDeltaPct: 20,
    confidence: 0.9,
    guardrailsPassed: 1,
    guardrailCount: 1,
    missingReasons: [],
    evaluatedAt: "2026-08-20T12:04:00.000Z"
  };
}

function valueEntry(id: string, loopId: string, netSavedMinutes: number, observedCostMinutes: number) {
  return {
    id,
    loopId,
    truthStatus: "observed" as const,
    grossSavedMinutes: netSavedMinutes + observedCostMinutes,
    observedCostMinutes,
    netSavedMinutes,
    hiddenCosts: { review: 10, rework: 5, botsitting: 3, escalation: 1, governance: 1 },
    recordedAt: "2026-08-20T12:05:00.000Z"
  };
}
