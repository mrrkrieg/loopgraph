import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { callLoopgraphConnectionTool } from "./connection-tools";
import { initLoopgraphWorkspace } from "./workspace";

describe("connection administration tools", () => {
  it("registers and health-checks only non-secret connector metadata", async () => {
    const projectRoot = await mkdtemp(path.join(tmpdir(), "loopgraph-connection-tools-"));
    await writeFile(path.join(projectRoot, "package.json"), JSON.stringify({ name: "connection-tools-test" }));
    await initLoopgraphWorkspace({ projectRoot });

    await expect(callLoopgraphConnectionTool("loopgraph_connections_register", {
      id: "unsafe",
      manifestId: "product_analytics",
      capabilityKeys: ["analytics.read"],
      grantedScopes: [],
      credentialRef: "sk-live-raw-secret",
      status: "connected"
    }, { projectRoot })).rejects.toThrow(/opaque/);

    const registered = await callLoopgraphConnectionTool("loopgraph_connections_register", {
      id: "analytics_main",
      manifestId: "product_analytics",
      capabilityKeys: ["analytics.read"],
      grantedScopes: [],
      credentialRef: "hermes://credentials/analytics-main",
      status: "connected",
      environment: "live",
      readPolicy: "read_only",
      writePolicy: "not_allowed"
    }, { projectRoot });
    expect(registered).toMatchObject({
      connection: {
        id: "analytics_main",
        credentialRef: "hermes://credentials/analytics-main"
      }
    });

    const health = await callLoopgraphConnectionTool("loopgraph_connections_health_report", {
      instanceId: "analytics_main",
      status: "degraded",
      checkedAt: "2026-07-29T23:00:00.000Z",
      checkedBy: "hermes-probe",
      errorCode: "provider_timeout",
      evidenceRefs: ["health:analytics-main:2026-07-29"]
    }, { projectRoot });
    expect(health).toMatchObject({
      connection: {
        status: "degraded",
        health: {
          checkedBy: "hermes-probe",
          errorCode: "provider_timeout"
        }
      }
    });

    await expect(callLoopgraphConnectionTool("loopgraph_connections_get", {}, {
      projectRoot
    })).resolves.toMatchObject({
      connections: [expect.objectContaining({ id: "analytics_main" })]
    });
  });
});
