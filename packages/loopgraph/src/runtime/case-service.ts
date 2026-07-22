import type { BusinessProblem, EventEnvelope, EscalationCase, LoopRunTrace, RouteCommit } from "../core";
import type { StorageAdapter } from "../sdk/adapters";
import { emitOutcomeRecordedLifecycleEvent, type LoopgraphLifecycleEmitResult } from "./lifecycle-events";
import { FileRoutingStore, type RoutingStore } from "./routing-store";
import { getLoopgraphRoot } from "./storage-resolver";

export type CaseStatus = EscalationCase["status"];
export type CaseOutcome = NonNullable<EscalationCase["outcome"]>;
export type ResolveCaseLifecycleOptions = {
  projectRoot?: string;
  routingStore?: RoutingStore;
  sourceEvent?: EventEnvelope;
  routeCommit?: RouteCommit;
  trace?: LoopRunTrace;
  problem?: BusinessProblem;
  now?: Date;
  signingSecret?: string;
  keyRef?: string;
};

export type ResolveCaseWithLifecycleResult = {
  case: EscalationCase;
  trace: LoopRunTrace | null;
  problem?: BusinessProblem;
  lifecycleDelivery?: LoopgraphLifecycleEmitResult;
  warnings: string[];
};

export async function listEscalationCases(storage: StorageAdapter) {
  return storage.listCases();
}

export async function transitionCaseStatus(
  storage: StorageAdapter,
  caseId: string,
  status: CaseStatus,
  outcome?: EscalationCase["outcome"]
) {
  const caseItem = await storage.getEscalationCase(caseId);
  if (!caseItem) throw new Error(`Case not found: ${caseId}`);

  const updated: EscalationCase = {
    ...caseItem,
    status,
    outcome: outcome ?? caseItem.outcome
  };

  await storage.saveEscalationCase(updated);
  return updated;
}

async function writeCaseOutcomeToTrace(
  storage: StorageAdapter,
  caseItem: EscalationCase,
  outcome: CaseOutcome
): Promise<LoopRunTrace | null> {
  const trace = await storage.getRun(caseItem.sourceRunId);
  if (!trace) {
    return null;
  }

  trace.outputs = [
    ...trace.outputs.filter((output) => output.id !== `case_outcome_${caseItem.id}`),
    {
      id: `case_outcome_${caseItem.id}`,
      type: "case_outcome",
      content: {
        caseId: caseItem.id,
        status: caseItem.status,
        outcome
      }
    },
    {
      id: `improvement_case_${caseItem.id}`,
      type: "improvement_signal",
      content: {
        loopId: trace.loopId,
        sourceRunId: trace.id,
        title: `Case resolved: ${caseItem.summary}`,
        description: outcome.resolutionSummary,
        failureMode: "case_resolved",
        teacherFeedback: outcome.businessResult
      }
    }
  ];

  await storage.saveRun(trace);
  return trace;
}

export async function resolveCase(
  storage: StorageAdapter,
  caseId: string,
  outcome: CaseOutcome,
  lifecycleOptions?: ResolveCaseLifecycleOptions
) {
  const result = await resolveCaseWithLifecycle(storage, caseId, outcome, lifecycleOptions);
  return result.case;
}

export async function resolveCaseWithLifecycle(
  storage: StorageAdapter,
  caseId: string,
  outcome: CaseOutcome,
  lifecycleOptions: ResolveCaseLifecycleOptions = {}
): Promise<ResolveCaseWithLifecycleResult> {
  const updated = await transitionCaseStatus(storage, caseId, "resolved", outcome);
  const trace = await writeCaseOutcomeToTrace(storage, updated, outcome);
  const warnings: string[] = trace ? [] : [`Source run trace not found for case ${caseId}: ${updated.sourceRunId}`];
  const lifecycle = await emitOutcomeLifecycleIfPossible({
    caseItem: updated,
    outcome,
    trace,
    options: lifecycleOptions,
    warnings
  });
  return {
    case: updated,
    trace,
    problem: lifecycle.problem,
    lifecycleDelivery: lifecycle.delivery,
    warnings
  };
}

async function emitOutcomeLifecycleIfPossible(input: {
  caseItem: EscalationCase;
  outcome: CaseOutcome;
  trace: LoopRunTrace | null;
  options: ResolveCaseLifecycleOptions;
  warnings: string[];
}): Promise<{ problem?: BusinessProblem; delivery?: LoopgraphLifecycleEmitResult }> {
  const trace = input.options.trace ?? input.trace;
  const canUseImplicitStore = Boolean(input.options.projectRoot || input.options.routingStore);
  if (!trace || !canUseImplicitStore) {
    return {};
  }

  const routingStore = input.options.routingStore ?? new FileRoutingStore(getLoopgraphRoot(input.options.projectRoot));
  const routeCommitId = input.options.routeCommit?.id ?? routeCommitIdFromTrace(trace);
  const eventId = input.options.sourceEvent?.id ?? trace.trigger.eventId;
  const receipt = input.options.sourceEvent
    ? undefined
    : await routingStore.getEventReceipt(eventId);
  const sourceEvent = input.options.sourceEvent ?? receipt?.event;
  const routeCommit = input.options.routeCommit ?? await findRouteCommitById(routingStore, routeCommitId);

  if (!sourceEvent) {
    input.warnings.push(`Event receipt not found for outcome lifecycle callback: ${eventId}`);
    return {};
  }
  if (!routeCommit) {
    input.warnings.push(`Route commit not found for outcome lifecycle callback: ${routeCommitId ?? "unknown"}`);
    return {};
  }

  const problem = await resolveProblemForOutcome({
    routingStore,
    explicitProblem: input.options.problem,
    routeCommit,
    outcome: input.outcome,
    caseId: input.caseItem.id,
    now: input.options.now ?? new Date()
  });

  const delivery = await emitOutcomeRecordedLifecycleEvent({
    projectRoot: input.options.projectRoot ?? process.cwd(),
    sourceEvent,
    routeCommit,
    trace,
    escalationCase: input.caseItem,
    outcome: input.outcome,
    problem,
    now: input.options.now,
    signingSecret: input.options.signingSecret,
    keyRef: input.options.keyRef
  });

  return { problem, delivery };
}

async function resolveProblemForOutcome(input: {
  routingStore: RoutingStore;
  explicitProblem?: BusinessProblem;
  routeCommit: RouteCommit;
  outcome: CaseOutcome;
  caseId: string;
  now: Date;
}): Promise<BusinessProblem | undefined> {
  const problem = input.explicitProblem ?? await input.routingStore.getBusinessProblem(input.routeCommit.problemId);
  if (!problem) return undefined;

  const nowIso = input.now.toISOString();
  const outcomeRef = `case_outcome:${input.caseId}`;
  const updated: BusinessProblem = {
    ...problem,
    status: "resolved",
    updatedAt: nowIso,
    resolvedAt: input.outcome.resolvedAt ?? nowIso,
    outcomeRefs: Array.from(new Set([...problem.outcomeRefs, outcomeRef]))
  };
  await input.routingStore.saveBusinessProblem(updated);
  return updated;
}

async function findRouteCommitById(
  routingStore: RoutingStore,
  routeCommitId?: string
): Promise<RouteCommit | undefined> {
  if (!routeCommitId) return undefined;
  return (await routingStore.listRouteCommits()).find((commit) => commit.id === routeCommitId);
}

function routeCommitIdFromTrace(trace: LoopRunTrace): string | undefined {
  for (const input of trace.inputs) {
    if (input.key !== "routing" || typeof input.value !== "object" || input.value === null) continue;
    const value = input.value as Record<string, unknown>;
    if (typeof value.routeCommitId === "string" && value.routeCommitId.length > 0) {
      return value.routeCommitId;
    }
  }
  return undefined;
}
