import path from "node:path";
import {
  contentHash,
  loopSpecHash,
  type BusinessProblem,
  type EventReceipt,
  type LoopRunTrace,
  type LoopSpec,
  type RouteCommit,
  type RouteJob
} from "../core";
import type { StorageAdapter } from "../sdk/adapters";
import { FileStorageAdapter } from "../sdk/storage";
import { executeLoop, type ExecuteResult } from "./executor";
import {
  emitEscalationCreatedLifecycleEvent,
  emitLoopRunLifecycleEvent,
  emitLoopRunStartedLifecycleEvent,
  type LoopgraphLifecycleEmitResult
} from "./lifecycle-events";
import { loadLoopSpecFromPath } from "./loader";
import type { LoopSpecRegistryStore } from "./loop-spec-store";
import { enqueueLoopControllerTriggerBestEffort } from "./loop-controller-triggers";
import { recordTraceMetricSamples } from "./outcome-service";
import { FileOutcomeStore } from "./outcome-store";
import { readProjectMetricDefinitions } from "./outcome-tools";
import { resolveExistingProjectPath } from "./project-paths";
import { commitPreparedActions } from "./review-service";
import {
  claimDueRouteJobs,
  claimWaitingReviewRouteJobs,
  failRouteJob,
  FileRoutingStore,
  markRouteJobCompleted,
  markRouteJobRunning,
  markRouteJobWaitingReview,
  renewRouteJobLease,
  updateRouteJobStatus,
  type RoutingStore
} from "./routing-store";
import { buildRouteCommitSimulationFixture } from "./routing-tools";
import { simulateLoop, type SimulateResult } from "./simulator";
import { getLoopgraphRoot } from "./storage-resolver";
import { readLoopgraphWorkspace } from "./workspace";

export const ROUTE_JOB_WORKER_SCHEMA_VERSION = "route-job-worker/v1alpha1" as const;

export type RouteJobWorkerItemResult = {
  jobId: string;
  routeCommitId: string;
  status: RouteJob["status"];
  runId?: string;
  traceStatus?: string;
  duplicate: boolean;
  lifecycleDeliveryIds: string[];
  metricSampleIds: string[];
  error?: { code: string; message: string };
};

export type RouteJobWorkerRunResult = {
  schemaVersion: typeof ROUTE_JOB_WORKER_SCHEMA_VERSION;
  workerId: string;
  claimed: number;
  processed: number;
  completed: number;
  waitingReview: number;
  failed: number;
  deadLetter: number;
  reconciledReviews: number;
  items: RouteJobWorkerItemResult[];
  controllerTrigger?: Awaited<ReturnType<typeof enqueueLoopControllerTriggerBestEffort>>;
};

export type RouteJobWorkerOptions = {
  projectRoot?: string;
  workerId?: string;
  limit?: number;
  leaseSeconds?: number;
  now?: Date;
  store?: RoutingStore;
  loopSpecStore?: LoopSpecRegistryStore;
  storage?: StorageAdapter;
  simulate?: typeof simulateLoop;
  execute?: (input: Parameters<typeof executeLoop>[0]) => Promise<ExecuteResult>;
};

export async function runRouteJobWorker(
  options: RouteJobWorkerOptions = {}
): Promise<RouteJobWorkerRunResult> {
  const projectRoot = path.resolve(options.projectRoot ?? process.cwd());
  const now = options.now ?? new Date();
  const workerId = options.workerId ?? `worker_${process.pid}`;
  const store = options.store ?? new FileRoutingStore(getLoopgraphRoot(projectRoot));
  const storage = options.storage ?? new FileStorageAdapter(getLoopgraphRoot(projectRoot));
  const reconciled = await reconcileReviewedRouteJobs({
    projectRoot,
    store,
    loopSpecStore: options.loopSpecStore,
    storage,
    now,
    workerId,
    leaseSeconds: options.leaseSeconds,
    limit: options.limit
  });
  const claimed = await claimDueRouteJobs({
    store,
    claimedBy: workerId,
    now,
    leaseSeconds: options.leaseSeconds,
    limit: options.limit
  });
  const items: RouteJobWorkerItemResult[] = [];

  for (const job of claimed) {
    items.push(await processClaimedRouteJob({
      projectRoot,
      store,
      loopSpecStore: options.loopSpecStore,
      storage,
      job,
      now,
      simulate: options.simulate ?? simulateLoop,
      execute: options.execute ?? executeLoop
    }));
  }

  const allItems = [...reconciled, ...items];
  const controllerTrigger = allItems.length === 0
    ? undefined
    : await enqueueLoopControllerTriggerBestEffort({
        projectRoot,
        type: "route_job",
        triggerId: `route-job-batch-${contentHash(allItems.map((item) => ({
          jobId: item.jobId,
          status: item.status,
          runId: item.runId
        })))}`,
        sourceRef: `route-job-worker:${workerId}`,
        occurredAt: now.toISOString(),
        requestedBy: workerId,
        evidenceRefs: allItems.flatMap((item) => [
          item.jobId,
          ...(item.runId ? [item.runId] : []),
          ...item.metricSampleIds
        ])
      }, { now });

  return {
    schemaVersion: ROUTE_JOB_WORKER_SCHEMA_VERSION,
    workerId,
    claimed: claimed.length,
    processed: items.length,
    completed: items.filter((item) => item.status === "completed").length,
    waitingReview: items.filter((item) => item.status === "waiting_review").length,
    failed: items.filter((item) => item.status === "failed").length,
    deadLetter: items.filter((item) => item.status === "dead_letter").length,
    reconciledReviews: reconciled.length,
    items: allItems,
    controllerTrigger
  };
}

export async function processClaimedRouteJob(input: {
  projectRoot: string;
  store: RoutingStore;
  loopSpecStore?: LoopSpecRegistryStore;
  storage: StorageAdapter;
  job: RouteJob;
  now?: Date;
  simulate?: typeof simulateLoop;
  execute?: (input: Parameters<typeof executeLoop>[0]) => Promise<ExecuteResult>;
}): Promise<RouteJobWorkerItemResult> {
  const now = input.now ?? new Date();
  const leaseToken = input.job.lease?.leaseToken;
  if (!input.job.lease || !leaseToken) {
    throw new Error(`Route job ${input.job.id} is not protected by a worker lease token`);
  }

  try {
    const context = await validateRouteJobContext({
      projectRoot: input.projectRoot,
      store: input.store,
      loopSpecStore: input.loopSpecStore,
      job: input.job
    });
    const existingTrace = await input.storage.getRun(input.job.runId);
    if (existingTrace && isTerminalTrace(existingTrace)) {
      return finalizeRouteJobFromTrace({
        projectRoot: input.projectRoot,
        store: input.store,
        loopSpecStore: input.loopSpecStore,
        job: input.job,
        context,
        trace: existingTrace,
        now,
        leaseToken,
        duplicate: true
      });
    }

    await markRouteJobRunning({
      store: input.store,
      jobId: input.job.id,
      leaseToken,
      now
    });
    const runningCommit: RouteCommit = {
      ...context.commit,
      status: "running"
    };
    await input.store.saveRouteCommit(runningCommit);
    const runningProblem: BusinessProblem = {
      ...context.problem,
      status: "in_progress",
      updatedAt: now.toISOString()
    };
    await input.store.saveBusinessProblem(runningProblem);

    const execution = await withRouteJobHeartbeat({
      store: input.store,
      job: input.job,
      leaseToken,
      operation: () => runJobByActivationMode({
        projectRoot: input.projectRoot,
        storage: input.storage,
        job: input.job,
        spec: context.spec,
        receipt: context.receipt,
        commit: runningCommit,
        now,
        simulate: input.simulate ?? simulateLoop,
        execute: input.execute ?? executeLoop
      })
    });
    if (execution.trace.loopId !== input.job.loopId || execution.trace.loopSpecHash !== input.job.loopSpecHash) {
      throw workerError(
        "RUN_BINDING_MISMATCH",
        `Run ${execution.trace.id} does not match route job ${input.job.id} LoopSpec binding`
      );
    }

    if (
      input.job.activationMode === "autonomous_low_risk" &&
      execution.trace.status === "COMPLETED" &&
      execution.trace.toolCalls.some((call) => call.status === "pending")
    ) {
      await commitPreparedActions(
        execution.trace,
        execution.trace.preparedActions.map((action) => action.fingerprint),
        context.spec
      );
      await input.storage.saveRun(execution.trace);
    }

    return finalizeRouteJobFromTrace({
      projectRoot: input.projectRoot,
      store: input.store,
      loopSpecStore: input.loopSpecStore,
      job: input.job,
      context: {
        ...context,
        commit: runningCommit,
        problem: runningProblem
      },
      trace: execution.trace,
      escalationCase: execution.escalationCase,
      now,
      leaseToken,
      duplicate: false
    });
  } catch (error) {
    const normalized = normalizeWorkerError(error);
    let failedJob: RouteJob;
    try {
      failedJob = await failRouteJob({
        store: input.store,
        jobId: input.job.id,
        leaseToken,
        error: normalized,
        now
      });
    } catch (failureUpdateError) {
      const current = await input.store.getRouteJob(input.job.id);
      if (!current) throw failureUpdateError;
      return {
        jobId: current.id,
        routeCommitId: current.routeCommitId,
        status: current.status,
        runId: current.runId,
        duplicate: false,
        lifecycleDeliveryIds: [],
        metricSampleIds: [],
        error: {
          code: "ROUTE_JOB_LEASE_LOST",
          message: `Worker no longer owns route job ${current.id}; no stale completion was written.`
        }
      };
    }
    const commit = await findRouteCommit(input.store, input.job.routeCommitId);
    if (commit) {
      await input.store.saveRouteCommit({
        ...commit,
        status: failedJob.status === "dead_letter" ? "failed" : "queued"
      });
    }
    const problem = await input.store.getBusinessProblem(input.job.problemId);
    if (problem) {
      await input.store.saveBusinessProblem({
        ...problem,
        status: "waiting",
        updatedAt: now.toISOString()
      });
    }
    return {
      jobId: failedJob.id,
      routeCommitId: failedJob.routeCommitId,
      status: failedJob.status,
      runId: failedJob.runId,
      duplicate: false,
      lifecycleDeliveryIds: [],
      metricSampleIds: [],
      error: {
        code: normalized.code ?? "ROUTE_JOB_FAILED",
        message: normalized.message
      }
    };
  }
}

async function runJobByActivationMode(input: {
  projectRoot: string;
  storage: StorageAdapter;
  job: RouteJob;
  spec: LoopSpec;
  receipt: EventReceipt;
  commit: RouteCommit;
  now: Date;
  simulate: typeof simulateLoop;
  execute: (input: Parameters<typeof executeLoop>[0]) => Promise<ExecuteResult>;
}): Promise<SimulateResult | ExecuteResult> {
  if (["shadow", "recommend", "simulate"].includes(input.job.activationMode)) {
    return input.simulate({
      spec: input.spec,
      fixture: buildRouteCommitSimulationFixture({
        spec: input.spec,
        receipt: input.receipt,
        commit: input.commit,
        simulatedAt: input.now.toISOString(),
        simulatedBy: `route-job:${input.job.lease?.claimedBy ?? "worker"}`
      }),
      storage: input.storage,
      provenance: {
        invocation: {
          actor: input.job.lease?.claimedBy ?? "route-job-worker",
          source: "loopgraph.route-job-worker",
          routeAttemptId: input.job.routeAttemptId,
          routeCommitId: input.job.routeCommitId
        },
        approvalPolicy: {
          requireFingerprintMatch: input.spec.approval.requireFingerprintMatch,
          separateCustomerFacingApproval: input.spec.approval.separateCustomerFacingApproval,
          allowedRoles: input.spec.approval.allowedRoles
        },
        connectorChecks: []
      }
    });
  }

  return input.execute({
    spec: input.spec,
    triggerPayload: {
      event: input.receipt.event,
      mappedInputs: input.commit.inputMapping,
      routeCommitId: input.commit.id,
      problemId: input.commit.problemId
    },
    eventId: input.receipt.event.id,
    startedAt: input.now.toISOString(),
    storage: input.storage,
    projectRoot: input.projectRoot,
    invokedBy: {
      actor: input.job.lease?.claimedBy ?? "route-job-worker",
      source: "loopgraph.route-job-worker",
      routeAttemptId: input.job.routeAttemptId,
      routeCommitId: input.job.routeCommitId
    }
  });
}

async function withRouteJobHeartbeat<T>(input: {
  store: RoutingStore;
  job: RouteJob;
  leaseToken: string;
  operation: () => Promise<T>;
}): Promise<T> {
  const leaseSeconds = routeJobLeaseSeconds(input.job);
  const heartbeatEveryMs = Math.max(5_000, Math.min(60_000, Math.floor(leaseSeconds * 1000 / 3)));
  let heartbeatError: unknown;
  let heartbeatInFlight = false;
  const timer = setInterval(() => {
    if (heartbeatInFlight || heartbeatError) return;
    heartbeatInFlight = true;
    void renewRouteJobLease({
      store: input.store,
      jobId: input.job.id,
      leaseToken: input.leaseToken,
      leaseSeconds
    }).catch((error) => {
      heartbeatError = error;
    }).finally(() => {
      heartbeatInFlight = false;
    });
  }, heartbeatEveryMs);
  timer.unref?.();

  try {
    const result = await input.operation();
    if (heartbeatError) throw heartbeatError;
    await renewRouteJobLease({
      store: input.store,
      jobId: input.job.id,
      leaseToken: input.leaseToken,
      leaseSeconds
    });
    return result;
  } finally {
    clearInterval(timer);
  }
}

function routeJobLeaseSeconds(job: RouteJob): number {
  if (!job.lease) return 300;
  const milliseconds = Date.parse(job.lease.expiresAt) - Date.parse(job.lease.claimedAt);
  return Math.max(30, Math.round(milliseconds / 1000));
}

async function finalizeRouteJobFromTrace(input: {
  projectRoot: string;
  store: RoutingStore;
  loopSpecStore?: LoopSpecRegistryStore;
  job: RouteJob;
  context: RouteJobContext;
  trace: LoopRunTrace;
  escalationCase?: SimulateResult["escalationCase"];
  now: Date;
  leaseToken?: string;
  duplicate: boolean;
}): Promise<RouteJobWorkerItemResult> {
  if (input.leaseToken) {
    await assertRouteJobFinalizeLease({
      store: input.store,
      jobId: input.job.id,
      leaseToken: input.leaseToken,
      now: input.now
    });
  }
  const workspace = input.loopSpecStore
    ? (await input.loopSpecStore.getWorkspace(input.projectRoot)).workspace
    : await readLoopgraphWorkspace(input.projectRoot);
  const metricSamples = await recordTraceMetricSamples({
    store: new FileOutcomeStore(getLoopgraphRoot(input.projectRoot)),
    workspaceId: workspace.projectRootId,
    companyId: input.context.receipt.event.companyId,
    trace: input.trace,
    metricDefinitions: await readProjectMetricDefinitions(input.projectRoot),
    now: input.now
  });
  const metricSampleIds = metricSamples.map((sample) => sample.record.id);
  const commitStatus = routeCommitStatusForTrace(input.trace.status);
  const updatedCommit: RouteCommit = {
    ...input.context.commit,
    runId: input.trace.id,
    status: commitStatus
  };
  await input.store.saveRouteCommit(updatedCommit);
  const updatedProblem: BusinessProblem = {
    ...input.context.problem,
    status: problemStatusForTrace(input.job.activationMode, input.trace.status),
    updatedAt: input.now.toISOString(),
    ...(input.job.activationMode.startsWith("autonomous") && input.trace.status === "COMPLETED"
      ? { resolvedAt: input.now.toISOString() }
      : {})
  };
  await input.store.saveBusinessProblem(updatedProblem);

  const lifecycle = await emitWorkerLifecycle({
    projectRoot: input.projectRoot,
    receipt: input.context.receipt,
    commit: updatedCommit,
    problem: updatedProblem,
    trace: input.trace,
    escalationCase: input.escalationCase,
    now: input.now
  });
  const lifecycleDeliveryIds = lifecycle.flatMap((result) =>
    result.emitted ? [result.delivery.id] : []
  );

  const waitingReview = input.trace.status === "WAITING_FOR_REVIEW";
  const completed = input.trace.status === "COMPLETED";
  let finalJob: RouteJob;
  if (waitingReview) {
    finalJob = await markRouteJobWaitingReview({
      store: input.store,
      jobId: input.job.id,
      leaseToken: input.leaseToken,
      runId: input.trace.id,
      now: input.now
    });
  } else if (completed) {
    finalJob = await markRouteJobCompleted({
      store: input.store,
      jobId: input.job.id,
      leaseToken: input.leaseToken,
      runId: input.trace.id,
      now: input.now,
      result: {
        traceStatus: input.trace.status,
        completedAt: input.trace.completedAt ?? input.now.toISOString(),
        lifecycleDeliveryIds,
        metricSampleIds
      }
    });
  } else {
    const error = workerError(
      "RUN_NOT_SUCCESSFUL",
      `Run ${input.trace.id} ended with status ${input.trace.status}`
    );
    const failedJob = await failRouteJob({
      store: input.store,
      jobId: input.job.id,
      leaseToken: input.leaseToken,
      error: normalizeWorkerError(error),
      now: input.now
    });
    return {
      jobId: failedJob.id,
      routeCommitId: failedJob.routeCommitId,
      status: failedJob.status,
      runId: input.trace.id,
      traceStatus: input.trace.status,
      duplicate: input.duplicate,
      lifecycleDeliveryIds,
      metricSampleIds,
      error: {
        code: "RUN_NOT_SUCCESSFUL",
        message: error.message
      }
    };
  }

  return {
    jobId: finalJob.id,
    routeCommitId: finalJob.routeCommitId,
    status: finalJob.status,
    runId: input.trace.id,
    traceStatus: input.trace.status,
    duplicate: input.duplicate,
    lifecycleDeliveryIds,
    metricSampleIds
  };
}

async function reconcileReviewedRouteJobs(input: {
  projectRoot: string;
  store: RoutingStore;
  loopSpecStore?: LoopSpecRegistryStore;
  storage: StorageAdapter;
  now: Date;
  workerId: string;
  leaseSeconds?: number;
  limit?: number;
}): Promise<RouteJobWorkerItemResult[]> {
  const waiting = await claimWaitingReviewRouteJobs({
    store: input.store,
    claimedBy: `${input.workerId}:review-reconciler`,
    now: input.now,
    leaseSeconds: input.leaseSeconds,
    limit: input.limit
  });
  const results: RouteJobWorkerItemResult[] = [];
  for (const job of waiting) {
    const trace = await input.storage.getRun(job.runId);
    if (!trace || !isTerminalTrace(trace)) {
      await updateRouteJobStatus({
        store: input.store,
        jobId: job.id,
        status: "waiting_review",
        leaseToken: job.lease?.leaseToken,
        clearLease: true,
        now: input.now
      });
      continue;
    }
    const context = await validateRouteJobContext({
      projectRoot: input.projectRoot,
      store: input.store,
      loopSpecStore: input.loopSpecStore,
      job,
      allowCompletedCommit: true
    });
    results.push(await finalizeRouteJobFromTrace({
      projectRoot: input.projectRoot,
      store: input.store,
      loopSpecStore: input.loopSpecStore,
      job,
      context,
      trace,
      now: input.now,
      leaseToken: job.lease?.leaseToken,
      duplicate: true
    }));
  }
  return results;
}

async function assertRouteJobFinalizeLease(input: {
  store: RoutingStore;
  jobId: string;
  leaseToken: string;
  now: Date;
}): Promise<void> {
  const current = await input.store.getRouteJob(input.jobId);
  if (!current) throw workerError("ROUTE_JOB_MISSING", `Route job not found: ${input.jobId}`);
  if (!["claimed", "running", "waiting_review"].includes(current.status)) {
    throw workerError(
      "ROUTE_JOB_NOT_FINALIZABLE",
      `Route job ${input.jobId} cannot be finalized from status ${current.status}`
    );
  }
  if (current.lease?.leaseToken !== input.leaseToken) {
    throw workerError("ROUTE_JOB_LEASE_LOST", `Route job lease lost: ${input.jobId}`);
  }
  if (Date.parse(current.lease.expiresAt) <= input.now.getTime()) {
    throw workerError("ROUTE_JOB_LEASE_EXPIRED", `Route job lease expired: ${input.jobId}`);
  }
}

type RouteJobContext = {
  receipt: EventReceipt;
  problem: BusinessProblem;
  commit: RouteCommit;
  spec: LoopSpec;
};

async function validateRouteJobContext(input: {
  projectRoot: string;
  store: RoutingStore;
  loopSpecStore?: LoopSpecRegistryStore;
  job: RouteJob;
  allowCompletedCommit?: boolean;
}): Promise<RouteJobContext> {
  const receipt = await input.store.getEventReceipt(input.job.eventId);
  if (!receipt) throw workerError("EVENT_RECEIPT_MISSING", `Event receipt not found: ${input.job.eventId}`);
  if (receipt.event.source === "loopgraph" || receipt.event.normalizedPayload.notificationOnly === true) {
    throw workerError("LIFECYCLE_REENTRY_BLOCKED", "Loopgraph lifecycle notifications cannot trigger route jobs");
  }
  const problem = await input.store.getBusinessProblem(input.job.problemId);
  if (!problem) throw workerError("BUSINESS_PROBLEM_MISSING", `Business problem not found: ${input.job.problemId}`);
  const commit = await findRouteCommit(input.store, input.job.routeCommitId);
  if (!commit) throw workerError("ROUTE_COMMIT_MISSING", `Route commit not found: ${input.job.routeCommitId}`);
  if (commit.status === "cancelled") {
    throw workerError("ROUTE_COMMIT_CANCELLED", `Route commit is cancelled: ${commit.id}`);
  }
  if (commit.status === "completed" && !input.allowCompletedCommit) {
    throw workerError("ROUTE_COMMIT_ALREADY_COMPLETED", `Route commit is already completed: ${commit.id}`);
  }
  assertRouteJobBindings(input.job, commit, receipt, problem);

  if (input.loopSpecStore) {
    const artifact = await input.loopSpecStore.getActiveLoopSpec(
      input.projectRoot,
      input.job.loopId
    );
    if (!artifact) {
      throw workerError(
        "LOOP_SPEC_NOT_REGISTERED",
        `Registered LoopSpec not found: ${input.job.loopId}`
      );
    }
    const hash = loopSpecHash(artifact.spec);
    if (hash !== input.job.loopSpecHash || hash !== commit.loopSpecHash) {
      throw workerError(
        "LOOP_SPEC_HASH_MISMATCH",
        `Registered LoopSpec hash ${hash} does not match immutable route binding ${input.job.loopSpecHash}`
      );
    }
    if (artifact.spec.routing?.activationMode !== input.job.activationMode) {
      throw workerError(
        "ACTIVATION_MODE_MISMATCH",
        `LoopSpec activation mode ${artifact.spec.routing?.activationMode ?? "missing"} does not match route job ${input.job.activationMode}`
      );
    }
    return { receipt, problem, commit, spec: artifact.spec };
  }

  const workspace = await readLoopgraphWorkspace(input.projectRoot);
  const registered = workspace.registeredSpecs.find((entry) => entry.id === input.job.loopId);
  if (!registered) {
    throw workerError("LOOP_SPEC_NOT_REGISTERED", `Registered LoopSpec not found: ${input.job.loopId}`);
  }
  let specPath: string;
  try {
    specPath = await resolveExistingProjectPath(input.projectRoot, registered.path, "registered LoopSpec");
  } catch {
    throw workerError("LOOP_SPEC_PATH_ESCAPE", "Registered LoopSpec path escapes the project root");
  }
  const loaded = await loadLoopSpecFromPath(specPath);
  if (!loaded.ok) {
    throw workerError("LOOP_SPEC_INVALID", loaded.errors.join("; "));
  }
  const hash = loopSpecHash(loaded.spec);
  if (hash !== input.job.loopSpecHash || hash !== commit.loopSpecHash) {
    throw workerError(
      "LOOP_SPEC_HASH_MISMATCH",
      `Registered LoopSpec hash ${hash} does not match immutable route binding ${input.job.loopSpecHash}`
    );
  }
  if (loaded.spec.routing?.activationMode !== input.job.activationMode) {
    throw workerError(
      "ACTIVATION_MODE_MISMATCH",
      `LoopSpec activation mode ${loaded.spec.routing?.activationMode ?? "missing"} does not match route job ${input.job.activationMode}`
    );
  }
  return { receipt, problem, commit, spec: loaded.spec };
}

function assertRouteJobBindings(
  job: RouteJob,
  commit: RouteCommit,
  receipt: EventReceipt,
  problem: BusinessProblem
): void {
  const mismatches = [
    job.eventId !== commit.eventId || job.eventId !== receipt.eventId ? "eventId" : undefined,
    job.problemId !== commit.problemId || job.problemId !== problem.id ? "problemId" : undefined,
    job.routeAttemptId !== commit.routeAttemptId ? "routeAttemptId" : undefined,
    job.loopId !== commit.loopId ? "loopId" : undefined,
    job.loopSpecHash !== commit.loopSpecHash ? "loopSpecHash" : undefined
  ].filter(Boolean);
  if (mismatches.length > 0) {
    throw workerError("ROUTE_JOB_BINDING_MISMATCH", `Route job binding mismatch: ${mismatches.join(", ")}`);
  }
}

async function emitWorkerLifecycle(input: {
  projectRoot: string;
  receipt: EventReceipt;
  commit: RouteCommit;
  problem: BusinessProblem;
  trace: LoopRunTrace;
  escalationCase?: SimulateResult["escalationCase"];
  now: Date;
}): Promise<LoopgraphLifecycleEmitResult[]> {
  const deliveries: LoopgraphLifecycleEmitResult[] = [];
  deliveries.push(await emitLoopRunStartedLifecycleEvent({
    projectRoot: input.projectRoot,
    sourceEvent: input.receipt.event,
    routeCommit: input.commit,
    trace: input.trace,
    problem: input.problem,
    now: input.now
  }));
  if (input.escalationCase) {
    deliveries.push(await emitEscalationCreatedLifecycleEvent({
      projectRoot: input.projectRoot,
      sourceEvent: input.receipt.event,
      routeCommit: input.commit,
      trace: input.trace,
      escalationCase: input.escalationCase,
      problem: input.problem,
      now: input.now
    }));
  }
  deliveries.push(await emitLoopRunLifecycleEvent({
    projectRoot: input.projectRoot,
    sourceEvent: input.receipt.event,
    routeCommit: input.commit,
    trace: input.trace,
    problem: input.problem,
    now: input.now
  }));
  return deliveries;
}

function routeCommitStatusForTrace(status: string): RouteCommit["status"] {
  if (status === "WAITING_FOR_REVIEW") return "waiting_review";
  if (status === "COMPLETED") return "completed";
  if (["BLOCKED_BY_POLICY", "FAILED_VERIFICATION", "REJECTED", "CANCELLED"].includes(status)) return "failed";
  return "running";
}

function problemStatusForTrace(
  activationMode: RouteJob["activationMode"],
  status: string
): BusinessProblem["status"] {
  if (status === "WAITING_FOR_REVIEW") return "waiting";
  if (status !== "COMPLETED") return "waiting";
  return activationMode === "autonomous_low_risk" || activationMode === "execute_with_approval"
    ? "resolved"
    : "routed";
}

function isTerminalTrace(trace: LoopRunTrace): boolean {
  return [
    "WAITING_FOR_REVIEW",
    "COMPLETED",
    "FAILED_VERIFICATION",
    "BLOCKED_BY_POLICY",
    "REJECTED",
    "CANCELLED"
  ].includes(trace.status);
}

async function findRouteCommit(store: RoutingStore, commitId: string): Promise<RouteCommit | null> {
  return (await store.listRouteCommits()).find((commit) => commit.id === commitId) ?? null;
}

function workerError(code: string, message: string): Error & { code: string } {
  return Object.assign(new Error(message), { code });
}

function normalizeWorkerError(error: unknown): { code?: string; message: string } {
  if (error instanceof Error) {
    const code = "code" in error && typeof error.code === "string" ? error.code : undefined;
    return { ...(code ? { code } : {}), message: error.message };
  }
  return { message: String(error) };
}
