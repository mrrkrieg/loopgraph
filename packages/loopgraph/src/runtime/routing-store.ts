import { mkdir, open, readFile, readdir, rename, stat, unlink, writeFile } from "node:fs/promises";
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
  type RoutingEligibilityResult,
  type RoutingLearningContextBinding
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

export const STALE_ROUTING_LEARNING_CONTEXT_ERROR =
  "Hermes learning-context digest is stale; re-ingest the event before routing" as const;

export type RouteJobListFilters = {
  eventId?: string;
  problemId?: string;
  routeCommitId?: string;
  loopId?: string;
  status?: RouteJob["status"];
};

export type RouteJobClaimInput = {
  claimedBy: string;
  now: Date;
  leaseSeconds: number;
  limit: number;
};

export type RouteJobAtomicUpdateInput = {
  jobId: string;
  expectedLeaseToken?: string;
  update: (job: RouteJob) => RouteJob;
};

export type AtomicEventReceiptResult = {
  receipt: EventReceipt;
  created: boolean;
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
  createEventReceiptAtomically?(
    receipt: EventReceipt
  ): Promise<AtomicEventReceiptResult>;
  /**
   * Durable stores should implement these operations with a database
   * transaction. The runtime falls back to the basic CRUD contract only for
   * compatibility with older, single-process adapters.
   */
  claimDueRouteJobsAtomically?(input: RouteJobClaimInput): Promise<RouteJob[]>;
  claimWaitingReviewRouteJobsAtomically?(input: RouteJobClaimInput): Promise<RouteJob[]>;
  updateRouteJobAtomically?(input: RouteJobAtomicUpdateInput): Promise<RouteJob>;
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

  async claimDueRouteJobsAtomically(input: RouteJobClaimInput): Promise<RouteJob[]> {
    return this.withRouteJobsLock(async () => {
      const jobs = await this.listRouteJobs();
      return claimRouteJobCandidates({
        jobs,
        claimedBy: input.claimedBy,
        now: input.now,
        leaseSeconds: input.leaseSeconds,
        limit: input.limit,
        save: (job) => this.saveRouteJob(job)
      });
    });
  }

  async claimWaitingReviewRouteJobsAtomically(input: RouteJobClaimInput): Promise<RouteJob[]> {
    return this.withRouteJobsLock(async () => {
      const jobs = await this.listRouteJobs({ status: "waiting_review" });
      return claimWaitingReviewCandidates({
        jobs,
        claimedBy: input.claimedBy,
        now: input.now,
        leaseSeconds: input.leaseSeconds,
        limit: input.limit,
        save: (job) => this.saveRouteJob(job)
      });
    });
  }

  async updateRouteJobAtomically(input: RouteJobAtomicUpdateInput): Promise<RouteJob> {
    return this.withRouteJobsLock(async () => {
      const job = await this.getRouteJob(input.jobId);
      if (!job) throw new Error(`Route job not found: ${input.jobId}`);
      if (input.expectedLeaseToken && job.lease?.leaseToken !== input.expectedLeaseToken) {
        throw new Error(`Route job lease lost: ${input.jobId}`);
      }
      const updated = routeJobSchema.parse(input.update(job));
      await this.saveRouteJob(updated);
      return updated;
    });
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

  private async withRouteJobsLock<T>(operation: () => Promise<T>): Promise<T> {
    await this.ensureDirs();
    const lockPath = path.join(this.collectionPath("jobs"), ".queue.lock");
    const startedAt = Date.now();
    let handle: Awaited<ReturnType<typeof open>> | undefined;

    while (!handle) {
      try {
        handle = await open(lockPath, "wx");
        await handle.writeFile(JSON.stringify({ pid: process.pid, acquiredAt: new Date().toISOString() }));
      } catch (error) {
        if (!isFileExistsError(error)) throw error;
        if (await isStaleLock(lockPath, 30_000)) {
          await unlink(lockPath).catch(() => undefined);
          continue;
        }
        if (Date.now() - startedAt >= 5_000) {
          throw new Error("Timed out waiting for the route-job queue lock");
        }
        await wait(10);
      }
    }

    try {
      return await operation();
    } finally {
      await handle.close();
      await unlink(lockPath).catch(() => undefined);
    }
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
  const atomicReceipt = !input.replay && input.store.createEventReceiptAtomically
    ? await input.store.createEventReceiptAtomically(receipt)
    : undefined;
  const existing = input.replay
    ? null
    : atomicReceipt
      ? atomicReceipt.created ? null : atomicReceipt.receipt
      : await input.store.getEventReceipt(input.event.id);

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

  if (!atomicReceipt?.created) await input.store.saveEventReceipt(receipt);

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
  learningContextBinding?: RoutingLearningContextBinding;
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
    ...(input.learningContextBinding ? { learningContextBinding: input.learningContextBinding } : {}),
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
  const validationErrors = [
    ...validation.errors,
    ...additionalErrors,
    ...(input.learningContextBinding?.acknowledgedDigest && !input.learningContextBinding.acknowledged
      ? [STALE_ROUTING_LEARNING_CONTEXT_ERROR]
      : [])
  ];

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
    routeJobs.push(await upsertRouteJobForCommit({
      store: input.store,
      event: receipt.event,
      commit,
      activationMode: card.activationMode,
      requiredCapabilities: card.requiredConnections,
      nowIso
    }));
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
  const leaseSeconds = input.leaseSeconds ?? 300;
  const limit = input.limit ?? 10;
  if (input.store.claimDueRouteJobsAtomically) {
    return input.store.claimDueRouteJobsAtomically({
      claimedBy: input.claimedBy,
      now,
      leaseSeconds,
      limit
    });
  }
  return claimRouteJobCandidates({
    jobs: await input.store.listRouteJobs(),
    claimedBy: input.claimedBy,
    now,
    leaseSeconds,
    limit,
    save: (job) => input.store.saveRouteJob(job)
  });
}

export async function claimWaitingReviewRouteJobs(input: {
  store: RoutingStore;
  claimedBy: string;
  now?: Date;
  leaseSeconds?: number;
  limit?: number;
}): Promise<RouteJob[]> {
  const now = input.now ?? new Date();
  const leaseSeconds = input.leaseSeconds ?? 300;
  const limit = input.limit ?? 10;
  if (input.store.claimWaitingReviewRouteJobsAtomically) {
    return input.store.claimWaitingReviewRouteJobsAtomically({
      claimedBy: input.claimedBy,
      now,
      leaseSeconds,
      limit
    });
  }
  return claimWaitingReviewCandidates({
    jobs: await input.store.listRouteJobs({ status: "waiting_review" }),
    claimedBy: input.claimedBy,
    now,
    leaseSeconds,
    limit,
    save: (job) => input.store.saveRouteJob(job)
  });
}

export async function markRouteJobRunning(input: {
  store: RoutingStore;
  jobId: string;
  now?: Date;
  leaseToken?: string;
  runId?: string;
}): Promise<RouteJob> {
  return updateRouteJobStatus({
    store: input.store,
    jobId: input.jobId,
    status: "running",
    now: input.now,
    leaseToken: input.leaseToken
  });
}

export async function markRouteJobWaitingReview(input: {
  store: RoutingStore;
  jobId: string;
  now?: Date;
  leaseToken?: string;
  runId?: string;
}): Promise<RouteJob> {
  return updateRouteJobStatus({
    store: input.store,
    jobId: input.jobId,
    status: "waiting_review",
    now: input.now,
    leaseToken: input.leaseToken,
    runId: input.runId,
    clearLease: true
  });
}

export async function markRouteJobCompleted(input: {
  store: RoutingStore;
  jobId: string;
  now?: Date;
  leaseToken?: string;
  result?: RouteJob["result"];
  runId?: string;
}): Promise<RouteJob> {
  return updateRouteJobStatus({
    store: input.store,
    jobId: input.jobId,
    status: "completed",
    now: input.now,
    leaseToken: input.leaseToken,
    result: input.result,
    runId: input.runId,
    clearLease: true
  });
}

export async function failRouteJob(input: {
  store: RoutingStore;
  jobId: string;
  error: { code?: string; message: string };
  now?: Date;
  leaseToken?: string;
}): Promise<RouteJob> {
  const now = input.now ?? new Date();
  const nowIso = now.toISOString();
  return mutateRouteJob({
    store: input.store,
    jobId: input.jobId,
    expectedLeaseToken: input.leaseToken,
    update: (job) => {
      const hasRetriesRemaining = job.attemptCount < job.maxAttempts;
      const status: RouteJob["status"] = hasRetriesRemaining ? "failed" : "dead_letter";
      const retryDelaySeconds = routeJobRetryDelaySeconds(job);
      return routeJobSchema.parse({
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
    }
  });
}

export async function updateRouteJobStatus(input: {
  store: RoutingStore;
  jobId: string;
  status: RouteJob["status"];
  now?: Date;
  clearLease?: boolean;
  leaseToken?: string;
  result?: RouteJob["result"];
  runId?: string;
}): Promise<RouteJob> {
  return mutateRouteJob({
    store: input.store,
    jobId: input.jobId,
    expectedLeaseToken: input.leaseToken,
    update: (job) => routeJobSchema.parse({
      ...job,
      status: input.status,
      ...(input.runId ? { runId: input.runId } : {}),
      ...(input.result ? { result: input.result } : {}),
      ...(input.clearLease ? { lease: undefined } : {}),
      updatedAt: (input.now ?? new Date()).toISOString()
    })
  });
}

export async function renewRouteJobLease(input: {
  store: RoutingStore;
  jobId: string;
  leaseToken: string;
  leaseSeconds?: number;
  now?: Date;
}): Promise<RouteJob> {
  const now = input.now ?? new Date();
  const nowIso = now.toISOString();
  return mutateRouteJob({
    store: input.store,
    jobId: input.jobId,
    expectedLeaseToken: input.leaseToken,
    update: (job) => {
      if (!job.lease) throw new Error(`Route job is not leased: ${job.id}`);
      return routeJobSchema.parse({
        ...job,
        lease: {
          ...job.lease,
          heartbeatAt: nowIso,
          expiresAt: new Date(now.getTime() + (input.leaseSeconds ?? 300) * 1000).toISOString()
        },
        updatedAt: nowIso
      });
    }
  });
}

export async function retryRouteJob(input: {
  store: RoutingStore;
  jobId: string;
  requestedBy: string;
  reason: string;
  now?: Date;
}): Promise<RouteJob> {
  const nowIso = (input.now ?? new Date()).toISOString();
  return mutateRouteJob({
    store: input.store,
    jobId: input.jobId,
    update: (job) => {
      if (!["failed", "dead_letter"].includes(job.status)) {
        throw new Error(`Route job ${job.id} cannot be retried from status ${job.status}`);
      }
      return routeJobSchema.parse({
        ...job,
        status: "queued",
        attemptCount: 0,
        lease: undefined,
        nextRunAt: nowIso,
        deadLetterReason: undefined,
        lastError: {
          code: "MANUAL_RETRY_REQUESTED",
          message: `${input.reason} (requested by ${input.requestedBy})`,
          at: nowIso
        },
        updatedAt: nowIso
      });
    }
  });
}

export async function cancelRouteJob(input: {
  store: RoutingStore;
  jobId: string;
  cancelledBy: string;
  reason: string;
  now?: Date;
}): Promise<RouteJob> {
  const now = input.now ?? new Date();
  const nowIso = now.toISOString();
  return mutateRouteJob({
    store: input.store,
    jobId: input.jobId,
    update: (job) => {
      if (job.status === "completed") {
        throw new Error(`Completed route job ${job.id} cannot be cancelled`);
      }
      if (job.lease && Date.parse(job.lease.expiresAt) > now.getTime()) {
        throw new Error(`Route job ${job.id} is actively leased by ${job.lease.claimedBy}; retry cancellation after the lease expires`);
      }
      return routeJobSchema.parse({
        ...job,
        status: "cancelled",
        lease: undefined,
        lastError: {
          code: "CANCELLED_BY_OPERATOR",
          message: `${input.reason} (cancelled by ${input.cancelledBy})`,
          at: nowIso
        },
        updatedAt: nowIso
      });
    }
  });
}

async function upsertRouteJobForCommit(input: {
  store: RoutingStore;
  event: EventEnvelope;
  commit: RouteCommit;
  activationMode: RoutingCard["activationMode"];
  requiredCapabilities: string[];
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
    executionTarget: routeExecutionTargetForActivation(input.activationMode, input.requiredCapabilities),
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

function routeExecutionTargetForActivation(
  activationMode: RoutingCard["activationMode"],
  requiredCapabilities: string[]
): RouteJob["executionTarget"] {
  if (["execute_with_approval", "autonomous_low_risk"].includes(activationMode)) {
    const configuredEnvironment = process.env.LOOPGRAPH_HERMES_EXECUTION_ENVIRONMENT;
    const environment = ["local", "sandbox", "staging", "production"].includes(configuredEnvironment ?? "")
      ? configuredEnvironment as RouteJob["executionTarget"]["environment"]
      : process.env.NODE_ENV === "production" ? "production" : "local";
    return {
      runtime: "hermes",
      environment,
      requiredCapabilities
    };
  }
  return {
    runtime: "loopgraph_local",
    environment: "local",
    requiredCapabilities
  };
}

function routeJobRetryDelaySeconds(job: RouteJob): number {
  const multiplier = Math.max(1, job.retryPolicy.backoffMultiplier);
  const exponent = Math.max(0, job.attemptCount - 1);
  const delay = Math.round(job.retryPolicy.baseDelaySeconds * multiplier ** exponent);
  return Math.min(job.retryPolicy.maxDelaySeconds, delay);
}

async function claimRouteJobCandidates(input: {
  jobs: RouteJob[];
  claimedBy: string;
  now: Date;
  leaseSeconds: number;
  limit: number;
  save: (job: RouteJob) => Promise<void>;
}): Promise<RouteJob[]> {
  const nowIso = input.now.toISOString();
  const leaseExpiresAt = new Date(input.now.getTime() + input.leaseSeconds * 1000).toISOString();
  const candidates = input.jobs
    .filter((job) => ["queued", "failed", "claimed", "running"].includes(job.status))
    .filter((job) => Date.parse(job.nextRunAt) <= input.now.getTime())
    .filter((job) => !job.lease || Date.parse(job.lease.expiresAt) <= input.now.getTime())
    .filter((job) => job.attemptCount < job.maxAttempts)
    .sort((left, right) => left.nextRunAt.localeCompare(right.nextRunAt) || left.createdAt.localeCompare(right.createdAt))
    .slice(0, input.limit);
  const claimed: RouteJob[] = [];

  for (const job of candidates) {
    const leaseToken = contentHash({
      jobId: job.id,
      claimedBy: input.claimedBy,
      claimedAt: nowIso,
      attemptCount: job.attemptCount + 1
    });
    const updated = routeJobSchema.parse({
      ...job,
      status: "claimed",
      attemptCount: job.attemptCount + 1,
      lease: {
        claimedBy: input.claimedBy,
        leaseToken,
        claimedAt: nowIso,
        heartbeatAt: nowIso,
        expiresAt: leaseExpiresAt
      },
      updatedAt: nowIso
    });
    await input.save(updated);
    claimed.push(updated);
  }

  return claimed;
}

async function claimWaitingReviewCandidates(input: {
  jobs: RouteJob[];
  claimedBy: string;
  now: Date;
  leaseSeconds: number;
  limit: number;
  save: (job: RouteJob) => Promise<void>;
}): Promise<RouteJob[]> {
  const nowIso = input.now.toISOString();
  const leaseExpiresAt = new Date(input.now.getTime() + input.leaseSeconds * 1000).toISOString();
  const candidates = input.jobs
    .filter((job) => job.status === "waiting_review")
    .filter((job) => !job.lease || Date.parse(job.lease.expiresAt) <= input.now.getTime())
    .sort((left, right) => left.updatedAt.localeCompare(right.updatedAt))
    .slice(0, input.limit);
  const claimed: RouteJob[] = [];

  for (const job of candidates) {
    const leaseToken = contentHash({
      purpose: "review_reconciliation",
      jobId: job.id,
      claimedBy: input.claimedBy,
      claimedAt: nowIso,
      previousLeaseToken: job.lease?.leaseToken,
      previousUpdatedAt: job.updatedAt
    });
    const updated = routeJobSchema.parse({
      ...job,
      lease: {
        claimedBy: input.claimedBy,
        leaseToken,
        claimedAt: nowIso,
        heartbeatAt: nowIso,
        expiresAt: leaseExpiresAt
      },
      updatedAt: nowIso
    });
    await input.save(updated);
    claimed.push(updated);
  }

  return claimed;
}

async function mutateRouteJob(input: {
  store: RoutingStore;
  jobId: string;
  expectedLeaseToken?: string;
  update: (job: RouteJob) => RouteJob;
}): Promise<RouteJob> {
  if (input.store.updateRouteJobAtomically) {
    return input.store.updateRouteJobAtomically(input);
  }
  const job = await input.store.getRouteJob(input.jobId);
  if (!job) throw new Error(`Route job not found: ${input.jobId}`);
  if (input.expectedLeaseToken && job.lease?.leaseToken !== input.expectedLeaseToken) {
    throw new Error(`Route job lease lost: ${input.jobId}`);
  }
  const updated = routeJobSchema.parse(input.update(job));
  await input.store.saveRouteJob(updated);
  return updated;
}

function safeFileName(id: string): string {
  return encodeURIComponent(id);
}

async function writeJson(filePath: string, value: unknown): Promise<void> {
  const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(tempPath, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  await rename(tempPath, filePath);
}

function isFileExistsError(error: unknown): boolean {
  return Boolean(error && typeof error === "object" && "code" in error && error.code === "EEXIST");
}

async function isStaleLock(lockPath: string, staleAfterMs: number): Promise<boolean> {
  try {
    const metadata = await stat(lockPath);
    return Date.now() - metadata.mtimeMs > staleAfterMs;
  } catch {
    return false;
  }
}

async function wait(milliseconds: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, milliseconds));
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
