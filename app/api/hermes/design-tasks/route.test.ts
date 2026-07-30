import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  selectDiscoveryDepartments,
  startHermesDiscoverySession
} from "loopgraph/runtime";
import { GET, POST } from "./route";

describe("Hermes design task API", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("creates and lists a project-bound durable design task", async () => {
    const projectRoot = await temporaryProjectRoot();
    vi.stubEnv("LOOPGRAPH_PROJECT_ROOT", projectRoot);
    const session = await startHermesDiscoverySession({
      projectRoot,
      sessionId: "session_design_api",
      companyId: "company_design_api",
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

    const createdResponse = await POST(new Request("https://loopgraph.local/api/hermes/design-tasks", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        sessionId: session.id,
        reason: "user_requested",
        projectRoot: "/tmp/ignored"
      })
    }));
    const created = await createdResponse.json();

    expect(createdResponse.status).toBe(202);
    expect(created).toMatchObject({
      task: {
        sessionId: session.id,
        department: "product",
        status: "needs_input",
        delivery: { status: "not_configured" }
      },
      request: {
        event_type: "loopgraph.design_requested"
      }
    });

    const listedResponse = await GET(new Request(
      `https://loopgraph.local/api/hermes/design-tasks?sessionId=${session.id}`
    ));
    await expect(listedResponse.json()).resolves.toMatchObject({
      tasks: [expect.objectContaining({ id: created.task.id })]
    });
  });

  it("rejects a start request without a discovery session id", async () => {
    const response = await POST(new Request("https://loopgraph.local/api/hermes/design-tasks", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({})
    }));

    expect(response.status).toBe(400);
  });
});

async function temporaryProjectRoot() {
  const projectRoot = await mkdtemp(path.join(tmpdir(), "loopgraph-hermes-design-api-"));
  await writeFile(path.join(projectRoot, "package.json"), JSON.stringify({
    name: "hermes-design-api-project",
    dependencies: { next: "^15.0.0" }
  }));
  return projectRoot;
}
