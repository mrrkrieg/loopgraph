import { createHash } from "node:crypto";
import {
  HERMES_DESIGN_CALLBACK_JOB_SCHEMA_VERSION,
  hermesDesignCallbackJobSchema,
  hermesDesignCallbackSchema,
  type HermesDesignCallbackJob
} from "../core";
import { processHermesDesignCallback } from "./hermes-design-bridge";
import type { DiscoveryDesignStore } from "./discovery-design-store";
import type { HermesDesignStore } from "./hermes-design-store";
import type { LoopSpecRegistryStore } from "./loop-spec-store";

export type HermesDesignCallbackWorkerItem = {
  jobId: string;
  taskId: string;
  callbackId: string;
  status: "completed" | "retry_scheduled" | "dead_letter";
  attemptCount: number;
  duplicate?: boolean;
  designRunId?: string;
  nextRunAt?: string;
  error?: string;
};

export type HermesDesignCallbackWorkerResult = {
  workerId: string;
  claimed: number;
  completed: number;
  retryScheduled: number;
  deadLettered: number;
  items: HermesDesignCallbackWorkerItem[];
};

export function createHermesDesignCallbackJob(input: {
  callback: unknown;
  requestHash: string;
  now?: Date;
  maxAttempts?: number;
}): HermesDesignCallbackJob {
  const callback = hermesDesignCallbackSchema.parse(input.callback);
  if (!/^[a-f0-9]{64}$/.test(input.requestHash)) {
    throw new Error("Hermes callback request hash must be a SHA-256 digest");
  }
  const nowIso = (input.now ?? new Date()).toISOString();
  const identityHash = createHash("sha256")
    .update(`${callback.taskId}\0${callback.callbackId}`)
    .digest("hex");
  return hermesDesignCallbackJobSchema.parse({
    schemaVersion: HERMES_DESIGN_CALLBACK_JOB_SCHEMA_VERSION,
    id: `hermes_callback_${identityHash.slice(0, 40)}`,
    idempotencyKey: `hermes_callback_${identityHash}`,
    taskId: callback.taskId,
    callbackId: callback.callbackId,
    requestHash: input.requestHash,
    callback,
    status: "queued",
    attemptCount: 0,
    maxAttempts: input.maxAttempts ?? 5,
    nextRunAt: nowIso,
    createdAt: nowIso,
    updatedAt: nowIso
  });
}

export async function runHermesDesignCallbackWorker(input: {
  projectRoot?: string;
  store: HermesDesignStore;
  discoveryStore?: DiscoveryDesignStore;
  loopSpecStore?: LoopSpecRegistryStore;
  workerId?: string;
  limit?: number;
  leaseSeconds?: number;
  now?: Date;
}): Promise<HermesDesignCallbackWorkerResult> {
  const now = input.now ?? new Date();
  const workerId = input.workerId?.trim() || `hermes-callback-${process.pid}`;
  const limit = boundedInteger(input.limit, 10, 1, 100);
  const leaseSeconds = boundedInteger(input.leaseSeconds, 300, 30, 3600);
  const claimed = await input.store.claimDueCallbackJobsAtomically({
    claimedBy: workerId,
    now,
    leaseSeconds,
    limit
  });
  const items: HermesDesignCallbackWorkerItem[] = [];
  for (const job of claimed) {
    items.push(await processClaimedCallback({
      projectRoot: input.projectRoot,
      store: input.store,
      discoveryStore: input.discoveryStore,
      loopSpecStore: input.loopSpecStore,
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
    items
  };
}

async function processClaimedCallback(input: {
  projectRoot?: string;
  store: HermesDesignStore;
  discoveryStore?: DiscoveryDesignStore;
  loopSpecStore?: LoopSpecRegistryStore;
  job: HermesDesignCallbackJob;
  now: Date;
}): Promise<HermesDesignCallbackWorkerItem> {
  const leaseToken = input.job.lease?.leaseToken;
  if (!leaseToken) {
    throw new Error(`Claimed Hermes callback job has no lease: ${input.job.id}`);
  }
  try {
    const result = await processHermesDesignCallback({
      projectRoot: input.projectRoot,
      callback: input.job.callback,
      now: input.now
    }, {
      store: input.store,
      discoveryStore: input.discoveryStore,
      loopSpecStore: input.loopSpecStore
    });
    const completedAt = input.now.toISOString();
    const saved = await input.store.updateCallbackJobAtomically({
      jobId: input.job.id,
      expectedLeaseToken: leaseToken,
      update: (current) => hermesDesignCallbackJobSchema.parse({
        ...current,
        status: "completed",
        lease: undefined,
        result: {
          duplicate: result.duplicate,
          designRunId: result.designRunId,
          validationErrors: result.validationErrors,
          completedAt
        },
        lastError: undefined,
        deadLetterReason: undefined,
        updatedAt: completedAt
      })
    });
    return {
      jobId: saved.id,
      taskId: saved.taskId,
      callbackId: saved.callbackId,
      status: "completed",
      attemptCount: saved.attemptCount,
      duplicate: result.duplicate,
      ...(result.designRunId ? { designRunId: result.designRunId } : {})
    };
  } catch (error) {
    return failClaimedCallback(input, leaseToken, error);
  }
}

async function failClaimedCallback(
  input: {
    store: HermesDesignStore;
    job: HermesDesignCallbackJob;
    now: Date;
  },
  leaseToken: string,
  error: unknown
): Promise<HermesDesignCallbackWorkerItem> {
  const message = boundedError(
    error instanceof Error ? error.message : "Hermes callback processing failed"
  );
  const failedAt = input.now.toISOString();
  const deadLetter = input.job.attemptCount >= input.job.maxAttempts;
  const nextRunAt = deadLetter
    ? input.job.nextRunAt
    : new Date(
        input.now.getTime() + retryDelaySeconds(input.job) * 1000
      ).toISOString();
  const saved = await input.store.updateCallbackJobAtomically({
    jobId: input.job.id,
    expectedLeaseToken: leaseToken,
    update: (current) => hermesDesignCallbackJobSchema.parse({
      ...current,
      status: deadLetter ? "dead_letter" : "failed",
      lease: undefined,
      nextRunAt,
      lastError: {
        message,
        at: failedAt
      },
      deadLetterReason: deadLetter
        ? "Hermes design callback processing exhausted its configured attempts."
        : undefined,
      updatedAt: failedAt
    })
  });
  return {
    jobId: saved.id,
    taskId: saved.taskId,
    callbackId: saved.callbackId,
    status: deadLetter ? "dead_letter" : "retry_scheduled",
    attemptCount: saved.attemptCount,
    ...(deadLetter ? {} : { nextRunAt: saved.nextRunAt }),
    error: message
  };
}

function retryDelaySeconds(job: HermesDesignCallbackJob): number {
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
  return value.trim().slice(0, 1000) || "Hermes callback processing failed";
}
