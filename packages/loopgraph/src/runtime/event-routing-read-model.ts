import path from "node:path";
import type {
  BusinessProblem,
  EventReceipt,
  RouteCommit,
  RouteJob,
  RouterEvaluation,
  RoutingAttempt,
  RoutingCard,
  RoutingCorrection
} from "../core";
import { planHermesWebhookRoutes, type HermesWebhookPlanResult } from "./hermes-webhooks";
import { listLoopgraphLifecycleDeliveries, type LoopgraphLifecycleDelivery } from "./lifecycle-events";
import {
  loopgraph_events_get,
  loopgraph_problems_get,
  loopgraph_route_jobs_get,
  loopgraph_routing_decision_get,
  loopgraph_routing_evaluations_get
} from "./routing-ops-tools";
import { FileRoutingStore, type RoutingStore } from "./routing-store";
import { loopgraph_routing_catalog_get } from "./routing-tools";
import type { LoopSpecRegistryStore } from "./loop-spec-store";
import { getLoopgraphRoot } from "./storage-resolver";

export const EVENT_ROUTING_OPERATIONS_SCHEMA_VERSION = "event-routing-operations/v1alpha1" as const;

export type EventRoutingOperationsFilters = {
  eventId?: string;
  source?: string;
  eventType?: string;
  receiptStatus?: EventReceipt["status"];
  action?: RoutingAttempt["action"] | "received";
  problemId?: string;
  problemStatus?: BusinessProblem["status"];
  loopId?: string;
  needsAttention?: boolean;
  unhandledOnly?: boolean;
};

export type EventRoutingOperationsInput = EventRoutingOperationsFilters & {
  projectRoot?: string;
  limit?: number;
  now?: Date;
  store?: RoutingStore;
  loopSpecStore?: LoopSpecRegistryStore;
};

export type EventRoutingOperationsRow = {
  id: string;
  eventId: string;
  receiptId: string;
  routeAttemptId?: string;
  receivedAt: string;
  source: string;
  eventType: string;
  subject: string;
  correlationId: string;
  receiptStatus: EventReceipt["status"];
  action: RoutingAttempt["action"] | "received";
  problemId?: string;
  problemSummary?: string;
  problemType?: string;
  problemStatus?: BusinessProblem["status"];
  selectedLoopIds: string[];
  selectedLoopLabels: string[];
  alternativeLoopIds: string[];
  confidence?: number;
  validationState: RoutingAttempt["status"] | EventReceipt["status"];
  validationErrors: string[];
  queueStatus?: RouteJob["status"] | RouteCommit["status"];
  runId?: string;
  owner: string;
  latencyMs?: number;
  corrections: Array<{
    id: string;
    expectedAction: RoutingCorrection["expectedAction"];
    expectedLoopIds: string[];
    correctedBy: string;
    correctedAt: string;
  }>;
  evaluation: {
    count: number;
    passedCount: number;
    failedCount: number;
    latestPassed?: boolean;
    latestEvaluatedAt?: string;
  };
  needsHumanChoice: boolean;
  needsCorrection: boolean;
  outcome?: {
    outcomeRef: string;
    summary: string;
    resolvedAt?: string;
    businessResult?: string;
    customerResult?: string;
    followUpRequired?: boolean;
  };
  timeline: string[];
  decisionDetail: EventRoutingDecisionDetail;
  correlationTimeline: EventRoutingTimelineEntry[];
};

export type EventRoutingDecisionDetail = {
  routeAttemptId?: string;
  action: RoutingAttempt["action"] | "received";
  catalogVersion?: string;
  policyVersion?: string;
  modelMetadata: Array<{
    key: string;
    value: string;
  }>;
  selectedRoutes: Array<{
    loopId: string;
    loopLabel: string;
    role: string;
    confidence: number;
    reasonSummary: string;
    evidenceRefs: string[];
    priority: number;
  }>;
  alternatives: Array<{
    loopId: string;
    loopLabel: string;
    confidence: number;
    reasonSummary: string;
  }>;
  routeCommits: Array<{
    id: string;
    loopId: string;
    loopLabel: string;
    status: RouteCommit["status"];
    runId?: string;
    committedAt: string;
  }>;
  routeJobs: Array<{
    id: string;
    status: RouteJob["status"];
    runId: string;
    attemptCount: number;
    maxAttempts: number;
    nextRunAt: string;
    updatedAt: string;
  }>;
};

export type EventRoutingTimelineEntry = {
  id: string;
  at: string;
  stage:
    | "event_receipt"
    | "hermes_decision"
    | "business_problem"
    | "route_commit"
    | "route_job"
    | "lifecycle_event"
    | "outcome_recorded"
    | "human_correction"
    | "routing_evaluation";
  label: string;
  detail: string;
  status: string;
};

export type EventRoutingProblemInboxItem = {
  problemId: string;
  summary: string;
  problemType: string;
  status: BusinessProblem["status"];
  subject: string;
  evidenceEventCount: number;
  primaryLoopId?: string;
  routeCommitCount: number;
  updatedAt: string;
  owner: string;
};

export type EventRoutingCatalogItem = {
  loopId: string;
  loopName: string;
  department?: string;
  activationMode: RoutingCard["activationMode"];
  currentReadiness: RoutingCard["currentReadiness"];
  minimumConfidence: number;
  priority: number;
  ambiguityPolicy: RoutingCard["ambiguityPolicy"];
  noMatchPolicy: RoutingCard["noMatchPolicy"];
  fanoutPolicy: RoutingCard["fanoutPolicy"];
  cooldown: RoutingCard["cooldown"];
  concurrency: RoutingCard["concurrency"];
  acceptedEvents: string[];
  problemTypes: string[];
  explicitNonGoals: string[];
  requiredConnections: string[];
  lifecycleEvents: string[];
  examples: RoutingCard["examples"];
};

export type EventRoutingOperationsReadModel = {
  schemaVersion: typeof EVENT_ROUTING_OPERATIONS_SCHEMA_VERSION;
  projectRoot: string;
  generatedAt: string;
  filters: EventRoutingOperationsFilters;
  summary: {
    eventCount: number;
    problemCount: number;
    unhandledProblemCount: number;
    routedEventCount: number;
    pendingHumanChoiceCount: number;
    routeJobCount: number;
    failedEvaluationCount: number;
    catalogLoopCount: number;
    hermesRouteCount: number;
    warningCount: number;
  };
  rows: EventRoutingOperationsRow[];
  problemInbox: EventRoutingProblemInboxItem[];
  routingCatalog: EventRoutingCatalogItem[];
  webhookHealth: {
    routeCount: number;
    eventFamilyCount: number;
    warnings: string[];
    routes: Array<{
      routeName: string;
      sourcePattern: string;
      eventTypePatterns: string[];
      loopIds: string[];
      deliveryMode: string;
    }>;
  };
};

export async function loadEventRoutingOperations(
  input: EventRoutingOperationsInput = {}
): Promise<EventRoutingOperationsReadModel> {
  const projectRoot = path.resolve(input.projectRoot ?? process.cwd());
  const limit = input.limit ?? 100;
  const generatedAt = (input.now ?? new Date()).toISOString();
  const store = input.store ?? new FileRoutingStore(getLoopgraphRoot(projectRoot));
  const filters = normalizeFilters(input);
  const [
    catalog,
    events,
    decisions,
    problems,
    jobs,
    evaluations,
    corrections,
    lifecycleDeliveries,
    webhookPlan
  ] = await Promise.all([
    loopgraph_routing_catalog_get(
      { projectRoot },
      { loopSpecStore: input.loopSpecStore }
    ),
    loopgraph_events_get({
      projectRoot,
      limit,
      eventId: filters.eventId,
      source: filters.source,
      eventType: filters.eventType,
      status: filters.receiptStatus
    }, { store }),
    loopgraph_routing_decision_get({
      projectRoot,
      limit,
      eventId: filters.eventId,
      problemId: filters.problemId,
      includeRouteJobs: true
    }, { store }),
    loopgraph_problems_get({ projectRoot, limit, includeRouteCommits: true }, { store }),
    loopgraph_route_jobs_get({ projectRoot, limit }, { store }),
    loopgraph_routing_evaluations_get({ projectRoot, limit }, { store }),
    store.listRoutingCorrections(),
    listLoopgraphLifecycleDeliveries(projectRoot),
    safeWebhookPlan(projectRoot, input.now)
  ]);

  const catalogByLoopId = new Map(catalog.routingCards.map((card) => [card.loopId, card]));
  const attemptsByEventId = groupBy(decisions.attempts, (item) => item.attempt.eventId);
  const problemsById = new Map(problems.problems.map((item) => [item.problem.id, item.problem]));
  const jobsByCommitId = new Map(jobs.jobs.map((job) => [job.routeCommitId, job]));
  const correctionsByEventId = groupBy(corrections, (correction) => correction.eventId);
  const evaluationsByEventId = groupBy(evaluations.evaluations, (evaluation) => evaluation.eventId);
  const lifecycleBySourceEventId = groupLifecycleDeliveries(lifecycleDeliveries);
  const rows = events.receipts.map((receipt) => {
    const relatedAttempts = (attemptsByEventId.get(receipt.eventId) ?? [])
      .sort((left, right) => right.attempt.createdAt.localeCompare(left.attempt.createdAt));
    return rowForReceipt({
      receipt,
      attemptBundle: relatedAttempts[0],
      catalogByLoopId,
      problemsById,
      jobsByCommitId,
      corrections: correctionsByEventId.get(receipt.eventId) ?? [],
      evaluations: evaluationsByEventId.get(receipt.eventId) ?? [],
      lifecycleDeliveries: lifecycleBySourceEventId.get(receipt.eventId) ?? []
    });
  }).filter((row) => rowMatchesFilters(row, filters));

  const rowScopedFiltersActive = hasRowScopedFilters(filters);
  const visibleProblemIds = new Set(rows.map((row) => row.problemId).filter((id): id is string => Boolean(id)));
  const problemInbox = problems.problems.map((item) => ({
    problemId: item.problem.id,
    summary: item.problem.summary,
    problemType: item.problem.problemType,
    status: item.problem.status,
    subject: subjectLabel(item.problem.subject),
    evidenceEventCount: item.problem.evidenceEventIds.length,
    ...(item.problem.primaryLoopId ? { primaryLoopId: item.problem.primaryLoopId } : {}),
    routeCommitCount: item.routeCommits?.length ?? item.problem.routeCommitIds.length,
    updatedAt: item.problem.updatedAt,
    owner: item.problem.owner ?? "Unassigned"
  }))
    .filter((problem) => problemMatchesFilters(problem, filters))
    .filter((problem) => !rowScopedFiltersActive || visibleProblemIds.has(problem.problemId))
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));

  const routingCatalog = catalog.routingCards.map((card) => ({
    loopId: card.loopId,
    loopName: card.loopName,
    ...(card.department ? { department: card.department } : {}),
    activationMode: card.activationMode,
    currentReadiness: card.currentReadiness,
    minimumConfidence: card.minimumConfidence,
    priority: card.priority,
    ambiguityPolicy: card.ambiguityPolicy,
    noMatchPolicy: card.noMatchPolicy,
    fanoutPolicy: card.fanoutPolicy,
    cooldown: card.cooldown,
    concurrency: card.concurrency,
    acceptedEvents: card.accepts.map((accept) => `${accept.sourcePattern}:${accept.eventTypePattern}`),
    problemTypes: card.problemTypes,
    explicitNonGoals: card.explicitNonGoals,
    requiredConnections: card.requiredConnections,
    lifecycleEvents: card.lifecycleEvents,
    examples: card.examples
  })).filter((item) => !filters.loopId || item.loopId === filters.loopId);
  const failedEvaluationCount = rows.reduce((count, row) => count + row.evaluation.failedCount, 0);
  const visibleEventIds = new Set(rows.map((row) => row.eventId));
  const routeJobCount = jobs.jobs.filter((job) => visibleEventIds.has(job.eventId)).length;

  return {
    schemaVersion: EVENT_ROUTING_OPERATIONS_SCHEMA_VERSION,
    projectRoot,
    generatedAt,
    filters,
    summary: {
      eventCount: rows.length,
      problemCount: problemInbox.length,
      unhandledProblemCount: problemInbox.filter((problem) => problem.status === "unhandled").length,
      routedEventCount: rows.filter((row) => row.action === "route").length,
      pendingHumanChoiceCount: rows.filter((row) => row.needsHumanChoice).length,
      routeJobCount,
      failedEvaluationCount,
      catalogLoopCount: routingCatalog.length,
      hermesRouteCount: webhookPlan.summary.routeCount,
      warningCount: webhookPlan.warnings.length
    },
    rows,
    problemInbox,
    routingCatalog,
    webhookHealth: {
      routeCount: webhookPlan.summary.routeCount,
      eventFamilyCount: webhookPlan.summary.eventFamilyCount,
      warnings: webhookPlan.warnings,
      routes: webhookPlan.routes.map((route) => ({
        routeName: route.routeName,
        sourcePattern: route.sourcePattern,
        eventTypePatterns: route.eventTypePatterns,
        loopIds: route.loopIds,
        deliveryMode: route.deliveryMode
      }))
    }
  };
}

function normalizeFilters(input: EventRoutingOperationsInput): EventRoutingOperationsFilters {
  return {
    ...(cleanString(input.eventId) ? { eventId: cleanString(input.eventId) } : {}),
    ...(cleanString(input.source) ? { source: cleanString(input.source) } : {}),
    ...(cleanString(input.eventType) ? { eventType: cleanString(input.eventType) } : {}),
    ...(input.receiptStatus ? { receiptStatus: input.receiptStatus } : {}),
    ...(input.action ? { action: input.action } : {}),
    ...(cleanString(input.problemId) ? { problemId: cleanString(input.problemId) } : {}),
    ...(input.problemStatus ? { problemStatus: input.problemStatus } : {}),
    ...(cleanString(input.loopId) ? { loopId: cleanString(input.loopId) } : {}),
    ...(input.needsAttention !== undefined ? { needsAttention: input.needsAttention } : {}),
    ...(input.unhandledOnly !== undefined ? { unhandledOnly: input.unhandledOnly } : {})
  };
}

function cleanString(value: string | undefined): string | undefined {
  const cleaned = value?.trim();
  return cleaned ? cleaned : undefined;
}

function rowMatchesFilters(row: EventRoutingOperationsRow, filters: EventRoutingOperationsFilters): boolean {
  if (filters.eventId && row.eventId !== filters.eventId && row.receiptId !== filters.eventId) return false;
  if (filters.source && row.source !== filters.source) return false;
  if (filters.eventType && row.eventType !== filters.eventType) return false;
  if (filters.receiptStatus && row.receiptStatus !== filters.receiptStatus) return false;
  if (filters.action && row.action !== filters.action) return false;
  if (filters.problemId && row.problemId !== filters.problemId) return false;
  if (filters.problemStatus && row.problemStatus !== filters.problemStatus) return false;
  if (filters.loopId && !row.selectedLoopIds.includes(filters.loopId) && !row.alternativeLoopIds.includes(filters.loopId)) return false;
  if (filters.unhandledOnly && row.problemStatus !== "unhandled" && row.action !== "unhandled") return false;
  if (filters.needsAttention && !rowNeedsAttention(row)) return false;
  return true;
}

function problemMatchesFilters(
  problem: EventRoutingProblemInboxItem,
  filters: EventRoutingOperationsFilters
): boolean {
  if (filters.problemId && problem.problemId !== filters.problemId) return false;
  if (filters.problemStatus && problem.status !== filters.problemStatus) return false;
  if (filters.unhandledOnly && problem.status !== "unhandled") return false;
  if (filters.loopId && problem.primaryLoopId !== filters.loopId) return false;
  if (filters.needsAttention && problem.status !== "needs_human" && problem.status !== "unhandled") return false;
  return true;
}

function hasRowScopedFilters(filters: EventRoutingOperationsFilters): boolean {
  return Boolean(
    filters.eventId ||
    filters.source ||
    filters.eventType ||
    filters.receiptStatus ||
    filters.action ||
    filters.loopId
  );
}

function rowNeedsAttention(row: EventRoutingOperationsRow): boolean {
  return row.needsHumanChoice ||
    row.needsCorrection ||
    row.problemStatus === "unhandled" ||
    row.action === "unhandled" ||
    row.action === "defer" ||
    row.receiptStatus === "failed" ||
    row.validationState === "rejected" ||
    row.validationState === "failed" ||
    row.validationErrors.length > 0;
}

function rowForReceipt(input: {
  receipt: EventReceipt;
  attemptBundle?: {
    attempt: RoutingAttempt;
    problem?: BusinessProblem;
    routeCommits?: RouteCommit[];
    routeJobs?: RouteJob[];
  };
  catalogByLoopId: Map<string, RoutingCard>;
  problemsById: Map<string, BusinessProblem>;
  jobsByCommitId: Map<string, RouteJob>;
  corrections: RoutingCorrection[];
  evaluations: RouterEvaluation[];
  lifecycleDeliveries: LoopgraphLifecycleDelivery[];
}): EventRoutingOperationsRow {
  const attempt = input.attemptBundle?.attempt;
  const routeCommits = input.attemptBundle?.routeCommits ?? [];
  const routeJobs = input.attemptBundle?.routeJobs ?? routeCommits
    .map((commit) => input.jobsByCommitId.get(commit.id))
    .filter((job): job is RouteJob => Boolean(job));
  const selectedLoopIds = routeCommits.length > 0
    ? routeCommits.map((commit) => commit.loopId)
    : attempt?.decision?.selectedRoutes.map((route) => route.loopId) ?? [];
  const selectedLoopLabels = selectedLoopIds.map((loopId) => input.catalogByLoopId.get(loopId)?.loopName ?? loopId);
  const problem = input.attemptBundle?.problem ??
    routeCommits.map((commit) => input.problemsById.get(commit.problemId)).find((item): item is BusinessProblem => Boolean(item));
  const latestEvaluation = [...input.evaluations].sort((left, right) => right.evaluatedAt.localeCompare(left.evaluatedAt))[0];
  const latestJob = [...routeJobs].sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))[0];
  const latestCommit = [...routeCommits].sort((left, right) => right.committedAt.localeCompare(left.committedAt))[0];
  const action = attempt?.action ?? "received";
  const validationState = attempt?.status ?? input.receipt.status;
  const needsHumanChoice = action === "request_human" || problem?.status === "needs_human";
  const needsCorrection = Boolean(latestEvaluation && !latestEvaluation.passed);
  const outcome = outcomeForRow(input.lifecycleDeliveries);
  const decisionDetail = decisionDetailForRow({
    attempt,
    action,
    routeCommits,
    routeJobs,
    catalogByLoopId: input.catalogByLoopId
  });
  const correlationTimeline = correlationTimelineForRow({
    receipt: input.receipt,
    attempt,
    problem,
    routeCommits,
    routeJobs,
    corrections: input.corrections,
    evaluations: input.evaluations,
    lifecycleDeliveries: input.lifecycleDeliveries,
    catalogByLoopId: input.catalogByLoopId
  });

  return {
    id: `${input.receipt.id}:${attempt?.id ?? "receipt"}`,
    eventId: input.receipt.eventId,
    receiptId: input.receipt.id,
    ...(attempt?.id ? { routeAttemptId: attempt.id } : {}),
    receivedAt: input.receipt.lastSeenAt,
    source: input.receipt.event.source,
    eventType: input.receipt.event.eventType,
    subject: subjectLabel(input.receipt.event.subject),
    correlationId: input.receipt.event.correlationId,
    receiptStatus: input.receipt.status,
    action,
    ...(problem ? {
      problemId: problem.id,
      problemSummary: problem.summary,
      problemType: problem.problemType,
      problemStatus: problem.status
    } : {}),
    selectedLoopIds,
    selectedLoopLabels,
    alternativeLoopIds: attempt?.decision?.alternatives.map((alternative) => alternative.loopId) ?? [],
    ...(attempt?.decision?.selectedRoutes[0]?.confidence !== undefined ? {
      confidence: attempt.decision.selectedRoutes[0].confidence
    } : {}),
    validationState,
    validationErrors: attempt?.validationErrors ?? [],
    ...(latestJob?.status ? { queueStatus: latestJob.status } : latestCommit?.status ? { queueStatus: latestCommit.status } : {}),
    ...(latestJob?.runId ? { runId: latestJob.runId } : latestCommit?.runId ? { runId: latestCommit.runId } : {}),
    owner: problem?.owner ?? "Unassigned",
    ...(attempt ? { latencyMs: eventToAttemptLatencyMs(input.receipt, attempt) } : {}),
    corrections: input.corrections.map((correction) => ({
      id: correction.id,
      expectedAction: correction.expectedAction,
      expectedLoopIds: correction.expectedLoopIds,
      correctedBy: correction.correctedBy,
      correctedAt: correction.correctedAt
    })),
    evaluation: {
      count: input.evaluations.length,
      passedCount: input.evaluations.filter((evaluation) => evaluation.passed).length,
      failedCount: input.evaluations.filter((evaluation) => !evaluation.passed).length,
      ...(latestEvaluation ? {
        latestPassed: latestEvaluation.passed,
        latestEvaluatedAt: latestEvaluation.evaluatedAt
      } : {})
    },
    needsHumanChoice,
    needsCorrection,
    ...(outcome ? { outcome } : {}),
    timeline: timelineForRow({
      receipt: input.receipt,
      action,
      problem,
      selectedLoopIds,
      queueStatus: latestJob?.status ?? latestCommit?.status,
      runId: latestJob?.runId ?? latestCommit?.runId,
      outcome
    }),
    decisionDetail,
    correlationTimeline
  };
}

function decisionDetailForRow(input: {
  attempt?: RoutingAttempt;
  action: RoutingAttempt["action"] | "received";
  routeCommits: RouteCommit[];
  routeJobs: RouteJob[];
  catalogByLoopId: Map<string, RoutingCard>;
}): EventRoutingDecisionDetail {
  const decision = input.attempt?.decision;
  return {
    ...(input.attempt?.id ? { routeAttemptId: input.attempt.id } : {}),
    action: input.action,
    ...(input.attempt?.catalogVersion ? { catalogVersion: input.attempt.catalogVersion } : {}),
    ...(decision?.policyVersion ? { policyVersion: decision.policyVersion } : {}),
    modelMetadata: summarizeModelMetadata(decision?.modelMetadata ?? {}),
    selectedRoutes: decision?.selectedRoutes.map((route) => ({
      loopId: route.loopId,
      loopLabel: input.catalogByLoopId.get(route.loopId)?.loopName ?? route.loopId,
      role: route.role,
      confidence: route.confidence,
      reasonSummary: route.reasonSummary,
      evidenceRefs: route.evidenceRefs,
      priority: route.priority
    })) ?? [],
    alternatives: decision?.alternatives.map((alternative) => ({
      loopId: alternative.loopId,
      loopLabel: input.catalogByLoopId.get(alternative.loopId)?.loopName ?? alternative.loopId,
      confidence: alternative.confidence,
      reasonSummary: alternative.reasonSummary
    })) ?? [],
    routeCommits: input.routeCommits.map((commit) => ({
      id: commit.id,
      loopId: commit.loopId,
      loopLabel: input.catalogByLoopId.get(commit.loopId)?.loopName ?? commit.loopId,
      status: commit.status,
      ...(commit.runId ? { runId: commit.runId } : {}),
      committedAt: commit.committedAt
    })),
    routeJobs: input.routeJobs.map((job) => ({
      id: job.id,
      status: job.status,
      runId: job.runId,
      attemptCount: job.attemptCount,
      maxAttempts: job.maxAttempts,
      nextRunAt: job.nextRunAt,
      updatedAt: job.updatedAt
    }))
  };
}

function correlationTimelineForRow(input: {
  receipt: EventReceipt;
  attempt?: RoutingAttempt;
  problem?: BusinessProblem;
  routeCommits: RouteCommit[];
  routeJobs: RouteJob[];
  corrections: RoutingCorrection[];
  evaluations: RouterEvaluation[];
  lifecycleDeliveries: LoopgraphLifecycleDelivery[];
  catalogByLoopId: Map<string, RoutingCard>;
}): EventRoutingTimelineEntry[] {
  const entries: EventRoutingTimelineEntry[] = [{
    id: input.receipt.id,
    at: input.receipt.lastSeenAt,
    stage: "event_receipt",
    label: "Event receipt persisted",
    detail: `${input.receipt.event.source} sent ${input.receipt.event.eventType} for ${subjectLabel(input.receipt.event.subject)}`,
    status: input.receipt.status
  }];

  if (input.attempt) {
    entries.push({
      id: input.attempt.id,
      at: input.attempt.createdAt,
      stage: "hermes_decision",
      label: `Hermes decision: ${input.attempt.action ?? "received"}`,
      detail: decisionSummary(input.attempt),
      status: input.attempt.status
    });
  }

  if (input.problem) {
    entries.push({
      id: input.problem.id,
      at: input.problem.updatedAt,
      stage: "business_problem",
      label: `Business problem ${input.problem.status}`,
      detail: `${input.problem.problemType}: ${input.problem.summary}`,
      status: input.problem.status
    });
  }

  for (const commit of input.routeCommits) {
    entries.push({
      id: commit.id,
      at: commit.committedAt,
      stage: "route_commit",
      label: "Loopgraph route validation committed",
      detail: `${input.catalogByLoopId.get(commit.loopId)?.loopName ?? commit.loopId} accepted with ${commit.status} status`,
      status: commit.status
    });
  }

  for (const job of input.routeJobs) {
    entries.push({
      id: job.id,
      at: job.updatedAt,
      stage: "route_job",
      label: `Durable route job ${job.status}`,
      detail: `${job.runId} · attempt ${job.attemptCount}/${job.maxAttempts}`,
      status: job.status
    });
  }

  for (const delivery of input.lifecycleDeliveries) {
    const eventType = delivery.event.eventType;
    entries.push({
      id: delivery.id,
      at: delivery.createdAt,
      stage: eventType === "loop.outcome.recorded" ? "outcome_recorded" : "lifecycle_event",
      label: eventType === "loop.outcome.recorded"
        ? "Verified outcome recorded for Hermes"
        : "Loop lifecycle callback prepared for Hermes",
      detail: lifecycleDeliveryDetail(delivery),
      status: delivery.status
    });
  }

  for (const correction of input.corrections) {
    entries.push({
      id: correction.id,
      at: correction.correctedAt,
      stage: "human_correction",
      label: `Human correction: ${correction.expectedAction}`,
      detail: `${correction.correctedBy}: ${correction.reason}`,
      status: correction.expectedAction
    });
  }

  for (const evaluation of input.evaluations) {
    entries.push({
      id: evaluation.id,
      at: evaluation.evaluatedAt,
      stage: "routing_evaluation",
      label: evaluation.passed ? "Routing evaluation passed" : "Routing evaluation failed",
      detail: `${evaluation.fixtureId}: expected ${evaluation.expectedAction} ${evaluation.expectedLoopIds.join(", ") || "no loop"}, got ${evaluation.actualAction} ${evaluation.actualLoopIds.join(", ") || "no loop"}`,
      status: evaluation.passed ? "passed" : "failed"
    });
  }

  return entries.sort((left, right) => left.at.localeCompare(right.at));
}

function decisionSummary(attempt: RoutingAttempt): string {
  if (attempt.validationErrors.length > 0) return attempt.validationErrors.join("; ");
  const selected = attempt.decision?.selectedRoutes ?? [];
  if (selected.length > 0) {
    return selected.map((route) => `${route.loopId}: ${route.reasonSummary}`).join("; ");
  }
  const alternatives = attempt.decision?.alternatives ?? [];
  if (alternatives.length > 0) {
    return `No committed route; alternatives were ${alternatives.map((item) => item.loopId).join(", ")}.`;
  }
  return "Hermes submitted a routing decision with no selected loops.";
}

function summarizeModelMetadata(metadata: Record<string, unknown>): Array<{ key: string; value: string }> {
  return Object.entries(metadata)
    .filter(([key, value]) => !sensitiveMetadataKey(key) && ["string", "number", "boolean"].includes(typeof value))
    .map(([key, value]) => ({
      key,
      value: String(value).slice(0, 120)
    }));
}

function sensitiveMetadataKey(key: string): boolean {
  return /secret|token|password|credential|api[_-]?key/i.test(key);
}

function groupLifecycleDeliveries(deliveries: LoopgraphLifecycleDelivery[]): Map<string, LoopgraphLifecycleDelivery[]> {
  const groups = new Map<string, LoopgraphLifecycleDelivery[]>();
  for (const delivery of deliveries) {
    const sourceEventId =
      readString(delivery.event.normalizedPayload, "sourceEventId") ??
      delivery.event.causationId ??
      delivery.event.parentEventId;
    if (!sourceEventId) continue;
    groups.set(sourceEventId, [...groups.get(sourceEventId) ?? [], delivery]);
  }
  return groups;
}

function outcomeForRow(deliveries: LoopgraphLifecycleDelivery[]): EventRoutingOperationsRow["outcome"] | undefined {
  const delivery = deliveries
    .filter((item) => item.event.eventType === "loop.outcome.recorded")
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt))[0];
  if (!delivery) return undefined;

  const payload = delivery.event.normalizedPayload;
  return {
    outcomeRef: readString(payload, "outcomeRef") ?? delivery.event.subject.id,
    summary: readString(payload, "resolutionSummary") ?? delivery.event.subject.display ?? "Outcome recorded",
    ...(readString(payload, "resolvedAt") ? { resolvedAt: readString(payload, "resolvedAt") } : {}),
    ...(readString(payload, "businessResult") ? { businessResult: readString(payload, "businessResult") } : {}),
    ...(readString(payload, "customerResult") ? { customerResult: readString(payload, "customerResult") } : {}),
    ...(readBoolean(payload, "followUpRequired") !== undefined ? { followUpRequired: readBoolean(payload, "followUpRequired") } : {})
  };
}

function lifecycleDeliveryDetail(delivery: LoopgraphLifecycleDelivery): string {
  if (delivery.event.eventType === "loop.outcome.recorded") {
    const summary = readString(delivery.event.normalizedPayload, "resolutionSummary") ?? delivery.event.subject.display ?? delivery.event.subject.id;
    const outcomeRef = readString(delivery.event.normalizedPayload, "outcomeRef") ?? delivery.event.subject.id;
    return `${outcomeRef} · ${summary}`;
  }
  return `${delivery.event.eventType} · ${readString(delivery.event.normalizedPayload, "runId") ?? delivery.event.subject.id}`;
}

async function safeWebhookPlan(projectRoot: string, now?: Date): Promise<HermesWebhookPlanResult> {
  try {
    return await planHermesWebhookRoutes({ projectRoot, now });
  } catch {
    return {
      schemaVersion: "hermes-webhook-plan/v1alpha1",
      projectRoot,
      generatedAt: (now ?? new Date()).toISOString(),
      catalogVersion: "unavailable",
      summary: {
        routeCount: 0,
        eventFamilyCount: 0,
        loopCount: 0,
        broadRouteCount: 0
      },
      routes: [],
      warnings: ["Hermes webhook route plan is unavailable for the current routing catalog."],
      nextActions: []
    };
  }
}

function groupBy<T>(items: T[], keyForItem: (item: T) => string): Map<string, T[]> {
  const groups = new Map<string, T[]>();
  for (const item of items) {
    const key = keyForItem(item);
    groups.set(key, [...groups.get(key) ?? [], item]);
  }
  return groups;
}

function subjectLabel(subject: { type: string; id: string; display?: string }): string {
  return `${subject.type}/${subject.display ?? subject.id}`;
}

function readString(input: Record<string, unknown>, key: string): string | undefined {
  const value = input[key];
  return typeof value === "string" ? value : undefined;
}

function readBoolean(input: Record<string, unknown>, key: string): boolean | undefined {
  const value = input[key];
  return typeof value === "boolean" ? value : undefined;
}

function eventToAttemptLatencyMs(receipt: EventReceipt, attempt: RoutingAttempt): number {
  return Math.max(0, Date.parse(attempt.createdAt) - Date.parse(receipt.lastSeenAt));
}

function timelineForRow(input: {
  receipt: EventReceipt;
  action: RoutingAttempt["action"] | "received";
  problem?: BusinessProblem;
  selectedLoopIds: string[];
  queueStatus?: RouteJob["status"] | RouteCommit["status"];
  runId?: string;
  outcome?: EventRoutingOperationsRow["outcome"];
}): string[] {
  return [
    `receipt:${input.receipt.status}`,
    input.action === "received" ? "awaiting Hermes decision" : `Hermes:${input.action}`,
    ...(input.problem ? [`problem:${input.problem.status}`] : []),
    ...(input.selectedLoopIds.length > 0 ? [`loop:${input.selectedLoopIds.join("+")}`] : []),
    ...(input.queueStatus ? [`queue:${input.queueStatus}`] : []),
    ...(input.runId ? [`run:${input.runId}`] : []),
    ...(input.outcome ? [`outcome:${input.outcome.outcomeRef}`] : [])
  ];
}
