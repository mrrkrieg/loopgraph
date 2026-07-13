import type {
  SemanticTopology,
  TopologyEdge,
  TopologyNode,
  TopologyNodeStatus,
  TopologyNodeType
} from "@/lib/loopgraph-core/graph";
import {
  edgeTypeStyles,
  nodeColorForDepartment,
  nodeTypeStyles,
  statusStroke
} from "./graph-styles";
import type {
  BrainEdgeType,
  BrainGraph,
  BrainGraphAdapterInput,
  BrainGraphDiagnostics,
  BrainGraphEdge,
  BrainGraphNode,
  BrainNodeStatus,
  BrainNodeType
} from "./graph-types";

const MAX_DEFAULT_WORKFLOW_LOOPS = 30;

const structureTypes = new Set<TopologyNodeType>([
  "company",
  "management_loop",
  "department_loop",
  "workflow_loop",
  "task_loop"
]);

const internalTypeMap: Partial<Record<TopologyNodeType, BrainNodeType>> = {
  signal_source: "data",
  context_source: "data",
  integration: "data",
  memory: "data",
  metric: "metric",
  human_review: "review",
  escalation_case: "review",
  improvement_item: "improvement",
  trace: "trace"
};

export function buildBrainGraph(input: BrainGraphAdapterInput): BrainGraph {
  const diagnostics: BrainGraphDiagnostics = {
    sourceNodeCount: input.topology.nodes.length,
    visibleNodeCount: 0,
    hiddenNodeIds: [],
    removedEdges: [],
    warnings: []
  };
  const selectedNodeId = input.topology.selectedLoopId
    ? `loop:${input.topology.selectedLoopId}`
    : undefined;
  const structuralNodes = selectStructuralNodes(input.topology, selectedNodeId, diagnostics);
  const structuralNodeIds = new Set(structuralNodes.map((node) => node.id));
  const nodes: BrainGraphNode[] = [];
  const nodeIds = new Set<string>();

  for (const node of structuralNodes) {
    const mapped = mapTopologyNode(node);
    if (!mapped) {
      diagnostics.hiddenNodeIds.push(node.id);
      continue;
    }
    nodes.push(mapped);
    nodeIds.add(mapped.id);
  }

  for (const node of input.topology.nodes) {
    if (nodeIds.has(node.id) || structureTypes.has(node.type)) {
      continue;
    }
    const mappedType = internalTypeMap[node.type];
    if (!mappedType || !layerEnabled(mappedType, input)) {
      diagnostics.hiddenNodeIds.push(node.id);
      continue;
    }
    if (node.loopId && !structuralNodeIds.has(`loop:${node.loopId}`)) {
      diagnostics.hiddenNodeIds.push(node.id);
      continue;
    }
    const mapped = mapTopologyNode(node);
    if (!mapped) {
      diagnostics.hiddenNodeIds.push(node.id);
      continue;
    }
    nodes.push(mapped);
    nodeIds.add(mapped.id);
  }

  const edges = input.topology.edges.flatMap((edge) => {
    const mapped = mapTopologyEdge(edge, nodeIds, diagnostics);
    return mapped ? [mapped] : [];
  });

  diagnostics.visibleNodeCount = nodes.length;
  addRollupMetadata(nodes, edges);

  return {
    nodes,
    edges,
    diagnostics
  };
}

export function filterBrainGraphByDepth(input: {
  graph: BrainGraph;
  centerId: string;
  depth: number;
}): BrainGraph {
  const depth = Math.max(1, Math.min(input.depth, 3));
  const adjacency = new Map<string, Set<string>>();
  for (const edge of input.graph.edges) {
    addNeighbor(adjacency, edge.source, edge.target);
    addNeighbor(adjacency, edge.target, edge.source);
  }

  const distances = new Map<string, number>([[input.centerId, 0]]);
  const queue = [input.centerId];

  while (queue.length > 0) {
    const current = queue.shift();
    if (!current) {
      continue;
    }
    const currentDistance = distances.get(current) ?? 0;
    if (currentDistance >= depth) {
      continue;
    }
    for (const next of adjacency.get(current) ?? []) {
      if (!distances.has(next)) {
        distances.set(next, currentDistance + 1);
        queue.push(next);
      }
    }
  }

  const nodeIds = new Set(distances.keys());
  const nodes = input.graph.nodes.filter((node) => nodeIds.has(node.id));
  const edges = input.graph.edges.filter((edge) => nodeIds.has(edge.source) && nodeIds.has(edge.target));

  return {
    nodes,
    edges,
    diagnostics: {
      ...input.graph.diagnostics,
      visibleNodeCount: nodes.length,
      hiddenNodeIds: [
        ...input.graph.diagnostics.hiddenNodeIds,
        ...input.graph.nodes.filter((node) => !nodeIds.has(node.id)).map((node) => node.id)
      ]
    }
  };
}

function selectStructuralNodes(
  topology: SemanticTopology,
  selectedNodeId: string | undefined,
  diagnostics: BrainGraphDiagnostics
) {
  const rootNodes = topology.nodes.filter((node) => node.type === "company");
  const managementNodes = topology.nodes.filter((node) => node.type === "management_loop");
  const departmentNodes = topology.nodes
    .filter((node) => node.type === "department_loop" && !node.isOrphan)
    .sort(byDepartmentThenLabel);
  const workflowNodes = topology.nodes
    .filter((node) =>
      (node.type === "workflow_loop" || node.type === "task_loop") &&
      !node.isOrphan &&
      !isTemplateOnly(node)
    )
    .sort(byWorkflowPriority);
  const selectedWorkflow = selectedNodeId
    ? workflowNodes.find((node) => node.id === selectedNodeId)
    : undefined;
  const cappedWorkflowNodes = workflowNodes.slice(0, MAX_DEFAULT_WORKFLOW_LOOPS);

  if (selectedWorkflow && !cappedWorkflowNodes.some((node) => node.id === selectedWorkflow.id)) {
    cappedWorkflowNodes.splice(Math.max(cappedWorkflowNodes.length - 1, 0), 1, selectedWorkflow);
  }

  for (const node of topology.nodes) {
    if (!structureTypes.has(node.type)) {
      continue;
    }
    if (node.isOrphan || isTemplateOnly(node)) {
      diagnostics.hiddenNodeIds.push(node.id);
    }
  }

  for (const node of workflowNodes.slice(MAX_DEFAULT_WORKFLOW_LOOPS)) {
    if (node.id !== selectedWorkflow?.id) {
      diagnostics.hiddenNodeIds.push(node.id);
    }
  }

  return [
    ...rootNodes,
    ...managementNodes,
    ...departmentNodes,
    ...cappedWorkflowNodes.sort(byDepartmentThenLabel)
  ];
}

function mapTopologyNode(node: TopologyNode): BrainGraphNode | null {
  const type = mapNodeType(node.type);
  if (!type) {
    return null;
  }
  const baseStyle = nodeTypeStyles[type];
  const departmentStroke = type === "workflow_loop" ? nodeColorForDepartment(node.department) : undefined;
  const status = mapStatus(node.status);
  const stroke = statusStroke[status] ?? departmentStroke ?? baseStyle.stroke;

  return {
    id: node.id,
    type,
    label: type === "company_brain" ? "Company Brain" : node.label,
    subtitle: node.subtitle,
    purpose: node.description ?? node.subtitle,
    loopId: node.loopId,
    departmentId: node.department,
    refId: node.refId,
    parentId: node.parentId,
    status,
    health: healthForStatus(status),
    openReviews: numberFromMetadata(node.metadata?.openReviews),
    missingData: missingDataCount(node),
    undefinedMetrics: node.type === "metric" && status === "needs_attention" ? 1 : 0,
    radius: radiusForNode(type, node.weight),
    color: type === "workflow_loop" ? "#ffffff" : baseStyle.color,
    stroke,
    metadata: {
      ...node.metadata,
      topologyType: node.type,
      topologyLayer: node.layer,
      fullLabel: node.label
    }
  };
}

function mapTopologyEdge(
  edge: TopologyEdge,
  nodeIds: Set<string>,
  diagnostics: BrainGraphDiagnostics
): BrainGraphEdge | null {
  if (!nodeIds.has(edge.source)) {
    diagnostics.removedEdges.push({
      id: edge.id,
      source: edge.source,
      target: edge.target,
      reason: "missing_source"
    });
    return null;
  }
  if (!nodeIds.has(edge.target)) {
    diagnostics.removedEdges.push({
      id: edge.id,
      source: edge.source,
      target: edge.target,
      reason: "missing_target"
    });
    return null;
  }
  const type = mapEdgeType(edge);
  if (!type) {
    diagnostics.removedEdges.push({
      id: edge.id,
      source: edge.source,
      target: edge.target,
      reason: "unsupported_edge"
    });
    return null;
  }
  const style = edgeTypeStyles[type];

  return {
    id: edge.id,
    source: edge.source,
    target: edge.target,
    type,
    label: edge.label,
    semantic: edge.semantic,
    executable: edge.executable,
    width: style.width,
    color: style.color,
    opacity: style.opacity,
    dashed: style.dashed || edge.style !== "solid"
  };
}

function mapNodeType(type: TopologyNodeType): BrainNodeType | null {
  if (type === "company") return "company_brain";
  if (type === "management_loop") return "management_loop";
  if (type === "department_loop") return "department_loop";
  if (type === "workflow_loop" || type === "task_loop") return "workflow_loop";
  return internalTypeMap[type] ?? null;
}

function mapEdgeType(edge: TopologyEdge): BrainEdgeType | null {
  if (edge.kind === "contains" && edge.source === "company:root") return "brain_routes_to";
  if (edge.kind === "contains" && edge.source === "loop:management") return "management_calls_department";
  if (edge.kind === "contains") return "department_contains_loop";
  if (edge.kind === "observes" || edge.kind === "reads_memory") return "loop_observes_data";
  if (edge.kind === "updates_metric") return "loop_updates_metric";
  if (edge.kind === "requires_approval" || edge.kind === "owned_by" || edge.kind === "escalates_to") {
    return "loop_requires_review";
  }
  if (edge.kind === "learns_from" || edge.kind === "writes_trace_to") return "loop_learns_from_trace";
  return null;
}

function mapStatus(status: TopologyNodeStatus): BrainNodeStatus {
  if (status === "active" || status === "complete") return "active";
  if (status === "blocked") return "blocked";
  if (status === "draft" || status === "hidden") return "draft";
  if (status === "warning" || status === "open") return "needs_attention";
  return "ready";
}

function layerEnabled(type: BrainNodeType, input: BrainGraphAdapterInput) {
  if (type === "data") return input.includeData;
  if (type === "metric") return input.includeMetrics;
  if (type === "review") return input.includeReviews;
  if (type === "improvement" || type === "trace") return input.includeImprove;
  return true;
}

function addRollupMetadata(nodes: BrainGraphNode[], edges: BrainGraphEdge[]) {
  const nodesById = new Map(nodes.map((node) => [node.id, node]));
  const childCounts = new Map<string, number>();

  for (const edge of edges) {
    if (
      edge.type === "brain_routes_to" ||
      edge.type === "management_calls_department" ||
      edge.type === "department_contains_loop"
    ) {
      childCounts.set(edge.source, (childCounts.get(edge.source) ?? 0) + 1);
    }
  }

  for (const node of nodes) {
    node.metadata = {
      ...node.metadata,
      managedCount: childCounts.get(node.id) ?? 0
    };
    if (node.type === "department_loop") {
      const childWorkflowCount = edges.filter((edge) => edge.source === node.id).length;
      node.subtitle = `${childWorkflowCount} workflow loops`;
    }
    if (node.type === "management_loop") {
      const departmentCount = edges.filter((edge) => edge.source === node.id).length;
      node.subtitle = `${departmentCount} department loops`;
    }
  }

  for (const edge of edges) {
    const source = nodesById.get(edge.source);
    const target = nodesById.get(edge.target);
    if (!source || !target) {
      continue;
    }
    if (source.type === "workflow_loop" && target.type !== "workflow_loop") {
      target.departmentId ??= source.departmentId;
    }
    if (target.type === "workflow_loop" && source.type !== "workflow_loop") {
      source.departmentId ??= target.departmentId;
    }
  }
}

function radiusForNode(type: BrainNodeType, weight: number) {
  const base = nodeTypeStyles[type].radius;
  if (type === "workflow_loop") {
    return Math.max(base, Math.min(34, 24 + weight * 1.5));
  }
  return base;
}

function healthForStatus(status: BrainNodeStatus) {
  if (status === "active") return 92;
  if (status === "ready") return 82;
  if (status === "needs_attention") return 64;
  if (status === "blocked") return 32;
  return 48;
}

function missingDataCount(node: TopologyNode) {
  if (node.type === "signal_source" && node.status === "warning") {
    return 1;
  }
  const dataSources = node.metadata?.dataSources;
  return Array.isArray(dataSources) && dataSources.length === 0 ? 1 : undefined;
}

function numberFromMetadata(value: unknown) {
  return typeof value === "number" ? value : undefined;
}

function addNeighbor(adjacency: Map<string, Set<string>>, source: string, target: string) {
  const neighbors = adjacency.get(source) ?? new Set<string>();
  neighbors.add(target);
  adjacency.set(source, neighbors);
}

function isTemplateOnly(node: TopologyNode) {
  const metadata = node.metadata ?? {};
  return (
    metadata.templateOnly === true ||
    metadata.runtimeLevel === "catalog" ||
    metadata.source === "demo_catalog"
  );
}

function byWorkflowPriority(left: TopologyNode, right: TopologyNode) {
  const selectedStatusRank = statusPriority(left.status) - statusPriority(right.status);
  if (selectedStatusRank !== 0) {
    return selectedStatusRank;
  }
  return byDepartmentThenLabel(left, right);
}

function byDepartmentThenLabel(left: TopologyNode, right: TopologyNode) {
  return `${left.department ?? ""}:${left.label}`.localeCompare(`${right.department ?? ""}:${right.label}`);
}

function statusPriority(status: TopologyNodeStatus) {
  if (status === "blocked") return 0;
  if (status === "warning" || status === "open") return 1;
  if (status === "active") return 2;
  if (status === "ready") return 3;
  return 4;
}
