import type { AppEvalRun } from "loopgraph/core";
import type { AgentOperationsActivityRow } from "loopgraph/runtime";
import type { OutcomeView, ValueEntryView } from "@/lib/loopgraph-runtime/operating-view-data";

export type InstalledAppOperationsView = {
  activity: AgentOperationsActivityRow[];
  outcomes: OutcomeView[];
  valueEntries: ValueEntryView[];
  summary: {
    incomingEvents: number;
    totalRuns: number;
    activeRuns: number;
    waitingApproval: number;
    completedRuns: number;
    failedRuns: number;
    observedOutcomes: number;
    reviewedDecisions: number;
    correctDecisions: number;
    incompleteDecisions: number;
    falsePositiveDecisions: number;
    routingAccuracy?: number;
    reviewMinutes: number;
    observedNetMinutes: number;
    observedCostMinutes: number;
    lastActivityAt?: string;
  };
};

export function buildInstalledAppOperationsView(input: {
  loopIds: string[];
  activity: AgentOperationsActivityRow[];
  evaluations: AppEvalRun[];
  outcomes: OutcomeView[];
  valueEntries: ValueEntryView[];
}): InstalledAppOperationsView {
  const loopIds = new Set(input.loopIds);
  const activityById = new Map(input.activity
    .filter((row) => loopIds.has(row.loopId))
    .map((row) => [row.id, row]));
  const activity = [...activityById.values()]
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
  const outcomes = input.outcomes
    .filter((outcome) => loopIds.has(outcome.loopId))
    .sort((left, right) => right.evaluatedAt.localeCompare(left.evaluatedAt));
  const valueEntries = input.valueEntries
    .filter((entry) => loopIds.has(entry.loopId))
    .sort((left, right) => right.recordedAt.localeCompare(left.recordedAt));
  const latestReplay = input.evaluations
    .filter((evaluation) => evaluation.level === "historical_replay")
    .sort((left, right) => evaluationTime(right).localeCompare(evaluationTime(left)))[0];
  const reviewedScenarios = latestReplay?.scenarios.filter((scenario) => scenario.humanLabel) ?? [];
  const correctDecisions = reviewedScenarios.filter((scenario) => scenario.humanLabel === "correct").length;
  const observedOutcomes = outcomes.filter((outcome) => outcome.truthStatus === "observed");
  const observedValue = valueEntries.filter((entry) => entry.truthStatus === "observed");

  return {
    activity,
    outcomes,
    valueEntries,
    summary: {
      incomingEvents: new Set(activity.map((row) => row.eventId)).size,
      totalRuns: activity.length,
      activeRuns: activity.filter((row) => ["claimed", "dispatched", "running"].includes(row.jobStatus)).length,
      waitingApproval: activity.filter((row) => row.jobStatus === "waiting_review").length,
      completedRuns: activity.filter((row) => row.jobStatus === "completed").length,
      failedRuns: activity.filter((row) => ["failed", "dead_letter"].includes(row.jobStatus)).length,
      observedOutcomes: observedOutcomes.length,
      reviewedDecisions: reviewedScenarios.length,
      correctDecisions,
      incompleteDecisions: reviewedScenarios.filter((scenario) => scenario.humanLabel === "incomplete").length,
      falsePositiveDecisions: reviewedScenarios.filter((scenario) => scenario.humanLabel === "false_positive").length,
      ...(reviewedScenarios.length > 0 ? { routingAccuracy: correctDecisions / reviewedScenarios.length } : {}),
      reviewMinutes: reviewedScenarios.reduce((total, scenario) => total + (scenario.reviewMinutes ?? 0), 0),
      observedNetMinutes: observedValue.reduce((total, entry) => total + entry.netSavedMinutes, 0),
      observedCostMinutes: observedValue.reduce((total, entry) => total + entry.observedCostMinutes, 0),
      ...(activity[0] ? { lastActivityAt: activity[0].updatedAt } : {})
    }
  };
}

function evaluationTime(evaluation: AppEvalRun): string {
  return evaluation.completedAt ?? evaluation.startedAt;
}
