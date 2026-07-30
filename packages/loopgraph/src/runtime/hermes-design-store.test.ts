import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  hermesDesignTaskSchema,
  type HermesDesignCallback,
  type HermesDesignRequest,
  type HermesDesignTask
} from "../core";
import { createHermesDesignDispatchJob } from "./hermes-design-bridge";
import { createHermesDesignCallbackJob } from "./hermes-design-callback-worker";
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

  it("commits a task and its outbound dispatch job as one recoverable operation", async () => {
    const store = await tempStore();
    const task = designTask("task_dispatch");
    const job = createHermesDesignDispatchJob(designRequest(task));

    const created = await store.createTaskAtomically(task, { dispatchJob: job });

    expect(created.created).toBe(true);
    expect(created.dispatchJob?.id).toBe(job.id);
    expect(await store.getTask(task.id)).toEqual(task);
    expect(await store.getDispatchJob(job.id)).toEqual(job);
  });

  it("leases one dispatch job to only one concurrent worker", async () => {
    const store = await tempStore();
    const task = designTask("task_claim");
    const job = createHermesDesignDispatchJob(
      designRequest(task),
      new Date("2026-07-30T12:00:00.000Z")
    );
    await store.createTaskAtomically(task, { dispatchJob: job });

    const now = new Date("2026-07-30T12:00:01.000Z");
    const [first, second] = await Promise.all([
      store.claimDueDispatchJobsAtomically({
        claimedBy: "worker_1",
        now,
        leaseSeconds: 60,
        limit: 1
      }),
      store.claimDueDispatchJobsAtomically({
        claimedBy: "worker_2",
        now,
        leaseSeconds: 60,
        limit: 1
      })
    ]);

    expect(first.length + second.length).toBe(1);
    const claimed = [...first, ...second][0];
    expect(claimed.status).toBe("claimed");
    expect(claimed.attemptCount).toBe(1);
    expect(claimed.lease?.claimedBy).toMatch(/^worker_[12]$/);
  });

  it("deduplicates an exact callback delivery and rejects a changed replay", async () => {
    const store = await tempStore();
    const task = designTask("task_callback_inbox");
    await store.createTaskAtomically(task);
    const signedCallback = {
      schemaVersion: "hermes-design-callback/v1alpha1" as const,
      callbackId: "callback_inbox_1",
      taskId: task.id,
      occurredAt: "2026-07-30T12:01:00.000Z",
      type: "task.acknowledged" as const
    };
    const job = createHermesDesignCallbackJob({
      callback: signedCallback,
      requestHash: "a".repeat(64),
      now: new Date("2026-07-30T12:01:00.000Z")
    });

    const first = await store.acceptCallbackJobAtomically({ job });
    const duplicate = await store.acceptCallbackJobAtomically({ job });
    const altered = createHermesDesignCallbackJob({
      callback: {
        ...signedCallback,
        occurredAt: "2026-07-30T12:02:00.000Z"
      },
      requestHash: "b".repeat(64),
      now: new Date("2026-07-30T12:02:00.000Z")
    });

    expect(first).toMatchObject({
      authorized: true,
      reason: "accepted",
      created: true
    });
    expect(duplicate).toMatchObject({
      authorized: true,
      reason: "duplicate",
      created: false,
      job: { id: job.id }
    });
    await expect(
      store.acceptCallbackJobAtomically({ job: altered })
    ).rejects.toThrow("different signed payload");
  });

  it("updates a resumed task and enqueues its new request under one lock", async () => {
    const store = await tempStore();
    const task = designTask("task_resume");
    await store.createTaskAtomically(task);

    const result = await store.updateTaskAndEnqueueDispatchAtomically({
      taskId: task.id,
      update: (current) => {
        const updated = hermesDesignTaskSchema.parse({
          ...current,
          status: "queued",
          updatedAt: "2026-07-30T12:02:00.000Z"
        });
        return {
          task: updated,
          dispatchJob: createHermesDesignDispatchJob(
            designRequest(updated),
            new Date("2026-07-30T12:02:00.000Z")
          )
        };
      }
    });

    expect(result.dispatchCreated).toBe(true);
    expect((await store.getTask(task.id))?.updatedAt).toBe(
      "2026-07-30T12:02:00.000Z"
    );
    expect(await store.getDispatchJob(result.dispatchJob.id)).toEqual(
      result.dispatchJob
    );
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

function designRequest(task: HermesDesignTask): HermesDesignRequest {
  return {
    schemaVersion: "hermes-design-request/v1alpha1" as const,
    event_type: "loopgraph.design_requested" as const,
    task,
    gaps: [],
    nextQuestions: [],
    allowedLoopgraphTools: [
      "loopgraph_opportunities_get",
      "loopgraph_evidence_gaps_get",
      "loopgraph_evidence_gap_answer",
      "loopgraph_design_context_get",
      "loopgraph_design_submit"
    ],
    instructions: []
  };
}
