import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  LOOPGRAPH_CONTROLLER_TOOL_NAMES,
  callLoopgraphControllerTool
} from "./loop-controller-tools";
import { initLoopgraphWorkspace } from "./workspace";

describe("loop controller tools", () => {
  it("runs, reads, and configures the controller through the trusted tool surface", async () => {
    const projectRoot = await temporaryProjectRoot();
    await initLoopgraphWorkspace({ projectRoot });

    const configured = await callLoopgraphControllerTool("loopgraph_controller_policy_set", {
      projectRoot,
      policy: {
        enabled: true,
        autoStartDesign: false,
        autoEvaluateOutcomes: true,
        autoShadowMaterialization: false,
        qualifyThreshold: 50,
        autoDesignThreshold: 70,
        autoShadowThreshold: 90,
        maxDecisionsPerRun: 10,
        cooldownSeconds: 120,
        maximumSignalSeverityForAutoShadow: "low",
        blockedAutoShadowDepartments: ["ops_finance", "hr_talent", "legal_compliance"],
        allowedAutoShadowChangeOperations: ["add"],
        requireNoOpenQuestions: true,
        requireNoUserApprovalItems: true,
        requireRoutingConnectionsReady: true
      }
    });
    const executed = await callLoopgraphControllerTool("loopgraph_controller_run", {
      projectRoot,
      triggerType: "manual",
      triggerId: "tool_run_1",
      sourceRef: "test:tool"
    }, {
      now: new Date("2026-07-29T16:00:00.000Z")
    });
    const listed = await callLoopgraphControllerTool("loopgraph_controller_runs_get", {
      projectRoot
    });

    expect(LOOPGRAPH_CONTROLLER_TOOL_NAMES).toHaveLength(4);
    expect(configured).toMatchObject({
      policy: {
        autoStartDesign: false,
        autoShadowMaterialization: false,
        qualifyThreshold: 50
      }
    });
    expect(executed).toMatchObject({
      duplicate: false,
      run: { status: "completed" }
    });
    if (!("run" in executed) || !executed.run) {
      throw new Error("Expected controller run result");
    }
    expect(listed).toMatchObject({
      runs: [expect.objectContaining({ id: executed.run.id })]
    });
  });
});

async function temporaryProjectRoot() {
  const projectRoot = await mkdtemp(path.join(tmpdir(), "loopgraph-controller-tools-"));
  await writeFile(path.join(projectRoot, "package.json"), JSON.stringify({
    name: "loop-controller-tools-test-project"
  }));
  return projectRoot;
}
