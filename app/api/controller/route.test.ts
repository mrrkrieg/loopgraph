import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { initLoopgraphWorkspace } from "loopgraph/runtime";
import { GET, POST } from "./route";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("controller API", () => {
  it("requires authentication, enqueues a trigger, drains it, and exposes its receipt", async () => {
    const projectRoot = await temporaryProjectRoot();
    await initLoopgraphWorkspace({ projectRoot });
    vi.stubEnv("LOOPGRAPH_PROJECT_ROOT", projectRoot);
    vi.stubEnv("LOOPGRAPH_WORKER_API_TOKEN", "controller-test-token");

    const unauthorized = await POST(new Request("https://loopgraph.local/api/controller", {
      method: "POST"
    }));
    expect(unauthorized.status).toBe(401);

    const response = await POST(new Request("https://loopgraph.local/api/controller", {
      method: "POST",
      headers: {
        authorization: "Bearer controller-test-token",
        "content-type": "application/json"
      },
      body: JSON.stringify({
        mode: "run",
        triggerType: "manual",
        triggerId: "api_controller_1",
        sourceRef: "test:api"
      })
    }));
    const body = await response.json();
    expect(response.status).toBe(202);
    expect(body).toMatchObject({
      enqueue: {
        duplicate: false,
        record: { trigger: { id: "api_controller_1" } }
      },
      scheduler: {
        claimed: 1,
        completed: 1
      }
    });

    const statusResponse = await GET(new Request("https://loopgraph.local/api/controller", {
      headers: { authorization: "Bearer controller-test-token" }
    }));
    await expect(statusResponse.json()).resolves.toMatchObject({
      runs: [expect.objectContaining({ status: "completed" })],
      triggers: [expect.objectContaining({ status: "completed" })]
    });
  });
});

async function temporaryProjectRoot() {
  const projectRoot = await mkdtemp(path.join(tmpdir(), "loopgraph-controller-api-"));
  await writeFile(path.join(projectRoot, "package.json"), JSON.stringify({
    name: "loop-controller-api-test"
  }));
  return projectRoot;
}
