import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  GRAPH_CHANGE_SET_SCHEMA_VERSION,
  LOOP_OPPORTUNITY_SCHEMA_VERSION,
  BusinessDiscoverySessionSchema,
  contentHash,
  graphChangeSetSchema,
  loopOpportunitySchema,
  loopOpportunitySignalSchema,
  normalizeDepartmentType,
  type BusinessProblem,
  type DepartmentType,
  type GraphChangeSet,
  type LoopOpportunity,
  type LoopOpportunityKind,
  type LoopOpportunitySignal
} from "../core";
import { FileStorageAdapter } from "../sdk/storage";
import {
  getDiscoverySession,
  saveDiscoverySession,
  selectDiscoveryDepartments,
  startHermesDiscoverySession
} from "./discovery-session";
import {
  getHermesDesignTask,
  startHermesDesignTask,
  type HermesDesignDispatchResult
} from "./hermes-design-bridge";
import type { HermesDesignStore } from "./hermes-design-store";
import { FileOutcomeStore, type OutcomeStore } from "./outcome-store";
import { FileRoutingStore, type RoutingStore } from "./routing-store";
import { getLoopgraphRoot } from "./storage-resolver";
import { readWorkspaceGraphState } from "./semantic-graph-state";
import {
  readLoopgraphWorkspace,
  type LoopgraphWorkspaceRegistry
} from "./workspace";

export type OpportunityThresholds = {
  qualify: number;
  autoDesign: number;
};

export type ScanLoopOpportunitiesInput = {
  projectRoot?: string;
  workspaceId?: string;
  companyId?: string;
  thresholds?: Partial<OpportunityThresholds>;
  autoStartDesign?: boolean;
  now?: Date;
};

export type ScanLoopOpportunitiesResult = {
  schemaVersion: "loop-opportunity-scan/v1alpha1";
  scannedAt: string;
  signalCount: number;
  opportunities: LoopOpportunity[];
  graphChangeSets: GraphChangeSet[];
  designDispatches: HermesDesignDispatchResult[];
};

type OpportunityGroup = {
  workspaceId: string;
  companyId: string;
  department: DepartmentType;
  problemType: string;
  targetLoopIds: string[];
  problemIds: string[];
  signals: LoopOpportunitySignal[];
};

type OpportunityScanContext = {
  projectRoot: string;
  workspace: LoopgraphWorkspaceRegistry;
  routingStore: RoutingStore;
  outcomeStore: OutcomeStore;
};

const DEFAULT_THRESHOLDS: OpportunityThresholds = {
  qualify: 45,
  autoDesign: 65
};

const DEPARTMENT_HINTS: Array<[DepartmentType, string[]]> = [
  ["marketing", ["ad", "campaign", "content", "seo", "webflow", "hubspot", "lead"]],
  ["sales", ["sales", "deal", "opportunity", "pipeline", "prospect", "crm", "forecast"]],
  ["product", ["product", "feedback", "feature", "roadmap", "adoption", "research"]],
  ["customer_success", ["support", "customer", "renewal", "churn", "ticket", "csat", "health score"]],
  ["engineering", ["engineering", "github", "repository", "pull request", "incident", "deploy", "bug", "ci"]],
  ["ops_finance", ["billing", "invoice", "payment", "finance", "budget", "cash", "vendor"]],
  ["hr_talent", ["candidate", "hiring", "employee", "onboarding", "ats", "hris", "talent"]],
  ["legal_compliance", ["legal", "contract", "policy", "compliance", "security", "audit", "access review"]],
  ["management", ["okr", "management", "leadership", "portfolio", "operating review"]]
];

export async function scanLoopOpportunities(
  input: ScanLoopOpportunitiesInput = {},
  options: {
    routingStore?: RoutingStore;
    outcomeStore?: OutcomeStore;
    designStore?: HermesDesignStore;
  } = {}
): Promise<ScanLoopOpportunitiesResult> {
  const projectRoot = path.resolve(input.projectRoot ?? process.cwd());
  const now = input.now ?? new Date();
  const nowIso = now.toISOString();
  const thresholds = normalizeThresholds(input.thresholds);
  const workspace = await readLoopgraphWorkspace(projectRoot);
  const routingStore = options.routingStore ?? new FileRoutingStore(getLoopgraphRoot(projectRoot));
  const outcomeStore = options.outcomeStore ?? new FileOutcomeStore(getLoopgraphRoot(projectRoot));
  const context: OpportunityScanContext = { projectRoot, workspace, routingStore, outcomeStore };
  const signals = await collectOpportunitySignals(context);
  const groups = groupOpportunitySignals({
    signals,
    workspace,
    workspaceId: input.workspaceId,
    companyId: input.companyId
  });
  const prior = await listLoopOpportunities(projectRoot);
  const opportunities: LoopOpportunity[] = [];
  const graphChangeSets: GraphChangeSet[] = [];
  const designDispatches: HermesDesignDispatchResult[] = [];

  for (const group of groups) {
    const fingerprint = opportunityFingerprint(group);
    const latestPrior = prior
      .filter((item) => item.fingerprint === fingerprint)
      .sort((left, right) => right.generation - left.generation || right.updatedAt.localeCompare(left.updatedAt))[0];
    const hasNewEvidenceAfterImplementation = latestPrior?.status === "implemented" &&
      group.signals.some((signal) => !latestPrior.signalIds.includes(signal.id) && signal.occurredAt > latestPrior.updatedAt);
    const existing = hasNewEvidenceAfterImplementation ? undefined : latestPrior;
    if (existing?.status === "dismissed" || existing?.status === "implemented") {
      opportunities.push(existing);
      const existingChangeSet = existing.graphChangeSetId
        ? await getGraphChangeSet(existing.graphChangeSetId, projectRoot)
        : undefined;
      if (existingChangeSet) graphChangeSets.push(existingChangeSet);
      continue;
    }

    const score = scoreOpportunity(group);
    const kind = opportunityKind(group);
    const existingTask = existing?.designTaskId
      ? await getHermesDesignTask(existing.designTaskId, projectRoot, options.designStore)
      : undefined;
    const status: LoopOpportunity["status"] = opportunityStatusFromTask(existingTask?.status) ??
      (score.total >= thresholds.qualify ? "qualified" : "detected");
    const generation = existing?.generation ?? (latestPrior?.generation ?? 0) + 1;
    let opportunity = loopOpportunitySchema.parse({
      schemaVersion: LOOP_OPPORTUNITY_SCHEMA_VERSION,
      id: existing?.id ?? `opportunity_${contentHash({ fingerprint, generation })}`,
      fingerprint,
      generation,
      supersedesOpportunityId: existing?.supersedesOpportunityId ??
        (hasNewEvidenceAfterImplementation ? latestPrior?.id : undefined),
      workspaceId: group.workspaceId,
      companyId: group.companyId,
      department: group.department,
      kind,
      status,
      problemType: group.problemType,
      title: opportunityTitle(kind, group),
      summary: opportunitySummary(kind, group),
      targetLoopIds: group.targetLoopIds,
      problemIds: group.problemIds,
      signalIds: group.signals.map((signal) => signal.id),
      signals: group.signals,
      score,
      thresholds,
      discoverySessionId: existing?.discoverySessionId,
      designTaskId: existing?.designTaskId,
      graphChangeSetId: existing?.graphChangeSetId,
      firstObservedAt: existing?.firstObservedAt ?? earliestSignalAt(group.signals),
      lastObservedAt: latestSignalAt(group.signals),
      createdAt: existing?.createdAt ?? nowIso,
      updatedAt: nowIso
    });

    let changeSet = await proposeGraphChangeSet({
      projectRoot,
      workspace,
      opportunity,
      existingId: opportunity.graphChangeSetId,
      now
    });
    if (existingTask) {
      changeSet = graphChangeSetSchema.parse({
        ...changeSet,
        designTaskId: existingTask.id,
        designRunId: existingTask.designRunIds.at(-1) ?? changeSet.designRunId,
        updatedAt: nowIso
      });
      await saveGraphChangeSet(changeSet, projectRoot);
    }
    opportunity = loopOpportunitySchema.parse({
      ...opportunity,
      graphChangeSetId: changeSet.id
    });

    if (
      input.autoStartDesign !== false &&
      opportunity.status === "qualified" &&
      opportunity.score.total >= thresholds.autoDesign
    ) {
      const session = await ensureOpportunityDiscoverySession({
        projectRoot,
        workspace,
        opportunity,
        now
      });
      const dispatch = await startHermesDesignTask({
        projectRoot,
        sessionId: session.id,
        department: opportunity.department,
        reason: opportunity.kind === "create_loop" ? "loop_opportunity" : "improvement",
        originProblemIds: opportunity.problemIds,
        originOpportunityId: opportunity.id,
        requestedBy: "loopgraph-opportunity-engine",
        now
      }, { store: options.designStore });
      designDispatches.push(dispatch);
      opportunity = loopOpportunitySchema.parse({
        ...opportunity,
        status: dispatch.task.status === "completed" ? "proposal_ready" : "design_requested",
        discoverySessionId: session.id,
        designTaskId: dispatch.task.id,
        updatedAt: nowIso
      });
      changeSet = graphChangeSetSchema.parse({
        ...changeSet,
        designTaskId: dispatch.task.id,
        updatedAt: nowIso
      });
      await saveGraphChangeSet(changeSet, projectRoot);
    }

    await saveLoopOpportunity(opportunity, projectRoot);
    opportunities.push(opportunity);
    graphChangeSets.push(changeSet);
  }

  return {
    schemaVersion: "loop-opportunity-scan/v1alpha1",
    scannedAt: nowIso,
    signalCount: signals.length,
    opportunities: opportunities.sort((left, right) =>
      right.score.total - left.score.total || right.updatedAt.localeCompare(left.updatedAt)
    ),
    graphChangeSets,
    designDispatches
  };
}

export async function listLoopOpportunities(
  projectRoot = process.cwd(),
  filters: {
    status?: LoopOpportunity["status"];
    department?: DepartmentType;
    minimumScore?: number;
  } = {}
): Promise<LoopOpportunity[]> {
  const root = opportunityRoot(path.resolve(projectRoot));
  try {
    const files = await readdir(root);
    const opportunities = await Promise.all(files
      .filter((file) => file.endsWith(".json"))
      .map(async (file) => {
        try {
          return loopOpportunitySchema.parse(JSON.parse(await readFile(path.join(root, file), "utf8")));
        } catch {
          return undefined;
        }
      }));
    return opportunities
      .filter((item): item is LoopOpportunity => Boolean(item))
      .filter((item) => !filters.status || item.status === filters.status)
      .filter((item) => !filters.department || item.department === filters.department)
      .filter((item) => filters.minimumScore === undefined || item.score.total >= filters.minimumScore)
      .sort((left, right) => right.score.total - left.score.total || right.updatedAt.localeCompare(left.updatedAt));
  } catch {
    return [];
  }
}

export async function getLoopOpportunity(
  opportunityId: string,
  projectRoot = process.cwd()
): Promise<LoopOpportunity | undefined> {
  try {
    return loopOpportunitySchema.parse(JSON.parse(
      await readFile(opportunityPath(path.resolve(projectRoot), opportunityId), "utf8")
    ));
  } catch {
    return undefined;
  }
}

export async function dismissLoopOpportunity(input: {
  projectRoot?: string;
  opportunityId: string;
  reason: string;
  now?: Date;
}): Promise<LoopOpportunity> {
  const projectRoot = path.resolve(input.projectRoot ?? process.cwd());
  const existing = await getLoopOpportunity(input.opportunityId, projectRoot);
  if (!existing) throw new Error(`Loop opportunity not found: ${input.opportunityId}`);
  const nowIso = (input.now ?? new Date()).toISOString();
  const dismissed = loopOpportunitySchema.parse({
    ...existing,
    status: "dismissed",
    dismissalReason: input.reason,
    dismissedAt: nowIso,
    updatedAt: nowIso
  });
  await saveLoopOpportunity(dismissed, projectRoot);
  return dismissed;
}

export async function markLoopOpportunityImplemented(input: {
  projectRoot?: string;
  designRunId: string;
  now?: Date;
}, options: {
  designStore?: HermesDesignStore;
} = {}): Promise<{
  opportunities: LoopOpportunity[];
  graphChangeSets: GraphChangeSet[];
}> {
  const projectRoot = path.resolve(input.projectRoot ?? process.cwd());
  const nowIso = (input.now ?? new Date()).toISOString();
  const opportunities = await listLoopOpportunities(projectRoot);
  const matched: LoopOpportunity[] = [];
  const appliedSets: GraphChangeSet[] = [];
  for (const opportunity of opportunities) {
    const task = opportunity.designTaskId
      ? await getHermesDesignTask(opportunity.designTaskId, projectRoot, options.designStore)
      : undefined;
    if (!task?.designRunIds.includes(input.designRunId)) continue;
    const implemented = loopOpportunitySchema.parse({
      ...opportunity,
      status: "implemented",
      updatedAt: nowIso
    });
    await saveLoopOpportunity(implemented, projectRoot);
    matched.push(implemented);
    if (opportunity.graphChangeSetId) {
      const changeSet = await getGraphChangeSet(opportunity.graphChangeSetId, projectRoot);
      if (changeSet) {
        const applied = graphChangeSetSchema.parse({
          ...changeSet,
          status: "applied",
          designRunId: input.designRunId,
          appliedAt: nowIso,
          updatedAt: nowIso
        });
        await saveGraphChangeSet(applied, projectRoot);
        appliedSets.push(applied);
      }
    }
  }
  return {
    opportunities: matched,
    graphChangeSets: appliedSets
  };
}

export async function listGraphChangeSets(
  projectRoot = process.cwd(),
  opportunityId?: string
): Promise<GraphChangeSet[]> {
  const root = graphChangeSetRoot(path.resolve(projectRoot));
  try {
    const files = await readdir(root);
    const sets = await Promise.all(files
      .filter((file) => file.endsWith(".json"))
      .map(async (file) => {
        try {
          return graphChangeSetSchema.parse(JSON.parse(await readFile(path.join(root, file), "utf8")));
        } catch {
          return undefined;
        }
      }));
    return sets
      .filter((item): item is GraphChangeSet => Boolean(item))
      .filter((item) => !opportunityId || item.opportunityId === opportunityId)
      .sort((left, right) => right.version - left.version || right.updatedAt.localeCompare(left.updatedAt));
  } catch {
    return [];
  }
}

export async function getGraphChangeSet(
  changeSetId: string,
  projectRoot = process.cwd()
): Promise<GraphChangeSet | undefined> {
  try {
    return graphChangeSetSchema.parse(JSON.parse(
      await readFile(graphChangeSetPath(path.resolve(projectRoot), changeSetId), "utf8")
    ));
  } catch {
    return undefined;
  }
}

async function collectOpportunitySignals(context: OpportunityScanContext): Promise<LoopOpportunitySignal[]> {
  const [problems, receipts, corrections, evaluations, jobs, observedOutcomes, valueLedgerEntries] = await Promise.all([
    context.routingStore.listBusinessProblems(),
    context.routingStore.listEventReceipts(),
    context.routingStore.listRoutingCorrections(),
    context.routingStore.listRouterEvaluations(),
    context.routingStore.listRouteJobs(),
    context.outcomeStore.listObservedOutcomes(),
    context.outcomeStore.listValueLedgerEntries()
  ]);
  const problemById = new Map(problems.map((problem) => [problem.id, problem]));
  const eventById = new Map(receipts.map((receipt) => [receipt.eventId, receipt.event]));
  const problemByEventId = new Map<string, BusinessProblem>();
  for (const problem of problems) {
    for (const eventId of problem.evidenceEventIds) problemByEventId.set(eventId, problem);
  }
  const commits = await context.routingStore.listRouteCommits();
  for (const commit of commits) {
    const problem = problemById.get(commit.problemId);
    if (problem) problemByEventId.set(commit.eventId, problem);
  }

  const signals: LoopOpportunitySignal[] = [];
  for (const problem of problems) {
    if (problem.status !== "unhandled" && !(problem.status === "needs_human" && !problem.primaryLoopId)) continue;
    signals.push(signal({
      type: problem.status === "unhandled" ? "unhandled_problem" : "human_route_choice",
      sourceRef: `problem:${problem.id}`,
      workspaceId: problem.workspaceId,
      companyId: problem.companyId,
      occurredAt: problem.updatedAt,
      summary: problem.summary,
      severity: problem.severity,
      problemType: problem.problemType,
      loopId: problem.primaryLoopId,
      problemId: problem.id,
      evidenceRefs: problem.evidenceEventIds
    }));
  }

  for (const correction of corrections) {
    const problem = problemByEventId.get(correction.eventId);
    const event = eventById.get(correction.eventId);
    const loopIds = correction.expectedLoopIds.length > 0
      ? correction.expectedLoopIds
      : problem?.primaryLoopId
        ? [problem.primaryLoopId]
        : [];
    for (const loopId of loopIds.length > 0 ? loopIds : [undefined]) {
      signals.push(signal({
        type: "routing_correction",
        sourceRef: `correction:${correction.id}`,
        workspaceId: problem?.workspaceId ?? event?.workspaceId,
        companyId: problem?.companyId ?? event?.companyId,
        occurredAt: correction.correctedAt,
        summary: correction.reason,
        severity: problem?.severity ?? "medium",
        problemType: problem?.problemType,
        loopId,
        problemId: problem?.id,
        eventId: event?.id ?? correction.eventId,
        evidenceRefs: [correction.id, correction.eventId]
      }));
    }
  }

  for (const evaluation of evaluations.filter((item) => !item.passed)) {
    const problem = problemByEventId.get(evaluation.eventId);
    const event = eventById.get(evaluation.eventId);
    const loopIds = evaluation.expectedLoopIds.length > 0
      ? evaluation.expectedLoopIds
      : evaluation.actualLoopIds;
    for (const loopId of loopIds.length > 0 ? loopIds : [undefined]) {
      signals.push(signal({
        type: "router_evaluation_failure",
        sourceRef: `routing-evaluation:${evaluation.id}`,
        workspaceId: problem?.workspaceId ?? event?.workspaceId,
        companyId: problem?.companyId ?? event?.companyId,
        occurredAt: evaluation.evaluatedAt,
        summary: `Expected ${evaluation.expectedAction} but observed ${evaluation.actualAction}.`,
        severity: problem?.severity ?? "medium",
        problemType: problem?.problemType,
        loopId,
        problemId: problem?.id,
        eventId: event?.id ?? evaluation.eventId,
        evidenceRefs: [evaluation.id, evaluation.fixtureId]
      }));
    }
  }

  for (const job of jobs.filter((item) => item.status === "failed" || item.status === "dead_letter")) {
    const problem = problemById.get(job.problemId);
    signals.push(signal({
      type: "route_job_failure",
      sourceRef: `route-job:${job.id}`,
      workspaceId: problem?.workspaceId,
      companyId: problem?.companyId,
      occurredAt: job.updatedAt,
      summary: job.lastError?.message ?? job.deadLetterReason ?? `Route job ${job.status}.`,
      severity: job.status === "dead_letter" ? "high" : problem?.severity ?? "medium",
      problemType: problem?.problemType,
      loopId: job.loopId,
      problemId: job.problemId,
      eventId: job.eventId,
      evidenceRefs: [job.id, job.routeCommitId]
    }));
  }

  const storage = new FileStorageAdapter(getLoopgraphRoot(context.projectRoot));
  const runs = await storage.listRuns();
  const traces = (await Promise.all(runs.map((run) => storage.getRun(run.id))))
    .filter((trace): trace is NonNullable<typeof trace> => Boolean(trace));
  const problemByRunId = new Map(commits
    .filter((commit) => commit.runId)
    .map((commit) => [commit.runId!, problemById.get(commit.problemId)]));
  for (const trace of traces) {
    const problem = problemByRunId.get(trace.id);
    const event = eventById.get(trace.trigger.eventId);
    if (isFailedRunStatus(trace.status)) {
      signals.push(signal({
        type: "run_failure",
        sourceRef: `run:${trace.id}`,
        workspaceId: problem?.workspaceId ?? event?.workspaceId,
        companyId: problem?.companyId ?? event?.companyId,
        occurredAt: trace.completedAt ?? trace.startedAt,
        summary: trace.errors.at(-1)?.message ?? `Loop run ended in ${trace.status}.`,
        severity: trace.status === "FAILED_VERIFICATION" ? "high" : problem?.severity ?? "medium",
        problemType: problem?.problemType,
        loopId: trace.loopId,
        problemId: problem?.id,
        eventId: trace.trigger.eventId,
        evidenceRefs: [trace.id]
      }));
    }
    if (trace.verificationResults.some((result) => !result.passed)) {
      signals.push(signal({
        type: "verification_failure",
        sourceRef: `run-verification:${trace.id}`,
        workspaceId: problem?.workspaceId ?? event?.workspaceId,
        companyId: problem?.companyId ?? event?.companyId,
        occurredAt: trace.completedAt ?? trace.startedAt,
        summary: trace.verificationResults.filter((result) => !result.passed).map((result) => result.summary).join("; "),
        severity: "high",
        problemType: problem?.problemType,
        loopId: trace.loopId,
        problemId: problem?.id,
        eventId: trace.trigger.eventId,
        evidenceRefs: [trace.id]
      }));
    }
    for (const review of trace.humanReviews.filter((item) =>
      ["rejected", "needs_changes", "request_evidence", "reassigned"].includes(item.status)
    )) {
      signals.push(signal({
        type: "review_friction",
        sourceRef: `review:${review.id}`,
        workspaceId: problem?.workspaceId ?? event?.workspaceId,
        companyId: problem?.companyId ?? event?.companyId,
        occurredAt: review.decidedAt ?? review.createdAt,
        summary: review.teacherFeedback ?? review.comment ?? `Review ended in ${review.status}.`,
        severity: review.status === "rejected" ? "high" : "medium",
        problemType: problem?.problemType,
        loopId: trace.loopId,
        problemId: problem?.id,
        eventId: trace.trigger.eventId,
        evidenceRefs: [trace.id, review.id],
        metrics: {
          reviewMinutes: review.reviewMinutes,
          reworkMinutes: review.reworkMinutes,
          botsittingMinutes: review.botsittingMinutes
        }
      }));
    }
    for (const output of trace.outputs.filter((item) => item.type === "improvement_signal")) {
      const content = isRecord(output.content) ? output.content : {};
      signals.push(signal({
        type: "improvement_signal",
        sourceRef: `improvement:${output.id}`,
        workspaceId: problem?.workspaceId ?? event?.workspaceId,
        companyId: problem?.companyId ?? event?.companyId,
        occurredAt: trace.completedAt ?? trace.startedAt,
        summary: stringValue(content.description) ?? stringValue(content.title) ?? "The loop emitted an improvement signal.",
        severity: "medium",
        problemType: stringValue(content.failureMode) ?? problem?.problemType,
        loopId: stringValue(content.loopId) ?? trace.loopId,
        problemId: problem?.id,
        eventId: trace.trigger.eventId,
        evidenceRefs: [trace.id, output.id]
      }));
    }
  }

  const latestOutcomes = latestBy(
    observedOutcomes,
    (outcome) => `${outcome.loopId}|${outcome.metricDefinitionId}`,
    (outcome) => outcome.evaluatedAt
  );
  for (const outcome of latestOutcomes) {
    if (outcome.status !== "regressed" && outcome.status !== "incomplete") continue;
    signals.push(signal({
      type: outcome.status === "regressed" ? "outcome_regression" : "outcome_incomplete",
      sourceRef: `outcome:${outcome.id}`,
      workspaceId: outcome.workspaceId,
      companyId: outcome.companyId,
      occurredAt: outcome.evaluatedAt,
      summary: outcome.status === "regressed"
        ? `${outcome.metricKey} regressed during the measurement window.`
        : `${outcome.metricKey} cannot yet be evaluated: ${outcome.evidenceSufficiency.reasons.join("; ") || "measurement evidence is incomplete"}.`,
      severity: outcome.status === "regressed" ? "high" : "low",
      problemType: outcome.status === "regressed"
        ? `${outcome.loopId}_outcome_regression`
        : `${outcome.loopId}_measurement_gap`,
      loopId: outcome.loopId,
      evidenceRefs: [outcome.id, ...outcome.evidenceRefs],
      metrics: {
        relativeDeltaPct: outcome.relativeDeltaPct
      }
    }));
  }

  for (const entry of valueLedgerEntries.filter((item) => item.netSavedMinutes < 0)) {
    signals.push(signal({
      type: "negative_value",
      sourceRef: `value-ledger:${entry.id}`,
      workspaceId: entry.workspaceId,
      companyId: entry.companyId,
      occurredAt: entry.recordedAt,
      summary: `${entry.loopId} recorded ${entry.netSavedMinutes} net saved minutes after operating cost.`,
      severity: entry.netSavedMinutes <= -30 ? "high" : "medium",
      problemType: `${entry.loopId}_negative_net_value`,
      loopId: entry.loopId,
      evidenceRefs: [entry.id, ...entry.evidenceRefs],
      metrics: {
        reviewMinutes: entry.hiddenCostMinutes.review,
        reworkMinutes: entry.hiddenCostMinutes.rework,
        botsittingMinutes: entry.hiddenCostMinutes.botsitting,
        netSavedMinutes: entry.netSavedMinutes
      }
    }));
  }

  return dedupeSignals(signals);
}

function groupOpportunitySignals(input: {
  signals: LoopOpportunitySignal[];
  workspace: LoopgraphWorkspaceRegistry;
  workspaceId?: string;
  companyId?: string;
}): OpportunityGroup[] {
  const departmentsByLoop = new Map(input.workspace.registeredSpecs.map((spec) => [spec.id, spec.department]));
  const groups = new Map<string, OpportunityGroup>();
  for (const item of input.signals) {
    const companyId = input.companyId ?? companyIdFromSignal(item) ?? input.workspace.projectRootId;
    const workspaceId = input.workspaceId ?? workspaceIdFromSignal(item) ?? input.workspace.projectRootId;
    const targetLoopIds = item.loopId ? [item.loopId] : [];
    const department = item.loopId
      ? departmentsByLoop.get(item.loopId) ?? inferDepartment(`${item.summary} ${item.loopId}`)
      : inferDepartment(item.summary);
    const problemType = problemTypeFromSignal(item);
    const key = [workspaceId, companyId, department, targetLoopIds.join(","), problemType].join("|");
    const group = groups.get(key) ?? {
      workspaceId,
      companyId,
      department,
      problemType,
      targetLoopIds,
      problemIds: [],
      signals: []
    };
    group.signals.push(item);
    if (item.problemId) group.problemIds.push(item.problemId);
    groups.set(key, group);
  }
  return [...groups.values()].map((group) => ({
    ...group,
    problemIds: unique(group.problemIds),
    signals: dedupeSignals(group.signals).sort((left, right) => left.occurredAt.localeCompare(right.occurredAt))
  }));
}

function scoreOpportunity(group: OpportunityGroup): LoopOpportunity["score"] {
  const sourceTypes = new Set(group.signals.map((item) => item.type));
  const recurrence = Math.min(25, 8 + Math.max(0, group.signals.length - 1) * 5);
  const businessImpact = Math.min(25, Math.max(...group.signals.map((item) => severityWeight(item.severity))));
  const coverageGap = group.targetLoopIds.length === 0 ? 25 : sourceTypes.has("routing_correction") ? 12 : 5;
  const evidenceConfidence = Math.min(15, 5 + sourceTypes.size * 4 + Math.min(4, group.problemIds.length * 2));
  const humanMinutes = group.signals.reduce((total, item) =>
    total +
    (item.metrics.reviewMinutes ?? 0) +
    (item.metrics.reworkMinutes ?? 0) +
    (item.metrics.botsittingMinutes ?? 0), 0);
  const humanFriction = Math.min(15,
    (sourceTypes.has("review_friction") ? 5 : 0) +
    Math.min(10, Math.round(humanMinutes / 15))
  );
  const riskPenalty = group.department === "custom" ? 8 : sourceTypes.size === 1 && group.signals.length === 1 ? 5 : 0;
  const total = clampScore(recurrence + businessImpact + coverageGap + evidenceConfidence + humanFriction - riskPenalty);
  const explanation = [
    `${group.signals.length} observed signal${group.signals.length === 1 ? "" : "s"} across ${sourceTypes.size} source type${sourceTypes.size === 1 ? "" : "s"}.`,
    group.targetLoopIds.length === 0
      ? "No registered loop currently owns this recurring business problem."
      : `The evidence points to an existing loop that should be improved: ${group.targetLoopIds.join(", ")}.`,
    humanMinutes > 0
      ? `${humanMinutes} minutes of recorded review, rework, or monitoring friction contributed to the score.`
      : "No hidden-labor minutes were recorded, so the score does not assume them.",
    riskPenalty > 0
      ? "The score is reduced because the department or evidence classification still needs confirmation."
      : "The department and evidence coverage are sufficiently specific for guided discovery."
  ];
  return {
    total,
    recurrence,
    businessImpact,
    coverageGap,
    evidenceConfidence,
    humanFriction,
    riskPenalty,
    explanation
  };
}

async function proposeGraphChangeSet(input: {
  projectRoot: string;
  workspace: LoopgraphWorkspaceRegistry;
  opportunity: LoopOpportunity;
  existingId?: string;
  now: Date;
}): Promise<GraphChangeSet> {
  const nowIso = input.now.toISOString();
  const existing = input.existingId
    ? await getGraphChangeSet(input.existingId, input.projectRoot)
    : undefined;
  const operation = graphOperation(input.opportunity.kind);
  const baseGraphHash = (await readWorkspaceGraphState(input.projectRoot)).graphHash;
  const changes = [{
    id: `change_${contentHash({ opportunityId: input.opportunity.id, operation })}`,
    operation,
    department: input.opportunity.department,
    targetLoopIds: input.opportunity.targetLoopIds,
    proposedLoopCount: operation === "add" ? 1 : operation === "split" ? 2 : operation === "retire" ? 0 : 1,
    title: input.opportunity.title,
    rationale: input.opportunity.summary,
    expectedOutcome: `Reduce recurrence of ${input.opportunity.problemType} and verify the result with observed evidence.`,
    evidenceRefs: input.opportunity.signals.flatMap((item) => [item.sourceRef, ...item.evidenceRefs]),
    requiresExplicitApproval: true
  }];
  const changeFingerprint = contentHash({
    baseGraphHash,
    changes: changes.map((change) => ({
      ...change,
      evidenceRefs: [...change.evidenceRefs].sort()
    }))
  });
  const existingFingerprint = existing
    ? contentHash({
        baseGraphHash: existing.baseGraphHash,
        changes: existing.changes.map((change) => ({
          ...change,
          evidenceRefs: [...change.evidenceRefs].sort()
        }))
      })
    : undefined;
  if (existing && existingFingerprint === changeFingerprint) {
    return existing;
  }
  if (existing && existing.status === "proposed") {
    await saveGraphChangeSet(graphChangeSetSchema.parse({
      ...existing,
      status: "superseded",
      updatedAt: nowIso
    }), input.projectRoot);
  }
  const version = (existing?.version ?? 0) + 1;
  const desired = graphChangeSetSchema.parse({
    schemaVersion: GRAPH_CHANGE_SET_SCHEMA_VERSION,
    id: `graph_change_${contentHash({
      opportunityId: input.opportunity.id,
      fingerprint: input.opportunity.fingerprint,
      version,
      changeFingerprint
    })}`,
    version,
    workspaceId: input.opportunity.workspaceId,
    companyId: input.opportunity.companyId,
    baseGraphHash,
    opportunityId: input.opportunity.id,
    status: "proposed",
    changes,
    supersedesId: existing?.id,
    designTaskId: input.opportunity.designTaskId,
    createdAt: nowIso,
    updatedAt: nowIso
  });
  await saveGraphChangeSet(desired, input.projectRoot);
  return desired;
}

async function ensureOpportunityDiscoverySession(input: {
  projectRoot: string;
  workspace: LoopgraphWorkspaceRegistry;
  opportunity: LoopOpportunity;
  now: Date;
}) {
  const sessionId = input.opportunity.discoverySessionId ??
    `session_${contentHash({ opportunityId: input.opportunity.id })}`;
  let session = await getDiscoverySession(sessionId, input.projectRoot);
  if (!session) {
    session = await startHermesDiscoverySession({
      projectRoot: input.projectRoot,
      sessionId,
      companyId: input.opportunity.companyId,
      companyName: input.workspace.displayName,
      createdByActor: "api",
      now: input.now
    });
  }
  if (!session.selectedDepartmentIds.includes(input.opportunity.department)) {
    session = await selectDiscoveryDepartments({
      projectRoot: input.projectRoot,
      sessionId: session.id,
      departments: unique([...session.selectedDepartmentIds, input.opportunity.department]),
      activeDepartment: input.opportunity.department,
      expectedRevision: session.revision,
      actor: "api",
      now: input.now
    });
  }
  const profile = session.companyProfile;
  const updated = BusinessDiscoverySessionSchema.parse({
    ...session,
    companyProfile: profile ? {
      ...profile,
      bottlenecks: unique([...profile.bottlenecks, input.opportunity.summary]),
      recurringWork: unique([...profile.recurringWork, input.opportunity.problemType])
    } : profile,
    revision: session.revision + 1,
    updatedAt: (input.now ?? new Date()).toISOString()
  });
  return saveDiscoverySession(updated, input.projectRoot, {
    expectedRevision: session.revision
  });
}

async function saveLoopOpportunity(opportunity: LoopOpportunity, projectRoot: string): Promise<void> {
  const filePath = opportunityPath(projectRoot, opportunity.id);
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(loopOpportunitySchema.parse(opportunity), null, 2)}\n`);
}

export async function saveGraphChangeSet(changeSet: GraphChangeSet, projectRoot: string): Promise<void> {
  const filePath = graphChangeSetPath(projectRoot, changeSet.id);
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(graphChangeSetSchema.parse(changeSet), null, 2)}\n`);
}

function opportunityRoot(projectRoot: string): string {
  return path.join(getLoopgraphRoot(projectRoot), "opportunities");
}

function opportunityPath(projectRoot: string, opportunityId: string): string {
  return path.join(opportunityRoot(projectRoot), `${encodeURIComponent(opportunityId)}.json`);
}

function graphChangeSetRoot(projectRoot: string): string {
  return path.join(getLoopgraphRoot(projectRoot), "graph", "change-sets");
}

function graphChangeSetPath(projectRoot: string, changeSetId: string): string {
  return path.join(graphChangeSetRoot(projectRoot), `${encodeURIComponent(changeSetId)}.json`);
}

function signal(input: Omit<LoopOpportunitySignal, "id" | "metrics"> & {
  metrics?: LoopOpportunitySignal["metrics"];
}): LoopOpportunitySignal {
  return loopOpportunitySignalSchema.parse({
    ...input,
    id: `signal_${contentHash({
      type: input.type,
      sourceRef: input.sourceRef,
      loopId: input.loopId,
      problemId: input.problemId
    })}`
  });
}

function opportunityFingerprint(group: OpportunityGroup): string {
  return contentHash({
    workspaceId: group.workspaceId,
    companyId: group.companyId,
    department: group.department,
    problemType: group.problemType,
    targetLoopIds: [...group.targetLoopIds].sort()
  });
}

function opportunityKind(group: OpportunityGroup): LoopOpportunityKind {
  if (group.targetLoopIds.length === 0) return "create_loop";
  if (group.signals.filter((item) => item.type === "negative_value").length >= 3) {
    return "retire_loop";
  }
  if (
    group.targetLoopIds.length === 1 &&
    group.signals.filter((item) => item.type === "routing_correction").length >= 3
  ) return "split_loop";
  return "improve_loop";
}

function latestBy<T>(
  items: T[],
  key: (item: T) => string,
  timestamp: (item: T) => string
): T[] {
  const latest = new Map<string, T>();
  for (const item of items) {
    const itemKey = key(item);
    const existing = latest.get(itemKey);
    if (!existing || timestamp(item) > timestamp(existing)) latest.set(itemKey, item);
  }
  return [...latest.values()];
}

function graphOperation(kind: LoopOpportunityKind): "add" | "update" | "split" | "merge" | "retire" {
  const operations: Record<LoopOpportunityKind, "add" | "update" | "split" | "merge" | "retire"> = {
    create_loop: "add",
    improve_loop: "update",
    split_loop: "split",
    merge_loops: "merge",
    retire_loop: "retire"
  };
  return operations[kind];
}

function opportunityTitle(kind: LoopOpportunityKind, group: OpportunityGroup): string {
  const department = formatDepartment(group.department);
  if (kind === "create_loop") return `Create a ${department} loop for ${humanize(group.problemType)}`;
  if (kind === "split_loop") return `Split ${group.targetLoopIds[0]} around recurring routing corrections`;
  if (kind === "retire_loop") return `Review ${group.targetLoopIds.join(", ")} for pause or retirement`;
  return `Improve ${group.targetLoopIds.join(", ")} for ${humanize(group.problemType)}`;
}

function opportunitySummary(kind: LoopOpportunityKind, group: OpportunityGroup): string {
  const latest = group.signals.at(-1)?.summary ?? group.problemType;
  if (kind === "create_loop") {
    return `${group.signals.length} observed signal(s) indicate a recurring ${formatDepartment(group.department)} problem with no registered owning loop. Latest evidence: ${latest}`;
  }
  if (kind === "retire_loop") {
    return `${group.signals.length} observed negative-value signal(s) indicate that ${group.targetLoopIds.join(", ")} should be paused or retired after accountable review. Latest evidence: ${latest}`;
  }
  return `${group.signals.length} observed signal(s) indicate that ${group.targetLoopIds.join(", ")} should be revised. Latest evidence: ${latest}`;
}

function problemTypeFromSignal(item: LoopOpportunitySignal): string {
  if (item.problemType) return item.problemType;
  if (item.loopId) return `${item.loopId}_performance`;
  return `${item.type}_coverage`;
}

function companyIdFromSignal(_item: LoopOpportunitySignal): string | undefined {
  return _item.companyId;
}

function workspaceIdFromSignal(_item: LoopOpportunitySignal): string | undefined {
  return _item.workspaceId;
}

function inferDepartment(value: string): DepartmentType {
  const normalized = normalizeDepartmentType(value);
  if (normalized) return normalized;
  const haystack = value.toLowerCase();
  return DEPARTMENT_HINTS.find(([, hints]) => hints.some((hint) => haystack.includes(hint)))?.[0] ?? "custom";
}

function severityWeight(severity: LoopOpportunitySignal["severity"]): number {
  return {
    low: 8,
    medium: 14,
    high: 21,
    critical: 25
  }[severity];
}

function normalizeThresholds(input?: Partial<OpportunityThresholds>): OpportunityThresholds {
  if (
    (input?.qualify !== undefined && !Number.isFinite(input.qualify)) ||
    (input?.autoDesign !== undefined && !Number.isFinite(input.autoDesign))
  ) {
    throw new Error("Loop opportunity thresholds must be finite numbers.");
  }
  const qualify = clampScore(input?.qualify ?? DEFAULT_THRESHOLDS.qualify);
  const autoDesign = clampScore(input?.autoDesign ?? DEFAULT_THRESHOLDS.autoDesign);
  if (autoDesign < qualify) {
    throw new Error("Loop opportunity auto-design threshold cannot be lower than the qualification threshold.");
  }
  return { qualify, autoDesign };
}

function clampScore(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value)));
}

function earliestSignalAt(signals: LoopOpportunitySignal[]): string {
  return signals.map((item) => item.occurredAt).sort()[0]!;
}

function latestSignalAt(signals: LoopOpportunitySignal[]): string {
  return signals.map((item) => item.occurredAt).sort().at(-1)!;
}

function isFailedRunStatus(status: string): boolean {
  return [
    "FAILED_VALIDATION",
    "FAILED_VERIFICATION",
    "ESCALATED",
    "REJECTED",
    "BLOCKED_BY_POLICY"
  ].includes(status);
}

function opportunityStatusFromTask(
  status?: "queued" | "needs_input" | "awaiting_hermes" | "designing" | "needs_repair" | "completed" | "failed" | "cancelled"
): LoopOpportunity["status"] | undefined {
  if (status === "completed") return "proposal_ready";
  if (status === "designing" || status === "needs_repair") return "designing";
  if (status === "queued" || status === "needs_input" || status === "awaiting_hermes") return "design_requested";
  return undefined;
}

function dedupeSignals(signals: LoopOpportunitySignal[]): LoopOpportunitySignal[] {
  return [...new Map(signals.map((item) => [item.id, item])).values()];
}

function unique<T>(items: T[]): T[] {
  return [...new Set(items)];
}

function formatDepartment(value: DepartmentType): string {
  return value.split("_").map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join(" / ");
}

function humanize(value: string): string {
  return value.replace(/[_-]+/g, " ");
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}
