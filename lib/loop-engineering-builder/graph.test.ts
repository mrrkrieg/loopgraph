import { describe, expect, it } from "vitest";
import { buildLoopGraph, calculateHiddenLaborSummary } from "./graph";
import { getDemoWorkspace } from "./demo-data";

describe("Loopgraph topology", () => {
  it("subtracts hidden labor before reporting net saved time", () => {
    const health = calculateHiddenLaborSummary(
      "loop_1",
      "active",
      {
        baselineMinutes: 600,
        loopExecutionMinutes: 150,
        reviewMinutes: 40,
        reworkMinutes: 20,
        botsittingMinutes: 30,
        escalationMinutes: 10,
        governanceMinutes: 10,
        relationshipRedeploymentMinutes: 500,
        qualityScore: 90
      },
      1,
      2
    );

    expect(health.netTimeSavedMinutes).toBe(340);
    expect(health.relationshipRedeploymentMinutes).toBe(340);
    expect(health.botsittingMinutes).toBe(30);
    expect(health.healthScore).toBeLessThan(90);
  });

  it("builds management, department, loop, data, review, and improvement relationships", () => {
    const workspace = getDemoWorkspace();
    const graph = buildLoopGraph({
      organization: workspace.organization,
      loops: workspace.loops,
      reviews: workspace.runBundle.review ? [workspace.runBundle.review] : [],
      improvements: workspace.improvements,
      selectedNodeId: `loop:${workspace.loop.id}`
    });

    expect(graph.nodes.some((node) => node.id === "loop:management")).toBe(true);
    expect(graph.nodes.some((node) => node.kind === "department")).toBe(true);
    expect(graph.nodes.some((node) => node.kind === "review")).toBe(true);
    expect(graph.nodes.some((node) => node.kind === "improvement")).toBe(true);
    expect(graph.edges.some((edge) => edge.kind === "rolls_up_to")).toBe(true);
    expect(graph.edges.some((edge) => edge.kind === "data_flow")).toBe(true);
    expect(graph.edges.some((edge) => edge.kind === "escalates_to")).toBe(true);
    expect(graph.edges.some((edge) => edge.kind === "improves")).toBe(true);
  });
});
