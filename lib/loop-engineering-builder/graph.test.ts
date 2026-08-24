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

  it("uses trace hidden labor override when provided", () => {
    const workspace = getDemoWorkspace();
    const lowLabor = buildLoopGraph({
      organization: workspace.organization,
      loops: workspace.loops,
      reviews: [],
      improvements: [],
      hiddenLaborByLoopId: {
        [workspace.loop.id]: {
          baselineMinutes: 600,
          loopExecutionMinutes: 100,
          reviewMinutes: 200,
          reworkMinutes: 100,
          botsittingMinutes: 50,
          escalationMinutes: 50,
          governanceMinutes: 50
        }
      }
    });
    const defaultGraph = buildLoopGraph({
      organization: workspace.organization,
      loops: workspace.loops,
      reviews: [],
      improvements: []
    });
    const lowHealth = lowLabor.health.find((item) => item.loopId === workspace.loop.id)?.healthScore ?? 0;
    const defaultHealth = defaultGraph.health.find((item) => item.loopId === workspace.loop.id)?.healthScore ?? 0;
    expect(lowHealth).toBeLessThan(defaultHealth);
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

  it("overlays runtime cases and traces onto the operating map", () => {
    const workspace = getDemoWorkspace();
    const loop = workspace.loops.find((item) => item.templateId === "cs-strategic-account-escalation");
    expect(loop).toBeTruthy();

    const graph = buildLoopGraph({
      organization: workspace.organization,
      loops: workspace.loops,
      selectedNodeId: loop ? `loop:${loop.id}` : undefined,
      runs: [
        {
          id: "run_test_1",
          loopId: loop?.id ?? "catalog_cs-strategic-account-escalation",
          status: "WAITING_FOR_REVIEW"
        }
      ],
      cases: [
        {
          id: "case_test_1",
          sourceLoopId: loop?.id ?? "catalog_cs-strategic-account-escalation",
          severity: "P1",
          status: "open",
          summary: "Enterprise outage near renewal"
        }
      ]
    });

    expect(graph.nodes.some((node) => node.kind === "trace")).toBe(true);
    expect(graph.nodes.some((node) => node.kind === "escalation_case")).toBe(true);
    expect(graph.edges.some((edge) => edge.kind === "writes_trace_to")).toBe(true);
    expect(graph.edges.some((edge) => edge.kind === "reports_to")).toBe(true);
    if (loop) {
      expect(graph.edges.some((edge) => edge.source === `loop:${loop.id}` && edge.kind === "escalates_to")).toBe(true);
    }
  });
});
