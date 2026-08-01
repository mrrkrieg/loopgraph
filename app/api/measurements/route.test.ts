import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  initLoopgraphWorkspace,
  readConnectionInstances
} from "loopgraph/runtime";
import { GET, POST } from "./route";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("measurement worker API", () => {
  it("fails closed, binds the project root, and stores only opaque connection references", async () => {
    const projectRoot = await temporaryProjectRoot();
    const attackerRoot = await temporaryProjectRoot();
    await initLoopgraphWorkspace({ projectRoot });
    await initLoopgraphWorkspace({ projectRoot: attackerRoot });
    vi.stubEnv("LOOPGRAPH_PROJECT_ROOT", projectRoot);
    vi.stubEnv("LOOPGRAPH_WORKER_API_TOKEN", "measurement-worker-token");

    const unauthorized = await POST(new Request("https://loopgraph.local/api/measurements", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "get_connections" })
    }));
    expect(unauthorized.status).toBe(401);

    const registered = await POST(new Request("https://loopgraph.local/api/measurements", {
      method: "POST",
      headers: authenticatedHeaders(),
      body: JSON.stringify({
        action: "register_connection",
        projectRoot: attackerRoot,
        id: "analytics_main",
        manifestId: "product_analytics",
        capabilityKeys: ["analytics.read"],
        credentialRef: "hermes://credentials/analytics-main",
        grantedScopes: [],
        status: "connected",
        environment: "live",
        readPolicy: "read_only",
        writePolicy: "not_allowed"
      })
    }));
    expect(registered.status).toBe(202);
    expect(await readConnectionInstances(projectRoot)).toMatchObject([{
      id: "analytics_main",
      credentialRef: "hermes://credentials/analytics-main"
    }]);
    expect(await readConnectionInstances(attackerRoot)).toEqual([]);

    const rawSecret = await POST(new Request("https://loopgraph.local/api/measurements", {
      method: "POST",
      headers: authenticatedHeaders(),
      body: JSON.stringify({
        action: "register_connection",
        id: "unsafe",
        manifestId: "product_analytics",
        capabilityKeys: ["analytics.read"],
        credentialRef: "sk-raw-secret-value",
        grantedScopes: [],
        status: "connected"
      })
    }));
    expect(rawSecret.status).toBe(400);
    await expect(rawSecret.json()).resolves.toMatchObject({
      error: expect.stringContaining("opaque")
    });

    const listed = await GET(new Request(
      "https://loopgraph.local/api/measurements?view=connections",
      { headers: { authorization: "Bearer measurement-worker-token" } }
    ));
    await expect(listed.json()).resolves.toMatchObject({
      connections: [expect.objectContaining({ id: "analytics_main" })]
    });
  });
});

function authenticatedHeaders() {
  return {
    authorization: "Bearer measurement-worker-token",
    "content-type": "application/json"
  };
}

async function temporaryProjectRoot() {
  const projectRoot = await mkdtemp(path.join(tmpdir(), "loopgraph-measurement-api-"));
  await writeFile(path.join(projectRoot, "package.json"), JSON.stringify({
    name: "loopgraph-measurement-api-test"
  }));
  return projectRoot;
}
