import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  selectDiscoveryDepartments,
  startHermesDiscoverySession
} from "loopgraph/runtime";
import { GET, POST } from "./route";

describe("evidence gap API", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("returns at most three questions and persists an answer into the shared session", async () => {
    const projectRoot = await temporaryProjectRoot();
    vi.stubEnv("LOOPGRAPH_PROJECT_ROOT", projectRoot);
    const session = await startHermesDiscoverySession({
      projectRoot,
      sessionId: "session_gap_api",
      companyId: "company_gap_api",
      createdByActor: "api"
    });
    const selected = await selectDiscoveryDepartments({
      projectRoot,
      sessionId: session.id,
      departments: ["product"],
      activeDepartment: "product",
      expectedRevision: session.revision,
      actor: "api"
    });

    const listed = await GET(new Request(
      `https://loopgraph.local/api/discovery/session/${session.id}/evidence-gaps?limit=99`
    ), {
      params: Promise.resolve({ sessionId: session.id })
    });
    const body = await listed.json();
    expect(listed.status).toBe(200);
    expect(body.questions).toHaveLength(3);

    const answered = await POST(new Request(
      `https://loopgraph.local/api/discovery/session/${session.id}/evidence-gaps`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          gapId: body.questions[0].gapId,
          answer: "PostHog and Linear",
          expectedRevision: selected.revision
        })
      }
    ), {
      params: Promise.resolve({ sessionId: session.id })
    });
    await expect(answered.json()).resolves.toMatchObject({
      session: {
        revision: selected.revision + 1,
        answers: [expect.objectContaining({
          confirmedByUser: true,
          source: "user"
        })]
      }
    });
    expect(answered.status).toBe(201);
  });
});

async function temporaryProjectRoot() {
  const projectRoot = await mkdtemp(path.join(tmpdir(), "loopgraph-evidence-gap-api-"));
  await writeFile(path.join(projectRoot, "package.json"), JSON.stringify({
    name: "evidence-gap-api-project"
  }));
  return projectRoot;
}
