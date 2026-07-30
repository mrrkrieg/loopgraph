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
      accepted: true,
      duplicate: false,
      callbackJob: {
        taskId: started.task.id,
        callbackId: callback.callbackId,
        status: "completed"
      },
      processing: {
        status: "completed",
        duplicate: false
      }
    });

    const duplicate = await POST(callbackRequest({
      taskId: started.task.id,
      body,
      timestamp,
      signature: signLoopgraphTaskPayload(body, timestamp, secret)
    }), {
      params: Promise.resolve({ taskId: started.task.id })
    });
    expect(duplicate.status).toBe(200);
    await expect(duplicate.json()).resolves.toMatchObject({
      accepted: true,
      duplicate: true,
      callbackJob: {
        taskId: started.task.id,
        callbackId: callback.callbackId,
        status: "completed"
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

  it("rejects oversized callback bodies before persistence", async () => {
    vi.stubEnv("LOOPGRAPH_HERMES_CALLBACK_SECRET", "callback-secret");
    const response = await POST(new Request(
      "https://loopgraph.local/api/hermes/design-tasks/task_1/callback",
      {
        method: "POST",
        body: "x".repeat(1024 * 1024 + 1)
      }
    ), {
      params: Promise.resolve({ taskId: "task_1" })
    });

    expect(response.status).toBe(413);
    await expect(response.json()).resolves.toEqual({
      error: "Hermes callback body exceeds 1 MiB."
    });
  });

  it("fails closed in hosted mode when the durable callback guard is unavailable", async () => {
    const secret = "callback-secret";
    const callback = {
      schemaVersion: "hermes-design-callback/v1alpha1",
      callbackId: "callback_hosted_1",
      taskId: "task_hosted_1",
      occurredAt: new Date().toISOString(),
      type: "task.acknowledged"
    };
    const body = JSON.stringify(callback);
    const timestamp = new Date().toISOString();
    vi.stubEnv("LOOPGRAPH_HERMES_CALLBACK_SECRET", secret);
    vi.stubEnv("LOOPGRAPH_HOSTED_MODE", "1");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://example.supabase.co");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "publishable");
    vi.stubEnv(
      "LOOPGRAPH_HOSTED_ORGANIZATION_ID",
      "123e4567-e89b-12d3-a456-426614174000"
    );
    vi.stubEnv("LOOPGRAPH_HOSTED_PROJECT_KEY", "main");
    vi.stubEnv("LOOPGRAPH_HERMES_CALLBACK_CREDENTIAL_ID", "hermes_callback");
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "");

    const response = await POST(callbackRequest({
      taskId: callback.taskId,
      body,
      timestamp,
      signature: signLoopgraphTaskPayload(body, timestamp, secret)
    }), {
      params: Promise.resolve({ taskId: callback.taskId })
    });

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({
      error:
        "Supabase Hermes design storage requires NEXT_PUBLIC_SUPABASE_URL, " +
        "SUPABASE_SERVICE_ROLE_KEY, and LOOPGRAPH_HOSTED_ORGANIZATION_ID"
    });
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
