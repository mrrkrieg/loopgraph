import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { callLoopgraphWorkspaceTool, loopgraph_departments_list, loopgraph_workspace_inspect } from "./workspace-tools";
import { initLoopgraphWorkspace } from "./workspace";

describe("workspace MCP tool surface", () => {
  it("returns the canonical department catalog with legacy aliases", async () => {
    const result = await loopgraph_departments_list();

    expect(result.count).toBe(10);
    expect(result.departments).toContainEqual(expect.objectContaining({
      id: "marketing",
      label: "Marketing"
    }));
    expect(result.departments).toContainEqual(expect.objectContaining({
      id: "ops_finance",
      aliases: ["operations_finance"]
    }));
    expect(result.departments).toContainEqual(expect.objectContaining({
      id: "hr_talent",
      aliases: ["hr"]
    }));
    expect(result.departments).toContainEqual(expect.objectContaining({
      id: "legal_compliance",
      aliases: ["legal_security"]
    }));
  });

  it("inspects a bound project workspace through the generic dispatcher", async () => {
    const projectRoot = await mkdtemp(path.join(tmpdir(), "loopgraph-workspace-tool-"));
    await initLoopgraphWorkspace({ projectRoot });

    const result = await callLoopgraphWorkspaceTool("loopgraph_workspace_inspect", { projectRoot });

    expect(result).toMatchObject({
      exists: true,
      projectRoot,
      registeredSpecCount: 0
    });
  });

  it("supports direct workspace inspect calls with runtime project root options", async () => {
    const projectRoot = await mkdtemp(path.join(tmpdir(), "loopgraph-workspace-tool-"));
    await initLoopgraphWorkspace({ projectRoot });

    const result = await loopgraph_workspace_inspect({}, { projectRoot });

    expect(result.exists).toBe(true);
    expect(result.registry.projectRootId).toMatch(/^project_/);
  });
});
