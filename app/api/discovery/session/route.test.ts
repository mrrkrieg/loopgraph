import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { GET, POST } from "./route";

describe("browser discovery session API", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("creates and lists project-local Hermes-compatible discovery sessions", async () => {
    const projectRoot = await mkdtemp(path.join(tmpdir(), "loopgraph-discovery-api-"));
    vi.stubEnv("LOOPGRAPH_PROJECT_ROOT", projectRoot);
    process.env.LOOPGRAPH_PROJECT_ROOT = projectRoot;

    const postResponse = await POST(new Request("https://loopgraph.local/api/discovery/session", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        sessionId: "session_browser_api",
        companyId: "company_browser_api",
        companyName: "Browser API Co",
        createdByActor: "browser"
      })
    }));
    const created = await postResponse.json();

    expect(postResponse.status).toBe(201);
    expect(created).toMatchObject({
      id: "session_browser_api",
      companyId: "company_browser_api",
      activeStage: "workspace",
      createdByActor: "browser",
      companyProfile: { name: "Browser API Co" }
    });

    const getResponse = await GET();
    const sessions = await getResponse.json();

    expect(getResponse.status).toBe(200);
    expect(sessions).toEqual([
      expect.objectContaining({
        id: "session_browser_api",
        createdByActor: "browser"
      })
    ]);
  });
});
