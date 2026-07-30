import { createHmac, timingSafeEqual } from "node:crypto";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  HERMES_DESIGN_TASK_SCHEMA_VERSION,
  contentHash,
  hermesDesignCallbackSchema,
  hermesDesignTaskSchema,
  normalizeDepartmentType,
  type EvidenceGap,
  type HermesDesignCallback,
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
import { getLoopgraphRoot } from "./storage-resolver";

export const HERMES_DESIGN_REQUEST_SCHEMA_VERSION = "hermes-design-request/v1alpha1" as const;

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

export type HermesDesignRequest = {
  schemaVersion: typeof HERMES_DESIGN_REQUEST_SCHEMA_VERSION;
  event_type: "loopgraph.design_requested";
  task: HermesDesignTask;
  context?: LoopDesignContext;
  gaps: EvidenceGap[];
  nextQuestions: Awaited<ReturnType<typeof getNextEvidenceGapQuestions>>["questions"];
  callback?: {
    url: string;
    signatureHeader: "x-hermes-signature";
    timestampHeader: "x-hermes-timestamp";
  };
  allowedLoopgraphTools: [
    "loopgraph_evidence_gaps_get",
    "loopgraph_evidence_gap_answer",
    "loopgraph_design_context_get",
    "loopgraph_design_submit"
  ];
  instructions: string[];
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
  } = {}
): Promise<HermesDesignDispatchResult> {
  const projectRoot = path.resolve(input.projectRoot ?? process.cwd());
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
  const existing = await findTaskByIdempotencyKey(projectRoot, idempotencyKey);
  if (existing && !["failed", "cancelled"].includes(existing.status)) {
    return {
      task: existing,
      request: buildHermesDesignRequest({
        task: existing,
        context,
        gaps: gapSet.gaps,
        nextQuestions: nextQuestions.questions,
        callbackUrl: input.callbackUrl ?? defaultCallbackUrl(existing.id)
      })
    };
  }

  let task = hermesDesignTaskSchema.parse({
    schemaVersion: HERMES_DESIGN_TASK_SCHEMA_VERSION,
    id: `hermes_task_${contentHash({ idempotencyKey, at: nowIso })}`,
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
  await saveHermesDesignTask(projectRoot, task);

  const request = buildHermesDesignRequest({
    task,
    context,
    gaps: gapSet.gaps,
    nextQuestions: nextQuestions.questions,
    callbackUrl: input.callbackUrl ?? defaultCallbackUrl(task.id)
  });
  const transport = options.transport ?? transportFromEnvironment(options);
  if (!transport) {
    task = hermesDesignTaskSchema.parse({
      ...task,
      delivery: {
        status: "not_configured",
        attemptCount: 0,
        error: "No Hermes task endpoint is configured. Hermes can claim the durable task through the Loopgraph MCP tools."
      },
      updatedAt: nowIso
    });
    await saveHermesDesignTask(projectRoot, task);
    return { task, request };
  }

  const result = await transport.dispatch(request);
  task = hermesDesignTaskSchema.parse({
    ...task,
    status: result.sent && task.status === "queued" ? "awaiting_hermes" : task.status,
    hermesTaskId: result.hermesTaskId ?? task.hermesTaskId,
    delivery: {
      status: result.sent ? "sent" : "failed",
      destination: result.destination,
      attemptCount: task.delivery.attemptCount + 1,
      lastAttemptAt: nowIso,
      responseStatus: result.responseStatus,
      error: result.error
    },
    updatedAt: nowIso
  });
  await saveHermesDesignTask(projectRoot, task);
  return { task, request };
}

export async function processHermesDesignCallback(input: {
  projectRoot?: string;
  callback: unknown;
  now?: Date;
}): Promise<{
  task: HermesDesignTask;
  duplicate: boolean;
  designRunId?: string;
  validationErrors: string[];
}> {
  const projectRoot = path.resolve(input.projectRoot ?? process.cwd());
  const callback = hermesDesignCallbackSchema.parse(input.callback);
  let task = await requireHermesDesignTask(projectRoot, callback.taskId);
  if (task.callbackIds.includes(callback.callbackId)) {
    return {
      task,
      duplicate: true,
      designRunId: task.designRunIds.at(-1),
      validationErrors: task.compilerErrors
    };
  }
  if (callback.hermesTaskId && task.hermesTaskId && callback.hermesTaskId !== task.hermesTaskId) {
    throw new Error(`Hermes task identity mismatch for ${task.id}.`);
  }

  const nowIso = (input.now ?? new Date()).toISOString();
  let designRunId: string | undefined;
  let validationErrors: string[] = [];
  if (callback.type === "task.acknowledged") {
    task = hermesDesignTaskSchema.parse({
      ...task,
      status: task.status === "needs_input" ? "needs_input" : "designing",
      hermesTaskId: callback.hermesTaskId ?? task.hermesTaskId,
      delivery: {
        ...task.delivery,
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
    task = hermesDesignTaskSchema.parse({
      ...task,
      status: "needs_input",
      blockingGapIds: gapSet.gaps.filter((gap) => gap.blocking && ["open", "asked"].includes(gap.status)).map((gap) => gap.id),
      nextQuestionGapIds: nextQuestions.questions.map((question) => question.gapId)
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
      task = hermesDesignTaskSchema.parse({
        ...task,
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
        now: input.now
      });
      designRunId = result.designRun.id;
      validationErrors = result.errors;
      task = hermesDesignTaskSchema.parse({
        ...task,
        status: result.valid ? "completed" : "needs_repair",
        designRunIds: Array.from(new Set([...task.designRunIds, result.designRun.id])),
        compilerErrors: result.errors,
        ...(result.valid ? { completedAt: nowIso } : {})
      });
    }
  } else if (callback.type === "task.failed") {
    task = hermesDesignTaskSchema.parse({
      ...task,
      status: "failed",
      compilerErrors: [callback.error]
    });
    validationErrors = [callback.error];
  }

  task = hermesDesignTaskSchema.parse({
    ...task,
    hermesTaskId: callback.hermesTaskId ?? task.hermesTaskId,
    callbackIds: [...task.callbackIds, callback.callbackId],
    updatedAt: nowIso
  });
  await saveHermesDesignTask(projectRoot, task);
  await saveHermesDesignCallback(projectRoot, callback);
  return {
    task,
    duplicate: false,
    ...(designRunId ? { designRunId } : {}),
    validationErrors
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
} = {}): Promise<HermesDesignDispatchResult[]> {
  const projectRoot = path.resolve(input.projectRoot ?? process.cwd());
  const tasks = (await listHermesDesignTasks(projectRoot, { sessionId: input.sessionId }))
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
  projectRoot = process.cwd()
): Promise<HermesDesignTask | undefined> {
  try {
    const raw = await readFile(hermesDesignTaskPath(path.resolve(projectRoot), taskId), "utf8");
    return hermesDesignTaskSchema.parse(JSON.parse(raw));
  } catch {
    return undefined;
  }
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
  }
): Promise<HermesDesignDispatchResult> {
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
  const nowIso = (input.now ?? new Date()).toISOString();
  let task = hermesDesignTaskSchema.parse({
    ...input.task,
    status: blocking.length > 0 ? "needs_input" : "queued",
    contextHash: context?.contextHash ?? input.task.contextHash,
    blockingGapIds: blocking.map((gap) => gap.id),
    nextQuestionGapIds: nextQuestions.questions.map((question) => question.gapId),
    compilerErrors: blocking.length > 0 ? input.task.compilerErrors : [],
    delivery: {
      ...input.task.delivery,
      status: "pending",
      error: undefined
    },
    updatedAt: nowIso
  });
  await saveHermesDesignTask(input.projectRoot, task);
  const request = buildHermesDesignRequest({
    task,
    context,
    gaps: gapSet.gaps,
    nextQuestions: nextQuestions.questions,
    callbackUrl: defaultCallbackUrl(task.id)
  });
  const transport = options.transport ?? transportFromEnvironment(options);
  if (!transport) {
    task = hermesDesignTaskSchema.parse({
      ...task,
      delivery: {
        status: "not_configured",
        attemptCount: task.delivery.attemptCount,
        error: "No Hermes task endpoint is configured. Hermes can claim the durable task through the Loopgraph MCP tools."
      },
      updatedAt: nowIso
    });
    await saveHermesDesignTask(input.projectRoot, task);
    return { task, request };
  }
  const delivery = await transport.dispatch(request);
  task = hermesDesignTaskSchema.parse({
    ...task,
    status: delivery.sent && task.status === "queued" ? "awaiting_hermes" : task.status,
    hermesTaskId: delivery.hermesTaskId ?? task.hermesTaskId,
    delivery: {
      status: delivery.sent ? "sent" : "failed",
      destination: delivery.destination,
      attemptCount: task.delivery.attemptCount + 1,
      lastAttemptAt: nowIso,
      responseStatus: delivery.responseStatus,
      error: delivery.error
    },
    updatedAt: nowIso
  });
  await saveHermesDesignTask(input.projectRoot, task);
  return { task, request };
}

export async function listHermesDesignTasks(
  projectRoot = process.cwd(),
  filters: {
    sessionId?: string;
    status?: HermesDesignTask["status"];
  } = {}
): Promise<HermesDesignTask[]> {
  try {
    const root = hermesDesignTasksRoot(path.resolve(projectRoot));
    const files = await readdir(root);
    const tasks = await Promise.all(files
      .filter((file) => file.endsWith(".json"))
      .map(async (file) => {
        try {
          return hermesDesignTaskSchema.parse(JSON.parse(await readFile(path.join(root, file), "utf8")));
        } catch {
          return undefined;
        }
      }));
    return tasks
      .filter((task): task is HermesDesignTask => Boolean(task))
      .filter((task) => !filters.sessionId || task.sessionId === filters.sessionId)
      .filter((task) => !filters.status || task.status === filters.status)
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
  } catch {
    return [];
  }
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

function buildHermesDesignRequest(input: {
  task: HermesDesignTask;
  context?: LoopDesignContext;
  gaps: EvidenceGap[];
  nextQuestions: HermesDesignRequest["nextQuestions"];
  callbackUrl?: string;
}): HermesDesignRequest {
  return {
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
          "Use only the bounded design context and registered Loopgraph schemas.",
          "Return a LoopDesignProposalSet through the signed callback or loopgraph_design_submit.",
          "Do not materialize specs, connect providers, or perform business actions."
        ]
  };
}

function transportFromEnvironment(options: {
  taskUrl?: string;
  taskSecret?: string;
}): HermesTaskTransport | undefined {
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

async function saveHermesDesignTask(projectRoot: string, task: HermesDesignTask): Promise<void> {
  const filePath = hermesDesignTaskPath(projectRoot, task.id);
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(task, null, 2)}\n`);
}

async function saveHermesDesignCallback(projectRoot: string, callback: HermesDesignCallback): Promise<void> {
  const filePath = path.join(
    getLoopgraphRoot(projectRoot),
    "hermes",
    "design-callbacks",
    `${encodeURIComponent(callback.callbackId)}.json`
  );
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(callback, null, 2)}\n`);
}

async function requireHermesDesignTask(projectRoot: string, taskId: string): Promise<HermesDesignTask> {
  const task = await getHermesDesignTask(taskId, projectRoot);
  if (!task) throw new Error(`Hermes design task not found: ${taskId}`);
  return task;
}

async function findTaskByIdempotencyKey(
  projectRoot: string,
  idempotencyKey: string
): Promise<HermesDesignTask | undefined> {
  return (await listHermesDesignTasks(projectRoot)).find((task) => task.idempotencyKey === idempotencyKey);
}

function hermesDesignTasksRoot(projectRoot: string): string {
  return path.join(getLoopgraphRoot(projectRoot), "hermes", "design-tasks");
}

function hermesDesignTaskPath(projectRoot: string, taskId: string): string {
  return path.join(hermesDesignTasksRoot(projectRoot), `${encodeURIComponent(taskId)}.json`);
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
