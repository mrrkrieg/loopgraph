import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  hermesDesignTaskSchema,
  type HermesDesignRequest,
  type HermesDesignTask
} from "../core";
import {
  createHermesDesignDispatchJob,
  type HermesTaskTransport
} from "./hermes-design-bridge";
import { runHermesDesignDispatchWorker } from "./hermes-design-dispatch-worker";
import { FileHermesDesignStore } from "./hermes-design-store";

describe("Hermes design dispatch worker", () => {
  it("delivers a leased job and reconciles the task receipt", async () => {
    const store = await tempStore();
    const task = designTask("task_success");
    await store.createTaskAtomically(task, {
      dispatchJob: createHermesDesignDispatchJob(
        designRequest(task),
        new Date("2026-07-30T12:00:00.000Z")
      )
    });
    const transport: HermesTaskTransport = {
      dispatch: vi.fn().mockResolvedValue({
        sent: true,
        destination: "https://hermes.example/tasks",
        responseStatus: 202,
        hermesTaskId: "hermes_123"
      })
    };

    const result = await runHermesDesignDispatchWorker({
      store,
      transport,
      workerId: "worker_primary",
      now: new Date("2026-07-30T12:00:01.000Z")
    });

    expect(result).toMatchObject({
      claimed: 1,
      completed: 1,
      retryScheduled: 0,
      deadLettered: 0
    });
    const savedTask = await store.getTask(task.id);
    expect(savedTask).toMatchObject({
      status: "awaiting_hermes",
      hermesTaskId: "hermes_123",
      delivery: {
        status: "sent",
        attemptCount: 1,
        responseStatus: 202
      }
    });
    expect((await store.listDispatchJobs())[0]).toMatchObject({
      status: "completed",
      attemptCount: 1,
      result: { hermesTaskId: "hermes_123" }
    });
  });

  it("schedules retries and dead-letters the final failed attempt", async () => {
    const store = await tempStore();
    const task = designTask("task_retry");
    const job = createHermesDesignDispatchJob(
      designRequest(task),
      new Date("2026-07-30T12:00:00.000Z")
    );
    job.maxAttempts = 2;
    await store.createTaskAtomically(task, { dispatchJob: job });
    const transport: HermesTaskTransport = {
      dispatch: vi.fn().mockResolvedValue({
        sent: false,
        destination: "https://hermes.example/tasks",
        responseStatus: 503,
        error: "Hermes unavailable"
      })
    };

    const first = await runHermesDesignDispatchWorker({
      store,
      transport,
      now: new Date("2026-07-30T12:00:01.000Z")
    });
    expect(first.retryScheduled).toBe(1);
    expect(first.items[0].nextRunAt).toBe("2026-07-30T12:00:31.000Z");

    const second = await runHermesDesignDispatchWorker({
      store,
      transport,
      now: new Date("2026-07-30T12:00:31.000Z")
    });
    expect(second.deadLettered).toBe(1);
    expect((await store.getTask(task.id))?.status).toBe("failed");
    expect((await store.listDispatchJobs())[0]).toMatchObject({
      status: "dead_letter",
      attemptCount: 2
    });
  });
});

async function tempStore(): Promise<FileHermesDesignStore> {
  return new FileHermesDesignStore(
    await mkdtemp(path.join(tmpdir(), "loopgraph-hermes-dispatch-worker-"))
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
