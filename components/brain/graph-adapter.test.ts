import { describe, expect, it } from "vitest";
import {
  buildBrainGraph,
  filterBrainGraphByDepth,
  filterBrainGraphForDepartmentStory
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

  it("adapts direct Hermes Brain topology without a management layer", () => {
    const graph = buildBrainGraph({
      topology: topology([
        node({ id: "company:root", type: "company", label: "Hermes Brain" }),
        node({ id: "loop:department:marketing", type: "department_loop", label: "Marketing", loopId: "department:marketing", parentId: "company:root", department: "marketing" }),
        node({ id: "loop:marketing_ads", type: "workflow_loop", label: "Ads", loopId: "marketing_ads", parentId: "loop:department:marketing", department: "marketing" }),
        node({ id: "loop:marketing_content_creation", type: "workflow_loop", label: "Content Creation", loopId: "marketing_content_creation", parentId: "loop:department:marketing", department: "marketing" })
      ], [
        edge({ source: "company:root", target: "loop:department:marketing" }),
        edge({ source: "loop:department:marketing", target: "loop:marketing_ads" }),
        edge({ source: "loop:department:marketing", target: "loop:marketing_content_creation" })
      ], {
        brainLabel: "Hermes Brain",
        hierarchyMode: "hermes_brain",
        managementLoopId: "company:root"
      }),
      includeData: false,
      includeMetrics: false,
      includeReviews: false,
      includeImprove: false
    });

    expect(graph.nodes.map((item) => item.label)).toEqual([
      "Hermes Brain",
      "Marketing",
      "Ads",
      "Content Creation"
    ]);
    expect(graph.edges.map((item) => item.type)).toEqual([
      "brain_routes_to",
      "department_contains_loop",
      "department_contains_loop"
    ]);
  });

  it("keeps an installed app boundary visible between its department and loops", () => {
    const graph = buildBrainGraph({
      topology: topology([
        node({ id: "company:root", type: "company", label: "Hermes Brain" }),
        node({ id: "loop:department:sales", type: "department_loop", label: "Sales", parentId: "company:root", department: "sales" }),
        node({ id: "app:sales-inbound", type: "workflow_loop", label: "Qualify and Route Inbound Leads", parentId: "loop:department:sales", department: "sales", metadata: { appNode: true, installationId: "install.sales-inbound" } }),
        node({ id: "loop:lead-intake", type: "task_loop", label: "Lead Intake", loopId: "lead-intake", parentId: "app:sales-inbound", department: "sales", metadata: { appId: "sales-inbound" } }),
        node({ id: "loop:lead-qualification", type: "task_loop", label: "Lead Qualification", loopId: "lead-qualification", parentId: "app:sales-inbound", department: "sales", metadata: { appId: "sales-inbound" } })
      ], [
        edge({ source: "company:root", target: "loop:department:sales" }),
        edge({ source: "loop:department:sales", target: "app:sales-inbound" }),
        edge({ source: "app:sales-inbound", target: "loop:lead-intake" }),
        edge({ source: "app:sales-inbound", target: "loop:lead-qualification" })
      ], { brainLabel: "Hermes Brain", hierarchyMode: "hermes_brain", managementLoopId: "company:root" }),
      includeData: false,
      includeMetrics: false,
      includeReviews: false,
      includeImprove: false
    });

    expect(graph.nodes.map((item) => item.id)).toEqual(expect.arrayContaining([
      "company:root",
      "loop:department:sales",
      "app:sales-inbound",
      "loop:lead-intake",
      "loop:lead-qualification"
    ]));
    expect(graph.nodes).toHaveLength(5);
    expect(graph.nodes.find((item) => item.id === "app:sales-inbound")).toMatchObject({
      radius: 36,
      color: "#fff7ed",
      metadata: { appNode: true, installationId: "install.sales-inbound" }
    });
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

  it("shows demo catalog loops only when explicitly requested", () => {
    const sample = topology([
      node({ id: "company:root", type: "company", label: "Hermes Brain" }),
      node({ id: "loop:department:marketing", type: "department_loop", label: "Marketing", department: "marketing" }),
      node({ id: "loop:marketing_ads", type: "workflow_loop", label: "Ads", loopId: "marketing_ads", parentId: "loop:department:marketing", department: "marketing", metadata: { source: "local_spec" } }),
      node({ id: "loop:catalog_content", type: "workflow_loop", label: "Content Template", loopId: "catalog_content", parentId: "loop:department:marketing", department: "marketing", metadata: { source: "demo_catalog", runtimeLevel: "spec_stub", templateOnly: true } })
    ], [
      edge({ source: "company:root", target: "loop:department:marketing" }),
      edge({ source: "loop:department:marketing", target: "loop:marketing_ads" }),
      edge({ source: "loop:department:marketing", target: "loop:catalog_content" })
    ], {
      brainLabel: "Hermes Brain",
      hierarchyMode: "hermes_brain",
      managementLoopId: "company:root"
    });
    const hidden = buildBrainGraph({
      topology: sample,
      includeData: false,
      includeMetrics: false,
      includeReviews: false,
      includeImprove: false
    });
    const visible = buildBrainGraph({
      topology: sample,
      includeCatalogLoops: true,
      includeData: false,
      includeMetrics: false,
      includeReviews: false,
      includeImprove: false
    });

    expect(hidden.nodes.map((item) => item.id)).toContain("loop:marketing_ads");
    expect(hidden.nodes.map((item) => item.id)).not.toContain("loop:catalog_content");
    expect(hidden.diagnostics.hiddenNodeIds).toContain("loop:catalog_content");
    expect(visible.nodes).toContainEqual(expect.objectContaining({
      id: "loop:catalog_content",
      label: "Demo: Content Template",
      subtitle: expect.stringContaining("Demo catalog")
    }));
    expect(visible.edges).toContainEqual(expect.objectContaining({
      source: "loop:department:marketing",
      target: "loop:catalog_content"
    }));
  });

  it("adds a hosted preview story layer without changing local catalog semantics", () => {
    const sample = topology([
      node({ id: "company:root", type: "company", label: "Hermes Brain", metadata: { hierarchyMode: "hermes_brain" } }),
      node({ id: "loop:department:marketing", type: "department_loop", label: "Marketing", department: "marketing" }),
      node({ id: "loop:catalog_content", type: "workflow_loop", label: "Content Template", loopId: "catalog_content", parentId: "loop:department:marketing", department: "marketing", metadata: { source: "demo_catalog", runtimeLevel: "spec_stub", templateOnly: true } })
    ], [
      edge({ source: "company:root", target: "loop:department:marketing" }),
      edge({ source: "loop:department:marketing", target: "loop:catalog_content" })
    ], {
      brainLabel: "Hermes Brain",
      hierarchyMode: "hermes_brain",
      managementLoopId: "company:root"
    });
    const preview = buildBrainGraph({
      topology: sample,
      includeCatalogLoops: true,
      previewStory: true,
      includeData: true,
      includeMetrics: true,
      includeReviews: true,
      includeImprove: true
    });

    expect(preview.nodes).toContainEqual(expect.objectContaining({
      id: "loop:catalog_content",
      label: "Content Template",
      subtitle: expect.stringContaining("Spec example")
    }));
    expect(preview.nodes.map((item) => item.label)).not.toContain("Demo: Content Template");
    expect(preview.nodes).toContainEqual(expect.objectContaining({
      id: "preview:data:crm",
      label: "CRM signals",
      type: "data",
      metadata: expect.objectContaining({ previewRole: "incoming_signal" })
    }));
    expect(preview.edges).toContainEqual(expect.objectContaining({
      source: "preview:data:crm",
      target: "company:root",
      type: "loop_observes_data"
    }));
    expect(preview.nodes).toContainEqual(expect.objectContaining({
      id: "preview:evidence:marketing",
      label: "Pipeline quality",
      metadata: expect.objectContaining({ previewRole: "evidence_outcome" })
    }));
    expect(preview.edges).toContainEqual(expect.objectContaining({
      source: "preview:evidence:marketing",
      target: "company:root",
      type: "loop_learns_from_trace"
    }));
  });

  it("filters the hosted preview to a Product-first event path", () => {
    const sample = topology([
      node({ id: "company:root", type: "company", label: "Hermes Brain", metadata: { hierarchyMode: "hermes_brain" } }),
      node({ id: "loop:department:product", type: "department_loop", label: "Product", department: "product" }),
      node({ id: "loop:product_feedback", type: "workflow_loop", label: "Feedback Clustering", loopId: "product_feedback", parentId: "loop:department:product", department: "product", metadata: { source: "demo_catalog", runtimeLevel: "spec_stub", templateOnly: true } }),
      node({ id: "loop:department:marketing", type: "department_loop", label: "Marketing", department: "marketing" }),
      node({ id: "loop:marketing_ads", type: "workflow_loop", label: "Ads", loopId: "marketing_ads", parentId: "loop:department:marketing", department: "marketing", metadata: { source: "demo_catalog", runtimeLevel: "spec_stub", templateOnly: true } })
    ], [
      edge({ source: "company:root", target: "loop:department:product" }),
      edge({ source: "loop:department:product", target: "loop:product_feedback" }),
      edge({ source: "company:root", target: "loop:department:marketing" }),
      edge({ source: "loop:department:marketing", target: "loop:marketing_ads" })
    ], {
      brainLabel: "Hermes Brain",
      hierarchyMode: "hermes_brain",
      managementLoopId: "company:root"
    });
    const graph = buildBrainGraph({
      topology: sample,
      includeCatalogLoops: true,
      previewStory: true,
      includeData: true,
      includeMetrics: true,
      includeReviews: true,
      includeImprove: false
    });
    const productPath = filterBrainGraphForDepartmentStory({
      graph,
      departmentId: "product"
    });
    const labels = productPath.nodes.map((item) => item.label);

    expect(labels).toContain("Hermes Brain");
    expect(labels).toContain("Product");
    expect(labels).toContain("Feedback Clustering");
    expect(labels).toContain("Product events");
    expect(labels).toContain("Support tickets");
    expect(labels).toContain("Product learning");
    expect(labels).not.toContain("Marketing");
    expect(labels).not.toContain("Ads");
    expect(productPath.edges).toContainEqual(expect.objectContaining({
      source: "preview:data:product-analytics",
      target: "company:root"
    }));
    expect(productPath.edges).toContainEqual(expect.objectContaining({
      source: "preview:evidence:product",
      target: "company:root"
    }));
  });

  it("orders Product before Marketing and shows up to three loops per department", () => {
    const departments = ["marketing", "product", "sales"] as const;
    const departmentNodes = departments.map((department) =>
      node({
        id: `loop:department:${department}`,
        type: "department_loop",
        label: `${department} department`,
        department
      })
    );
    const workflowNodes = departments.flatMap((department) =>
      Array.from({ length: 4 }, (_, index) =>
        node({
          id: `loop:${department}:${index}`,
          type: "workflow_loop",
          label: `${department} loop ${index + 1}`,
          loopId: `${department}:${index}`,
          parentId: `loop:department:${department}`,
          department,
          metadata: { source: "demo_catalog", runtimeLevel: "spec_stub", templateOnly: true }
        })
      )
    );
    const sample = topology([
      node({ id: "company:root", type: "company", label: "Hermes Brain" }),
      ...departmentNodes,
      ...workflowNodes
    ], [
      ...departments.map((department) => edge({ source: "company:root", target: `loop:department:${department}` })),
      ...workflowNodes.map((workflow) => edge({ source: workflow.parentId, target: workflow.id }))
    ], {
      brainLabel: "Hermes Brain",
      hierarchyMode: "hermes_brain",
      managementLoopId: "company:root"
    });
    const graph = buildBrainGraph({
      topology: sample,
      includeCatalogLoops: true,
      includeData: false,
      includeMetrics: false,
      includeReviews: false,
      includeImprove: false
    });
    const visibleDepartments = graph.nodes.filter((item) => item.type === "department_loop");

    expect(visibleDepartments.map((item) => item.departmentId)).toEqual([
      "product",
      "marketing",
      "sales"
    ]);
    expect(graph.nodes.filter((item) => item.type === "workflow_loop" && item.departmentId === "product")).toHaveLength(3);
    expect(graph.nodes.filter((item) => item.type === "workflow_loop" && item.departmentId === "marketing")).toHaveLength(3);
    expect(graph.nodes.filter((item) => item.type === "workflow_loop" && item.departmentId === "sales")).toHaveLength(3);
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

function topology(
  nodes: TopologyNode[],
  edges: TopologyEdge[],
  options: {
    brainLabel?: string;
    hierarchyMode?: "management" | "hermes_brain";
    managementLoopId?: string;
  } = {}
): SemanticTopology {
  return {
    id: "test-topology",
    version: 1,
    rootNodeId: "company:root",
    managementLoopId: options.managementLoopId ?? "loop:management",
    metadata: {
      companyName: "Test Company",
      brainLabel: options.brainLabel,
      hierarchyMode: options.hierarchyMode,
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
