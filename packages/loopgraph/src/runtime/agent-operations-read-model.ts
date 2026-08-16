import path from "node:path";
import type {
  HermesAgentInstance,
  HermesExecutionEvent,
  LoopRunTrace,
  RouteJob
} from "../core";
import type { StorageAdapter } from "../sdk/adapters";
import { FileStorageAdapter } from "../sdk/storage";
import {
  loadEventRoutingOperations,
  type EventRoutingOperationsReadModel,
  type EventRoutingOperationsRow
} from "./event-routing-read-model";
import { FileHermesOperationsStore, type HermesOperationsStore } from "./hermes-operations-store";
import type { LoopSpecRegistryStore } from "./loop-spec-store";
import { FileRoutingStore, type RoutingStore } from "./routing-store";
import { getLoopgraphRoot } from "./storage-resolver";

export const AGENT_OPERATIONS_READ_MODEL_SCHEMA_VERSION = "agent-operations/v1alpha1" as const;

export type AgentOperationsFilters = {
  source?: string;
  department?: string;
  loopId?: string;
  agentInstanceId?: string;
  status?: string;
  needsAttention?: boolean;
};

export type AgentOperationsActivityRow = {
  id: string;
  eventId: string;
  source: string;
  eventType: string;
  problemId?: string;
  problemSummary?: string;
  department: string;
  loopId: string;
  loopLabel: string;
  routeJobId: string;
  executionRuntime: RouteJob["executionTarget"]["runtime"];
  jobStatus: RouteJob["status"];
  agentInstanceId?: string;
  agentName?: string;
  runId: string;
  traceStatus?: string;
  taskCount: number;
  completedTaskCount: number;
  toolCallCount: number;
  approvalCount: number;
  outputCount: number;
  observedOutcomeCount: number;
  latestEventType?: HermesExecutionEvent["eventType"];
  latestSummary?: string;
  receivedAt: string;
  updatedAt: string;
  latencyMs?: number;
  needsAttention: boolean;
};

export type AgentOperationsTopologyNode = {
  id: string;
  kind: "source" | "hermes" | "department" | "loop" | "agent" | "task" | "outcome";
  label: string;
  detail: string;
  status?: string;
};

export type AgentOperationsTopologyEdge = {
  id: string;
  from: string;
  to: string;
  label: string;
};

export type AgentOperationsReadModel = {
  schemaVersion: typeof AGENT_OPERATIONS_READ_MODEL_SCHEMA_VERSION;
  projectRoot: string;
  generatedAt: string;
  filters: AgentOperationsFilters;
  summary: {
    registeredAgents: number;
    healthyAgents: number;
    incomingEvents: number;
    dispatchedRuns: number;
    activeRuns: number;
    waitingApproval: number;
    completedRuns: number;
    failedRuns: number;
    observedOutcomes: number;
  };
  agents: Array<HermesAgentInstance & { healthy: boolean; secondsSinceHeartbeat: number }>;
  activity: AgentOperationsActivityRow[];
  topology: {
    nodes: AgentOperationsTopologyNode[];
    edges: AgentOperationsTopologyEdge[];
  };
};

export type AgentOperationsTraceDetail = {
  schemaVersion: "agent-operations-trace/v1alpha1";
  generatedAt: string;
  activity: AgentOperationsActivityRow;
  routing: {
    action: EventRoutingOperationsRow["action"];
    confidence?: number;
    catalogVersion?: string;
    policyVersion?: string;
    needsHumanChoice: boolean;
    needsCorrection: boolean;
    selectedRoutes: Array<{
      loopId: string;
      loopLabel: string;
      role: string;
      confidence: number;
      reasonSummary: string;
      evidenceRefCount: number;
      priority: number;
    }>;
    alternatives: EventRoutingOperationsRow["decisionDetail"]["alternatives"];
    timeline: EventRoutingOperationsRow["correlationTimeline"];
  };
  execution: {
    timeline: Array<{
      id: string;
      sequence: number;
      eventType: HermesExecutionEvent["eventType"];
      occurredAt: string;
      summary?: string;
      task?: { id: string; label: string; owner?: string };
      tool?: { callId: string; toolKey: string };
      approval?: { id: string; status: string; requestedRole?: string };
      output?: { id: string; type: string; label: string };
      outcome?: { metricKey: string; value: number; unit?: string };
      error?: { code: string; retryable: boolean };
    }>;
    tasks: Array<{
      id: string;
      label: string;
      owner?: string;
      status: string;
      summary?: string;
      startedAt?: string;
      completedAt?: string;
      errorCode?: string;
    }>;
    toolCalls: Array<{
      id: string;
      toolKey: string;
      status: string;
      startedAt: string;
      completedAt?: string;
    }>;
    approvals: Array<{
      id: string;
      status: string;
      role: string;
      createdAt: string;
      decidedAt?: string;
    }>;
    outputs: Array<{ id: string; type: string }>;
    outcomes: Array<{ name: string; value: number; unit?: string; observed: boolean }>;
    verification: Array<{ verifierId: string; passed: boolean; summary: string }>;
    errors: Array<{ code: string; at: string }>;
  };
};

export async function loadAgentOperationsReadModel(input: AgentOperationsFilters & {
  projectRoot?: string;
  now?: Date;
  limit?: number;
  routingStore?: RoutingStore;
  operationsStore?: HermesOperationsStore;
  storage?: StorageAdapter;
  loopSpecStore?: LoopSpecRegistryStore;
} = {}): Promise<AgentOperationsReadModel> {
  const projectRoot = path.resolve(input.projectRoot ?? process.cwd());
  const root = getLoopgraphRoot(projectRoot);
  const now = input.now ?? new Date();
  const routingStore = input.routingStore ?? new FileRoutingStore(root);
  const operationsStore = input.operationsStore ?? new FileHermesOperationsStore(root);
  const storage = input.storage ?? new FileStorageAdapter(root);
  const filters = normalizeFilters(input);

  const [routing, agents, executionEvents, runSummaries] = await Promise.all([
    loadEventRoutingOperations({
      projectRoot,
      limit: input.limit ?? 250,
      store: routingStore,
      loopSpecStore: input.loopSpecStore,
      source: filters.source,
      loopId: filters.loopId,
      needsAttention: filters.needsAttention
    }),
    operationsStore.listAgentInstances(),
    operationsStore.listExecutionEvents({ limit: input.limit ?? 1_000 }),
    storage.listRuns()
  ]);
  const traces = await Promise.all(runSummaries.map((run) => storage.getRun(run.id)));
  const traceById = new Map(traces.filter((trace): trace is LoopRunTrace => trace !== null).map((trace) => [trace.id, trace]));
  const agentById = new Map(agents.map((agent) => [agent.id, agent]));
  const eventsByJob = groupEventsByJob(executionEvents);
  const catalogByLoop = new Map(routing.routingCatalog.map((item) => [item.loopId, item]));
  const activity = buildActivity({ routing, traceById, agentById, eventsByJob, catalogByLoop })
    .filter((row) => !filters.department || normalize(row.department) === normalize(filters.department))
    .filter((row) => !filters.agentInstanceId || row.agentInstanceId === filters.agentInstanceId)
    .filter((row) => !filters.status || row.jobStatus === filters.status || row.traceStatus === filters.status)
    .filter((row) => filters.needsAttention !== true || row.needsAttention)
    .slice(0, input.limit ?? 250);
  const decoratedAgents = agents.map((agent) => {
    const secondsSinceHeartbeat = Math.max(0, Math.floor((now.getTime() - Date.parse(agent.lastHeartbeatAt)) / 1_000));
    return { ...agent, healthy: ["online", "degraded"].includes(agent.status) && secondsSinceHeartbeat <= 180, secondsSinceHeartbeat };
  });

  return {
    schemaVersion: AGENT_OPERATIONS_READ_MODEL_SCHEMA_VERSION,
    projectRoot,
    generatedAt: now.toISOString(),
    filters,
    summary: {
      registeredAgents: agents.length,
      healthyAgents: decoratedAgents.filter((agent) => agent.healthy).length,
      incomingEvents: routing.summary.eventCount,
      dispatchedRuns: activity.filter((row) => row.jobStatus === "dispatched").length,
      activeRuns: activity.filter((row) => ["claimed", "dispatched", "running"].includes(row.jobStatus)).length,
      waitingApproval: activity.filter((row) => row.jobStatus === "waiting_review").length,
      completedRuns: activity.filter((row) => row.jobStatus === "completed").length,
      failedRuns: activity.filter((row) => ["failed", "dead_letter"].includes(row.jobStatus)).length,
      observedOutcomes: activity.reduce((sum, row) => sum + row.observedOutcomeCount, 0)
    },
    agents: decoratedAgents,
    activity,
    topology: buildTopology(activity)
  };
}

export async function loadAgentOperationsTraceDetail(input: {
  routeJobId: string;
  projectRoot?: string;
  now?: Date;
  routingStore?: RoutingStore;
  operationsStore?: HermesOperationsStore;
  storage?: StorageAdapter;
  loopSpecStore?: LoopSpecRegistryStore;
}): Promise<AgentOperationsTraceDetail | null> {
  const projectRoot = path.resolve(input.projectRoot ?? process.cwd());
  const root = getLoopgraphRoot(projectRoot);
  const routingStore = input.routingStore ?? new FileRoutingStore(root);
  const operationsStore = input.operationsStore ?? new FileHermesOperationsStore(root);
  const storage = input.storage ?? new FileStorageAdapter(root);
  const job = await routingStore.getRouteJob(input.routeJobId);
  if (!job) return null;

  const [routing, agents, executionEvents, trace] = await Promise.all([
    loadEventRoutingOperations({
      projectRoot,
      eventId: job.eventId,
      limit: 50,
      store: routingStore,
      loopSpecStore: input.loopSpecStore,
      now: input.now
    }),
    operationsStore.listAgentInstances(),
    operationsStore.listExecutionEvents({ routeJobId: job.id, limit: 1_000 }),
    storage.getRun(job.runId)
  ]);
  const routingRow = routing.rows.find((row) => row.decisionDetail.routeJobs.some((candidate) => candidate.id === job.id));
  if (!routingRow) return null;
  const activity = buildActivity({
    routing,
    traceById: new Map(trace ? [[trace.id, trace]] : []),
    agentById: new Map(agents.map((agent) => [agent.id, agent])),
    eventsByJob: new Map([[job.id, executionEvents]]),
    catalogByLoop: new Map(routing.routingCatalog.map((item) => [item.loopId, item]))
  }).find((row) => row.routeJobId === job.id);
  if (!activity) return null;

  return buildAgentOperationsTraceDetail({
    activity,
    routing: routingRow,
    executionEvents,
    trace,
    generatedAt: (input.now ?? new Date()).toISOString()
  });
}

export function buildAgentOperationsTraceDetail(input: {
  activity: AgentOperationsActivityRow;
  routing: EventRoutingOperationsRow;
  executionEvents: HermesExecutionEvent[];
  trace: LoopRunTrace | null;
  generatedAt: string;
}): AgentOperationsTraceDetail {
  const trace = input.trace;
  return {
    schemaVersion: "agent-operations-trace/v1alpha1",
    generatedAt: input.generatedAt,
    activity: input.activity,
    routing: {
      action: input.routing.action,
      ...(input.routing.confidence !== undefined ? { confidence: input.routing.confidence } : {}),
      ...(input.routing.decisionDetail.catalogVersion ? { catalogVersion: input.routing.decisionDetail.catalogVersion } : {}),
      ...(input.routing.decisionDetail.policyVersion ? { policyVersion: input.routing.decisionDetail.policyVersion } : {}),
      needsHumanChoice: input.routing.needsHumanChoice,
      needsCorrection: input.routing.needsCorrection,
      selectedRoutes: input.routing.decisionDetail.selectedRoutes.map((route) => ({
        loopId: route.loopId,
        loopLabel: route.loopLabel,
        role: route.role,
        confidence: route.confidence,
        reasonSummary: route.reasonSummary,
        evidenceRefCount: route.evidenceRefs.length,
        priority: route.priority
      })),
      alternatives: input.routing.decisionDetail.alternatives,
      timeline: input.routing.correlationTimeline
    },
    execution: {
      timeline: [...input.executionEvents]
        .sort((left, right) => left.sequence - right.sequence)
        .map(projectExecutionEvent),
      tasks: (trace?.taskRuns ?? []).map((task) => ({
        id: task.id,
        label: task.label,
        ...(task.owner ? { owner: task.owner } : {}),
        status: task.status,
        ...(task.summary ? { summary: task.summary } : {}),
        ...(task.startedAt ? { startedAt: task.startedAt } : {}),
        ...(task.completedAt ? { completedAt: task.completedAt } : {}),
        ...(task.error?.code ? { errorCode: task.error.code } : {})
      })),
      toolCalls: (trace?.toolCalls ?? []).map((tool) => ({
        id: tool.id,
        toolKey: tool.toolKey,
        status: tool.status,
        startedAt: tool.startedAt,
        ...(tool.completedAt ? { completedAt: tool.completedAt } : {})
      })),
      approvals: (trace?.humanReviews ?? []).map((approval) => ({
        id: approval.id,
        status: approval.status,
        role: approval.role,
        createdAt: approval.createdAt,
        ...(approval.decidedAt ? { decidedAt: approval.decidedAt } : {})
      })),
      outputs: (trace?.outputs ?? []).map((output) => ({ id: output.id, type: output.type })),
      outcomes: (trace?.metrics ?? []).map((metric) => ({
        name: metric.name,
        value: metric.value,
        ...(metric.unit ? { unit: metric.unit } : {}),
        observed: metric.observed
      })),
      verification: (trace?.verificationResults ?? []).map((verification) => ({
        verifierId: verification.verifierId,
        passed: verification.passed,
        summary: verification.summary
      })),
      errors: (trace?.errors ?? []).map((error) => ({ code: error.code, at: error.at }))
    }
  };
}

function buildActivity(input: {
  routing: EventRoutingOperationsReadModel;
  traceById: Map<string, LoopRunTrace>;
  agentById: Map<string, HermesAgentInstance>;
  eventsByJob: Map<string, HermesExecutionEvent[]>;
  catalogByLoop: Map<string, EventRoutingOperationsReadModel["routingCatalog"][number]>;
}): AgentOperationsActivityRow[] {
  const activity: AgentOperationsActivityRow[] = [];
  for (const row of input.routing.rows) {
    for (const job of row.decisionDetail.routeJobs) {
      const commit = row.decisionDetail.routeCommits.find((item) => item.runId === job.runId || item.loopId === row.selectedLoopIds[0]);
      const loopId = commit?.loopId ?? row.selectedLoopIds[0] ?? "unassigned";
      const catalog = input.catalogByLoop.get(loopId);
      const trace = input.traceById.get(job.runId);
      const events = input.eventsByJob.get(job.id) ?? [];
      const latest = events[events.length - 1];
      const agent = latest ? input.agentById.get(latest.agentInstanceId) : undefined;
      const tasks = trace?.taskRuns ?? [];
      activity.push({
        id: `${row.id}:${job.id}`,
        eventId: row.eventId,
        source: row.source,
        eventType: row.eventType,
        ...(row.problemId ? { problemId: row.problemId } : {}),
        ...(row.problemSummary ? { problemSummary: row.problemSummary } : {}),
        department: catalog?.department ?? "Unassigned",
        loopId,
        loopLabel: catalog?.loopName ?? commit?.loopLabel ?? loopId,
        routeJobId: job.id,
        executionRuntime: job.executionTarget?.runtime ?? (events.length > 0 ? "hermes" : "loopgraph_local"),
        jobStatus: job.status,
        ...(latest ? { agentInstanceId: latest.agentInstanceId } : {}),
        ...(agent ? { agentName: agent.name } : {}),
        runId: job.runId,
        ...(trace ? { traceStatus: trace.status } : {}),
        taskCount: tasks.length,
        completedTaskCount: tasks.filter((task) => task.status === "completed").length,
        toolCallCount: trace?.toolCalls.length ?? 0,
        approvalCount: trace?.humanReviews.length ?? 0,
        outputCount: trace?.outputs.length ?? 0,
        observedOutcomeCount: trace?.metrics.filter((metric) => metric.observed).length ?? 0,
        ...(latest ? { latestEventType: latest.eventType } : {}),
        ...(latest?.summary ? { latestSummary: latest.summary } : {}),
        receivedAt: row.receivedAt,
        updatedAt: latest?.occurredAt ?? job.updatedAt,
        ...(trace?.latencyMs !== undefined ? { latencyMs: trace.latencyMs } : {}),
        needsAttention: row.needsHumanChoice || row.needsCorrection || ["waiting_review", "failed", "dead_letter"].includes(job.status)
      });
    }
  }
  return activity.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
}

function buildTopology(activity: AgentOperationsActivityRow[]): AgentOperationsReadModel["topology"] {
  const nodes = new Map<string, AgentOperationsTopologyNode>();
  const edges = new Map<string, AgentOperationsTopologyEdge>();
  nodes.set("hermes", { id: "hermes", kind: "hermes", label: "Hermes Brain", detail: "Routes events and owns live execution", status: "active" });
  for (const row of activity) {
    const sourceId = `source:${normalize(row.source)}`;
    const departmentId = `department:${normalize(row.department)}`;
    const loopId = `loop:${row.loopId}`;
    nodes.set(sourceId, { id: sourceId, kind: "source", label: row.source, detail: row.eventType });
    nodes.set(departmentId, { id: departmentId, kind: "department", label: humanize(row.department), detail: "Department" });
    nodes.set(loopId, { id: loopId, kind: "loop", label: row.loopLabel, detail: row.jobStatus, status: row.jobStatus });
    addEdge(edges, sourceId, "hermes", "event");
    addEdge(edges, "hermes", departmentId, "route");
    addEdge(edges, departmentId, loopId, "owns");
    if (row.agentInstanceId) {
      const agentId = `agent:${row.agentInstanceId}`;
      nodes.set(agentId, { id: agentId, kind: "agent", label: row.agentName ?? row.agentInstanceId, detail: "Hermes runtime", status: row.jobStatus });
      addEdge(edges, loopId, agentId, "executes");
    }
    if (row.taskCount > 0) {
      const taskId = `task:${row.runId}`;
      nodes.set(taskId, { id: taskId, kind: "task", label: `${row.completedTaskCount}/${row.taskCount} tasks`, detail: row.latestSummary ?? row.latestEventType ?? "Run activity" });
      addEdge(edges, row.agentInstanceId ? `agent:${row.agentInstanceId}` : loopId, taskId, "work");
    }
    if (row.observedOutcomeCount > 0) {
      const outcomeId = `outcome:${row.runId}`;
      nodes.set(outcomeId, { id: outcomeId, kind: "outcome", label: `${row.observedOutcomeCount} outcome${row.observedOutcomeCount === 1 ? "" : "s"}`, detail: "Returned as evidence" });
      addEdge(edges, row.taskCount > 0 ? `task:${row.runId}` : loopId, outcomeId, "evidence");
      addEdge(edges, outcomeId, "hermes", "learns");
    }
  }
  return { nodes: [...nodes.values()], edges: [...edges.values()] };
}

function projectExecutionEvent(event: HermesExecutionEvent): AgentOperationsTraceDetail["execution"]["timeline"][number] {
  return {
    id: event.id,
    sequence: event.sequence,
    eventType: event.eventType,
    occurredAt: event.occurredAt,
    ...(event.summary ? { summary: event.summary } : {}),
    ...(event.task ? {
      task: {
        id: event.task.id,
        label: event.task.label,
        ...(event.task.owner ? { owner: event.task.owner } : {})
      }
    } : {}),
    ...(event.tool ? { tool: { callId: event.tool.callId, toolKey: event.tool.toolKey } } : {}),
    ...(event.approval ? {
      approval: {
        id: event.approval.id,
        status: event.approval.status,
        ...(event.approval.requestedRole ? { requestedRole: event.approval.requestedRole } : {})
      }
    } : {}),
    ...(event.output ? { output: { id: event.output.id, type: event.output.type, label: event.output.label } } : {}),
    ...(event.outcome ? {
      outcome: {
        metricKey: event.outcome.metricKey,
        value: event.outcome.value,
        ...(event.outcome.unit ? { unit: event.outcome.unit } : {})
      }
    } : {}),
    ...(event.error ? { error: { code: event.error.code, retryable: event.error.retryable } } : {})
  };
}

function groupEventsByJob(events: HermesExecutionEvent[]): Map<string, HermesExecutionEvent[]> {
  const grouped = new Map<string, HermesExecutionEvent[]>();
  for (const event of events) grouped.set(event.routeJobId, [...(grouped.get(event.routeJobId) ?? []), event]);
  for (const values of grouped.values()) values.sort((left, right) => left.sequence - right.sequence);
  return grouped;
}

function addEdge(edges: Map<string, AgentOperationsTopologyEdge>, from: string, to: string, label: string): void {
  const id = `${from}->${to}:${label}`;
  edges.set(id, { id, from, to, label });
}

function normalizeFilters(input: AgentOperationsFilters): AgentOperationsFilters {
  return {
    ...(input.source?.trim() ? { source: input.source.trim() } : {}),
    ...(input.department?.trim() ? { department: input.department.trim() } : {}),
    ...(input.loopId?.trim() ? { loopId: input.loopId.trim() } : {}),
    ...(input.agentInstanceId?.trim() ? { agentInstanceId: input.agentInstanceId.trim() } : {}),
    ...(input.status?.trim() ? { status: input.status.trim() } : {}),
    ...(input.needsAttention !== undefined ? { needsAttention: input.needsAttention } : {})
  };
}

function normalize(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_");
}

function humanize(value: string): string {
  return value.replace(/[_-]+/g, " ").replace(/\b\w/g, (character) => character.toUpperCase());
}
