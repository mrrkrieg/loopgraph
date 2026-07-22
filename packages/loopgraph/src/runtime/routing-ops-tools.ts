import path from "node:path";
import { z } from "zod";
import {
  routeJobStatusSchema,
  routingDecisionActionSchema,
  type BusinessProblem,
  type EventReceipt,
  type RouteCommit,
  type RouteJob,
  type RouterEvaluation,
  type RoutingAttempt
} from "../core";
import { buildConnectionPlan } from "./connection-plan";
import {
  listLoopgraphLifecycleDeliveries,
  loopgraphLifecycleDeliveryStatusSchema,
  type LoopgraphLifecycleDelivery
} from "./lifecycle-events";
import { listLoopgraphLoops, type HermesGraphProjection } from "./loop-materialization";
import { FileRoutingStore, type RoutingStore } from "./routing-store";
import { getLoopgraphRoot } from "./storage-resolver";

export const LOOPGRAPH_ROUTING_OPS_TOOL_NAMES = [
  "loopgraph_events_get",
  "loopgraph_problems_get",
  "loopgraph_routing_decision_get",
  "loopgraph_route_jobs_get",
  "loopgraph_routing_evaluations_get",
  "loopgraph_lifecycle_events_get",
  "loopgraph_graph_get"
] as const;

export type LoopgraphRoutingOpsToolName = (typeof LOOPGRAPH_ROUTING_OPS_TOOL_NAMES)[number];

export type LoopgraphRoutingOpsToolRuntimeOptions = {
  projectRoot?: string;
  store?: RoutingStore;
  now?: Date;
};

const limitSchema = z.number().int().min(1).max(200).default(50);

export const eventsGetInputSchema = z.object({
  projectRoot: z.string().optional(),
  eventId: z.string().optional(),
  source: z.string().optional(),
  eventType: z.string().optional(),
  status: z.enum(["received", "duplicate", "ignored", "replayed", "failed"]).optional(),
  limit: limitSchema
}).default({});

export const problemsGetInputSchema = z.object({
  projectRoot: z.string().optional(),
  problemId: z.string().optional(),
  status: z.enum([
    "detected",
    "needs_human",
    "routed",
    "in_progress",
    "waiting",
    "resolved",
    "closed",
    "unhandled"
  ]).optional(),
  subjectType: z.string().optional(),
  subjectId: z.string().optional(),
  includeRouteCommits: z.boolean().default(true),
  limit: limitSchema
}).default({});

export const routingDecisionGetInputSchema = z.object({
  projectRoot: z.string().optional(),
  eventId: z.string().optional(),
  attemptId: z.string().optional(),
  problemId: z.string().optional(),
  includeReceipts: z.boolean().default(true),
  includeRouteCommits: z.boolean().default(true),
  includeRouteJobs: z.boolean().default(true),
  limit: limitSchema
}).default({});

export const routeJobsGetInputSchema = z.object({
  projectRoot: z.string().optional(),
  jobId: z.string().optional(),
  eventId: z.string().optional(),
  problemId: z.string().optional(),
  routeCommitId: z.string().optional(),
  loopId: z.string().optional(),
  status: routeJobStatusSchema.optional(),
  limit: limitSchema
}).default({});

export const routingEvaluationsGetInputSchema = z.object({
  projectRoot: z.string().optional(),
  evaluationId: z.string().optional(),
  fixtureId: z.string().optional(),
  eventId: z.string().optional(),
  expectedAction: routingDecisionActionSchema.optional(),
  passed: z.boolean().optional(),
  limit: limitSchema
}).default({});

export const lifecycleEventsGetInputSchema = z.object({
  projectRoot: z.string().optional(),
  deliveryId: z.string().optional(),
  eventId: z.string().optional(),
  correlationId: z.string().optional(),
  status: loopgraphLifecycleDeliveryStatusSchema.optional(),
  limit: limitSchema
}).default({});

export const graphGetInputSchema = z.object({
  projectRoot: z.string().optional(),
  projection: z.enum(["design", "event_routing"]).default("design"),
  eventId: z.string().optional(),
  problemId: z.string().optional(),
  includeConnections: z.boolean().default(true)
}).default({});

export type EventsGetInput = z.input<typeof eventsGetInputSchema>;
export type ProblemsGetInput = z.input<typeof problemsGetInputSchema>;
export type RoutingDecisionGetInput = z.input<typeof routingDecisionGetInputSchema>;
export type RouteJobsGetInput = z.input<typeof routeJobsGetInputSchema>;
export type RoutingEvaluationsGetInput = z.input<typeof routingEvaluationsGetInputSchema>;
export type LifecycleEventsGetInput = z.input<typeof lifecycleEventsGetInputSchema>;
export type GraphGetInput = z.input<typeof graphGetInputSchema>;

export type EventsGetResult = {
  projectRoot: string;
  count: number;
  receipts: EventReceipt[];
};

export type ProblemsGetResult = {
  projectRoot: string;
  count: number;
  problems: Array<{
    problem: BusinessProblem;
    routeCommits?: RouteCommit[];
  }>;
};

export type RoutingDecisionGetResult = {
  projectRoot: string;
  count: number;
  attempts: Array<{
    attempt: RoutingAttempt;
    receipt?: EventReceipt;
    problem?: BusinessProblem;
    routeCommits?: RouteCommit[];
    routeJobs?: RouteJob[];
  }>;
};

export type RouteJobsGetResult = {
  projectRoot: string;
  count: number;
  jobs: RouteJob[];
};

export type RoutingEvaluationsGetResult = {
  projectRoot: string;
  count: number;
  evaluations: RouterEvaluation[];
};

export type LifecycleEventsGetResult = {
  projectRoot: string;
  count: number;
  deliveries: LoopgraphLifecycleDelivery[];
};

export type GraphProjectionResult = {
  schemaVersion: "graph-projection/v1alpha1";
  projectRoot: string;
  projection: "design" | "event_routing";
  generatedAt: string;
  summary: {
    nodeCount: number;
    edgeCount: number;
    loopCount?: number;
    eventCount?: number;
    problemCount?: number;
    routeCommitCount?: number;
    routeJobCount?: number;
  };
  graphProjection: HermesGraphProjection;
};

export const loopgraphRoutingOpsToolDefinitions = [
  {
    name: "loopgraph_events_get",
    description: "Return durable Hermes EventEnvelope receipts from the project-local routing store.",
    readOnly: true,
    idempotent: true
  },
  {
    name: "loopgraph_problems_get",
    description: "Return business problems grouped across related Hermes events, with route commits when requested.",
    readOnly: true,
    idempotent: true
  },
  {
    name: "loopgraph_routing_decision_get",
    description: "Return Hermes routing attempts, validation state, related receipts, problems, and route commits.",
    readOnly: true,
    idempotent: true
  },
  {
    name: "loopgraph_route_jobs_get",
    description: "Return durable route jobs, queue status, leases, retries, and dead-letter state for Hermes-routed work.",
    readOnly: true,
    idempotent: true
  },
  {
    name: "loopgraph_routing_evaluations_get",
    description: "Return persisted Hermes routing fixture evaluations for precision, recall, abstention, and duplicate-suppression audits.",
    readOnly: true,
    idempotent: true
  },
  {
    name: "loopgraph_lifecycle_events_get",
    description: "Return signed Loopgraph lifecycle events prepared for Hermes without exposing signing secrets.",
    readOnly: true,
    idempotent: true
  },
  {
    name: "loopgraph_graph_get",
    description: "Return a design or event-routing graph projection for the Hermes Company Brain.",
    readOnly: true,
    idempotent: true
  }
] satisfies Array<{
  name: LoopgraphRoutingOpsToolName;
  description: string;
  readOnly: boolean;
  idempotent: boolean;
}>;

export async function callLoopgraphRoutingOpsTool(
  name: LoopgraphRoutingOpsToolName,
  input: unknown,
  options: LoopgraphRoutingOpsToolRuntimeOptions = {}
) {
  if (name === "loopgraph_events_get") {
    return loopgraph_events_get(input as EventsGetInput, options);
  }
  if (name === "loopgraph_problems_get") {
    return loopgraph_problems_get(input as ProblemsGetInput, options);
  }
  if (name === "loopgraph_routing_decision_get") {
    return loopgraph_routing_decision_get(input as RoutingDecisionGetInput, options);
  }
  if (name === "loopgraph_route_jobs_get") {
    return loopgraph_route_jobs_get(input as RouteJobsGetInput, options);
  }
  if (name === "loopgraph_routing_evaluations_get") {
    return loopgraph_routing_evaluations_get(input as RoutingEvaluationsGetInput, options);
  }
  if (name === "loopgraph_lifecycle_events_get") {
    return loopgraph_lifecycle_events_get(input as LifecycleEventsGetInput, options);
  }
  if (name === "loopgraph_graph_get") {
    return loopgraph_graph_get(input as GraphGetInput, options);
  }
  throw new Error(`Unknown Loopgraph routing operations tool: ${String(name)}`);
}

export async function loopgraph_events_get(
  input: EventsGetInput = {},
  options: LoopgraphRoutingOpsToolRuntimeOptions = {}
): Promise<EventsGetResult> {
  const parsed = eventsGetInputSchema.parse(input);
  const projectRoot = resolveProjectRoot(parsed.projectRoot, options.projectRoot);
  const receipts = (await storeFor(projectRoot, options).listEventReceipts())
    .filter((receipt) => !parsed.eventId || receipt.eventId === parsed.eventId || receipt.id === parsed.eventId)
    .filter((receipt) => !parsed.source || receipt.event.source === parsed.source)
    .filter((receipt) => !parsed.eventType || receipt.event.eventType === parsed.eventType)
    .filter((receipt) => !parsed.status || receipt.status === parsed.status)
    .sort((left, right) => right.lastSeenAt.localeCompare(left.lastSeenAt))
    .slice(0, parsed.limit);

  return {
    projectRoot,
    count: receipts.length,
    receipts
  };
}

export async function loopgraph_problems_get(
  input: ProblemsGetInput = {},
  options: LoopgraphRoutingOpsToolRuntimeOptions = {}
): Promise<ProblemsGetResult> {
  const parsed = problemsGetInputSchema.parse(input);
  const projectRoot = resolveProjectRoot(parsed.projectRoot, options.projectRoot);
  const store = storeFor(projectRoot, options);
  const problems = (await store.listBusinessProblems())
    .filter((problem) => !parsed.problemId || problem.id === parsed.problemId)
    .filter((problem) => !parsed.status || problem.status === parsed.status)
    .filter((problem) => !parsed.subjectType || problem.subject.type === parsed.subjectType)
    .filter((problem) => !parsed.subjectId || problem.subject.id === parsed.subjectId)
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
    .slice(0, parsed.limit);

  return {
    projectRoot,
    count: problems.length,
    problems: await Promise.all(problems.map(async (problem) => ({
      problem,
      ...(parsed.includeRouteCommits ? { routeCommits: await store.listRouteCommits(problem.id) } : {})
    })))
  };
}

export async function loopgraph_routing_decision_get(
  input: RoutingDecisionGetInput = {},
  options: LoopgraphRoutingOpsToolRuntimeOptions = {}
): Promise<RoutingDecisionGetResult> {
  const parsed = routingDecisionGetInputSchema.parse(input);
  const projectRoot = resolveProjectRoot(parsed.projectRoot, options.projectRoot);
  const store = storeFor(projectRoot, options);
  const receipts = parsed.includeReceipts ? await store.listEventReceipts() : [];
  const problems = await store.listBusinessProblems();
  const allCommits = parsed.includeRouteCommits ? await store.listRouteCommits() : [];
  const allJobs = parsed.includeRouteJobs ? await store.listRouteJobs() : [];
  const attemptEventIdsForProblem = parsed.problemId
    ? new Set(allCommits.filter((commit) => commit.problemId === parsed.problemId).map((commit) => commit.eventId))
    : undefined;
  const attempts = (await store.listRoutingAttempts(parsed.eventId))
    .filter((attempt) => !parsed.attemptId || attempt.id === parsed.attemptId)
    .filter((attempt) => !attemptEventIdsForProblem || attemptEventIdsForProblem.has(attempt.eventId))
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
    .slice(0, parsed.limit);

  return {
    projectRoot,
    count: attempts.length,
    attempts: attempts.map((attempt) => {
      const receipt = receipts.find((item) => item.eventId === attempt.eventId);
      const routeCommits = allCommits.filter((commit) =>
        commit.routeAttemptId === attempt.id ||
        commit.eventId === attempt.eventId ||
        (parsed.problemId ? commit.problemId === parsed.problemId : false)
      );
      const routeCommitIds = new Set(routeCommits.map((commit) => commit.id));
      const routeJobs = allJobs.filter((job) =>
        job.routeAttemptId === attempt.id ||
        job.eventId === attempt.eventId ||
        routeCommitIds.has(job.routeCommitId) ||
        (parsed.problemId ? job.problemId === parsed.problemId : false)
      );
      const problem = problemForAttempt(attempt, problems, routeCommits);
      return {
        attempt,
        ...(receipt ? { receipt } : {}),
        ...(problem ? { problem } : {}),
        ...(parsed.includeRouteCommits ? { routeCommits } : {}),
        ...(parsed.includeRouteJobs ? { routeJobs } : {})
      };
    })
  };
}

export async function loopgraph_route_jobs_get(
  input: RouteJobsGetInput = {},
  options: LoopgraphRoutingOpsToolRuntimeOptions = {}
): Promise<RouteJobsGetResult> {
  const parsed = routeJobsGetInputSchema.parse(input);
  const projectRoot = resolveProjectRoot(parsed.projectRoot, options.projectRoot);
  const jobs = (await storeFor(projectRoot, options).listRouteJobs({
    eventId: parsed.eventId,
    problemId: parsed.problemId,
    routeCommitId: parsed.routeCommitId,
    loopId: parsed.loopId,
    status: parsed.status
  }))
    .filter((job) => !parsed.jobId || job.id === parsed.jobId)
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
    .slice(0, parsed.limit);

  return {
    projectRoot,
    count: jobs.length,
    jobs
  };
}

export async function loopgraph_routing_evaluations_get(
  input: RoutingEvaluationsGetInput = {},
  options: LoopgraphRoutingOpsToolRuntimeOptions = {}
): Promise<RoutingEvaluationsGetResult> {
  const parsed = routingEvaluationsGetInputSchema.parse(input);
  const projectRoot = resolveProjectRoot(parsed.projectRoot, options.projectRoot);
  const evaluations = (await storeFor(projectRoot, options).listRouterEvaluations())
    .filter((evaluation) => !parsed.evaluationId || evaluation.id === parsed.evaluationId)
    .filter((evaluation) => !parsed.fixtureId || evaluation.fixtureId === parsed.fixtureId)
    .filter((evaluation) => !parsed.eventId || evaluation.eventId === parsed.eventId)
    .filter((evaluation) => !parsed.expectedAction || evaluation.expectedAction === parsed.expectedAction)
    .filter((evaluation) => parsed.passed === undefined || evaluation.passed === parsed.passed)
    .sort((left, right) => right.evaluatedAt.localeCompare(left.evaluatedAt))
    .slice(0, parsed.limit);

  return {
    projectRoot,
    count: evaluations.length,
    evaluations
  };
}

export async function loopgraph_lifecycle_events_get(
  input: LifecycleEventsGetInput = {},
  options: LoopgraphRoutingOpsToolRuntimeOptions = {}
): Promise<LifecycleEventsGetResult> {
  const parsed = lifecycleEventsGetInputSchema.parse(input);
  const projectRoot = resolveProjectRoot(parsed.projectRoot, options.projectRoot);
  const deliveries = (await listLoopgraphLifecycleDeliveries(projectRoot))
    .filter((delivery) => !parsed.deliveryId || delivery.id === parsed.deliveryId)
    .filter((delivery) => !parsed.eventId || lifecycleDeliveryMatchesEvent(delivery, parsed.eventId))
    .filter((delivery) => !parsed.correlationId || delivery.event.correlationId === parsed.correlationId)
    .filter((delivery) => !parsed.status || delivery.status === parsed.status)
    .slice(0, parsed.limit);

  return {
    projectRoot,
    count: deliveries.length,
    deliveries
  };
}

export async function loopgraph_graph_get(
  input: GraphGetInput = {},
  options: LoopgraphRoutingOpsToolRuntimeOptions = {}
): Promise<GraphProjectionResult> {
  const parsed = graphGetInputSchema.parse(input);
  const projectRoot = resolveProjectRoot(parsed.projectRoot, options.projectRoot);
  const generatedAt = (options.now ?? new Date()).toISOString();
  const graphProjection = parsed.projection === "event_routing"
    ? await eventRoutingGraphProjection({ projectRoot, eventId: parsed.eventId, problemId: parsed.problemId, options })
    : await designGraphProjection({ projectRoot, includeConnections: parsed.includeConnections });

  return {
    schemaVersion: "graph-projection/v1alpha1",
    projectRoot,
    projection: parsed.projection,
    generatedAt,
    summary: {
      nodeCount: graphProjection.nodes.length,
      edgeCount: graphProjection.edges.length,
      ...(parsed.projection === "design" ? { loopCount: graphProjection.nodes.filter((node) => node.type === "loop").length } : {}),
      ...(parsed.projection === "event_routing" ? {
        eventCount: graphProjection.nodes.filter((node) => node.type === "event").length,
        problemCount: graphProjection.nodes.filter((node) => node.type === "problem").length,
        routeCommitCount: graphProjection.nodes.filter((node) => node.type === "route_commit").length,
        routeJobCount: graphProjection.nodes.filter((node) => node.type === "route_job").length
      } : {})
    },
    graphProjection
  };
}

async function designGraphProjection(input: {
  projectRoot: string;
  includeConnections: boolean;
}): Promise<HermesGraphProjection> {
  const loops = await listLoopgraphLoops({ projectRoot: input.projectRoot });
  const projection = {
    nodes: [...loops.graphProjection.nodes],
    edges: [...loops.graphProjection.edges]
  };
  if (!input.includeConnections) return dedupeGraphProjection(projection);

  const plan = await buildConnectionPlan({ projectRoot: input.projectRoot });
  for (const item of plan.items) {
    projection.nodes.push({
      id: `connection:${item.capability}`,
      label: item.capability,
      type: "connector"
    });
    for (const loop of item.loops) {
      projection.edges.push({
        source: `connection:${item.capability}`,
        target: `loop:${loop.loopId}`,
        label: item.status === "connected"
          ? "connected signal"
          : item.status === "manual_fallback"
            ? "manual fallback"
            : "missing connection",
        executable: item.status === "connected"
      });
    }
  }

  return dedupeGraphProjection(projection);
}

async function eventRoutingGraphProjection(input: {
  projectRoot: string;
  eventId?: string;
  problemId?: string;
  options: LoopgraphRoutingOpsToolRuntimeOptions;
}): Promise<HermesGraphProjection> {
  const store = storeFor(input.projectRoot, input.options);
  const receipts = (await store.listEventReceipts())
    .filter((receipt) => !input.eventId || receipt.eventId === input.eventId || receipt.id === input.eventId);
  const problems = (await store.listBusinessProblems())
    .filter((problem) => !input.problemId || problem.id === input.problemId)
    .filter((problem) => !input.eventId || problem.evidenceEventIds.includes(input.eventId));
  const problemEventIds = new Set(problems.flatMap((problem) => problem.evidenceEventIds));
  const attempts = (await store.listRoutingAttempts())
    .filter((attempt) =>
      (!input.eventId || attempt.eventId === input.eventId) &&
      (!input.problemId || problemEventIds.has(attempt.eventId))
    );
  const commits = (await store.listRouteCommits())
    .filter((commit) =>
      (!input.eventId || commit.eventId === input.eventId) &&
      (!input.problemId || commit.problemId === input.problemId)
    );
  const jobs = (await store.listRouteJobs())
    .filter((job) =>
      (!input.eventId || job.eventId === input.eventId) &&
      (!input.problemId || job.problemId === input.problemId)
    );
  const commitIds = new Set(commits.map((commit) => commit.id));
  const runIds = new Set([
    ...commits.map((commit) => commit.runId).filter((runId): runId is string => Boolean(runId)),
    ...jobs.map((job) => job.runId)
  ]);
  const lifecycleDeliveries = (await listLoopgraphLifecycleDeliveries(input.projectRoot))
    .filter((delivery) =>
      (!input.eventId || lifecycleDeliveryMatchesEvent(delivery, input.eventId)) &&
      (!input.problemId || lifecycleDeliveryMatchesProblemOrCommit(delivery, input.problemId, commitIds, runIds))
    );
  const projection: HermesGraphProjection = {
    nodes: [{ id: "company_brain", label: "Hermes Brain", type: "company_brain" }],
    edges: []
  };

  for (const receipt of receipts) {
    const sourceId = `source:${receipt.event.source}`;
    const eventNodeId = `event:${receipt.eventId}`;
    projection.nodes.push(
      { id: sourceId, label: receipt.event.source, type: "event" },
      { id: eventNodeId, label: receipt.event.eventType, type: "event" }
    );
    projection.edges.push(
      { source: sourceId, target: "company_brain", label: "webhook to Hermes", executable: true },
      { source: "company_brain", target: eventNodeId, label: receipt.status, executable: false }
    );
  }

  for (const problem of problems) {
    const problemNodeId = `problem:${problem.id}`;
    projection.nodes.push({ id: problemNodeId, label: problem.summary, type: "problem" });
    for (const eventId of problem.evidenceEventIds) {
      projection.edges.push({
        source: `event:${eventId}`,
        target: problemNodeId,
        label: "evidence",
        executable: false
      });
    }
  }

  for (const attempt of attempts) {
    const attemptNodeId = `attempt:${attempt.id}`;
    projection.nodes.push({
      id: attemptNodeId,
      label: `${attempt.action ?? "received"} · ${attempt.status}`,
      type: "loop"
    });
    projection.edges.push({
      source: `event:${attempt.eventId}`,
      target: attemptNodeId,
      label: "Hermes decision",
      executable: attempt.status === "committed"
    });
    for (const alternative of attempt.decision?.alternatives ?? []) {
      const loopNodeId = `loop:${alternative.loopId}`;
      projection.nodes.push({ id: loopNodeId, label: alternative.loopId, type: "loop" });
      projection.edges.push({
        source: attemptNodeId,
        target: loopNodeId,
        label: "alternative",
        executable: false
      });
    }
  }

  for (const commit of commits) {
    const problemNodeId = `problem:${commit.problemId}`;
    const attemptNodeId = `attempt:${commit.routeAttemptId}`;
    const commitNodeId = `commit:${commit.id}`;
    const loopNodeId = `loop:${commit.loopId}`;
    projection.nodes.push(
      { id: commitNodeId, label: commit.status, type: "route_commit" },
      { id: loopNodeId, label: commit.loopId, type: "loop" }
    );
    projection.edges.push(
      { source: problemNodeId, target: attemptNodeId, label: "problem routed by", executable: false },
      { source: attemptNodeId, target: commitNodeId, label: "validated route", executable: true },
      { source: commitNodeId, target: loopNodeId, label: "selected loop", executable: commit.status !== "shadow" }
    );
    if (commit.runId) {
      const runNodeId = `run:${commit.runId}`;
      projection.nodes.push({ id: runNodeId, label: commit.runId, type: "loop" });
      projection.edges.push({ source: loopNodeId, target: runNodeId, label: "run", executable: true });
    }
  }

  for (const job of jobs) {
    const jobNodeId = `job:${job.id}`;
    const commitNodeId = `commit:${job.routeCommitId}`;
    const runNodeId = `run:${job.runId}`;
    projection.nodes.push(
      { id: jobNodeId, label: job.status, type: "route_job" },
      { id: runNodeId, label: job.runId, type: "loop" }
    );
    projection.edges.push(
      {
        source: commitNodeId,
        target: jobNodeId,
        label: "durable queue",
        executable: ["queued", "claimed", "running", "failed"].includes(job.status)
      },
      {
        source: jobNodeId,
        target: runNodeId,
        label: "idempotent run",
        executable: job.status !== "dead_letter" && job.status !== "cancelled"
      }
    );
  }

  for (const delivery of lifecycleDeliveries) {
    const runId = readString(delivery.event.normalizedPayload, "runId");
    const routeCommitId = readString(delivery.event.normalizedPayload, "routeCommitId");
    const lifecycleNodeId = `lifecycle:${delivery.event.id}`;
    projection.nodes.push({
      id: lifecycleNodeId,
      label: delivery.event.eventType,
      type: "event"
    });
    if (runId) {
      const runNodeId = `run:${runId}`;
      projection.nodes.push({ id: runNodeId, label: runId, type: "loop" });
      projection.edges.push({
        source: runNodeId,
        target: lifecycleNodeId,
        label: "emits",
        executable: false
      });
    } else if (routeCommitId) {
      projection.edges.push({
        source: `commit:${routeCommitId}`,
        target: lifecycleNodeId,
        label: "emits",
        executable: false
      });
    }
    projection.edges.push({
      source: lifecycleNodeId,
      target: "company_brain",
      label: "signed lifecycle webhook",
      executable: false
    });
  }

  return dedupeGraphProjection(projection);
}

function lifecycleDeliveryMatchesEvent(delivery: LoopgraphLifecycleDelivery, eventId: string): boolean {
  return delivery.event.id === eventId ||
    delivery.event.causationId === eventId ||
    delivery.event.parentEventId === eventId ||
    readString(delivery.event.normalizedPayload, "sourceEventId") === eventId;
}

function lifecycleDeliveryMatchesProblemOrCommit(
  delivery: LoopgraphLifecycleDelivery,
  problemId: string,
  commitIds: Set<string>,
  runIds: Set<string>
): boolean {
  const deliveryProblemId = readString(delivery.event.normalizedPayload, "problemId");
  const routeCommitId = readString(delivery.event.normalizedPayload, "routeCommitId");
  const runId = readString(delivery.event.normalizedPayload, "runId");
  return deliveryProblemId === problemId ||
    Boolean(routeCommitId && commitIds.has(routeCommitId)) ||
    Boolean(runId && runIds.has(runId));
}

function readString(input: Record<string, unknown>, key: string): string | undefined {
  const value = input[key];
  return typeof value === "string" ? value : undefined;
}

function problemForAttempt(
  attempt: RoutingAttempt,
  problems: BusinessProblem[],
  routeCommits: RouteCommit[]
): BusinessProblem | undefined {
  const problemId = routeCommits.find((commit) => commit.routeAttemptId === attempt.id)?.problemId;
  if (problemId) return problems.find((problem) => problem.id === problemId);
  return problems.find((problem) => problem.evidenceEventIds.includes(attempt.eventId));
}

function storeFor(projectRoot: string, options: LoopgraphRoutingOpsToolRuntimeOptions): RoutingStore {
  return options.store ?? new FileRoutingStore(getLoopgraphRoot(projectRoot));
}

function resolveProjectRoot(inputProjectRoot: string | undefined, optionProjectRoot: string | undefined): string {
  return path.resolve(inputProjectRoot ?? optionProjectRoot ?? process.cwd());
}

function dedupeGraphProjection(projection: HermesGraphProjection): HermesGraphProjection {
  const nodes = Array.from(new Map(projection.nodes.map((node) => [node.id, node])).values());
  const edges = Array.from(new Map(projection.edges.map((edge) => [
    `${edge.source}->${edge.target}:${edge.label}`,
    edge
  ])).values());
  return { nodes, edges };
}
