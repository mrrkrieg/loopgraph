import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  businessProblemSchema,
  contentHash,
  createProblemDedupeKey,
  createRouteJobId,
  eventReceiptSchema,
  evaluateRoutingEligibility,
  mapRoutingCardInputs,
  routeCommitSchema,
  routeJobSchema,
  routerEvaluationSchema,
  routingAttemptSchema,
  routingCorrectionSchema,
  routingDecisionSchema,
  validateRoutingDecisionForEvent,
  type BusinessProblem,
  type EventEnvelope,
  type EventReceipt,
  type RouteCommit,
  type RouteJob,
  type RouterEvaluation,
  type RoutingAttempt,
  type RoutingCard,
  type RoutingCorrection,
  type RoutingDecision,
  type RoutingEligibilityResult
} from "../core";
import { getLoopgraphRoot } from "./storage-resolver";

export type EventIngestResult = {
  receipt: EventReceipt;
  duplicate: boolean;
  eligibleRoutes: RoutingEligibilityResult[];
  openProblemCandidates: BusinessProblem[];
};

export type RoutingDecisionSubmissionResult = {
  attempt: RoutingAttempt;
  valid: boolean;
  validationErrors: string[];
  problem?: BusinessProblem;
  routeCommits: RouteCommit[];
  routeJobs: RouteJob[];
  humanChoiceAlternatives: RoutingDecision["alternatives"];
};

export type RouteJobListFilters = {
  eventId?: string;
  problemId?: string;
  routeCommitId?: string;
  loopId?: string;
  status?: RouteJob["status"];
};

export interface RoutingStore {
  saveEventReceipt(receipt: EventReceipt): Promise<void>;
  getEventReceipt(eventId: string): Promise<EventReceipt | null>;
  listEventReceipts(): Promise<EventReceipt[]>;
  saveBusinessProblem(problem: BusinessProblem): Promise<void>;
  getBusinessProblem(problemId: string): Promise<BusinessProblem | null>;
  listBusinessProblems(): Promise<BusinessProblem[]>;
  saveRoutingAttempt(attempt: RoutingAttempt): Promise<void>;
  listRoutingAttempts(eventId?: string): Promise<RoutingAttempt[]>;
  saveRouteCommit(commit: RouteCommit): Promise<void>;
  listRouteCommits(problemId?: string): Promise<RouteCommit[]>;
  saveRouteJob(job: RouteJob): Promise<void>;
  getRouteJob(jobId: string): Promise<RouteJob | null>;
  listRouteJobs(filters?: RouteJobListFilters): Promise<RouteJob[]>;
  saveRoutingCorrection(correction: RoutingCorrection): Promise<void>;
  listRoutingCorrections(eventId?: string): Promise<RoutingCorrection[]>;
  saveRouterEvaluation(evaluation: RouterEvaluation): Promise<void>;
  listRouterEvaluations(): Promise<RouterEvaluation[]>;
}

export class FileRoutingStore implements RoutingStore {
  constructor(private rootDir = getLoopgraphRoot()) {}

  async saveEventReceipt(receipt: EventReceipt): Promise<void> {
    const parsed = eventReceiptSchema.parse(receipt);
    await this.ensureDirs();
    await writeJson(this.recordPath("events", parsed.id), parsed);
  }

  async getEventReceipt(eventId: string): Promise<EventReceipt | null> {
    const receipts = await this.listEventReceipts();
    return receipts.find((receipt) => receipt.eventId === eventId && !["duplicate", "replayed"].includes(receipt.status)) ?? null;
  }

  async listEventReceipts(): Promise<EventReceipt[]> {
    return this.listRecords("events", eventReceiptSchema);
  }

  async saveBusinessProblem(problem: BusinessProblem): Promise<void> {
    const parsed = businessProblemSchema.parse(problem);
    await this.ensureDirs();
    await writeJson(this.recordPath("problems", parsed.id), parsed);
  }

  async getBusinessProblem(problemId: string): Promise<BusinessProblem | null> {
    return readJson(this.recordPath("problems", problemId), businessProblemSchema);
  }

  async listBusinessProblems(): Promise<BusinessProblem[]> {
    return this.listRecords("problems", businessProblemSchema);
  }

  async saveRoutingAttempt(attempt: RoutingAttempt): Promise<void> {
    const parsed = routingAttemptSchema.parse(attempt);
    await this.ensureDirs();
    await writeJson(this.recordPath("attempts", parsed.id), parsed);
  }

  async listRoutingAttempts(eventId?: string): Promise<RoutingAttempt[]> {
    const attempts = await this.listRecords("attempts", routingAttemptSchema);
    return eventId ? attempts.filter((attempt) => attempt.eventId === eventId) : attempts;
  }

  async saveRouteCommit(commit: RouteCommit): Promise<void> {
    const parsed = routeCommitSchema.parse(commit);
    await this.ensureDirs();
    await writeJson(this.recordPath("commits", parsed.id), parsed);
  }

  async listRouteCommits(problemId?: string): Promise<RouteCommit[]> {
    const commits = await this.listRecords("commits", routeCommitSchema);
    return problemId ? commits.filter((commit) => commit.problemId === problemId) : commits;
  }

  async saveRouteJob(job: RouteJob): Promise<void> {
    const parsed = routeJobSchema.parse(job);
    await this.ensureDirs();
    await writeJson(this.recordPath("jobs", parsed.id), parsed);
  }

  async getRouteJob(jobId: string): Promise<RouteJob | null> {
    return readJson(this.recordPath("jobs", jobId), routeJobSchema);
  }

  async listRouteJobs(filters: RouteJobListFilters = {}): Promise<RouteJob[]> {
    const jobs = await this.listRecords("jobs", routeJobSchema);
    return jobs
      .filter((job) => !filters.eventId || job.eventId === filters.eventId)
      .filter((job) => !filters.problemId || job.problemId === filters.problemId)
      .filter((job) => !filters.routeCommitId || job.routeCommitId === filters.routeCommitId)
      .filter((job) => !filters.loopId || job.loopId === filters.loopId)
      .filter((job) => !filters.status || job.status === filters.status);
  }

  async saveRoutingCorrection(correction: RoutingCorrection): Promise<void> {
    const parsed = routingCorrectionSchema.parse(correction);
    await this.ensureDirs();
    await writeJson(this.recordPath("corrections", parsed.id), parsed);
  }

  async listRoutingCorrections(eventId?: string): Promise<RoutingCorrection[]> {
    const corrections = await this.listRecords("corrections", routingCorrectionSchema);
    return eventId ? corrections.filter((correction) => correction.eventId === eventId) : corrections;
  }

  async saveRouterEvaluation(evaluation: RouterEvaluation): Promise<void> {
    const parsed = routerEvaluationSchema.parse(evaluation);
    await this.ensureDirs();
    await writeJson(this.recordPath("evaluations", parsed.id), parsed);
  }

  async listRouterEvaluations(): Promise<RouterEvaluation[]> {
    return this.listRecords("evaluations", routerEvaluationSchema);
  }

  private async ensureDirs(): Promise<void> {
    await Promise.all([
      mkdir(this.collectionPath("events"), { recursive: true }),
      mkdir(this.collectionPath("problems"), { recursive: true }),
      mkdir(this.collectionPath("attempts"), { recursive: true }),
      mkdir(this.collectionPath("commits"), { recursive: true }),
      mkdir(this.collectionPath("jobs"), { recursive: true }),
      mkdir(this.collectionPath("corrections"), { recursive: true }),
      mkdir(this.collectionPath("evaluations"), { recursive: true })
    ]);
  }

  private collectionPath(collection: string): string {
    return path.join(this.rootDir, "routing", collection);
  }

  private recordPath(collection: string, id: string): string {
    return path.join(this.collectionPath(collection), `${safeFileName(id)}.json`);
  }

  private async listRecords<T>(collection: string, schema: { parse(input: unknown): T }): Promise<T[]> {
    try {
      const dir = this.collectionPath(collection);
      const files = await readdir(dir);
      const records: T[] = [];
      for (const file of files.filter((item) => item.endsWith(".json"))) {
        const record = await readJson(path.join(dir, file), schema);
        if (record !== null) records.push(record);
      }
      return records;
    } catch {
      return [];
    }
  }
}

export async function ingestRoutingEvent(input: {
  store: RoutingStore;
  event: EventEnvelope;
  routingCards: RoutingCard[];
  replay?: boolean;
  now?: Date;
}): Promise<EventIngestResult> {
  const nowIso = (input.now ?? new Date()).toISOString();
  const existing = input.replay ? null : await input.store.getEventReceipt(input.event.id);

  if (existing) {
    const duplicateReceipt = eventReceiptSchema.parse({
      id: `receipt_duplicate_${contentHash({ eventId: input.event.id, at: nowIso })}`,
      eventId: input.event.id,
      event: input.event,
      eventHash: existing.eventHash,
      status: "duplicate",
      duplicateOfEventId: existing.eventId,
      firstSeenAt: nowIso,
      lastSeenAt: nowIso
    });
    await input.store.saveEventReceipt(duplicateReceipt);
    return {
      receipt: duplicateReceipt,
      duplicate: true,
      eligibleRoutes: [],
      openProblemCandidates: []
    };
  }

  const receipt = eventReceiptSchema.parse({
    id: input.replay
      ? `receipt_replay_${contentHash({ eventId: input.event.id, at: nowIso })}`
      : `receipt_${input.event.id}`,
    eventId: input.event.id,
    event: input.event,
    eventHash: contentHash(input.event),
    status: input.replay ? "replayed" : "received",
    firstSeenAt: nowIso,
    lastSeenAt: nowIso
  });

  await input.store.saveEventReceipt(receipt);

  const eligibleRoutes = input.routingCards
    .map((card) => evaluateRoutingEligibility(input.event, card))
    .filter((result) => result.eligible)
    .sort((a, b) => b.card.priority - a.card.priority || a.card.loopName.localeCompare(b.card.loopName));

  const openProblemCandidates = (await input.store.listBusinessProblems()).filter((problem) => {
    return (
      problem.workspaceId === input.event.workspaceId &&
      problem.companyId === input.event.companyId &&
      problem.subject.type === input.event.subject.type &&
      problem.subject.id === input.event.subject.id &&
      !["resolved", "closed"].includes(problem.status)
    );
  });

  return {
    receipt,
    duplicate: false,
    eligibleRoutes,
    openProblemCandidates
  };
}

export async function submitRoutingDecision(input: {
  store: RoutingStore;
  decision: RoutingDecision;
  routingCards: RoutingCard[];
  catalogVersion: string;
  now?: Date;
  hermesMetadata?: Record<string, unknown>;
}): Promise<RoutingDecisionSubmissionResult> {
  const nowIso = (input.now ?? new Date()).toISOString();
  const decision = routingDecisionSchema.parse(input.decision);
  const receipt = await input.store.getEventReceipt(decision.eventId);
  const baseAttempt = {
    id: `attempt_${contentHash({ eventId: decision.eventId, decision, at: nowIso })}`,
    eventId: decision.eventId,
    catalogVersion: decision.catalogVersion,
    action: decision.action,
    decision,
    hermesMetadata: input.hermesMetadata ?? {},
    createdAt: nowIso
  };

  if (!receipt) {
    const attempt = routingAttemptSchema.parse({
      ...baseAttempt,
      status: "rejected",
      validationErrors: ["Event receipt not found; events must be durably ingested before routing decisions"]
    });
    await input.store.saveRoutingAttempt(attempt);
    return {
      attempt,
      valid: false,
      validationErrors: attempt.validationErrors,
      routeCommits: [],
      routeJobs: [],
      humanChoiceAlternatives: []
    };
  }

  const validation = validateRoutingDecisionForEvent({
    event: receipt.event,
    decision,
    routingCards: input.routingCards,
    catalogVersion: input.catalogVersion
  });
  const additionalErrors = await collectSubmissionErrors(input.store, receipt.event, decision, validation.selectedCards);
  const validationErrors = [...validation.errors, ...additionalErrors];

  if (validationErrors.length > 0) {
    const attempt = routingAttemptSchema.parse({
      ...baseAttempt,
      status: "rejected",
      validationErrors
    });
    await input.store.saveRoutingAttempt(attempt);
    return {
      attempt,
      valid: false,
      validationErrors,
      routeCommits: [],
      routeJobs: [],
      humanChoiceAlternatives: decision.action === "request_human" ? decision.alternatives : []
    };
  }

  const attempt = routingAttemptSchema.parse({
    ...baseAttempt,
    status: decision.action === "ignore" ? "validated" : "committed",
    validationErrors: []
  });
  await input.store.saveRoutingAttempt(attempt);

  if (decision.action === "ignore") {
    return {
      attempt,
      valid: true,
      validationErrors: [],
      routeCommits: [],
      routeJobs: [],
      humanChoiceAlternatives: []
    };
  }

  const problem = await upsertProblemForDecision({
    store: input.store,
    event: receipt.event,
    decision,
    selectedCards: validation.selectedCards,
    nowIso
  });

  if (decision.action === "append_evidence" || decision.action === "request_human" || decision.action === "unhandled" || decision.action === "defer") {
    return {
      attempt,
      valid: true,
      validationErrors: [],
      problem,
      routeCommits: [],
      routeJobs: [],
      humanChoiceAlternatives: decision.action === "request_human" ? decision.alternatives : []
    };
  }

  const existingCommits = await input.store.listRouteCommits(problem.id);
  const routeCommits: RouteCommit[] = [];
  const routeJobs: RouteJob[] = [];

  for (const card of validation.selectedCards) {
    const commitId = `route_${contentHash({
      eventId: receipt.event.id,
      problemId: problem.id,
      loopId: card.loopId,
      loopSpecHash: card.loopSpecHash
    })}`;
    const existingCommit = existingCommits.find((commit) => commit.id === commitId);
    const commitStatus = card.activationMode === "shadow" || card.activationMode === "recommend" ? "shadow" : "queued";
    const commit = routeCommitSchema.parse({
      id: commitId,
      eventId: receipt.event.id,
      problemId: problem.id,
      loopId: card.loopId,
      loopSpecHash: card.loopSpecHash,
      routeAttemptId: attempt.id,
      runId: commitStatus === "queued" ? `run_${contentHash({ commitId })}` : undefined,
      status: existingCommit?.status ?? commitStatus,
      inputMapping: mapRoutingCardInputs(receipt.event, card),
      committedAt: existingCommit?.committedAt ?? nowIso
    });

    await input.store.saveRouteCommit(commit);
    routeCommits.push(commit);
    if (commit.status === "queued") {
      routeJobs.push(await upsertRouteJobForCommit({
        store: input.store,
        event: receipt.event,
        commit,
        activationMode: card.activationMode,
        nowIso
      }));
    }
  }

  const routeCommitIds = new Set([...problem.routeCommitIds, ...routeCommits.map((commit) => commit.id)]);
  const primaryRoute = decision.selectedRoutes.find((route) => route.role === "primary") ?? decision.selectedRoutes[0];
  const supportingLoopIds = decision.selectedRoutes
    .filter((route) => route.role === "supporting")
    .map((route) => route.loopId);
  const updatedProblem = businessProblemSchema.parse({
    ...problem,
    status: "routed",
    primaryLoopId: problem.primaryLoopId ?? primaryRoute?.loopId,
    supportingLoopIds: [...new Set([...problem.supportingLoopIds, ...supportingLoopIds])],
    routeCommitIds: [...routeCommitIds],
    updatedAt: nowIso
  });
  await input.store.saveBusinessProblem(updatedProblem);

  return {
    attempt,
    valid: true,
    validationErrors: [],
    problem: updatedProblem,
    routeCommits,
    routeJobs,
    humanChoiceAlternatives: []
  };
}

export async function claimDueRouteJobs(input: {
  store: RoutingStore;
  claimedBy: string;
  now?: Date;
  leaseSeconds?: number;
  limit?: number;
}): Promise<RouteJob[]> {
  const now = input.now ?? new Date();
  const nowIso = now.toISOString();
  const leaseSeconds = input.leaseSeconds ?? 300;
  const leaseExpiresAt = new Date(now.getTime() + leaseSeconds * 1000).toISOString();
  const limit = input.limit ?? 10;
  const candidates = (await input.store.listRouteJobs())
    .filter((job) => ["queued", "failed"].includes(job.status))
    .filter((job) => Date.parse(job.nextRunAt) <= now.getTime())
    .filter((job) => !job.lease || Date.parse(job.lease.expiresAt) <= now.getTime())
    .filter((job) => job.attemptCount < job.maxAttempts)
    .sort((left, right) => left.nextRunAt.localeCompare(right.nextRunAt) || left.createdAt.localeCompare(right.createdAt))
    .slice(0, limit);
  const claimed: RouteJob[] = [];

  for (const job of candidates) {
    const updated = routeJobSchema.parse({
      ...job,
      status: "claimed",
      attemptCount: job.attemptCount + 1,
      lease: {
        claimedBy: input.claimedBy,
        claimedAt: nowIso,
        expiresAt: leaseExpiresAt
      },
      updatedAt: nowIso
    });
    await input.store.saveRouteJob(updated);
    claimed.push(updated);
  }

  return claimed;
}

export async function markRouteJobRunning(input: {
  store: RoutingStore;
  jobId: string;
  now?: Date;
}): Promise<RouteJob> {
  return updateRouteJobStatus({
    store: input.store,
    jobId: input.jobId,
    status: "running",
    now: input.now
  });
}

export async function markRouteJobWaitingReview(input: {
  store: RoutingStore;
  jobId: string;
  now?: Date;
}): Promise<RouteJob> {
  return updateRouteJobStatus({
    store: input.store,
    jobId: input.jobId,
    status: "waiting_review",
    now: input.now,
    clearLease: true
  });
}

export async function markRouteJobCompleted(input: {
  store: RoutingStore;
  jobId: string;
  now?: Date;
}): Promise<RouteJob> {
  return updateRouteJobStatus({
    store: input.store,
    jobId: input.jobId,
    status: "completed",
    now: input.now,
    clearLease: true
  });
}

export async function failRouteJob(input: {
  store: RoutingStore;
  jobId: string;
  error: { code?: string; message: string };
  now?: Date;
}): Promise<RouteJob> {
  const job = await input.store.getRouteJob(input.jobId);
  if (!job) throw new Error(`Route job not found: ${input.jobId}`);
  const now = input.now ?? new Date();
  const nowIso = now.toISOString();
  const hasRetriesRemaining = job.attemptCount < job.maxAttempts;
  const status: RouteJob["status"] = hasRetriesRemaining ? "failed" : "dead_letter";
  const retryDelaySeconds = routeJobRetryDelaySeconds(job);
  const updated = routeJobSchema.parse({
    ...job,
    status,
    lease: undefined,
    nextRunAt: hasRetriesRemaining
      ? new Date(now.getTime() + retryDelaySeconds * 1000).toISOString()
      : job.nextRunAt,
    lastError: {
      ...input.error,
      at: nowIso
    },
    deadLetterReason: hasRetriesRemaining ? undefined : input.error.message,
    updatedAt: nowIso
  });
  await input.store.saveRouteJob(updated);
  return updated;
}

export async function updateRouteJobStatus(input: {
  store: RoutingStore;
  jobId: string;
  status: RouteJob["status"];
  now?: Date;
  clearLease?: boolean;
}): Promise<RouteJob> {
  const job = await input.store.getRouteJob(input.jobId);
  if (!job) throw new Error(`Route job not found: ${input.jobId}`);
  const updated = routeJobSchema.parse({
    ...job,
    status: input.status,
    ...(input.clearLease ? { lease: undefined } : {}),
    updatedAt: (input.now ?? new Date()).toISOString()
  });
  await input.store.saveRouteJob(updated);
  return updated;
}

async function upsertRouteJobForCommit(input: {
  store: RoutingStore;
  event: EventEnvelope;
  commit: RouteCommit;
  activationMode: RoutingCard["activationMode"];
  nowIso: string;
}): Promise<RouteJob> {
  const jobId = createRouteJobId({
    eventId: input.commit.eventId,
    loopId: input.commit.loopId,
    loopSpecHash: input.commit.loopSpecHash
  });
  const existing = await input.store.getRouteJob(jobId);
  if (existing) return existing;

  const job = routeJobSchema.parse({
    schemaVersion: "route-job/v1alpha1",
    id: jobId,
    idempotencyKey: contentHash({
      eventId: input.commit.eventId,
      loopId: input.commit.loopId,
      loopSpecHash: input.commit.loopSpecHash
    }),
    eventId: input.commit.eventId,
    problemId: input.commit.problemId,
    routeCommitId: input.commit.id,
    routeAttemptId: input.commit.routeAttemptId,
    loopId: input.commit.loopId,
    loopSpecHash: input.commit.loopSpecHash,
    runId: input.commit.runId ?? `run_${contentHash({ commitId: input.commit.id })}`,
    activationMode: input.activationMode,
    status: "queued",
    correlationId: input.event.correlationId,
    attemptCount: 0,
    maxAttempts: 3,
    retryPolicy: {
      baseDelaySeconds: 30,
      maxDelaySeconds: 3600,
      backoffMultiplier: 2
    },
    nextRunAt: input.nowIso,
    createdAt: input.nowIso,
    updatedAt: input.nowIso
  });

  await input.store.saveRouteJob(job);
  return job;
}

function routeJobRetryDelaySeconds(job: RouteJob): number {
  const multiplier = Math.max(1, job.retryPolicy.backoffMultiplier);
  const exponent = Math.max(0, job.attemptCount - 1);
  const delay = Math.round(job.retryPolicy.baseDelaySeconds * multiplier ** exponent);
  return Math.min(job.retryPolicy.maxDelaySeconds, delay);
}

function safeFileName(id: string): string {
  return encodeURIComponent(id);
}

async function writeJson(filePath: string, value: unknown): Promise<void> {
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

async function readJson<T>(filePath: string, schema: { parse(input: unknown): T }): Promise<T | null> {
  try {
    const raw = await readFile(filePath, "utf8");
    return schema.parse(JSON.parse(raw));
  } catch {
    return null;
  }
}

async function collectSubmissionErrors(
  store: RoutingStore,
  event: EventEnvelope,
  decision: RoutingDecision,
  selectedCards: RoutingCard[]
): Promise<string[]> {
  const errors: string[] = [];

  if (["route", "request_human", "unhandled", "defer"].includes(decision.action) && !decision.problem) {
    errors.push(`${decision.action} action requires a business problem proposal`);
  }

  if (decision.action === "append_evidence") {
    if (!decision.existingProblemId) errors.push("append_evidence action requires existingProblemId");
    if (decision.selectedRoutes.length > 0) errors.push("append_evidence action must not create selected routes");
  }

  if (decision.existingProblemId) {
    const existing = await store.getBusinessProblem(decision.existingProblemId);
    if (!existing) {
      errors.push(`Existing problem "${decision.existingProblemId}" was not found`);
    } else if (existing.workspaceId !== event.workspaceId || existing.companyId !== event.companyId) {
      errors.push(`Existing problem "${decision.existingProblemId}" does not belong to this event workspace`);
    } else if (existing.subject.type !== event.subject.type || existing.subject.id !== event.subject.id) {
      errors.push(`Existing problem "${decision.existingProblemId}" does not match this event subject`);
    }
  }

  if (decision.action === "route" && decision.problem) {
    const proposedTypes = new Set(decision.problem.problemTypes);
    for (const card of selectedCards) {
      const hasProblemTypeMatch = card.problemTypes.some((problemType) => proposedTypes.has(problemType));
      if (decision.problem.problemTypes.length > 0 && !hasProblemTypeMatch) {
        errors.push(`Selected loop "${card.loopId}" does not solve the proposed problem type`);
      }
    }

    const proposedDedupeKey = canonicalProblemDedupeKey(event, decision, selectedCards);
    const existingOpenProblem = (await store.listBusinessProblems()).find((problem) => {
      return (
        problem.dedupeKey === proposedDedupeKey &&
        !["resolved", "closed"].includes(problem.status) &&
        problem.routeCommitIds.length > 0 &&
        !problem.evidenceEventIds.includes(event.id)
      );
    });

    if (existingOpenProblem) {
      errors.push(`Matching open problem "${existingOpenProblem.id}" already has committed work; append evidence instead`);
    }
  }

  return errors;
}

async function upsertProblemForDecision(input: {
  store: RoutingStore;
  event: EventEnvelope;
  decision: RoutingDecision;
  selectedCards: RoutingCard[];
  nowIso: string;
}): Promise<BusinessProblem> {
  if (input.decision.action === "append_evidence" && input.decision.existingProblemId) {
    const existing = await input.store.getBusinessProblem(input.decision.existingProblemId);
    if (!existing) throw new Error(`Existing problem "${input.decision.existingProblemId}" was not found`);
    const updated = businessProblemSchema.parse({
      ...existing,
      evidenceEventIds: [...new Set([...existing.evidenceEventIds, input.event.id])],
      updatedAt: input.nowIso
    });
    await input.store.saveBusinessProblem(updated);
    return updated;
  }

  const problemInput = input.decision.problem;
  if (!problemInput) throw new Error(`${input.decision.action} action requires a business problem proposal`);

  const dedupeKey = canonicalProblemDedupeKey(input.event, input.decision, input.selectedCards);
  const existingById = input.decision.existingProblemId
    ? await input.store.getBusinessProblem(input.decision.existingProblemId)
    : null;
  const existingByKey = (await input.store.listBusinessProblems()).find((problem) => problem.dedupeKey === dedupeKey);
  const existing = existingById ?? existingByKey;
  const problemType = canonicalProblemType(input.decision, input.selectedCards);
  const status = statusForDecisionAction(input.decision.action);
  const problem = businessProblemSchema.parse({
    id: existing?.id ?? dedupeKey,
    workspaceId: input.event.workspaceId,
    companyId: input.event.companyId,
    problemType,
    subject: problemInput.subject,
    summary: problemInput.summary,
    severity: problemInput.severity,
    status,
    correlationId: existing?.correlationId ?? input.event.correlationId,
    dedupeKey,
    evidenceEventIds: [...new Set([...(existing?.evidenceEventIds ?? []), input.event.id])],
    primaryLoopId: existing?.primaryLoopId,
    supportingLoopIds: existing?.supportingLoopIds ?? [],
    routeCommitIds: existing?.routeCommitIds ?? [],
    owner: existing?.owner,
    slaDueAt: existing?.slaDueAt,
    outcomeRefs: existing?.outcomeRefs ?? [],
    openedAt: existing?.openedAt ?? input.nowIso,
    updatedAt: input.nowIso,
    resolvedAt: existing?.resolvedAt
  });

  await input.store.saveBusinessProblem(problem);
  return problem;
}

function canonicalProblemType(decision: RoutingDecision, selectedCards: RoutingCard[]): string {
  const proposedTypes = new Set(decision.problem?.problemTypes ?? []);
  const selectedCardType = selectedCards
    .flatMap((card) => card.problemTypes)
    .find((problemType) => proposedTypes.size === 0 || proposedTypes.has(problemType));
  return selectedCardType ?? decision.problem?.problemTypes[0] ?? "unhandled_business_problem";
}

function canonicalProblemDedupeKey(event: EventEnvelope, decision: RoutingDecision, selectedCards: RoutingCard[]): string {
  const problemType = canonicalProblemType(decision, selectedCards);
  const subject = decision.problem?.subject ?? event.subject;
  const dedupeInputs = decision.problem?.dedupeKeyInputs ?? [];
  return createProblemDedupeKey({
    workspaceId: event.workspaceId,
    problemType,
    subjectType: subject.type,
    subjectId: subject.id,
    repeatWindow: dedupeInputs.length > 0 ? contentHash(dedupeInputs) : undefined
  });
}

function statusForDecisionAction(action: RoutingDecision["action"]): BusinessProblem["status"] {
  if (action === "request_human") return "needs_human";
  if (action === "unhandled") return "unhandled";
  if (action === "defer") return "waiting";
  if (action === "route") return "routed";
  return "detected";
}
