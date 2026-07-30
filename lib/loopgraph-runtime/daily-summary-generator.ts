import type { AccessRequirement } from "loopgraph/core";
import { DailySummarySchema, type DailySummary } from "loopgraph/core";
import type { EscalationCase } from "loopgraph/core";
import type { HumanReviewTrace } from "loopgraph/core";
import type { LoopSpec } from "loopgraph/core";
import type { MetricDefinition, UndefinedMetric } from "loopgraph/core";
import type { LoopRunTrace } from "loopgraph/core";
import type {
  EvidenceTruthStatus,
  MetricSample,
  ObservedOutcome,
  ValueLedgerEntry
} from "loopgraph/core";

export type DailySummaryInput = {
  companyId: string;
  loopSpecs: LoopSpec[];
  traces: LoopRunTrace[];
  cases: EscalationCase[];
  reviews: HumanReviewTrace[];
  accessRequirements: AccessRequirement[];
  metricDefinitions: MetricDefinition[];
  undefinedMetrics: UndefinedMetric[];
  improvements: Array<{ id: string; loopId?: string; recommendation?: string; status?: string }>;
  metricSamples?: MetricSample[];
  observedOutcomes?: ObservedOutcome[];
  valueLedgerEntries?: ValueLedgerEntry[];
  date?: string;
};

export function generateDailySummary(input: DailySummaryInput): DailySummary {
  const date = input.date ?? new Date().toISOString().slice(0, 10);
  const dateRange = utcDateRange(date);
  const metricSamples = input.metricSamples ?? [];
  const observedOutcomes = input.observedOutcomes ?? [];
  const valueLedgerEntries = (input.valueLedgerEntries ?? [])
    .filter((entry) => windowsOverlap(entry.window, dateRange));
  const openReviews = [
    ...input.reviews,
    ...input.traces.flatMap((trace) => trace.humanReviews)
  ].filter((review) => review.status === "open" || review.status === "needs_changes");
  const openCases = input.cases.filter((caseItem) => !["resolved", "closed", "rejected"].includes(caseItem.status));
  const loopSummaries = input.loopSpecs.map((spec) => summarizeLoop(
    spec,
    input,
    openReviews,
    openCases,
    metricSamples,
    observedOutcomes,
    valueLedgerEntries
  ));
  const departments = summarizeDepartments(loopSummaries);
  const grossSavedMinutes = sum(valueLedgerEntries, (entry) => entry.grossSavedMinutes);
  const reviewMinutes = sum(valueLedgerEntries, (entry) => entry.hiddenCostMinutes.review);
  const reworkMinutes = sum(valueLedgerEntries, (entry) => entry.hiddenCostMinutes.rework);
  const botsittingMinutes = sum(valueLedgerEntries, (entry) => entry.hiddenCostMinutes.botsitting);
  const escalationMinutes = sum(valueLedgerEntries, (entry) => entry.hiddenCostMinutes.escalation);
  const governanceMinutes = sum(valueLedgerEntries, (entry) => entry.hiddenCostMinutes.governance);
  const netSavedMinutes = sum(valueLedgerEntries, (entry) => entry.netSavedMinutes);
  const averageDepartmentHealth = departments.length
    ? departments.reduce((sum, department) => sum + department.health, 0) / departments.length
    : 0;
  const companyHealth = input.loopSpecs.length === 0
    ? 0
    : Math.max(0, Math.round(
        averageDepartmentHealth -
        openCases.filter((caseItem) => ["P0", "P1"].includes(caseItem.severity)).length * 10 -
        loopSummaries.filter((loop) => loop.status === "blocked" || loop.status === "missing_access").length * 6 -
        input.undefinedMetrics.filter((metric) => metric.status === "open").length * 2
      ));
  const loopsRanCount = new Set(input.traces
    .filter((trace) => timestampFallsWithin(trace.completedAt ?? trace.startedAt, dateRange))
    .map((trace) => trace.loopId)).size;

  return DailySummarySchema.parse({
    id: `${input.companyId}:${date}`,
    companyId: input.companyId,
    date,
    companyHealth,
    healthTruthStatus: input.loopSpecs.length === 0 ? "incomplete" : "modeled",
    trackedLoopCount: input.loopSpecs.length,
    loopsRanCount,
    netSavedMinutes,
    grossSavedMinutes,
    reviewMinutes,
    reworkMinutes,
    botsittingMinutes,
    escalationMinutes,
    governanceMinutes,
    valueTruthStatus: aggregateTruthStatus(valueLedgerEntries.map((entry) => entry.truthStatus)),
    metricSampleCount: metricSamples.length,
    observedOutcomeCount: observedOutcomes.length,
    valueLedgerEntryCount: valueLedgerEntries.length,
    departments,
    loops: loopSummaries,
    openReviews,
    escalations: openCases,
    undefinedMetrics: input.undefinedMetrics,
    recommendedActions: buildRecommendedActions(loopSummaries, input.accessRequirements, input.undefinedMetrics, openReviews),
    generatedAt: new Date().toISOString()
  });
}

function summarizeLoop(
  spec: LoopSpec,
  input: DailySummaryInput,
  openReviews: HumanReviewTrace[],
  openCases: EscalationCase[],
  metricSamples: MetricSample[],
  observedOutcomes: ObservedOutcome[],
  valueLedgerEntries: ValueLedgerEntry[]
): DailySummary["loops"][number] {
  const loopId = spec.metadata.id;
  const latestTrace = input.traces
    .filter((trace) => trace.loopId === loopId)
    .sort((left, right) => (right.completedAt ?? right.startedAt).localeCompare(left.completedAt ?? left.startedAt))[0];
  const access = input.accessRequirements.filter((item) => item.loopId === loopId || item.loopRecommendationId === spec.metadata.labels?.recommendationId);
  const metrics = input.metricDefinitions.filter((item) => item.loopId === loopId || item.loopRecommendationId === spec.metadata.labels?.recommendationId);
  const undefinedMetrics = input.undefinedMetrics.filter((item) => item.loopId === loopId || item.loopRecommendationId === spec.metadata.labels?.recommendationId);
  const reviews = openReviews.filter((review) => review.runId === latestTrace?.id);
  const cases = openCases.filter((caseItem) => caseItem.sourceLoopId === loopId);
  const loopSamples = metricSamples
    .filter((sample) => sample.loopId === loopId)
    .sort((left, right) => left.observedAt.localeCompare(right.observedAt));
  const loopOutcomes = observedOutcomes
    .filter((outcome) => outcome.loopId === loopId)
    .sort((left, right) => right.evaluatedAt.localeCompare(left.evaluatedAt));
  const loopLedgerEntries = valueLedgerEntries.filter((entry) => entry.loopId === loopId);
  const missingAccess = access.some((item) => item.blockingLevel === "blocking" && !["connected", "manual_fallback", "waived"].includes(item.status));
  const latestFailed = latestTrace?.verificationResults.some((result) => !result.passed) ||
    latestTrace?.status === "FAILED_VALIDATION" ||
    latestTrace?.status === "FAILED_VERIFICATION";
  const primaryMetric = metrics[0];
  const primaryUndefined = primaryMetric && undefinedMetrics.some((metric) => metric.metricKey === primaryMetric.key && metric.status === "open");
  const status = missingAccess
    ? "missing_access"
    : primaryUndefined
      ? "missing_metric"
      : reviews.length > 0
        ? "waiting_for_human"
        : latestFailed
          ? "failed_verification"
          : cases.length > 0
            ? "needs_attention"
            : latestTrace
              ? "healthy"
              : "draft";
  const latestOutcome = primaryMetric
    ? loopOutcomes.find((outcome) => outcome.metricDefinitionId === primaryMetric.id)
    : loopOutcomes[0];
  const primaryMetricSamples = primaryMetric
    ? loopSamples.filter((sample) => sample.metricDefinitionId === primaryMetric.id)
    : [];
  const latestMetricSample = primaryMetricSamples.at(-1);
  const previousMetricSample = primaryMetricSamples.at(-2);
  const netSavedMinutes = sum(loopLedgerEntries, (entry) => entry.netSavedMinutes);
  const botsittingMinutes = sum(loopLedgerEntries, (entry) => entry.hiddenCostMinutes.botsitting);

  return {
    loopId,
    loopName: spec.metadata.name,
    departmentId: spec.topology?.department ?? "custom",
    departmentName: formatDepartment(spec.topology?.department ?? "Custom"),
    status,
    readinessLevel: readinessFromSpec(spec),
    mainMetric: primaryMetric ? {
      label: primaryMetric.label,
      ...(latestMetricSample ? {
        value: latestMetricSample.value,
        ...(previousMetricSample ? { delta: latestMetricSample.value - previousMetricSample.value } : {})
      } : {}),
      status: primaryUndefined || !latestMetricSample || latestMetricSample.truthStatus === "incomplete"
        ? "undefined"
        : latestMetricSample.truthStatus
    } : undefined,
    lastRunAt: latestTrace?.completedAt ?? latestTrace?.startedAt,
    openReviewCount: reviews.length,
    escalationCount: cases.length,
    undefinedMetricCount: undefinedMetrics.filter((metric) => metric.status === "open").length,
    netSavedMinutes,
    botsittingMinutes,
    valueTruthStatus: aggregateTruthStatus(loopLedgerEntries.map((entry) => entry.truthStatus)),
    outcomeStatus: latestOutcome?.status,
    summary: loopSummary(status, spec.metadata.name),
    nextAction: nextAction(status)
  };
}

function aggregateTruthStatus(statuses: EvidenceTruthStatus[]): EvidenceTruthStatus {
  if (statuses.length === 0 || statuses.some((status) => status === "incomplete")) return "incomplete";
  if (statuses.every((status) => status === "observed")) return "observed";
  return "modeled";
}

function utcDateRange(date: string) {
  return {
    start: `${date}T00:00:00.000Z`,
    end: `${date}T23:59:59.999Z`
  };
}

function windowsOverlap(
  left: { start: string; end: string },
  right: { start: string; end: string }
) {
  return left.end >= right.start && left.start <= right.end;
}

function timestampFallsWithin(timestamp: string | undefined, range: { start: string; end: string }) {
  return Boolean(timestamp && timestamp >= range.start && timestamp <= range.end);
}

function sum<T>(items: T[], value: (item: T) => number) {
  return items.reduce((total, item) => total + value(item), 0);
}

function summarizeDepartments(loops: DailySummary["loops"]) {
  const grouped = new Map<string, DailySummary["loops"]>();
  for (const loop of loops) {
    grouped.set(loop.departmentId, [...(grouped.get(loop.departmentId) ?? []), loop]);
  }
  return Array.from(grouped.entries()).map(([departmentId, departmentLoops]) => {
    const blockedLoopCount = departmentLoops.filter((loop) =>
      ["blocked", "missing_access", "missing_metric"].includes(loop.status)
    ).length;
    const undefinedMetricCount = departmentLoops.reduce((sum, loop) => sum + loop.undefinedMetricCount, 0);
    const openReviewCount = departmentLoops.reduce((sum, loop) => sum + loop.openReviewCount, 0);
    const health = Math.max(0, Math.round(88 - blockedLoopCount * 15 - undefinedMetricCount * 4 - openReviewCount * 3));
    return {
      departmentId,
      name: departmentLoops[0]?.departmentName ?? formatDepartment(departmentId),
      health,
      activeLoopCount: departmentLoops.length,
      blockedLoopCount,
      openReviewCount,
      undefinedMetricCount,
      summary: `${departmentLoops.length} loop(s), ${blockedLoopCount} blocked, ${undefinedMetricCount} undefined metric(s).`
    };
  });
}

function buildRecommendedActions(
  loops: DailySummary["loops"],
  accessRequirements: AccessRequirement[],
  undefinedMetrics: UndefinedMetric[],
  openReviews: HumanReviewTrace[]
) {
  return [
    ...accessRequirements
      .filter((item) => item.blockingLevel === "blocking" && item.status === "not_requested")
      .slice(0, 4)
      .map((item) => ({
        id: `${item.id}:action`,
        priority: "high" as const,
        label: `Resolve ${item.integrationType} access`,
        reason: item.reason,
        targetType: "access" as const,
        targetId: item.id
      })),
    ...undefinedMetrics
      .filter((item) => item.status === "open")
      .slice(0, 4)
      .map((item) => ({
        id: `${item.id}:action`,
        priority: "medium" as const,
        label: `Define ${item.label}`,
        reason: item.requiredAction,
        targetType: "metric" as const,
        targetId: item.id
      })),
    ...openReviews.slice(0, 3).map((review) => ({
      id: `${review.id}:action`,
      priority: "medium" as const,
      label: "Review pending approval",
      reason: review.comment ?? "A loop is waiting for human judgment.",
      targetType: "review" as const,
      targetId: review.id
    })),
    ...loops
      .filter((loop) => loop.status === "healthy")
      .slice(0, 2)
      .map((loop) => ({
        id: `${loop.loopId}:action`,
        priority: "low" as const,
        label: `Review rollout level for ${loop.loopName}`,
        reason: "Healthy loops can be considered for the next phased rollout level after audit.",
        targetType: "loop" as const,
        targetId: loop.loopId
      }))
  ];
}

function readinessFromSpec(spec: LoopSpec) {
  const label = spec.metadata.labels?.readiness;
  return label === "L1" || label === "L2" || label === "L3" || label === "L4" ? label : "L0";
}

function loopSummary(status: DailySummary["loops"][number]["status"], name: string) {
  const summaries: Record<typeof status, string> = {
    healthy: `${name} has no blocking access, review, or metric issue today.`,
    needs_attention: `${name} has an escalation or health signal that needs attention.`,
    blocked: `${name} is blocked before activation.`,
    missing_access: `${name} is waiting on required access.`,
    missing_metric: `${name} has a primary metric that is not yet measurable.`,
    waiting_for_human: `${name} is waiting for a human review.`,
    failed_verification: `${name} failed its latest verifier.`,
    draft: `${name} is still in draft.`
  };
  return summaries[status];
}

function nextAction(status: DailySummary["loops"][number]["status"]) {
  const actions: Record<typeof status, string> = {
    healthy: "Review rollout readiness.",
    needs_attention: "Inspect escalation and assign owner.",
    blocked: "Resolve blocker before activation.",
    missing_access: "Connect, waive, or add manual fallback for access.",
    missing_metric: "Define metric source and baseline.",
    waiting_for_human: "Complete the open review.",
    failed_verification: "Inspect failed verifier and improve policy.",
    draft: "Finish owner, access, metric, and verifier setup."
  };
  return actions[status];
}

function formatDepartment(value: string) {
  return value
    .replace(/_/g, " / ")
    .split(" ")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}
