import path from "node:path";
import {
  loopControllerTriggerRecordSchema,
  type LoopControllerTriggerRecord
} from "../core";
import {
  runLoopController,
  type LoopControllerRuntimeOptions
} from "./loop-controller";
import { FileLoopControllerStore } from "./loop-controller-store";
import { getLoopgraphRoot } from "./storage-resolver";

export const LOOP_CONTROLLER_SCHEDULER_SCHEMA_VERSION = "loop-controller-scheduler/v1alpha1" as const;

export type RunLoopControllerSchedulerInput = {
  projectRoot?: string;
  limit?: number;
  maxAttempts?: number;
  processingLeaseSeconds?: number;
  now?: Date;
};

export type LoopControllerSchedulerItem = {
  triggerRecordId: string;
  triggerId: string;
  status: LoopControllerTriggerRecord["status"];
  controllerRunId?: string;
  duplicateRun?: boolean;
  error?: string;
};

export type LoopControllerSchedulerResult = {
  schemaVersion: typeof LOOP_CONTROLLER_SCHEDULER_SCHEMA_VERSION;
  claimed: number;
  completed: number;
  failed: number;
  items: LoopControllerSchedulerItem[];
};

export async function runLoopControllerScheduler(
  input: RunLoopControllerSchedulerInput = {},
  options: LoopControllerRuntimeOptions = {}
): Promise<LoopControllerSchedulerResult> {
  const projectRoot = path.resolve(input.projectRoot ?? process.cwd());
  const now = input.now ?? new Date();
  const store = options.store ?? new FileLoopControllerStore(getLoopgraphRoot(projectRoot));
  const limit = boundedInteger(input.limit ?? 20, 1, 100, "Controller scheduler limit");
  const maxAttempts = boundedInteger(input.maxAttempts ?? 3, 1, 20, "Controller scheduler max attempts");
  const leaseSeconds = boundedInteger(
    input.processingLeaseSeconds ?? 300,
    30,
    3600,
    "Controller trigger lease seconds"
  );
  const claimed = await store.claimTriggers({
    limit,
    maxAttempts,
    leaseSeconds,
    now
  });

  const items: LoopControllerSchedulerItem[] = [];
  for (const record of claimed) {
    const leaseId = record.leaseId;
    if (!leaseId) {
      throw new Error(`Claimed controller trigger is missing a lease: ${record.id}`);
    }
    try {
      const result = await runLoopController({
        projectRoot,
        trigger: record.trigger,
        now
      }, {
        ...options,
        store
      });
      const completed = loopControllerTriggerRecordSchema.parse({
        ...record,
        status: result.run.status === "failed" ? "failed" : "completed",
        controllerRunId: result.run.id,
        error: result.run.status === "failed"
          ? result.run.errors.map((item) => item.message).join("; ") || "Controller run failed"
          : undefined,
        updatedAt: now.toISOString(),
        leaseId: undefined,
        leaseExpiresAt: undefined,
        ...(result.run.status === "failed" ? {} : { completedAt: now.toISOString() })
      });
      await store.settleTrigger(completed, leaseId);
      items.push({
        triggerRecordId: completed.id,
        triggerId: completed.trigger.id,
        status: completed.status,
        controllerRunId: result.run.id,
        duplicateRun: result.duplicate,
        error: completed.error
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const failed = loopControllerTriggerRecordSchema.parse({
        ...record,
        status: "failed",
        error: message,
        updatedAt: now.toISOString(),
        leaseId: undefined,
        leaseExpiresAt: undefined
      });
      await store.settleTrigger(failed, leaseId);
      items.push({
        triggerRecordId: failed.id,
        triggerId: failed.trigger.id,
        status: "failed",
        error: message
      });
    }
  }

  return {
    schemaVersion: LOOP_CONTROLLER_SCHEDULER_SCHEMA_VERSION,
    claimed: claimed.length,
    completed: items.filter((item) => item.status === "completed").length,
    failed: items.filter((item) => item.status === "failed").length,
    items
  };
}

function boundedInteger(value: number, minimum: number, maximum: number, label: string) {
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    throw new Error(`${label} must be an integer from ${minimum} to ${maximum}.`);
  }
  return value;
}
