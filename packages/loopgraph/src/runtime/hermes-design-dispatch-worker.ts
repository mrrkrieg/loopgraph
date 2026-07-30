import {
  hermesDesignDispatchJobSchema,
  hermesDesignTaskSchema,
  type HermesDesignDispatchJob,
  type HermesDesignTask
} from "../core";
import {
  resolveHermesTaskTransport,
  type HermesTaskTransport,
  type HermesTaskTransportResult
} from "./hermes-design-bridge";
import type { HermesDesignStore } from "./hermes-design-store";

export type HermesDesignDispatchWorkerItem = {
  jobId: string;
  taskId: string;
  status: "completed" | "retry_scheduled" | "dead_letter";
  attemptCount: number;
  nextRunAt?: string;
  error?: string;
};

export type HermesDesignDispatchWorkerResult = {
  workerId: string;
  claimed: number;
  completed: number;
  retryScheduled: number;
  deadLettered: number;
  reconciled: number;
  items: HermesDesignDispatchWorkerItem[];
};

export async function runHermesDesignDispatchWorker(input: {
  store: HermesDesignStore;
  transport?: HermesTaskTransport;
  taskUrl?: string;
  taskSecret?: string;
  workerId?: string;
  limit?: number;
  leaseSeconds?: number;
  now?: Date;
}): Promise<HermesDesignDispatchWorkerResult> {
  const now = input.now ?? new Date();
  const workerId = input.workerId?.trim() || `hermes-design-${process.pid}`;
  const limit = boundedInteger(input.limit, 10, 1, 100);
  const leaseSeconds = boundedInteger(input.leaseSeconds, 300, 30, 3600);
  const transport = resolveHermesTaskTransport({
    transport: input.transport,
    taskUrl: input.taskUrl,
    taskSecret: input.taskSecret
  });
  if (!transport) {
    throw new Error(
      "A Hermes task endpoint and secret are required before dispatch jobs can run."
    );
  }

  const reconciled = await reconcileTerminalDispatchJobs(input.store, now, limit);
  const claimed = await input.store.claimDueDispatchJobsAtomically({
    claimedBy: workerId,
    now,
    leaseSeconds,
    limit
  });
  const items: HermesDesignDispatchWorkerItem[] = [];
  for (const job of claimed) {
    items.push(await dispatchClaimedJob({
      store: input.store,
      transport,
      job,
      now
    }));
  }
  return {
    workerId,
    claimed: claimed.length,
    completed: items.filter((item) => item.status === "completed").length,
    retryScheduled: items.filter((item) => item.status === "retry_scheduled").length,
    deadLettered: items.filter((item) => item.status === "dead_letter").length,
    reconciled,
    items
  };
}

async function dispatchClaimedJob(input: {
  store: HermesDesignStore;
  transport: HermesTaskTransport;
  job: HermesDesignDispatchJob;
  now: Date;
}): Promise<HermesDesignDispatchWorkerItem> {
  const leaseToken = input.job.lease?.leaseToken;
  if (!leaseToken) {
    throw new Error(`Claimed Hermes dispatch job has no lease: ${input.job.id}`);
  }
  let delivery: HermesTaskTransportResult;
  try {
    delivery = await input.transport.dispatch(input.job.request);
  } catch (error) {
    delivery = {
      sent: false,
      error: error instanceof Error ? error.message : "Hermes task delivery failed"
    };
  }
  const completedAt = input.now.toISOString();
  if (delivery.sent) {
    const saved = await input.store.updateDispatchJobAtomically({
      jobId: input.job.id,
      expectedLeaseToken: leaseToken,
      update: (current) => hermesDesignDispatchJobSchema.parse({
        ...current,
        status: "completed",
        lease: undefined,
        result: {
          destination: delivery.destination,
          responseStatus: delivery.responseStatus,
          hermesTaskId: delivery.hermesTaskId,
          completedAt
        },
        lastError: undefined,
        deadLetterReason: undefined,
        updatedAt: completedAt
      })
    });
    await reconcileTaskFromDispatch(input.store, saved, delivery, input.now);
    return {
      jobId: saved.id,
      taskId: saved.taskId,
      status: "completed",
      attemptCount: saved.attemptCount
    };
  }

  const error = boundedError(delivery.error ?? "Hermes task delivery failed");
  const deadLetter = input.job.attemptCount >= input.job.maxAttempts;
  const nextRunAt = deadLetter
    ? input.job.nextRunAt
    : new Date(
        input.now.getTime() + retryDelaySeconds(input.job) * 1000
      ).toISOString();
  const saved = await input.store.updateDispatchJobAtomically({
    jobId: input.job.id,
    expectedLeaseToken: leaseToken,
    update: (current) => hermesDesignDispatchJobSchema.parse({
      ...current,
      status: deadLetter ? "dead_letter" : "failed",
      lease: undefined,
      nextRunAt,
      lastError: {
        message: error,
        at: completedAt
      },
      deadLetterReason: deadLetter
        ? "Hermes design delivery exhausted its configured attempts."
        : undefined,
      updatedAt: completedAt
    })
  });
  await reconcileTaskFromDispatch(input.store, saved, delivery, input.now);
  return {
    jobId: saved.id,
    taskId: saved.taskId,
    status: deadLetter ? "dead_letter" : "retry_scheduled",
    attemptCount: saved.attemptCount,
    ...(deadLetter ? {} : { nextRunAt: saved.nextRunAt }),
    error
  };
}

async function reconcileTerminalDispatchJobs(
  store: HermesDesignStore,
  now: Date,
  limit: number
): Promise<number> {
  const terminal = (await store.listDispatchJobs())
    .filter((job) => ["completed", "dead_letter"].includes(job.status))
    .slice(0, limit);
  let reconciled = 0;
  for (const job of terminal) {
    const task = await store.getTask(job.taskId);
    if (!task || taskMatchesDispatch(task, job)) continue;
    await reconcileTaskFromDispatch(store, job, {
      sent: job.status === "completed",
      destination: job.result?.destination,
      responseStatus: job.result?.responseStatus,
      hermesTaskId: job.result?.hermesTaskId,
      error: job.lastError?.message
    }, now);
    reconciled += 1;
  }
  return reconciled;
}

async function reconcileTaskFromDispatch(
  store: HermesDesignStore,
  job: HermesDesignDispatchJob,
  delivery: HermesTaskTransportResult,
  now: Date
): Promise<HermesDesignTask> {
  const nowIso = now.toISOString();
  return store.updateTaskAtomically({
    taskId: job.taskId,
    update: (current) => hermesDesignTaskSchema.parse({
      ...current,
      status: delivery.sent && current.status === "queued"
        ? "awaiting_hermes"
        : job.status === "dead_letter" && !["completed", "cancelled"].includes(current.status)
          ? "failed"
          : current.status,
      hermesTaskId: delivery.hermesTaskId ?? current.hermesTaskId,
      delivery: {
        status: delivery.sent ? "sent" : "failed",
        destination: delivery.destination ?? current.delivery.destination,
        attemptCount: Math.max(current.delivery.attemptCount, job.attemptCount),
        lastAttemptAt: nowIso,
        responseStatus: delivery.responseStatus,
        error: delivery.error
      },
      updatedAt: nowIso
    })
  });
}

function taskMatchesDispatch(
  task: HermesDesignTask,
  job: HermesDesignDispatchJob
): boolean {
  if (job.status === "completed") {
    return task.delivery.status === "sent" &&
      task.delivery.attemptCount >= job.attemptCount &&
      (!job.result?.hermesTaskId || task.hermesTaskId === job.result.hermesTaskId);
  }
  return task.delivery.status === "failed" &&
    task.delivery.attemptCount >= job.attemptCount &&
    (task.status === "failed" || ["completed", "cancelled"].includes(task.status));
}

function retryDelaySeconds(job: HermesDesignDispatchJob): number {
  const delay = job.retryPolicy.baseDelaySeconds *
    job.retryPolicy.backoffMultiplier ** Math.max(0, job.attemptCount - 1);
  return Math.min(job.retryPolicy.maxDelaySeconds, Math.ceil(delay));
}

function boundedInteger(
  value: number | undefined,
  fallback: number,
  minimum: number,
  maximum: number
): number {
  if (value === undefined) return fallback;
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    throw new Error(`Expected an integer from ${minimum} to ${maximum}.`);
  }
  return value;
}

function boundedError(value: string): string {
  return value.trim().slice(0, 1000) || "Hermes task delivery failed";
}
