import {
  contentHash,
  hermesExecutionEventSchema,
  loopRunTraceSchema,
  type BusinessProblem,
  type HermesExecutionEvent,
  type LoopRunTrace,
  type RouteCommit,
  type RouteJob,
  type TaskRunTrace,
  type ToolCallTrace
} from "../core";
import type { StorageAdapter } from "../sdk/adapters";
import {
  failRouteJob,
  markRouteJobCompleted,
  markRouteJobRunning,
  markRouteJobWaitingReview,
  updateRouteJobStatus,
  type RoutingStore
} from "./routing-store";
import type { HermesOperationsStore } from "./hermes-operations-store";

export type IngestHermesExecutionEventResult = {
  event: HermesExecutionEvent;
  created: boolean;
  job: RouteJob;
  trace: LoopRunTrace;
};

export async function ingestHermesExecutionEvent(input: {
  event: HermesExecutionEvent;
  operationsStore: HermesOperationsStore;
  routingStore: RoutingStore;
  storage: StorageAdapter;
  now?: Date;
}): Promise<IngestHermesExecutionEventResult> {
  const event = hermesExecutionEventSchema.parse(input.event);
  const [job, agent, receipt, commits, existingEvents] = await Promise.all([
    input.routingStore.getRouteJob(event.routeJobId),
    input.operationsStore.getAgentInstance(event.agentInstanceId),
    input.routingStore.getEventReceipt(event.eventId),
    input.routingStore.listRouteCommits(),
    input.operationsStore.listExecutionEvents({ runId: event.runId })
  ]);
  if (!job) throw executionError("ROUTE_JOB_NOT_FOUND", `Route job not found: ${event.routeJobId}`);
  if (!agent) throw executionError("HERMES_AGENT_NOT_FOUND", `Hermes agent not found: ${event.agentInstanceId}`);
  if (!receipt) throw executionError("EVENT_RECEIPT_NOT_FOUND", `Event receipt not found: ${event.eventId}`);
  validateExecutionBinding({ event, job, agentWorkspaceId: agent.workspaceId });

  const priorWithSequence = existingEvents.find((item) => item.sequence === event.sequence && item.idempotencyKey !== event.idempotencyKey);
  if (priorWithSequence) {
    throw executionError("HERMES_SEQUENCE_CONFLICT", `Run ${event.runId} already contains sequence ${event.sequence}`);
  }

  const append = await input.operationsStore.appendExecutionEvent(event);
  const commit = commits.find((item) => item.id === job.routeCommitId);
  if (!commit) throw executionError("ROUTE_COMMIT_NOT_FOUND", `Route commit not found: ${job.routeCommitId}`);

  const existingTrace = await input.storage.getRun(job.runId);
  const trace = projectExecutionEventToTrace({
    event: append.event,
    job,
    receiptEvent: {
      id: receipt.event.id,
      source: receipt.event.source,
      type: receipt.event.eventType,
      occurredAt: receipt.event.occurredAt
    },
    existingTrace
  });
  await input.storage.saveRun(trace);

  const now = input.now ?? new Date(event.recordedAt);
  const projected = await projectExecutionState({
    event: append.event,
    job,
    commit,
    routingStore: input.routingStore,
    trace,
    now
  });
  return {
    event: append.event,
    created: append.created,
    job: projected,
    trace
  };
}

export function projectExecutionEventToTrace(input: {
  event: HermesExecutionEvent;
  job: RouteJob;
  receiptEvent: {
    id: string;
    source: string;
    type: string;
    occurredAt: string;
  };
  existingTrace: LoopRunTrace | null;
}): LoopRunTrace {
  const trace = input.existingTrace
    ? loopRunTraceSchema.parse(input.existingTrace)
    : createHermesTrace(input);
  const event = input.event;
  trace.status = traceStatusForExecutionEvent(event, trace.status);

  if (event.task) trace.taskRuns = upsertTaskRun(trace.taskRuns ?? [], event);
  if (event.tool) trace.toolCalls = upsertToolCall(trace.toolCalls, event);
  if (event.approval) trace.humanReviews = upsertApproval(trace.humanReviews, event);
  if (event.output) {
    trace.outputs = upsertById(trace.outputs, {
      id: event.output.id,
      type: event.output.type,
      content: {
        label: event.output.label,
        ...(event.output.artifactRef ? { artifactRef: event.output.artifactRef } : {})
      }
    });
  }
  if (event.outcome) {
    trace.metrics = upsertByName(trace.metrics, {
      name: event.outcome.metricKey,
      value: event.outcome.value,
      ...(event.outcome.unit ? { unit: event.outcome.unit } : {}),
      observed: true
    });
  }
  if (event.error) {
    trace.errors = upsertByCodeAndTime(trace.errors, {
      code: event.error.code,
      message: event.error.message,
      at: event.occurredAt
    });
  }
  if (["run.completed", "run.failed"].includes(event.eventType)) {
    trace.completedAt = event.occurredAt;
    trace.latencyMs = Math.max(0, Date.parse(event.occurredAt) - Date.parse(trace.startedAt));
  }
  return loopRunTraceSchema.parse(trace);
}

function createHermesTrace(input: {
  event: HermesExecutionEvent;
  job: RouteJob;
  receiptEvent: { id: string; source: string; type: string; occurredAt: string };
}): LoopRunTrace {
  const event = input.event;
  return loopRunTraceSchema.parse({
    id: input.job.runId,
    loopId: input.job.loopId,
    loopSpecVersion: "bound-by-hash",
    loopSpecHash: input.job.loopSpecHash,
    mode: "execute",
    status: "COMMITTED",
    trigger: {
      type: input.receiptEvent.type,
      source: input.receiptEvent.source,
      event: input.receiptEvent.type,
      eventId: input.receiptEvent.id,
      receivedAt: event.recordedAt
    },
    idempotencyKey: input.job.idempotencyKey,
    contextSnapshot: {
      id: `ctx_${contentHash({ runId: input.job.runId, eventId: input.receiptEvent.id })}`,
      loopId: input.job.loopId,
      loopSpecVersion: "bound-by-hash",
      createdAt: event.recordedAt,
      contentHash: contentHash({ eventId: input.receiptEvent.id, loopSpecHash: input.job.loopSpecHash }),
      tokenEstimate: 0,
      entries: [{
        sourceId: input.receiptEvent.id,
        sourceType: "event",
        title: `${input.receiptEvent.source}: ${input.receiptEvent.type}`,
        value: { eventRef: input.receiptEvent.id },
        retrievedAt: event.recordedAt,
        freshness: "realtime",
        sensitivity: "internal",
        trusted: true,
        redactionApplied: true,
        contentHash: contentHash(input.receiptEvent.id),
        precedence: 0
      }]
    },
    inputs: [],
    taskRuns: [],
    toolCalls: [],
    policyDecisions: [],
    verificationResults: [],
    escalationCases: [],
    humanReviews: [],
    outputs: [],
    metrics: [],
    errors: [],
    provenance: {
      invocation: {
        actor: event.agentInstanceId,
        source: "hermes.execution",
        routeAttemptId: event.routeAttemptId,
        routeCommitId: event.routeCommitId
      },
      connectorChecks: []
    },
    startedAt: event.occurredAt
  });
}

async function projectExecutionState(input: {
  event: HermesExecutionEvent;
  job: RouteJob;
  commit: RouteCommit;
  routingStore: RoutingStore;
  trace: LoopRunTrace;
  now: Date;
}): Promise<RouteJob> {
  const { event, routingStore, now } = input;
  if (event.eventType === "run.started") {
    await routingStore.saveRouteCommit({ ...input.commit, status: "running", runId: event.runId });
    await updateProblem(routingStore, input.job.problemId, "in_progress", now);
    return markRouteJobRunning({ store: routingStore, jobId: input.job.id, now });
  }
  if (event.eventType === "approval.requested") {
    await routingStore.saveRouteCommit({ ...input.commit, status: "waiting_review", runId: event.runId });
    await updateProblem(routingStore, input.job.problemId, "waiting", now);
    return markRouteJobWaitingReview({ store: routingStore, jobId: input.job.id, runId: event.runId, now });
  }
  if (event.eventType === "approval.resolved" && event.approval?.status === "approved") {
    await routingStore.saveRouteCommit({ ...input.commit, status: "running", runId: event.runId });
    await updateProblem(routingStore, input.job.problemId, "in_progress", now);
    return updateRouteJobStatus({ store: routingStore, jobId: input.job.id, status: "running", runId: event.runId, now });
  }
  if (event.eventType === "run.completed") {
    await routingStore.saveRouteCommit({ ...input.commit, status: "completed", runId: event.runId });
    await updateProblem(routingStore, input.job.problemId, "resolved", now, now.toISOString());
    return markRouteJobCompleted({
      store: routingStore,
      jobId: input.job.id,
      runId: event.runId,
      now,
      result: { traceStatus: input.trace.status, completedAt: event.occurredAt, lifecycleDeliveryIds: [], metricSampleIds: [] }
    });
  }
  if (event.eventType === "run.failed") {
    await routingStore.saveRouteCommit({ ...input.commit, status: "failed", runId: event.runId });
    await updateProblem(routingStore, input.job.problemId, "waiting", now);
    return failRouteJob({
      store: routingStore,
      jobId: input.job.id,
      error: { code: event.error?.code, message: event.error?.message ?? "Hermes run failed" },
      now
    });
  }
  return (await routingStore.getRouteJob(input.job.id)) ?? input.job;
}

async function updateProblem(
  store: RoutingStore,
  problemId: string,
  status: BusinessProblem["status"],
  now: Date,
  resolvedAt?: string
): Promise<void> {
  const problem = await store.getBusinessProblem(problemId);
  if (!problem) return;
  await store.saveBusinessProblem({
    ...problem,
    status,
    updatedAt: now.toISOString(),
    ...(resolvedAt ? { resolvedAt } : {})
  });
}

function validateExecutionBinding(input: {
  event: HermesExecutionEvent;
  job: RouteJob;
  agentWorkspaceId: string;
}): void {
  const event = input.event;
  const job = input.job;
  const mismatches = [
    ["workspaceId", event.workspaceId, input.agentWorkspaceId],
    ["routeCommitId", event.routeCommitId, job.routeCommitId],
    ["routeAttemptId", event.routeAttemptId, job.routeAttemptId],
    ["eventId", event.eventId, job.eventId],
    ["problemId", event.problemId, job.problemId],
    ["loopId", event.loopId, job.loopId],
    ["loopSpecHash", event.loopSpecHash, job.loopSpecHash],
    ["runId", event.runId, job.runId],
    ["correlationId", event.correlationId, job.correlationId]
  ].filter(([, actual, expected]) => actual !== expected);
  if (mismatches.length > 0) {
    throw executionError("HERMES_EXECUTION_BINDING_MISMATCH", `Hermes execution event does not match its assignment: ${mismatches.map(([key]) => key).join(", ")}`);
  }
  if (job.executionTarget.runtime !== "hermes") {
    throw executionError("INVALID_EXECUTION_TARGET", `Route job ${job.id} is not assigned to Hermes`);
  }
}

function traceStatusForExecutionEvent(event: HermesExecutionEvent, current: LoopRunTrace["status"]): LoopRunTrace["status"] {
  if (event.eventType === "approval.requested") return "WAITING_FOR_REVIEW";
  if (event.eventType === "approval.resolved" && event.approval?.status === "rejected") return "REJECTED";
  if (event.eventType === "run.completed") return "COMPLETED";
  if (event.eventType === "run.failed") return "FAILED_VERIFICATION";
  if (["run.started", "task.started", "task.completed", "tool.started", "tool.completed", "output.created", "outcome.observed"].includes(event.eventType)) return "COMMITTED";
  return current;
}

function upsertTaskRun(taskRuns: TaskRunTrace[], event: HermesExecutionEvent): TaskRunTrace[] {
  if (!event.task) return taskRuns;
  const existing = taskRuns.find((task) => task.id === event.task?.id);
  const status: TaskRunTrace["status"] = event.eventType === "task.started"
    ? "running"
    : event.eventType === "task.completed"
      ? "completed"
      : event.eventType === "task.failed"
        ? "failed"
        : existing?.status ?? "pending";
  const updated: TaskRunTrace = {
    id: event.task.id,
    label: event.task.label,
    ...(event.task.owner ? { owner: event.task.owner } : {}),
    ...(event.task.summary ? { summary: event.task.summary } : {}),
    status,
    ...(event.eventType === "task.started" ? { startedAt: event.occurredAt } : existing?.startedAt ? { startedAt: existing.startedAt } : {}),
    ...(["task.completed", "task.failed"].includes(event.eventType) ? { completedAt: event.occurredAt } : {}),
    ...(event.error ? { error: { code: event.error.code, message: event.error.message } } : {})
  };
  return upsertById(taskRuns, updated);
}

function upsertToolCall(toolCalls: ToolCallTrace[], event: HermesExecutionEvent): ToolCallTrace[] {
  if (!event.tool) return toolCalls;
  const existing = toolCalls.find((call) => call.id === event.tool?.callId);
  const status: ToolCallTrace["status"] = event.eventType === "tool.completed"
    ? "completed"
    : event.eventType === "tool.failed"
      ? "failed"
      : "pending";
  return upsertById(toolCalls, {
    id: event.tool.callId,
    toolKey: event.tool.toolKey,
    input: event.tool.inputRef ? { ref: event.tool.inputRef } : {},
    ...(event.tool.outputRef ? { output: { ref: event.tool.outputRef } } : existing?.output !== undefined ? { output: existing.output } : {}),
    status,
    startedAt: existing?.startedAt ?? event.occurredAt,
    ...(status !== "pending" ? { completedAt: event.occurredAt } : {})
  });
}

function upsertApproval(reviews: LoopRunTrace["humanReviews"], event: HermesExecutionEvent): LoopRunTrace["humanReviews"] {
  if (!event.approval) return reviews;
  const existing = reviews.find((review) => review.id === event.approval?.id);
  const status = event.approval.status === "requested" ? "open" : event.approval.status;
  return upsertById(reviews, {
    id: event.approval.id,
    runId: event.runId,
    status,
    ...(event.approval.resolvedBy ? { reviewerId: event.approval.resolvedBy } : {}),
    role: roleForApproval(event.approval.requestedRole),
    approvedFingerprints: [],
    rejectedFingerprints: [],
    ...(event.approval.reason ? { comment: event.approval.reason } : {}),
    createdAt: existing?.createdAt ?? event.occurredAt,
    ...(event.approval.status !== "requested" ? { decidedAt: event.occurredAt } : {})
  });
}

function roleForApproval(role: string | undefined): LoopRunTrace["humanReviews"][number]["role"] {
  const allowed: Array<LoopRunTrace["humanReviews"][number]["role"]> = ["approver", "reviewer", "owner", "teacher", "executor", "accountability_holder"];
  return allowed.find((item) => item === role) ?? "approver";
}

function upsertById<T extends { id: string }>(values: T[], next: T): T[] {
  return [...values.filter((value) => value.id !== next.id), next];
}

function upsertByName<T extends { name: string }>(values: T[], next: T): T[] {
  return [...values.filter((value) => value.name !== next.name), next];
}

function upsertByCodeAndTime<T extends { code: string; at: string }>(values: T[], next: T): T[] {
  return values.some((value) => value.code === next.code && value.at === next.at) ? values : [...values, next];
}

function executionError(code: string, message: string): Error & { code: string } {
  return Object.assign(new Error(message), { code });
}
