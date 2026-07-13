import { describe, expect, it } from "vitest";
import {
  buildBrainGraph,
  filterBrainGraphByDepth
} from "./graph-adapter";
import type { SemanticTopology, TopologyEdge, TopologyNode } from "@/lib/loopgraph-core/graph";

describe("buildBrainGraph", () => {
  it("includes company brain, management, department, and workflow loops by default", () => {
    const graph = buildBrainGraph({
      topology: topology([
        node({ id: "company:root", type: "company", label: "Workspace" }),
        node({ id: "loop:management", type: "management_loop", label: "Company Management Loop", loopId: "management" }),
        node({ id: "loop:department:marketing", type: "department_loop", label: "Marketing Department Loop", loopId: "department:marketing" }),
        node({ id: "loop:campaign-learning", type: "workflow_loop", label: "Campaign Learning Loop", loopId: "campaign-learning", parentId: "loop:department:marketing", department: "marketing" })
      ], [
        edge({ source: "company:root", target: "loop:management" }),
        edge({ source: "loop:management", target: "loop:department:marketing" }),
        edge({ source: "loop:department:marketing", target: "loop:campaign-learning" })
      ]),
      includeData: false,
      includeMetrics: false,
      includeReviews: false,
      includeImprove: false
    });

    expect(graph.nodes.map((item) => item.type)).toEqual([
      "company_brain",
      "management_loop",
      "department_loop",
      "workflow_loop"
    ]);
    expect(graph.edges.map((item) => item.type)).toEqual([
      "brain_routes_to",
      "management_calls_department",
      "department_contains_loop"
    ]);
  });

  it("excludes orphans and template-only workflow nodes", () => {
    const graph = buildBrainGraph({
      topology: topology([
        node({ id: "company:root", type: "company" }),
        node({ id: "loop:management", type: "management_loop" }),
        node({ id: "loop:department:marketing", type: "department_loop" }),
        node({ id: "loop:ready", type: "workflow_loop", loopId: "ready", parentId: "loop:department:marketing" }),
        node({ id: "loop:orphan", type: "workflow_loop", loopId: "orphan", isOrphan: true }),
        node({ id: "loop:template", type: "workflow_loop", loopId: "template", metadata: { runtimeLevel: "catalog" } })
      ], [
        edge({ source: "company:root", target: "loop:management" }),
        edge({ source: "loop:management", target: "loop:department:marketing" }),
        edge({ source: "loop:department:marketing", target: "loop:ready" })
      ]),
      includeData: false,
      includeMetrics: false,
      includeReviews: false,
      includeImprove: false
    });

    expect(graph.nodes.map((item) => item.id)).toContain("loop:ready");
    expect(graph.nodes.map((item) => item.id)).not.toContain("loop:orphan");
    expect(graph.nodes.map((item) => item.id)).not.toContain("loop:template");
  });

  it("keeps default graph smaller than the full semantic topology and adds metrics by toggle", () => {
    const sample = topology([
      node({ id: "company:root", type: "company" }),
      node({ id: "loop:management", type: "management_loop" }),
      node({ id: "loop:department:sales", type: "department_loop", department: "sales" }),
      node({ id: "loop:lead-qualification", type: "workflow_loop", loopId: "lead-qualification", parentId: "loop:department:sales", department: "sales" }),
      node({ id: "metric:lead-qualification:conversion", type: "metric", label: "Qualified conversion", layer: "measurement", loopId: "lead-qualification", parentId: "loop:lead-qualification" })
    ], [
      edge({ source: "company:root", target: "loop:management" }),
      edge({ source: "loop:management", target: "loop:department:sales" }),
      edge({ source: "loop:department:sales", target: "loop:lead-qualification" }),
      edge({ source: "loop:lead-qualification", target: "metric:lead-qualification:conversion", kind: "updates_metric" })
    ]);
    const defaultGraph = buildBrainGraph({
      topology: sample,
      includeData: false,
      includeMetrics: false,
      includeReviews: false,
      includeImprove: false
    });
    const withMetrics = buildBrainGraph({
      topology: sample,
      includeData: false,
      includeMetrics: true,
      includeReviews: false,
      includeImprove: false
    });

    expect(defaultGraph.nodes.length).toBeLessThan(sample.nodes.length);
    expect(defaultGraph.nodes.some((item) => item.type === "metric")).toBe(false);
    expect(withMetrics.nodes.some((item) => item.type === "metric")).toBe(true);
  });

  it("removes edges with missing endpoints", () => {
    const graph = buildBrainGraph({
      topology: topology([
        node({ id: "company:root", type: "company" }),
        node({ id: "loop:management", type: "management_loop" })
      ], [
        edge({ source: "company:root", target: "loop:management" }),
        edge({ id: "bad-edge", source: "missing", target: "loop:management" })
      ]),
      includeData: false,
      includeMetrics: false,
      includeReviews: false,
      includeImprove: false
    });

    expect(graph.edges.map((item) => item.id)).not.toContain("bad-edge");
    expect(graph.diagnostics.removedEdges).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: "bad-edge", reason: "missing_source" })])
    );
  });

  it("returns selected local node and direct neighbors at depth one", () => {
    const graph = buildBrainGraph({
      topology: topology([
        node({ id: "company:root", type: "company" }),
        node({ id: "loop:management", type: "management_loop" }),
        node({ id: "loop:department:sales", type: "department_loop", department: "sales" }),
        node({ id: "loop:lead-qualification", type: "workflow_loop", loopId: "lead-qualification", parentId: "loop:department:sales", department: "sales" }),
        node({ id: "loop:far-loop", type: "workflow_loop", loopId: "far-loop", parentId: "loop:department:sales", department: "sales" })
      ], [
        edge({ source: "company:root", target: "loop:management" }),
        edge({ source: "loop:management", target: "loop:department:sales" }),
        edge({ source: "loop:department:sales", target: "loop:lead-qualification" }),
        edge({ source: "loop:department:sales", target: "loop:far-loop" })
      ]),
      includeData: false,
      includeMetrics: false,
      includeReviews: false,
      includeImprove: false
    });
    const local = filterBrainGraphByDepth({
      graph,
      centerId: "loop:lead-qualification",
      depth: 1
    });

    expect(new Set(local.nodes.map((item) => item.id))).toEqual(
      new Set(["loop:lead-qualification", "loop:department:sales"])
    );
  });
});

function topology(nodes: TopologyNode[], edges: TopologyEdge[]): SemanticTopology {
  return {
    id: "test-topology",
    version: 1,
    rootNodeId: "company:root",
    managementLoopId: "loop:management",
    metadata: {
      companyName: "Test Company",
      sourceLabel: "Test",
      generatedAt: new Date(0).toISOString(),
      loopSpecCount: 1,
      departments: []
    },
    nodes,
    edges,
    orphanNodes: [],
    warnings: [],
    filterCounts: {
      total: nodes.length,
      visibleByDefault: nodes.length,
      orphans: 0,
      byType: {} as SemanticTopology["filterCounts"]["byType"],
      byLayer: {} as SemanticTopology["filterCounts"]["byLayer"],
      byDepartment: {},
      byStatus: {} as SemanticTopology["filterCounts"]["byStatus"]
    }
  };
}

function node(overrides: Partial<TopologyNode>): TopologyNode {
  return {
    id: overrides.id ?? "node",
    type: overrides.type ?? "workflow_loop",
    label: overrides.label ?? "Node",
    subtitle: overrides.subtitle,
    description: overrides.description,
    refId: overrides.refId,
    refType: overrides.refType,
    loopId: overrides.loopId,
    department: overrides.department,
    parentId: overrides.parentId,
    parentLoopId: overrides.parentLoopId,
    layer: overrides.layer ?? "structure",
    status: overrides.status ?? "ready",
    weight: overrides.weight ?? 4,
    visibleByDefault: overrides.visibleByDefault ?? true,
    isExpandable: overrides.isExpandable ?? true,
    isOrphan: overrides.isOrphan,
    metadata: overrides.metadata
  };
}

function edge(overrides: Partial<TopologyEdge>): TopologyEdge {
  return {
    id: overrides.id ?? `${overrides.source}->${overrides.target}`,
    source: overrides.source ?? "source",
    target: overrides.target ?? "target",
    kind: overrides.kind ?? "contains",
    label: overrides.label,
    semantic: overrides.semantic ?? true,
    executable: overrides.executable ?? false,
    style: overrides.style ?? "solid",
    metadata: overrides.metadata
  };
}
