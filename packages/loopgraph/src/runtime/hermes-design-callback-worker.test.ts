import { createHash } from "node:crypto";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  hermesDesignCallbackJobSchema,
  hermesDesignTaskSchema,
  type HermesDesignCallback,
  type HermesDesignTask
} from "../core";
import {
  createHermesDesignCallbackJob,
  runHermesDesignCallbackWorker
} from "./hermes-design-callback-worker";
import {
  FileHermesDesignStore,
  type HermesDesignStore
} from "./hermes-design-store";

describe("Hermes design callback worker", () => {
  it("persists, leases, and applies an acknowledged callback", async () => {
    const store = await tempStore();
    const task = designTask("task_callback_success");
    await store.createTaskAtomically(task);
    const callback = acknowledgedCallback(task.id, "callback_success");
    const accepted = await store.acceptCallbackJobAtomically({
      job: callbackJob(callback)
    });

    const result = await runHermesDesignCallbackWorker({
      store,
      workerId: "callback-worker-primary",
      now: new Date("2026-07-30T12:00:01.000Z")
    });

    expect(accepted).toMatchObject({
      authorized: true,
      reason: "accepted",
      created: true
    });
    expect(result).toMatchObject({
      claimed: 1,
      completed: 1,
      retryScheduled: 0,
      deadLettered: 0
    });
    expect(await store.getTask(task.id)).toMatchObject({
      callbackIds: [callback.callbackId],
      delivery: { acknowledgedAt: callback.occurredAt }
    });
    expect(await store.getCallbackJob(accepted.job!.id)).toMatchObject({
      status: "completed",
      attemptCount: 1,
      result: { duplicate: false }
    });
  });

  it("completes a recovered job idempotently when the callback was already applied", async () => {
    const store = await tempStore();
    const task = designTask("task_callback_recovery");
    await store.createTaskAtomically(task);
    const callback = acknowledgedCallback(task.id, "callback_recovery");
    await store.acceptCallbackJobAtomically({ job: callbackJob(callback) });
    await store.applyCallbackAtomically({
      taskId: task.id,
      callback,
      update: (current) => hermesDesignTaskSchema.parse({
        ...current,
        callbackIds: [...current.callbackIds, callback.callbackId],
        updatedAt: callback.occurredAt
      })
    });

    const result = await runHermesDesignCallbackWorker({
      store,
      now: new Date("2026-07-30T12:00:01.000Z")
    });

    expect(result.items[0]).toMatchObject({
      status: "completed",
      duplicate: true
    });
    expect((await store.getTask(task.id))?.callbackIds).toEqual([
      callback.callbackId
    ]);
  });

  it("retries processing failures and dead-letters the final attempt", async () => {
    const store = await tempStore();
    const task = designTask("task_callback_retry");
    await store.createTaskAtomically(task);
    const callback = acknowledgedCallback(task.id, "callback_retry");
    const job = hermesDesignCallbackJobSchema.parse({
      ...callbackJob(callback),
      maxAttempts: 2
    });
    await store.acceptCallbackJobAtomically({ job });
    const failingStore = failCallbackApplication(store);

    const first = await runHermesDesignCallbackWorker({
      store: failingStore,
      now: new Date("2026-07-30T12:00:01.000Z")
    });
    expect(first.retryScheduled).toBe(1);
    expect(first.items[0]).toMatchObject({
      status: "retry_scheduled",
      nextRunAt: "2026-07-30T12:00:31.000Z"
    });

    const second = await runHermesDesignCallbackWorker({
      store: failingStore,
      now: new Date("2026-07-30T12:00:31.000Z")
    });
    expect(second.deadLettered).toBe(1);
    expect(await store.getCallbackJob(job.id)).toMatchObject({
      status: "dead_letter",
      attemptCount: 2
    });
    expect((await store.getTask(task.id))?.callbackIds).toEqual([]);
  });
});

async function tempStore(): Promise<FileHermesDesignStore> {
  return new FileHermesDesignStore(
    await mkdtemp(path.join(tmpdir(), "loopgraph-hermes-callback-worker-"))
  );
}

function designTask(id: string): HermesDesignTask {
  return hermesDesignTaskSchema.parse({
    id,
    idempotencyKey: `design_${id}`,
    sessionId: "session_1",
    companyId: "company_1",
    department: "product",
    status: "queued",
    reason: "user_requested",
    createdAt: "2026-07-30T12:00:00.000Z",
    updatedAt: "2026-07-30T12:00:00.000Z"
  });
}

function acknowledgedCallback(
  taskId: string,
  callbackId: string
): HermesDesignCallback {
  return {
    schemaVersion: "hermes-design-callback/v1alpha1",
    callbackId,
    taskId,
    occurredAt: "2026-07-30T12:00:00.000Z",
    type: "task.acknowledged"
  };
}

function callbackJob(callback: HermesDesignCallback) {
  const requestHash = createHash("sha256")
    .update(JSON.stringify(callback))
    .digest("hex");
  return createHermesDesignCallbackJob({
    callback,
    requestHash,
    now: new Date("2026-07-30T12:00:00.000Z")
  });
}

function failCallbackApplication(
  store: FileHermesDesignStore
): HermesDesignStore {
  return new Proxy(store, {
    get(target, property) {
      if (property === "applyCallbackAtomically") {
        return async () => {
          throw new Error("simulated callback compiler failure");
        };
      }
      const value = Reflect.get(target, property, target);
      return typeof value === "function" ? value.bind(target) : value;
    }
  });
}
