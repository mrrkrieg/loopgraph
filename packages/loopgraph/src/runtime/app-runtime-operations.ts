import { z } from "zod";
import {
  APP_RUNTIME_OPERATION_RESPONSE_SCHEMA_VERSION,
  appRuntimeOperationResponseSchema,
  canonicalAppDigest,
  type AppRuntimeOperationResponse
} from "../core";
import type { LoopSpecRegistryStore } from "./loop-spec-store";
import type { OutcomeStore } from "./outcome-store";
import type { RoutingStore } from "./routing-store";
import { assertSecretFree } from "./secret-redaction";
import { readWorkspaceGraphState } from "./semantic-graph-state";
import { LOOPGRAPH_RUNTIME_OPERATION_CATALOG } from "./app-runtime-operation-catalog";

const MAX_RUNTIME_RESULT_BYTES = 256 * 1024;

const graphReadInputSchema = z.object({
  loopIds: z.array(z.string().min(1).max(256)).max(50).default([]),
  departments: z.array(z.string().min(1).max(96)).max(20).default([]),
  limit: z.number().int().min(1).max(100).default(50)
}).strict();

const routingReadInputSchema = z.object({
  scope: z.enum(["object", "company"]).default("object"),
  problemStatuses: z.array(z.enum([
    "detected",
    "needs_human",
    "routed",
    "in_progress",
    "waiting",
    "resolved",
    "closed",
    "unhandled"
  ])).max(8).default([]),
  limit: z.number().int().min(1).max(100).default(50)
}).strict();

const outcomesReadInputSchema = z.object({
  loopIds: z.array(z.string().min(1).max(256)).max(50).default([]),
  departmentIds: z.array(z.string().min(1).max(96)).max(20).default([]),
  truthStatuses: z.array(z.enum(["observed", "modeled", "incomplete"])).max(3).default([]),
  windowStart: z.string().datetime().optional(),
  windowEnd: z.string().datetime().optional(),
  limit: z.number().int().min(1).max(100).default(50)
}).strict().superRefine((input, ctx) => {
  if (input.windowStart && input.windowEnd && Date.parse(input.windowEnd) < Date.parse(input.windowStart)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["windowEnd"], message: "windowEnd must not precede windowStart" });
  }
});

export const LOOPGRAPH_APP_RUNTIME_OPERATION_CATALOG = LOOPGRAPH_RUNTIME_OPERATION_CATALOG
  .filter((entry) => entry.registered);

export type AppRuntimeOperationRequest = {
  requestId: string;
  operation: string;
  input: Record<string, unknown>;
  workspaceId: string;
  companyId: string;
  installationId: string;
  appId: string;
  artifactDigest: string;
  loopId: string;
  loopVersionHash: string;
  capability: string;
  routeJobId: string;
  agentInstanceId: string;
  companyObject: { type: string; id: string };
  now: Date;
};

export type AppRuntimeOperationTransport = {
  execute(request: AppRuntimeOperationRequest): Promise<AppRuntimeOperationResponse>;
};

/**
 * Fixed internal operation registry for App-owned Hermes work.
 *
 * It deliberately contains no dynamic module loading, arbitrary function name,
 * filesystem path, SQL, URL, or write handler. Each operation owns its input
 * schema and receives tenant/project/subject identity derived by the route
 * execution boundary.
 */
export class LoopgraphAppRuntimeOperationRegistry implements AppRuntimeOperationTransport {
  constructor(private readonly dependencies: {
    projectRoot: string;
    loopSpecStore: LoopSpecRegistryStore;
    routingStore: RoutingStore;
    outcomeStore: OutcomeStore;
  }) {}

  async execute(request: AppRuntimeOperationRequest): Promise<AppRuntimeOperationResponse> {
    assertSecretFree(request.input, "app_runtime_operation.input");
    let result: Record<string, unknown>;
    if (!LOOPGRAPH_APP_RUNTIME_OPERATION_CATALOG.some((entry) => entry.operation === request.operation)) {
      throw new Error(`Loopgraph runtime operation is not registered: ${request.operation}`);
    }
    if (request.operation === "graph.read") {
      result = await this.readGraph(request, graphReadInputSchema.parse(request.input));
    } else if (request.operation === "routing-decisions.read") {
      result = await this.readRouting(request, routingReadInputSchema.parse(request.input));
    } else if (request.operation === "outcomes-value.read") {
      result = await this.readOutcomes(request, outcomesReadInputSchema.parse(request.input));
    } else throw new Error(`Loopgraph runtime operation handler is missing: ${request.operation}`);
    assertBoundedRuntimeResult(result);
    const completedAt = request.now.toISOString();
    const base = {
      schemaVersion: APP_RUNTIME_OPERATION_RESPONSE_SCHEMA_VERSION,
      requestId: request.requestId,
      operation: request.operation,
      status: "succeeded" as const,
      result,
      completedAt
    };
    return appRuntimeOperationResponseSchema.parse({
      ...base,
      resultDigest: canonicalAppDigest({ ...base, resultDigest: undefined })
    });
  }

  private async readGraph(
    request: AppRuntimeOperationRequest,
    input: z.infer<typeof graphReadInputSchema>
  ): Promise<Record<string, unknown>> {
    const state = await readWorkspaceGraphState(this.dependencies.projectRoot, this.dependencies.loopSpecStore);
    const loopIds = new Set(input.loopIds);
    const departments = new Set(input.departments);
    const loops = state.entries
      .filter((entry) => loopIds.size === 0 || loopIds.has(entry.id))
      .filter((entry) => departments.size === 0 || departments.has(entry.department ?? entry.spec.topology?.department ?? ""))
      .slice(0, input.limit)
      .map((entry) => ({
        id: entry.id,
        name: entry.name,
        department: entry.department ?? entry.spec.topology?.department,
        version: entry.spec.metadata.version,
        versionHash: entry.versionHash,
        activationMode: entry.spec.routing?.activationMode ?? "shadow",
        problemTypes: entry.spec.routing?.problemTypes ?? [],
        parentLoopId: entry.spec.topology?.parentLoopId,
        requiredCapabilities: entry.spec.tools
          .map((tool) => tool.adapterId)
          .filter((adapterId) => adapterId.startsWith("capability:"))
          .map((adapterId) => adapterId.slice("capability:".length))
          .sort()
      }));
    return {
      workspaceId: request.workspaceId,
      companyId: request.companyId,
      graphHash: state.graphHash,
      totalLoops: state.entries.length,
      returnedLoops: loops.length,
      loops
    };
  }

  private async readRouting(
    request: AppRuntimeOperationRequest,
    input: z.infer<typeof routingReadInputSchema>
  ): Promise<Record<string, unknown>> {
    const [allProblems, allReceipts, allAttempts, allCommits, allJobs] = await Promise.all([
      this.dependencies.routingStore.listBusinessProblems(),
      this.dependencies.routingStore.listEventReceipts(),
      this.dependencies.routingStore.listRoutingAttempts(),
      this.dependencies.routingStore.listRouteCommits(),
      this.dependencies.routingStore.listRouteJobs()
    ]);
    const receipts = new Map(allReceipts
      .filter((receipt) => receipt.event.workspaceId === request.workspaceId && receipt.event.companyId === request.companyId)
      .map((receipt) => [receipt.eventId, receipt]));
    const problems = allProblems
      .filter((problem) => problem.workspaceId === request.workspaceId && problem.companyId === request.companyId)
      .filter((problem) => input.scope === "company" || (
        problem.subject.type === request.companyObject.type && problem.subject.id === request.companyObject.id
      ))
      .filter((problem) => input.problemStatuses.length === 0 || input.problemStatuses.includes(problem.status))
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt) || left.id.localeCompare(right.id))
      .slice(0, input.limit);
    const attemptsByEvent = new Map<string, typeof allAttempts>();
    for (const attempt of allAttempts) {
      if (!receipts.has(attempt.eventId)) continue;
      attemptsByEvent.set(attempt.eventId, [...(attemptsByEvent.get(attempt.eventId) ?? []), attempt]);
    }
    return {
      workspaceId: request.workspaceId,
      companyId: request.companyId,
      scope: input.scope,
      companyObject: request.companyObject,
      returnedProblems: problems.length,
      decisions: problems.map((problem) => {
        const eventId = problem.evidenceEventIds.at(-1);
        const receipt = eventId ? receipts.get(eventId) : undefined;
        const attempt = eventId
          ? [...(attemptsByEvent.get(eventId) ?? [])].sort((left, right) => right.createdAt.localeCompare(left.createdAt))[0]
          : undefined;
        return {
          problem: {
            id: problem.id,
            type: problem.problemType,
            subject: problem.subject,
            summary: problem.summary,
            severity: problem.severity,
            status: problem.status,
            primaryLoopId: problem.primaryLoopId,
            supportingLoopIds: problem.supportingLoopIds,
            updatedAt: problem.updatedAt
          },
          event: receipt ? {
            id: receipt.eventId,
            source: receipt.event.source,
            type: receipt.event.eventType,
            occurredAt: receipt.event.occurredAt,
            signatureVerified: receipt.event.trust.signatureVerified
          } : undefined,
          decision: attempt?.decision ? {
            action: attempt.decision.action,
            selectedRoutes: attempt.decision.selectedRoutes.map((route) => ({
              loopId: route.loopId,
              role: route.role,
              confidence: route.confidence,
              reasonSummary: route.reasonSummary
            })),
            status: attempt.status,
            policyVersion: attempt.decision.policyVersion
          } : undefined,
          routeCommits: allCommits
            .filter((commit) => commit.problemId === problem.id)
            .map((commit) => ({ id: commit.id, loopId: commit.loopId, status: commit.status, committedAt: commit.committedAt })),
          routeJobs: allJobs
            .filter((job) => job.problemId === problem.id)
            .map((job) => ({ id: job.id, loopId: job.loopId, status: job.status, runId: job.runId, updatedAt: job.updatedAt }))
        };
      })
    };
  }

  private async readOutcomes(
    request: AppRuntimeOperationRequest,
    input: z.infer<typeof outcomesReadInputSchema>
  ): Promise<Record<string, unknown>> {
    const [allOutcomes, allLedger] = await Promise.all([
      this.dependencies.outcomeStore.listObservedOutcomes({
        workspaceId: request.workspaceId,
        companyId: request.companyId
      }),
      this.dependencies.outcomeStore.listValueLedgerEntries({
        workspaceId: request.workspaceId,
        companyId: request.companyId,
        windowStart: input.windowStart,
        windowEnd: input.windowEnd
      })
    ]);
    const loopIds = new Set(input.loopIds);
    const departmentIds = new Set(input.departmentIds);
    const truthStatuses = new Set(input.truthStatuses);
    const matches = (record: { loopId: string; departmentId?: string; truthStatus: "observed" | "modeled" | "incomplete" }) =>
      (loopIds.size === 0 || loopIds.has(record.loopId)) &&
      (departmentIds.size === 0 || Boolean(record.departmentId && departmentIds.has(record.departmentId))) &&
      (truthStatuses.size === 0 || truthStatuses.has(record.truthStatus));
    const outcomes = allOutcomes
      .filter(matches)
      .filter((outcome) => !input.windowStart || outcome.evaluationWindow.end >= input.windowStart)
      .filter((outcome) => !input.windowEnd || outcome.evaluationWindow.start <= input.windowEnd)
      .slice(0, input.limit)
      .map((outcome) => ({
        id: outcome.id,
        departmentId: outcome.departmentId,
        loopId: outcome.loopId,
        metricDefinitionId: outcome.metricDefinitionId,
        metricKey: outcome.metricKey,
        unit: outcome.unit,
        desiredDirection: outcome.desiredDirection,
        evaluationWindow: outcome.evaluationWindow,
        baseline: outcome.baseline?.value,
        observed: outcome.observed?.value,
        target: outcome.target,
        absoluteDelta: outcome.absoluteDelta,
        relativeDeltaPct: outcome.relativeDeltaPct,
        status: outcome.status,
        truthStatus: outcome.truthStatus,
        confidence: outcome.confidence,
        evidenceSufficient: outcome.evidenceSufficiency.sufficient,
        evaluatedAt: outcome.evaluatedAt
      }));
    const valueLedger = allLedger
      .filter(matches)
      .slice(0, input.limit)
      .map((entry) => ({
        id: entry.id,
        departmentId: entry.departmentId,
        loopId: entry.loopId,
        window: entry.window,
        grossSavedMinutes: entry.grossSavedMinutes,
        observedCostMinutes: entry.observedCostMinutes,
        netSavedMinutes: entry.netSavedMinutes,
        monetaryValue: entry.monetaryValue,
        truthStatus: entry.truthStatus,
        observedOutcomeIds: entry.observedOutcomeIds,
        recordedAt: entry.recordedAt
      }));
    return {
      workspaceId: request.workspaceId,
      companyId: request.companyId,
      returnedOutcomes: outcomes.length,
      returnedValueEntries: valueLedger.length,
      outcomes,
      valueLedger
    };
  }
}

function assertBoundedRuntimeResult(result: Record<string, unknown>) {
  assertSecretFree(result, "app_runtime_operation.result");
  const serialized = JSON.stringify(result);
  if (Buffer.byteLength(serialized, "utf8") > MAX_RUNTIME_RESULT_BYTES) {
    throw new Error(`Loopgraph runtime operation result exceeds ${MAX_RUNTIME_RESULT_BYTES} bytes`);
  }
}
