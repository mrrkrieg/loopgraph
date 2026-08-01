import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { initLoopgraphWorkspace } from "loopgraph/runtime";
import { GET } from "./route";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("scheduled measurement API", () => {
  it("fails closed without CRON_SECRET and schedules plus reconciles when authenticated", async () => {
    const projectRoot = await temporaryProjectRoot();
    await initLoopgraphWorkspace({ projectRoot });
    vi.stubEnv("LOOPGRAPH_PROJECT_ROOT", projectRoot);

    const unconfigured = await GET(new Request("https://loopgraph.local/api/cron/measurements"));
    expect(unconfigured.status).toBe(503);

    vi.stubEnv("CRON_SECRET", "measurement-cron-token");
    const response = await GET(new Request("https://loopgraph.local/api/cron/measurements", {
      headers: { authorization: "Bearer measurement-cron-token" }
    }));
    const body = await response.json();

    expect(response.status).toBe(202);
    expect(body).toMatchObject({
      schedule: {
        created: [],
        existing: [],
        blockedBindings: []
      },
      reconciliation: {
        report: {
          status: "blocked",
          issues: [expect.objectContaining({ kind: "webhook_manifest_missing" })]
        },
        controllerTrigger: { enqueued: true }
      }
    });
  });
});

async function temporaryProjectRoot() {
  const projectRoot = await mkdtemp(path.join(tmpdir(), "loopgraph-measurement-cron-"));
  await writeFile(path.join(projectRoot, "package.json"), JSON.stringify({
    name: "loopgraph-measurement-cron-test"
  }));
  return projectRoot;
}
