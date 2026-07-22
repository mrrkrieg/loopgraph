import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createLocalDesignStudioSpec } from "./local-workspace";
import { getSemanticTopology, getWorkspace, startLoopRun } from "./workspace";

describe("workspace fallback", () => {
  const originalDisableLocalRegistry = process.env.LOOPGRAPH_DISABLE_LOCAL_REGISTRY;
  const originalProjectRoot = process.env.LOOPGRAPH_PROJECT_ROOT;

  beforeEach(() => {
    process.env.LOOPGRAPH_DISABLE_LOCAL_REGISTRY = "true";
  });

  afterEach(() => {
    if (originalDisableLocalRegistry === undefined) {
      delete process.env.LOOPGRAPH_DISABLE_LOCAL_REGISTRY;
    } else {
      process.env.LOOPGRAPH_DISABLE_LOCAL_REGISTRY = originalDisableLocalRegistry;
    }
    if (originalProjectRoot === undefined) {
      delete process.env.LOOPGRAPH_PROJECT_ROOT;
    } else {
      process.env.LOOPGRAPH_PROJECT_ROOT = originalProjectRoot;
    }
  });

  it("returns a zero-config Loopgraph workspace with topology data", async () => {
    const workspace = await getWorkspace();

    expect(workspace.organization.name).toBe("Acme Loops");
    expect(workspace.loops.length).toBeGreaterThan(1);
    expect(workspace.graph.nodes.length).toBeGreaterThan(workspace.loops.length);
    expect(workspace.graph.view.selectedNodeId).toContain("loop:");
  });

  it("can build a catalog-enriched Brain topology without a local registry", async () => {
    const topology = await getSemanticTopology(undefined, { includeCatalogLoops: true });
    const workflowLoops = topology.nodes.filter((node) => node.type === "workflow_loop");
    const departments = topology.nodes.filter((node) => node.type === "department_loop");

    expect(topology.metadata.sourceLabel).toBe("Demo catalog");
    expect(workflowLoops.length).toBeGreaterThan(20);
    expect(departments.length).toBeGreaterThan(5);
    expect(topology.edges.some((edge) => edge.source === "loop:management")).toBe(true);
  });

  it("keeps demo catalog loops out of real workspaces unless explicitly requested", async () => {
    const projectRoot = await mkdtemp(path.join(tmpdir(), "loopgraph-no-demo-leakage-"));
    process.env.LOOPGRAPH_DISABLE_LOCAL_REGISTRY = "false";
    process.env.LOOPGRAPH_PROJECT_ROOT = projectRoot;

    await createLocalDesignStudioSpec({
      templateId: "marketing-campaign_learning",
      name: "Real Campaign Loop",
      goal: "Review real campaign efficiency signals."
    });

    const defaultTopology = await getSemanticTopology(undefined, {
      brainLabel: "Hermes Brain",
      hierarchyMode: "hermes_brain"
    });
    const catalogTopology = await getSemanticTopology(undefined, {
      brainLabel: "Hermes Brain",
      hierarchyMode: "hermes_brain",
      includeCatalogLoops: true
    });
    const defaultWorkflowNodes = defaultTopology.nodes.filter((node) => node.type === "workflow_loop");
    const catalogWorkflowNodes = catalogTopology.nodes.filter((node) => node.type === "workflow_loop");

    expect(defaultTopology.metadata.sourceLabel).toBe("Registered LoopSpecs");
    expect(defaultWorkflowNodes.map((node) => node.label)).toEqual(["Real Campaign Loop"]);
    expect(defaultWorkflowNodes.some((node) => node.metadata?.source === "demo_catalog")).toBe(false);
    expect(catalogTopology.metadata.sourceLabel).toBe("Registered LoopSpecs + demo catalog");
    expect(catalogWorkflowNodes.length).toBeGreaterThan(defaultWorkflowNodes.length);
    expect(catalogWorkflowNodes).toEqual(expect.arrayContaining([
      expect.objectContaining({
        metadata: expect.objectContaining({
          source: "demo_catalog",
          templateOnly: true
        })
      })
    ]));
  });

  it("can start a demo run without Supabase", async () => {
    const runBundle = await startLoopRun("loop_demo_marketing_campaign");

    expect(runBundle.run.humanReviewRequired).toBe(true);
    expect(runBundle.steps.length).toBeGreaterThan(0);
    expect(runBundle.steps.map((step) => step.stepType)).toContain("observe");
    expect(runBundle.review?.status).toBe("pending");
  });
});
