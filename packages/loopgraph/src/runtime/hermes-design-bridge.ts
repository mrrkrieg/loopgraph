import { createHmac, timingSafeEqual } from "node:crypto";
import path from "node:path";
import {
  HERMES_DESIGN_DISPATCH_JOB_SCHEMA_VERSION,
  HERMES_DESIGN_REQUEST_SCHEMA_VERSION,
  HERMES_DESIGN_TASK_SCHEMA_VERSION,
  contentHash,
  hermesDesignDispatchJobSchema,
  hermesDesignCallbackSchema,
  hermesDesignRequestSchema,
  hermesDesignTaskSchema,
  normalizeDepartmentType,
  type EvidenceGap,
  type HermesDesignDispatchJob,
  type HermesDesignRequest,
  type HermesDesignTask,
  type LoopDesignContext
} from "../core";
import { buildLoopDesignContext, submitLoopDesignProposalSet } from "./design-service";
import {
  compileEvidenceGaps,
  getNextEvidenceGapQuestions,
  mergeHermesEvidenceGaps
} from "./evidence-gap-engine";
import { getDiscoverySession } from "./discovery-session";
import {
  FileHermesDesignStore,
  type HermesDesignStore,
  type HermesDesignTaskFilters
} from "./hermes-design-store";
import { getLoopgraphRoot } from "./storage-resolver";

export {
  HERMES_DESIGN_REQUEST_SCHEMA_VERSION
} from "../core";
export type {
  HermesDesignRequest
} from "../core";

export type StartHermesDesignTaskInput = {
  projectRoot?: string;
  sessionId: string;
  department?: string;
  reason?: HermesDesignTask["reason"];
  originProblemIds?: string[];
  originOpportunityId?: string;
  requestedBy?: string;
  callbackUrl?: string;
  now?: Date;
};

export type HermesDesignDispatchResult = {
  task: HermesDesignTask;
  request: HermesDesignRequest;
};

export type HermesTaskTransportResult = {
  sent: boolean;
  destination?: string;
  responseStatus?: number;
  hermesTaskId?: string;
  error?: string;
};

export interface HermesTaskTransport {
  dispatch(request: HermesDesignRequest): Promise<HermesTaskTransportResult>;
}

export class HttpHermesTaskTransport implements HermesTaskTransport {
  constructor(private options: {
    url: string;
    secret: string;
    fetchImpl?: typeof fetch;
    now?: () => Date;
  }) {}

  async dispatch(request: HermesDesignRequest): Promise<HermesTaskTransportResult> {
    const fetchImpl = this.options.fetchImpl ?? fetch;
    const timestamp = String(Math.floor((this.options.now?.() ?? new Date()).getTime() / 1000));
    const body = JSON.stringify(request);
    const signature = signHermesWebhookV2Payload(body, timestamp, this.options.secret);
    try {
      const response = await fetchImpl(this.options.url, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-webhook-signature-v2": signature,
          "x-webhook-timestamp": timestamp,
          "x-request-id": request.task.idempotencyKey,
          "x-loopgraph-task-id": request.task.id
        },
        body
      });
      const responseBody = await readResponseJson(response);
      return {
        sent: response.ok,
        destination: this.options.url,
        responseStatus: response.status,
        hermesTaskId: readString(responseBody, "taskId") ?? readString(responseBody, "id"),
        ...(!response.ok ? {
          error: readString(responseBody, "error") ?? `Hermes task endpoint returned ${response.status}`
        } : {})
      };
    } catch (error) {
      return {
        sent: false,
        destination: this.options.url,
        error: error instanceof Error ? error.message : "Hermes task delivery failed"
      };
    }
  }
}

export async function startHermesDesignTask(
  input: StartHermesDesignTaskInput,
  options: {
    transport?: HermesTaskTransport;
    taskUrl?: string;
    taskSecret?: string;
    store?: HermesDesignStore;
  } = {}
): Promise<HermesDesignDispatchResult> {
  const projectRoot = path.resolve(input.projectRoot ?? process.cwd());
  const store = designStoreFor(projectRoot, options.store);
  const session = await getDiscoverySession(input.sessionId, projectRoot);
  if (!session) throw new Error(`Discovery session not found: ${input.sessionId}`);
  const departmentCandidate = input.department ?? session.activeDepartmentId;
  const department = departmentCandidate ? normalizeDepartmentType(departmentCandidate) : undefined;
  if (!department) throw new Error("Select an active department before starting a Hermes design task.");
  if (!session.selectedDepartmentIds.includes(department)) {
    throw new Error(`Department ${department} is not selected in discovery session ${session.id}.`);
  }

  const now = input.now ?? new Date();
  const nowIso = now.toISOString();
  const gapSet = await compileEvidenceGaps({
    projectRoot,
    sessionId: session.id,
    now
  });
  const nextQuestions = await getNextEvidenceGapQuestions({
    projectRoot,
    sessionId: session.id,
    limit: 3
  });
  const blockingGaps = gapSet.gaps.filter((gap) =>
    gap.blocking &&
    ["open", "asked"].includes(gap.status) &&
    gap.requiredFor.includes("design")
  );
  const context = blockingGaps.length === 0
    ? await buildLoopDesignContext({
        projectRoot,
        sessionId: session.id,
        department
      })
    : undefined;
  const idempotencyKey = `hermes_design_${contentHash({
    sessionId: session.id,
    revision: session.revision,
    department,
    reason: input.reason ?? "user_requested",
    originProblemIds: [...(input.originProblemIds ?? [])].sort(),
    originOpportunityId: input.originOpportunityId
  })}`;
  const transport = options.transport ?? resolveHermesTaskTransport(options);
  const queueDispatch = Boolean(options.store && transport);
  const matchingTasks = (await store.listTasks())
    .filter((candidate) => candidate.idempotencyKey === idempotencyKey);
  const existing = matchingTasks
    .find((candidate) => !["failed", "cancelled"].includes(candidate.status));
  if (existing && !["failed", "cancelled"].includes(existing.status)) {
    const request = buildHermesDesignRequest({
      task: existing,
      context,
      gaps: gapSet.gaps,
      nextQuestions: nextQuestions.questions,
      callbackUrl: input.callbackUrl ?? defaultCallbackUrl(existing.id)
    });
    if (queueDispatch && existing.delivery.status !== "sent") {
      await store.enqueueDispatchJobAtomically(
        createHermesDesignDispatchJob(request, now)
      );
    }
    return { task: existing, request };
  }

  let task = hermesDesignTaskSchema.parse({
    schemaVersion: HERMES_DESIGN_TASK_SCHEMA_VERSION,
    id: `hermes_task_${contentHash({
      idempotencyKey,
      attempt: matchingTasks.length
    })}`,
    idempotencyKey,
    sessionId: session.id,
    companyId: session.companyId,
    department,
    status: blockingGaps.length > 0 ? "needs_input" : "queued",
    reason: input.reason ?? "user_requested",
    originProblemIds: input.originProblemIds ?? [],
    originOpportunityId: input.originOpportunityId,
    contextHash: context?.contextHash,
    blockingGapIds: blockingGaps.map((gap) => gap.id),
    nextQuestionGapIds: nextQuestions.questions.map((question) => question.gapId),
    designRunIds: [],
    compilerErrors: [],
    callbackIds: [],
    delivery: { status: "pending", attemptCount: 0 },
    requestedBy: input.requestedBy ?? "loopgraph",
    createdAt: nowIso,
    updatedAt: nowIso
  });
  let request = buildHermesDesignRequest({
    task,
    context,
    gaps: gapSet.gaps,
    nextQuestions: nextQuestions.questions,
    callbackUrl: input.callbackUrl ?? defaultCallbackUrl(task.id)
  });
  const candidateDispatchJob = queueDispatch
    ? createHermesDesignDispatchJob(request, now)
    : undefined;
  const created = await store.createTaskAtomically(task, {
    ...(candidateDispatchJob ? { dispatchJob: candidateDispatchJob } : {})
  });
  if (!created.created) {
    request = buildHermesDesignRequest({
      task: created.task,
      context,
      gaps: gapSet.gaps,
      nextQuestions: nextQuestions.questions,
      callbackUrl: input.callbackUrl ?? defaultCallbackUrl(created.task.id)
    });
    if (
      queueDispatch &&
      created.task.delivery.status !== "sent" &&
      !created.dispatchJob
    ) {
      await store.enqueueDispatchJobAtomically(
        createHermesDesignDispatchJob(request, now)
      );
    }
    return { task: created.task, request };
  }
  task = created.task;

  request = buildHermesDesignRequest({
    task,
    context,
    gaps: gapSet.gaps,
    nextQuestions: nextQuestions.questions,
    callbackUrl: input.callbackUrl ?? defaultCallbackUrl(task.id)
  });
  if (queueDispatch) {
    return { task, request };
  }
  if (!transport) {
    task = await store.updateTaskAtomically({
      taskId: task.id,
      update: (current) => hermesDesignTaskSchema.parse({
        ...current,
        delivery: {
          status: "not_configured",
          attemptCount: current.delivery.attemptCount,
          error: "No Hermes task endpoint is configured. Hermes can claim the durable task through the Loopgraph MCP tools."
        },
        updatedAt: nowIso
      })
    });
    return { task, request };
  }

  const result = await transport.dispatch(request);
  task = await store.updateTaskAtomically({
    taskId: task.id,
    update: (current) => hermesDesignTaskSchema.parse({
      ...current,
      status: result.sent && current.status === "queued"
        ? "awaiting_hermes"
        : current.status,
      hermesTaskId: result.hermesTaskId ?? current.hermesTaskId,
      delivery: {
        status: result.sent ? "sent" : "failed",
        destination: result.destination,
        attemptCount: current.delivery.attemptCount + 1,
        lastAttemptAt: nowIso,
        responseStatus: result.responseStatus,
        error: result.error
      },
      updatedAt: nowIso
    })
  });
  return { task, request };
}

export async function processHermesDesignCallback(input: {
  projectRoot?: string;
  callback: unknown;
  now?: Date;
}, options: {
  store?: HermesDesignStore;
} = {}): Promise<{
  task: HermesDesignTask;
  duplicate: boolean;
  designRunId?: string;
  validationErrors: string[];
}> {
  const projectRoot = path.resolve(input.projectRoot ?? process.cwd());
  const store = designStoreFor(projectRoot, options.store);
  const callback = hermesDesignCallbackSchema.parse(input.callback);
  const task = await requireHermesDesignTask(store, callback.taskId);
  if (task.callbackIds.includes(callback.callbackId)) {
    const repaired = await store.applyCallbackAtomically({
      taskId: callback.taskId,
      callback,
      update: (current) => current
    });
    return {
      task: repaired.task,
      duplicate: true,
      designRunId: repaired.task.designRunIds.at(-1),
      validationErrors: repaired.task.compilerErrors
    };
  }
  if (callback.hermesTaskId && task.hermesTaskId && callback.hermesTaskId !== task.hermesTaskId) {
    throw new Error(`Hermes task identity mismatch for ${task.id}.`);
  }

  const nowIso = (input.now ?? new Date()).toISOString();
  let designRunId: string | undefined;
  let validationErrors: string[] = [];
  let applyEffect: (current: HermesDesignTask) => HermesDesignTask = (current) => current;
  if (callback.type === "task.acknowledged") {
    applyEffect = (current) => hermesDesignTaskSchema.parse({
      ...current,
      status: current.status === "needs_input"
        ? "needs_input"
        : isTerminalDesignTaskStatus(current.status)
          ? current.status
          : "designing",
      delivery: {
        ...current.delivery,
        acknowledgedAt: callback.occurredAt
      }
    });
  } else if (callback.type === "task.questions_requested") {
    const gapSet = await mergeHermesEvidenceGaps({
      projectRoot,
      sessionId: task.sessionId,
      gaps: callback.gaps,
      now: input.now
    });
    const nextQuestions = await getNextEvidenceGapQuestions({
      projectRoot,
      sessionId: task.sessionId,
      limit: 3
    });
    const blockingGapIds = gapSet.gaps
      .filter((gap) => gap.blocking && ["open", "asked"].includes(gap.status))
      .map((gap) => gap.id);
    const nextQuestionGapIds = nextQuestions.questions.map((question) => question.gapId);
    applyEffect = (current) => hermesDesignTaskSchema.parse({
      ...current,
      status: "needs_input",
      blockingGapIds,
      nextQuestionGapIds
    });
  } else if (callback.type === "task.proposal_submitted") {
    const currentGaps = await compileEvidenceGaps({
      projectRoot,
      sessionId: task.sessionId,
      now: input.now
    });
    const blocking = currentGaps.gaps.filter((gap) =>
      gap.blocking &&
      ["open", "asked"].includes(gap.status) &&
      gap.requiredFor.includes("design")
    );
    if (blocking.length > 0) {
      validationErrors = blocking.map((gap) => `Unresolved evidence gap: ${gap.field}`);
      applyEffect = (current) => hermesDesignTaskSchema.parse({
        ...current,
        status: "needs_input",
        blockingGapIds: blocking.map((gap) => gap.id),
        compilerErrors: validationErrors
      });
    } else {
      const result = await submitLoopDesignProposalSet({
        projectRoot,
        sessionId: task.sessionId,
        department: task.department,
        proposalSet: callback.proposalSet,
        providerName: callback.providerName ?? "hermes",
        modelIdentifier: callback.modelIdentifier,
        reasoningProfile: "high",
        providerMetadata: {
          ...callback.providerMetadata,
          hermesTaskId: callback.hermesTaskId ?? task.hermesTaskId,
          hermesDesignTaskId: task.id,
          callbackId: callback.callbackId
        },
        submissionIdempotencyKey: `hermes-callback:${callback.callbackId}`,
        now: input.now
      });
      designRunId = result.designRun.id;
      validationErrors = result.errors;
      applyEffect = (current) => hermesDesignTaskSchema.parse({
        ...current,
        status: result.valid ? "completed" : "needs_repair",
        designRunIds: Array.from(new Set([...current.designRunIds, result.designRun.id])),
        compilerErrors: result.errors,
        ...(result.valid ? { completedAt: nowIso } : {})
      });
    }
  } else if (callback.type === "task.failed") {
    validationErrors = [callback.error];
    applyEffect = (current) => hermesDesignTaskSchema.parse({
      ...current,
      status: isTerminalDesignTaskStatus(current.status) ? current.status : "failed",
      compilerErrors: Array.from(new Set([...current.compilerErrors, callback.error]))
    });
  }

  const applied = await store.applyCallbackAtomically({
    taskId: callback.taskId,
    callback,
    update: (current) => {
      if (
        callback.hermesTaskId &&
        current.hermesTaskId &&
        callback.hermesTaskId !== current.hermesTaskId
      ) {
        throw new Error(`Hermes task identity mismatch for ${current.id}.`);
      }
      const effected = applyEffect(current);
      return hermesDesignTaskSchema.parse({
        ...effected,
        hermesTaskId: callback.hermesTaskId ?? effected.hermesTaskId,
        callbackIds: Array.from(new Set([...effected.callbackIds, callback.callbackId])),
        updatedAt: nowIso
      });
    }
  });
  return {
    task: applied.task,
    duplicate: applied.duplicate,
    ...(applied.duplicate
      ? { designRunId: applied.task.designRunIds.at(-1) }
      : designRunId
        ? { designRunId }
        : {}),
    validationErrors: applied.duplicate
      ? applied.task.compilerErrors
      : validationErrors
  };
}

export async function resumeHermesDesignTasksForSession(input: {
  projectRoot?: string;
  sessionId: string;
  now?: Date;
}, options: {
  transport?: HermesTaskTransport;
  taskUrl?: string;
  taskSecret?: string;
  store?: HermesDesignStore;
} = {}): Promise<HermesDesignDispatchResult[]> {
  const projectRoot = path.resolve(input.projectRoot ?? process.cwd());
  const store = designStoreFor(projectRoot, options.store);
  const tasks = (await store.listTasks({ sessionId: input.sessionId }))
    .filter((task) => ["needs_input", "queued", "awaiting_hermes", "needs_repair"].includes(task.status))
    .slice(0, 1);
  const results: HermesDesignDispatchResult[] = [];
  for (const task of tasks) {
    results.push(await resumeHermesDesignTask({
      projectRoot,
      task,
      now: input.now
    }, options));
  }
  return results;
}

export async function getHermesDesignTask(
  taskId: string,
  projectRoot = process.cwd(),
  store?: HermesDesignStore
): Promise<HermesDesignTask | undefined> {
  return designStoreFor(path.resolve(projectRoot), store).getTask(taskId);
}

async function resumeHermesDesignTask(
  input: {
    projectRoot: string;
    task: HermesDesignTask;
    now?: Date;
  },
  options: {
    transport?: HermesTaskTransport;
    taskUrl?: string;
    taskSecret?: string;
    store?: HermesDesignStore;
  }
): Promise<HermesDesignDispatchResult> {
  const store = designStoreFor(input.projectRoot, options.store);
  const gapSet = await compileEvidenceGaps({
    projectRoot: input.projectRoot,
    sessionId: input.task.sessionId,
    now: input.now
  });
  const nextQuestions = await getNextEvidenceGapQuestions({
    projectRoot: input.projectRoot,
    sessionId: input.task.sessionId,
    limit: 3
  });
  const blocking = gapSet.gaps.filter((gap) =>
    gap.blocking &&
    ["open", "asked"].includes(gap.status) &&
    gap.requiredFor.includes("design")
  );
  const context = blocking.length === 0
    ? await buildLoopDesignContext({
        projectRoot: input.projectRoot,
        sessionId: input.task.sessionId,
        department: input.task.department
      })
    : undefined;
  const now = input.now ?? new Date();
  const nowIso = now.toISOString();
  const refreshTask = (current: HermesDesignTask) => hermesDesignTaskSchema.parse({
      ...current,
      status: blocking.length > 0 ? "needs_input" : "queued",
      contextHash: context?.contextHash ?? current.contextHash,
      blockingGapIds: blocking.map((gap) => gap.id),
      nextQuestionGapIds: nextQuestions.questions.map((question) => question.gapId),
      compilerErrors: blocking.length > 0 ? current.compilerErrors : [],
      delivery: {
        ...current.delivery,
        status: "pending",
        error: undefined
      },
      updatedAt: nowIso
    });
  const transport = options.transport ?? resolveHermesTaskTransport(options);
  if (options.store && transport) {
    const updated = await store.updateTaskAndEnqueueDispatchAtomically({
      taskId: input.task.id,
      update: (current) => {
        const task = refreshTask(current);
        const request = buildHermesDesignRequest({
          task,
          context,
          gaps: gapSet.gaps,
          nextQuestions: nextQuestions.questions,
          callbackUrl: defaultCallbackUrl(task.id)
        });
        return {
          task,
          dispatchJob: createHermesDesignDispatchJob(request, now)
        };
      }
    });
    return {
      task: updated.task,
      request: updated.dispatchJob.request
    };
  }
  let task = await store.updateTaskAtomically({
    taskId: input.task.id,
    update: refreshTask
  });
  const request = buildHermesDesignRequest({
    task,
    context,
    gaps: gapSet.gaps,
    nextQuestions: nextQuestions.questions,
    callbackUrl: defaultCallbackUrl(task.id)
  });
  if (!transport) {
    task = await store.updateTaskAtomically({
      taskId: task.id,
      update: (current) => hermesDesignTaskSchema.parse({
        ...current,
        delivery: {
          status: "not_configured",
          attemptCount: current.delivery.attemptCount,
          error: "No Hermes task endpoint is configured. Hermes can claim the durable task through the Loopgraph MCP tools."
        },
        updatedAt: nowIso
      })
    });
    return { task, request };
  }
  const delivery = await transport.dispatch(request);
  task = await store.updateTaskAtomically({
    taskId: task.id,
    update: (current) => hermesDesignTaskSchema.parse({
      ...current,
      status: delivery.sent && current.status === "queued"
        ? "awaiting_hermes"
        : current.status,
      hermesTaskId: delivery.hermesTaskId ?? current.hermesTaskId,
      delivery: {
        status: delivery.sent ? "sent" : "failed",
        destination: delivery.destination,
        attemptCount: current.delivery.attemptCount + 1,
        lastAttemptAt: nowIso,
        responseStatus: delivery.responseStatus,
        error: delivery.error
      },
      updatedAt: nowIso
    })
  });
  return { task, request };
}

export async function listHermesDesignTasks(
  projectRoot = process.cwd(),
  filters: HermesDesignTaskFilters = {},
  store?: HermesDesignStore
): Promise<HermesDesignTask[]> {
  return designStoreFor(path.resolve(projectRoot), store).listTasks(filters);
}

export function signLoopgraphTaskPayload(body: string, timestamp: string, secret: string): string {
  return `sha256=${createHmac("sha256", secret).update(`${timestamp}.${body}`).digest("hex")}`;
}

export function signHermesWebhookV2Payload(body: string, timestamp: string, secret: string): string {
  return createHmac("sha256", secret).update(`${timestamp}.${body}`).digest("hex");
}

export function verifyHermesCallbackSignature(input: {
  body: string;
  timestamp: string;
  signature: string;
  secret: string;
  now?: Date;
  maxClockSkewSeconds?: number;
}): boolean {
  const timestampMs = Date.parse(input.timestamp);
  if (!Number.isFinite(timestampMs)) return false;
  const skewMs = Math.abs((input.now ?? new Date()).getTime() - timestampMs);
  if (skewMs > (input.maxClockSkewSeconds ?? 300) * 1000) return false;
  const expected = signLoopgraphTaskPayload(input.body, input.timestamp, input.secret);
  const expectedBuffer = Buffer.from(expected);
  const actualBuffer = Buffer.from(input.signature);
  return expectedBuffer.length === actualBuffer.length && timingSafeEqual(expectedBuffer, actualBuffer);
}

export function buildHermesDesignRequest(input: {
  task: HermesDesignTask;
  context?: LoopDesignContext;
  gaps: EvidenceGap[];
  nextQuestions: HermesDesignRequest["nextQuestions"];
  callbackUrl?: string;
}): HermesDesignRequest {
  return hermesDesignRequestSchema.parse({
    schemaVersion: HERMES_DESIGN_REQUEST_SCHEMA_VERSION,
    event_type: "loopgraph.design_requested",
    task: input.task,
    ...(input.context ? { context: input.context } : {}),
    gaps: input.gaps.filter((gap) => ["open", "asked"].includes(gap.status)),
    nextQuestions: input.nextQuestions,
    ...(input.callbackUrl ? {
      callback: {
        url: input.callbackUrl,
        signatureHeader: "x-hermes-signature",
        timestampHeader: "x-hermes-timestamp"
      }
    } : {}),
    allowedLoopgraphTools: [
      "loopgraph_opportunities_get",
      "loopgraph_evidence_gaps_get",
      "loopgraph_evidence_gap_answer",
      "loopgraph_design_context_get",
      "loopgraph_design_submit"
    ],
    instructions: input.task.status === "needs_input"
      ? [
          "Ask only the supplied nextQuestions and preserve each gapId when returning answers.",
          "Do not invent missing facts or create a proposal while a blocking design gap remains.",
          "Submit answers through Loopgraph, then wait for the refreshed evidence-gap result."
        ]
      : [
          ...(input.task.originOpportunityId
            ? [`Read loop opportunity ${input.task.originOpportunityId} through loopgraph_opportunities_get before proposing a graph change.`]
            : []),
          "Use only the bounded design context and registered Loopgraph schemas.",
          "Return a LoopDesignProposalSet through the signed callback or loopgraph_design_submit.",
          "Do not materialize specs, connect providers, or perform business actions."
        ]
  });
}

export function createHermesDesignDispatchJob(
  request: HermesDesignRequest,
  now = new Date()
): HermesDesignDispatchJob {
  const parsedRequest = hermesDesignRequestSchema.parse(request);
  const nowIso = now.toISOString();
  const idempotencyKey = `hermes_dispatch_${contentHash({
    taskId: parsedRequest.task.id,
    request: parsedRequest
  })}`;
  return hermesDesignDispatchJobSchema.parse({
    schemaVersion: HERMES_DESIGN_DISPATCH_JOB_SCHEMA_VERSION,
    id: `hermes_dispatch_job_${contentHash({ idempotencyKey })}`,
    idempotencyKey,
    taskId: parsedRequest.task.id,
    request: parsedRequest,
    status: "queued",
    attemptCount: 0,
    maxAttempts: 5,
    nextRunAt: nowIso,
    createdAt: nowIso,
    updatedAt: nowIso
  });
}

export function resolveHermesTaskTransport(options: {
  transport?: HermesTaskTransport;
  taskUrl?: string;
  taskSecret?: string;
}): HermesTaskTransport | undefined {
  if (options.transport) return options.transport;
  const url =
    options.taskUrl ??
    process.env.LOOPGRAPH_HERMES_WEBHOOK_URL ??
    process.env.LOOPGRAPH_HERMES_TASK_URL;
  if (!url) return undefined;
  const secret =
    options.taskSecret ??
    process.env.LOOPGRAPH_HERMES_WEBHOOK_SECRET ??
    process.env.LOOPGRAPH_HERMES_TASK_SECRET;
  if (!secret) {
    throw new Error(
      "LOOPGRAPH_HERMES_WEBHOOK_SECRET is required when LOOPGRAPH_HERMES_WEBHOOK_URL is configured."
    );
  }
  return new HttpHermesTaskTransport({ url, secret });
}

function defaultCallbackUrl(taskId: string): string | undefined {
  const origin = process.env.LOOPGRAPH_PUBLIC_URL?.replace(/\/+$/, "");
  return origin ? `${origin}/api/hermes/design-tasks/${encodeURIComponent(taskId)}/callback` : undefined;
}

async function requireHermesDesignTask(
  store: HermesDesignStore,
  taskId: string
): Promise<HermesDesignTask> {
  const task = await store.getTask(taskId);
  if (!task) throw new Error(`Hermes design task not found: ${taskId}`);
  return task;
}

function designStoreFor(
  projectRoot: string,
  supplied?: HermesDesignStore
): HermesDesignStore {
  return supplied ?? new FileHermesDesignStore(getLoopgraphRoot(projectRoot));
}

function isTerminalDesignTaskStatus(status: HermesDesignTask["status"]): boolean {
  return ["completed", "cancelled"].includes(status);
}

async function readResponseJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return {};
  }
}

function readString(input: unknown, key: string): string | undefined {
  if (!input || typeof input !== "object") return undefined;
  const value = (input as Record<string, unknown>)[key];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}
