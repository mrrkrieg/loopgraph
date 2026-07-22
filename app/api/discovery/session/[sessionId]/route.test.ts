import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { startHermesDiscoverySession } from "loopgraph/runtime";
import { GET } from "./route";

describe("browser discovery session detail API", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("resumes a project-local Hermes discovery session by id", async () => {
    const projectRoot = await mkdtemp(path.join(tmpdir(), "loopgraph-discovery-detail-api-"));
    vi.stubEnv("LOOPGRAPH_PROJECT_ROOT", projectRoot);
    process.env.LOOPGRAPH_PROJECT_ROOT = projectRoot;
    await startHermesDiscoverySession({
      projectRoot,
      sessionId: "session_hermes_detail",
      companyId: "company_hermes_detail",
      companyName: "Hermes Detail Co",
      createdByActor: "hermes"
    });

    const response = await GET(new Request("https://loopgraph.local/api/discovery/session/session_hermes_detail"), {
      params: Promise.resolve({ sessionId: "session_hermes_detail" })
    });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      id: "session_hermes_detail",
      companyId: "company_hermes_detail",
      createdByActor: "hermes",
      companyProfile: { name: "Hermes Detail Co" }
    });
  });
});
