import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getSemanticTopology, getWorkspace, startLoopRun } from "./workspace";

describe("workspace fallback", () => {
  const originalDisableLocalRegistry = process.env.LOOPGRAPH_DISABLE_LOCAL_REGISTRY;

  beforeEach(() => {
    process.env.LOOPGRAPH_DISABLE_LOCAL_REGISTRY = "true";
  });

  afterEach(() => {
    if (originalDisableLocalRegistry === undefined) {
      delete process.env.LOOPGRAPH_DISABLE_LOCAL_REGISTRY;
    } else {
      process.env.LOOPGRAPH_DISABLE_LOCAL_REGISTRY = originalDisableLocalRegistry;
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

  it("can start a demo run without Supabase", async () => {
    const runBundle = await startLoopRun("loop_demo_marketing_campaign");

    expect(runBundle.run.humanReviewRequired).toBe(true);
    expect(runBundle.steps.length).toBeGreaterThan(0);
    expect(runBundle.steps.map((step) => step.stepType)).toContain("observe");
    expect(runBundle.review?.status).toBe("pending");
  });
});
