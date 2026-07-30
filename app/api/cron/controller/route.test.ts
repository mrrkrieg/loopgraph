import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { initLoopgraphWorkspace } from "loopgraph/runtime";
import { GET } from "./route";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("scheduled controller API", () => {
  it("fails closed without CRON_SECRET and runs one authenticated schedule cycle", async () => {
    const projectRoot = await temporaryProjectRoot();
    await initLoopgraphWorkspace({ projectRoot });
    vi.stubEnv("LOOPGRAPH_PROJECT_ROOT", projectRoot);

    const unconfigured = await GET(new Request("https://loopgraph.local/api/cron/controller"));
    expect(unconfigured.status).toBe(503);

    vi.stubEnv("CRON_SECRET", "cron-test-token");
    const response = await GET(new Request("https://loopgraph.local/api/cron/controller", {
      headers: { authorization: "Bearer cron-test-token" }
    }));
    const body = await response.json();

    expect(response.status).toBe(202);
    expect(body).toMatchObject({
      enqueue: { duplicate: false },
      scheduler: { claimed: 1, completed: 1 }
    });
  });
});

async function temporaryProjectRoot() {
  const projectRoot = await mkdtemp(path.join(tmpdir(), "loopgraph-controller-cron-"));
  await writeFile(path.join(projectRoot, "package.json"), JSON.stringify({
    name: "loop-controller-cron-test"
  }));
  return projectRoot;
}
