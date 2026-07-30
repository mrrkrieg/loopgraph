import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  hermesDesignTaskSchema,
  type HermesDesignCallback,
  type HermesDesignTask
} from "../core";
import { FileHermesDesignStore } from "./hermes-design-store";

describe("file Hermes design store", () => {
  it("creates one active task for concurrent idempotent requests", async () => {
    const store = await tempStore();
    const task = designTask("task_1");

    const [first, second] = await Promise.all([
      store.createTaskAtomically(task),
      store.createTaskAtomically({ ...task, id: "task_2" })
    ]);

    expect([first.created, second.created].filter(Boolean)).toHaveLength(1);
    expect(first.task.id).toBe(second.task.id);
    expect(await store.listTasks()).toHaveLength(1);
  });

  it("allows a new attempt after a failed task", async () => {
    const store = await tempStore();
    await store.createTaskAtomically(designTask("failed_task", "failed"));

    const retried = await store.createTaskAtomically(designTask("retry_task"));

    expect(retried.created).toBe(true);
    expect(retried.task.id).toBe("retry_task");
    expect(await store.listTasks()).toHaveLength(2);
  });

  it("merges concurrent callback identities without losing either update", async () => {
    const store = await tempStore();
    const task = designTask("task_callbacks");
    await store.createTaskAtomically(task);
    const callbacks = [
      callback("callback_ack", "task.acknowledged"),
      callback("callback_failed", "task.failed")
    ] as const;

    await Promise.all(callbacks.map((item) =>
      store.applyCallbackAtomically({
        taskId: task.id,
        callback: item,
        update: (current) => hermesDesignTaskSchema.parse({
          ...current,
          callbackIds: [...current.callbackIds, item.callbackId],
          updatedAt: "2026-07-30T12:01:00.000Z"
        })
      })
    ));

    const saved = await store.getTask(task.id);
    expect(saved?.callbackIds.sort()).toEqual([
      "callback_ack",
      "callback_failed"
    ]);
    const duplicate = await store.applyCallbackAtomically({
      taskId: task.id,
      callback: callbacks[0],
      update: () => {
        throw new Error("duplicate callback must not run the updater");
      }
    });
    expect(duplicate.duplicate).toBe(true);
  });
});

async function tempStore(): Promise<FileHermesDesignStore> {
  return new FileHermesDesignStore(
    await mkdtemp(path.join(tmpdir(), "loopgraph-hermes-design-store-"))
  );
}

function designTask(
  id: string,
  status: HermesDesignTask["status"] = "queued"
): HermesDesignTask {
  return hermesDesignTaskSchema.parse({
    id,
    idempotencyKey: "design_key_1",
    sessionId: "session_1",
    companyId: "company_1",
    department: "product",
    status,
    reason: "user_requested",
    createdAt: "2026-07-30T12:00:00.000Z",
    updatedAt: "2026-07-30T12:00:00.000Z"
  });
}

function callback(
  callbackId: string,
  type: "task.acknowledged" | "task.failed"
): HermesDesignCallback {
  return type === "task.acknowledged"
    ? {
        schemaVersion: "hermes-design-callback/v1alpha1",
        callbackId,
        taskId: "task_callbacks",
        occurredAt: "2026-07-30T12:01:00.000Z",
        type
      }
    : {
        schemaVersion: "hermes-design-callback/v1alpha1",
        callbackId,
        taskId: "task_callbacks",
        occurredAt: "2026-07-30T12:01:00.000Z",
        type,
        error: "Hermes stopped",
        retryable: true
      };
}
