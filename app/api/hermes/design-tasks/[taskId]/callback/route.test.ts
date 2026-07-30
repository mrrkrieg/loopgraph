import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  selectDiscoveryDepartments,
  signLoopgraphTaskPayload,
  startHermesDesignTask,
  startHermesDiscoverySession
} from "loopgraph/runtime";
import { POST } from "./route";

describe("Hermes design task callback API", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("accepts a fresh signed callback and rejects a forged callback", async () => {
    const projectRoot = await temporaryProjectRoot();
    const secret = "callback-secret";
    vi.stubEnv("LOOPGRAPH_PROJECT_ROOT", projectRoot);
    vi.stubEnv("LOOPGRAPH_HERMES_CALLBACK_SECRET", secret);
    const session = await startHermesDiscoverySession({
      projectRoot,
      sessionId: "session_callback_api",
      companyId: "company_callback_api",
      createdByActor: "api"
    });
    await selectDiscoveryDepartments({
      projectRoot,
      sessionId: session.id,
      departments: ["product"],
      activeDepartment: "product",
      expectedRevision: session.revision,
      actor: "api"
    });
    const started = await startHermesDesignTask({
      projectRoot,
      sessionId: session.id
    });
    const callback = {
      schemaVersion: "hermes-design-callback/v1alpha1",
      callbackId: "callback_api_ack_1",
      taskId: started.task.id,
      occurredAt: new Date().toISOString(),
      type: "task.acknowledged"
    };
    const body = JSON.stringify(callback);
    const timestamp = new Date().toISOString();

    const accepted = await POST(callbackRequest({
      taskId: started.task.id,
      body,
      timestamp,
      signature: signLoopgraphTaskPayload(body, timestamp, secret)
    }), {
      params: Promise.resolve({ taskId: started.task.id })
    });
    expect(accepted.status).toBe(202);
    await expect(accepted.json()).resolves.toMatchObject({
      duplicate: false,
      task: {
        id: started.task.id,
        status: "needs_input"
      }
    });

    const forged = await POST(callbackRequest({
      taskId: started.task.id,
      body,
      timestamp,
      signature: signLoopgraphTaskPayload(`${body}altered`, timestamp, secret)
    }), {
      params: Promise.resolve({ taskId: started.task.id })
    });
    expect(forged.status).toBe(401);

    const mismatchedRoute = await POST(callbackRequest({
      taskId: "another_task",
      body,
      timestamp,
      signature: signLoopgraphTaskPayload(body, timestamp, secret)
    }), {
      params: Promise.resolve({ taskId: "another_task" })
    });
    expect(mismatchedRoute.status).toBe(400);
  });

  it("fails closed when callback verification is not configured", async () => {
    vi.stubEnv("LOOPGRAPH_HERMES_CALLBACK_SECRET", "");
    vi.stubEnv("LOOPGRAPH_HERMES_TASK_SECRET", "");
    const response = await POST(new Request("https://loopgraph.local/api/hermes/design-tasks/task_1/callback", {
      method: "POST",
      body: "{}"
    }), {
      params: Promise.resolve({ taskId: "task_1" })
    });

    expect(response.status).toBe(503);
  });
});

function callbackRequest(input: {
  taskId: string;
  body: string;
  timestamp: string;
  signature: string;
}) {
  return new Request(`https://loopgraph.local/api/hermes/design-tasks/${input.taskId}/callback`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-hermes-timestamp": input.timestamp,
      "x-hermes-signature": input.signature
    },
    body: input.body
  });
}

async function temporaryProjectRoot() {
  const projectRoot = await mkdtemp(path.join(tmpdir(), "loopgraph-hermes-callback-api-"));
  await writeFile(path.join(projectRoot, "package.json"), JSON.stringify({
    name: "hermes-callback-api-project"
  }));
  return projectRoot;
}
