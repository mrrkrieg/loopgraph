import type { LoopSpec } from "./loop-spec";
import type { EscalationCase } from "./escalation";
import type { HumanReviewTrace } from "./review";
import type { LoopRunTrace } from "./trace";

export type GraphNode = {
  id: string;
  kind: string;
  label: string;
  subtitle?: string;
  metadata?: Record<string, unknown>;
};

export type GraphEdge = {
  id: string;
  source: string;
  target: string;
  kind: "observes" | "calls" | "verifies_with" | "requires_approval" | "escalates_to" | "writes_trace_to" | "reports_to" | "learns_from";
  semantic: boolean;
};

export type DerivedGraph = {
  nodes: GraphNode[];
  edges: GraphEdge[];
};

export function buildGraphFromSpecs(input: {
  specs: LoopSpec[];
  cases?: EscalationCase[];
  traces?: LoopRunTrace[];
}): DerivedGraph {
  const nodes: GraphNode[] = [];
  const edges: GraphEdge[] = [];

  for (const spec of input.specs) {
    nodes.push({
      id: `loop:${spec.metadata.id}`,
      kind: "loop",
      label: spec.metadata.name,
      subtitle: spec.metadata.version,
      metadata: { department: spec.topology?.department }
    });

    for (const source of spec.context.sources) {
      const nodeId = `source:${spec.metadata.id}:${source.id}`;
      nodes.push({ id: nodeId, kind: "signal_source", label: source.title, subtitle: source.type });
      edges.push({
        id: `${nodeId}->loop:${spec.metadata.id}`,
        source: nodeId,
        target: `loop:${spec.metadata.id}`,
        kind: "observes",
        semantic: true
      });
    }

    for (const verifier of spec.verification) {
      const nodeId = `verifier:${spec.metadata.id}:${verifier.id}`;
      nodes.push({ id: nodeId, kind: "verifier", label: verifier.id, subtitle: verifier.type });
      edges.push({
        id: `${nodeId}->loop:${spec.metadata.id}`,
        source: nodeId,
        target: `loop:${spec.metadata.id}`,
        kind: "verifies_with",
        semantic: true
      });
    }
  }

  for (const trace of input.traces ?? []) {
    nodes.push({ id: `trace:${trace.id}`, kind: "trace", label: trace.id, subtitle: trace.status });
    edges.push({
      id: `loop:${trace.loopId}->trace:${trace.id}`,
      source: `loop:${trace.loopId}`,
      target: `trace:${trace.id}`,
      kind: "writes_trace_to",
      semantic: true
    });
  }

  for (const caseItem of input.cases ?? []) {
    nodes.push({ id: `case:${caseItem.id}`, kind: "escalation_case", label: caseItem.summary, subtitle: caseItem.severity });
    edges.push({
      id: `loop:${caseItem.sourceLoopId}->case:${caseItem.id}`,
      source: `loop:${caseItem.sourceLoopId}`,
      target: `case:${caseItem.id}`,
      kind: "escalates_to",
      semantic: true
    });
    edges.push({
      id: `case:${caseItem.id}->management`,
      source: `case:${caseItem.id}`,
      target: "management:escalation",
      kind: "reports_to",
      semantic: false
    });
  }

  nodes.push({ id: "management:escalation", kind: "management_loop", label: "Management Escalation Loop" });

  return { nodes, edges };
}

export type TopologyNodeType =
  | "company"
  | "management_loop"
  | "department_loop"
  | "workflow_loop"
  | "task_loop"
  | "signal_source"
  | "integration"
  | "context_source"
  | "tool_action"
  | "verifier"
  | "human_owner"
  | "human_review"
  | "metric"
  | "trace"
  | "escalation_case"
  | "improvement_item"
  | "memory";

export type TopologyRefType =
  | "loop_spec"
  | "run_trace"
  | "escalation_case"
  | "human_review"
  | "metric"
  | "tool"
  | "integration"
  | "memory"
  | "improvement_item";

export type TopologyLayer =
  | "structure"
  | "data"
  | "action"
  | "verification"
  | "human"
  | "measurement"
  | "runtime"
  | "memory";

export type TopologyNodeStatus =
  | "ready"
  | "active"
  | "draft"
  | "open"
  | "warning"
  | "blocked"
  | "complete"
  | "hidden";

export type TopologyEdgeKind =
  | "contains"
  | "observes"
  | "calls"
  | "uses_tool"
  | "verifies_with"
  | "requires_approval"
  | "owned_by"
  | "updates_metric"
  | "writes_trace_to"
  | "escalates_to"
  | "learns_from"
  | "reads_memory"
  | "writes_memory"
  | "reports_to"
  | "related_to";

export type TopologyNode = {
  id: string;
  type: TopologyNodeType;
  label: string;
  subtitle?: string;
  description?: string;
  refId?: string;
  refType?: TopologyRefType;
  loopId?: string;
  department?: string;
  parentId?: string;
  parentLoopId?: string;
  layer: TopologyLayer;
  status: TopologyNodeStatus;
  weight: number;
  visibleByDefault: boolean;
  isExpandable: boolean;
  isOrphan?: boolean;
  metadata?: Record<string, unknown>;
};

export type TopologyEdge = {
  id: string;
  source: string;
  target: string;
  kind: TopologyEdgeKind;
  label?: string;
  semantic: boolean;
  executable: boolean;
  style: "solid" | "dashed" | "dotted";
  metadata?: Record<string, unknown>;
};

export type TopologyFilterCounts = {
  total: number;
  visibleByDefault: number;
  orphans: number;
  byType: Record<TopologyNodeType, number>;
  byLayer: Record<TopologyLayer, number>;
  byDepartment: Record<string, number>;
  byStatus: Record<TopologyNodeStatus, number>;
};

export type TopologyWarning = {
  id: string;
  severity: "info" | "warning" | "error";
  code:
    | "missing_parent"
    | "missing_department"
    | "missing_owner"
    | "missing_metric"
    | "missing_verifier"
    | "unreachable_node"
    | "invalid_edge";
  message: string;
  nodeId?: string;
  loopId?: string;
  suggestedFix?: string;
};

export type TopologyMetadata = {
  companyName: string;
  brainLabel?: string;
  hierarchyMode?: "management" | "hermes_brain";
  sourceLabel: string;
  generatedAt: string;
  loopSpecCount: number;
  selectedLoopId?: string;
  departments: string[];
};

export type SemanticTopology = {
  id: string;
  version: 1;
  rootNodeId: string;
  managementLoopId: string;
  selectedLoopId?: string;
  metadata: TopologyMetadata;
  nodes: TopologyNode[];
  edges: TopologyEdge[];
  orphanNodes: TopologyNode[];
  warnings: TopologyWarning[];
  filterCounts: TopologyFilterCounts;
};

export type LoopEgoGraph = SemanticTopology & {
  centerNodeId: string;
  breadcrumbs: TopologyNode[];
};

export type TopologyMetricInput = {
  id?: string;
  loopId: string;
  name: string;
  value?: number | string;
  status?: TopologyNodeStatus;
};

export type TopologyImprovementItem = {
  id: string;
  loopId: string;
  title: string;
  status?: TopologyNodeStatus | string;
  sourceTraceId?: string;
  failureMode?: string;
};

export type TopologyBuildOptions = {
  companyName?: string;
  brainLabel?: string;
  hierarchyMode?: "management" | "hermes_brain";
  sourceLabel?: string;
  selectedLoopId?: string;
  generatedAt?: string;
  includeInternalsByDefault?: boolean;
  attachUnmappedToCustom?: boolean;
};

export type TopologyVisibilityMode =
  | "company"
  | "selected-loop"
  | "brain-map"
  | "department-map"
  | "runtime-trace-map";

export type TopologyVisibilityOptions = {
  mode?: TopologyVisibilityMode;
  includeTypes?: TopologyNodeType[];
  enabledLayers?: Partial<Record<TopologyLayer, boolean>>;
  selectedLoopId?: string;
  department?: string;
  attentionOnly?: boolean;
  search?: string;
  showOrphans?: boolean;
};

const topologyNodeTypes: TopologyNodeType[] = [
  "company",
  "management_loop",
  "department_loop",
  "workflow_loop",
  "task_loop",
  "signal_source",
  "integration",
  "context_source",
  "tool_action",
  "verifier",
  "human_owner",
  "human_review",
  "metric",
  "trace",
  "escalation_case",
  "improvement_item",
  "memory"
];

const topologyLayers: TopologyLayer[] = [
  "structure",
  "data",
  "action",
  "verification",
  "human",
  "measurement",
  "runtime",
  "memory"
];

const topologyStatuses: TopologyNodeStatus[] = [
  "ready",
  "active",
  "draft",
  "open",
  "warning",
  "blocked",
  "complete",
  "hidden"
];

export function buildSemanticTopology(input: {
  loopSpecs?: LoopSpec[];
  specs?: LoopSpec[];
  traces?: LoopRunTrace[];
  cases?: EscalationCase[];
  reviews?: HumanReviewTrace[];
  metrics?: TopologyMetricInput[];
  improvements?: TopologyImprovementItem[];
  options?: TopologyBuildOptions;
}): SemanticTopology {
  const loopSpecs = [...(input.loopSpecs ?? input.specs ?? [])].sort((left, right) =>
    `${departmentForSpec(left) ?? ""}:${left.metadata.name}`.localeCompare(
      `${departmentForSpec(right) ?? ""}:${right.metadata.name}`
    )
  );
  const options = input.options ?? {};
  const rootNodeId = "company:root";
  const hierarchyMode = options.hierarchyMode ?? "management";
  const managementLoopId = hierarchyMode === "hermes_brain" ? rootNodeId : "loop:management";
  const departmentParentNodeId = hierarchyMode === "hermes_brain" ? rootNodeId : managementLoopId;
  const brainLabel = options.brainLabel ?? (hierarchyMode === "hermes_brain" ? "Hermes Brain" : options.companyName ?? "Company");
  const nodeMap = new Map<string, TopologyNode>();
  const edgeMap = new Map<string, TopologyEdge>();
  const specIds = new Set(loopSpecs.map((spec) => spec.metadata.id));
  const traceLoopByRunId = new Map<string, string>();

  addNode(nodeMap, {
    id: rootNodeId,
    type: "company",
    label: brainLabel,
    subtitle: hierarchyMode === "hermes_brain" ? "Operational event brain" : "Operating system",
    layer: "structure",
    status: "active",
    weight: 7,
    visibleByDefault: true,
    isExpandable: true,
    metadata: {
      source: "semantic_topology",
      brainLabel,
      hierarchyMode
    }
  });

  if (hierarchyMode !== "hermes_brain") {
    addNode(nodeMap, {
      id: managementLoopId,
      type: "management_loop",
      label: "Company Management Loop",
      subtitle: "Reviews departments, metrics, risk, and improvements",
      loopId: "management",
      parentId: rootNodeId,
      layer: "structure",
      status: "active",
      weight: 6,
      visibleByDefault: true,
      isExpandable: true,
      metadata: {
        synthetic: true,
        role: "rollup"
      }
    });
    addEdge(edgeMap, nodeMap, {
      source: rootNodeId,
      target: managementLoopId,
      kind: "contains",
      label: "operates"
    });
  }

  const departmentNodeIds = new Map<string, string>();
  const appNodeIds = new Map<string, string>();
  for (const spec of loopSpecs) {
    const department = departmentForSpec(spec);
    if (!department) {
      continue;
    }

    const departmentNodeId = ensureDepartmentLoop({
      department,
      departmentNodeIds,
      edgeMap,
      managementLoopId: departmentParentNodeId,
      nodeMap,
      visibleByDefault: true,
      plainLabel: hierarchyMode === "hermes_brain"
    });
    const appNodeId = ensureInstalledAppNode({
      appNodeIds,
      departmentNodeId,
      edgeMap,
      nodeMap,
      spec
    });
    const nodeId = loopNodeId(spec.metadata.id);
    addNode(nodeMap, loopNodeFromSpec(spec, {
      nodeId,
      parentId: spec.topology?.parentLoopId
        ? loopNodeId(spec.topology.parentLoopId)
        : appNodeId ?? departmentNodeId,
      visibleByDefault: true,
      isOrphan: false,
      nodeType: appNodeId ? "task_loop" : undefined
    }));
  }

  for (const spec of loopSpecs) {
    const nodeId = loopNodeId(spec.metadata.id);
    const nodeExists = nodeMap.has(nodeId);
    if (nodeExists) {
      continue;
    }

    if (options.attachUnmappedToCustom) {
      const departmentNodeId = ensureDepartmentLoop({
        department: "custom",
        departmentNodeIds,
        edgeMap,
        managementLoopId: departmentParentNodeId,
        nodeMap,
        visibleByDefault: true,
        plainLabel: hierarchyMode === "hermes_brain"
      });
      addNode(nodeMap, loopNodeFromSpec(spec, {
        nodeId,
        parentId: departmentNodeId,
        visibleByDefault: true,
        isOrphan: false
      }));
      continue;
    }

    addNode(nodeMap, loopNodeFromSpec(spec, {
      nodeId,
      parentId: undefined,
      visibleByDefault: false,
      isOrphan: true
    }));
  }

  for (const spec of loopSpecs) {
    const nodeId = loopNodeId(spec.metadata.id);
    const parentLoopId = spec.topology?.parentLoopId;
    const department = departmentForSpec(spec);
    const appId = spec.metadata.labels?.appId;
    const parentNodeId = parentLoopId && specIds.has(parentLoopId)
      ? loopNodeId(parentLoopId)
      : appId && appNodeIds.has(appId)
        ? appNodeIds.get(appId)
      : department
        ? departmentNodeIds.get(departmentSlug(department))
        : undefined;

    if (!parentNodeId) {
      continue;
    }

    addEdge(edgeMap, nodeMap, {
      source: parentNodeId,
      target: nodeId,
      kind: "contains",
      label: parentLoopId ? "nested loop" : appId ? "app loop" : "department workflow"
    });
  }

  addInstalledAppTopologies(nodeMap, edgeMap, loopSpecs);

  for (const spec of loopSpecs) {
    addLoopInternals(nodeMap, edgeMap, spec, Boolean(options.includeInternalsByDefault));
  }

  for (const trace of input.traces ?? []) {
    traceLoopByRunId.set(trace.id, trace.loopId);
    addTrace(nodeMap, edgeMap, trace);
    for (const review of trace.humanReviews) {
      addHumanReviewNode(nodeMap, edgeMap, review, trace.loopId);
    }
    for (const metric of trace.metrics) {
      addMetricNode(nodeMap, edgeMap, {
        id: `${trace.id}:${slug(metric.name)}`,
        loopId: trace.loopId,
        name: metric.name,
        value: metric.value,
        status: "active"
      }, false);
    }
  }

  for (const caseItem of input.cases ?? []) {
    addEscalationCase(nodeMap, edgeMap, caseItem, managementLoopId);
  }

  for (const review of input.reviews ?? []) {
    const loopId = traceLoopByRunId.get(review.runId);
    if (loopId) {
      addHumanReviewNode(nodeMap, edgeMap, review, loopId);
    }
  }

  for (const metric of input.metrics ?? []) {
    addMetricNode(nodeMap, edgeMap, metric, false);
  }

  for (const item of input.improvements ?? []) {
    addImprovementNode(nodeMap, edgeMap, item);
  }

  const nodes = Array.from(nodeMap.values());
  const edges = Array.from(edgeMap.values()).filter(
    (edge) => nodeMap.has(edge.source) && nodeMap.has(edge.target)
  );
  const orphanNodes = classifyOrphans(nodes, edges);
  const topologyWithoutWarnings: SemanticTopology = {
    id: "semantic-topology",
    version: 1,
    rootNodeId,
    managementLoopId,
    selectedLoopId: options.selectedLoopId,
    metadata: {
      companyName: options.companyName ?? "Company",
      brainLabel,
      hierarchyMode,
      sourceLabel: options.sourceLabel ?? "LoopSpecs",
      generatedAt: options.generatedAt ?? new Date(0).toISOString(),
      loopSpecCount: loopSpecs.length,
      selectedLoopId: options.selectedLoopId,
      departments: Array.from(departmentNodeIds.keys()).sort()
    },
    nodes,
    edges,
    orphanNodes,
    warnings: [],
    filterCounts: createFilterCounts(nodes)
  };

  return {
    ...topologyWithoutWarnings,
    warnings: createTopologyWarnings(topologyWithoutWarnings)
  };
}

export function buildLoopEgoGraph(input: {
  topology: SemanticTopology;
  loopId: string;
  depth?: number;
  includeTypes?: TopologyNodeType[];
  enabledLayers?: Partial<Record<TopologyLayer, boolean>>;
}): LoopEgoGraph {
  const maxDepth = Math.max(input.depth ?? 2, 1);
  const nodeMap = new Map(input.topology.nodes.map((node) => [node.id, node]));
  const centerNode = findLoopNode(input.topology.nodes, input.loopId) ?? input.topology.nodes[0];
  const centerNodeId = centerNode?.id ?? input.topology.rootNodeId;
  const includeTypeSet = input.includeTypes ? new Set(input.includeTypes) : undefined;
  const layerVisibility = {
    ...defaultLayerVisibility("selected-loop"),
    ...(input.enabledLayers ?? {})
  };
  const distances = new Map<string, number>([[centerNodeId, 0]]);
  const queue = [centerNodeId];

  while (queue.length > 0) {
    const current = queue.shift();
    if (!current) {
      continue;
    }
    const distance = distances.get(current) ?? 0;
    if (distance >= maxDepth) {
      continue;
    }

    for (const edge of input.topology.edges) {
      if (edge.source !== current && edge.target !== current) {
        continue;
      }
      const next = edge.source === current ? edge.target : edge.source;
      const nextNode = nodeMap.get(next);
      if (!nextNode || nextNode.isOrphan) {
        continue;
      }
      if (includeTypeSet && !includeTypeSet.has(nextNode.type) && next !== centerNodeId && nextNode.layer !== "structure") {
        continue;
      }
      if (!layerVisibility[nextNode.layer] && next !== centerNodeId && nextNode.layer !== "structure") {
        continue;
      }
      if (!distances.has(next)) {
        distances.set(next, distance + 1);
        queue.push(next);
      }
    }
  }

  const nodeIds = new Set(distances.keys());
  const nodes = input.topology.nodes
    .filter((node) => nodeIds.has(node.id))
    .map((node) => {
      const distance = distances.get(node.id) ?? 2;
      return {
        ...node,
        metadata: {
          ...node.metadata,
          ring: distance === 0 ? "center" : distance === 1 ? "inner" : "outer",
          layout: distance === 0 ? "ego-center" : "ego-ring"
        }
      };
    });
  const edges = input.topology.edges.filter(
    (edge) => nodeIds.has(edge.source) && nodeIds.has(edge.target)
  );
  const breadcrumbs = buildBreadcrumbs(centerNodeId, input.topology.nodes);
  const orphanNodes = classifyOrphans(nodes, edges);
  const topology: LoopEgoGraph = {
    ...input.topology,
    id: `ego:${centerNodeId}`,
    selectedLoopId: centerNode?.loopId ?? input.loopId,
    centerNodeId,
    breadcrumbs,
    nodes,
    edges,
    orphanNodes,
    warnings: createTopologyWarnings({ ...input.topology, nodes, edges, orphanNodes }),
    filterCounts: createFilterCounts(nodes)
  };

  return topology;
}

export function getVisibleTopology(
  topology: SemanticTopology,
  options: TopologyVisibilityOptions = {}
): SemanticTopology {
  const mode = options.mode ?? "company";
  const includeTypeSet = options.includeTypes ? new Set(options.includeTypes) : undefined;
  const layerVisibility = {
    ...defaultLayerVisibility(mode),
    ...(options.enabledLayers ?? {})
  };
  const normalizedSearch = options.search?.trim().toLowerCase() ?? "";
  const selectedNode = options.selectedLoopId
    ? findLoopNode(topology.nodes, options.selectedLoopId)
    : undefined;
  const selectedConnections = selectedNode
    ? directSemanticConnections(selectedNode.id, topology.edges)
    : new Set<string>();
  const visibleNodes = topology.nodes.filter((node) => {
    if (node.isOrphan && !options.showOrphans) {
      return false;
    }
    if (options.department && options.department !== "all") {
      const isGlobal = node.type === "company" || node.type === "management_loop";
      const isSelectedContext = selectedConnections.has(node.id) || node.id === selectedNode?.id;
      if (!isGlobal && !isSelectedContext && node.department !== options.department) {
        return false;
      }
    }
    if (options.attentionOnly && !["warning", "blocked", "open"].includes(node.status)) {
      const isGlobal = node.type === "company" || node.type === "management_loop";
      if (!isGlobal) {
        return false;
      }
    }
    if (normalizedSearch && !nodeMatchesSearch(node, normalizedSearch)) {
      const isGlobal = node.type === "company" || node.type === "management_loop";
      const isSelectedContext = selectedConnections.has(node.id) || node.id === selectedNode?.id;
      if (!isGlobal && !isSelectedContext) {
        return false;
      }
    }
    if (includeTypeSet?.has(node.type)) {
      return true;
    }
    if (node.layer === "structure") {
      return node.visibleByDefault || options.showOrphans;
    }
    if (mode === "runtime-trace-map" && node.layer === "runtime") {
      return true;
    }
    return Boolean(layerVisibility[node.layer]);
  });
  const visibleNodeIds = new Set(visibleNodes.map((node) => node.id));
  const edges = topology.edges.filter(
    (edge) => visibleNodeIds.has(edge.source) && visibleNodeIds.has(edge.target)
  );
  const orphanNodes = classifyOrphans(visibleNodes, edges);

  return {
    ...topology,
    id: `${topology.id}:${mode}`,
    nodes: visibleNodes,
    edges,
    orphanNodes,
    filterCounts: createFilterCounts(visibleNodes),
    warnings: createTopologyWarnings({ ...topology, nodes: visibleNodes, edges, orphanNodes })
  };
}

export function classifyOrphans(nodes: TopologyNode[], edges: TopologyEdge[]): TopologyNode[] {
  const incomingContainment = new Set(
    edges
      .filter((edge) => edge.semantic && edge.kind === "contains")
      .map((edge) => edge.target)
  );
  const semanticConnections = new Set<string>();
  for (const edge of edges) {
    if (!edge.semantic || edge.kind === "reports_to") {
      continue;
    }
    semanticConnections.add(edge.source);
    semanticConnections.add(edge.target);
  }

  return nodes.filter((node) => {
    if (node.type === "company") {
      return false;
    }
    if (node.isOrphan) {
      return true;
    }
    if (["management_loop", "department_loop", "workflow_loop", "task_loop"].includes(node.type)) {
      return !incomingContainment.has(node.id);
    }
    return !semanticConnections.has(node.id);
  });
}

export function createTopologyWarnings(input: {
  nodes: TopologyNode[];
  edges: TopologyEdge[];
  orphanNodes?: TopologyNode[];
}): TopologyWarning[] {
  const nodeMap = new Map(input.nodes.map((node) => [node.id, node]));
  const warnings: TopologyWarning[] = [];
  const pushWarning = (warning: TopologyWarning) => {
    if (!warnings.some((existing) => existing.id === warning.id)) {
      warnings.push(warning);
    }
  };

  for (const edge of input.edges) {
    if (!nodeMap.has(edge.source) || !nodeMap.has(edge.target)) {
      pushWarning({
        id: `invalid-edge:${edge.id}`,
        severity: "error",
        code: "invalid_edge",
        message: `Edge ${edge.id} references a missing node.`,
        suggestedFix: "Regenerate topology from current LoopSpecs."
      });
    }
  }

  for (const node of input.orphanNodes ?? classifyOrphans(input.nodes, input.edges)) {
    pushWarning({
      id: `orphan:${node.id}`,
      severity: "warning",
      code: node.department ? "missing_parent" : "missing_department",
      message: `${node.label} is unattached and hidden from the default company topology.`,
      nodeId: node.id,
      loopId: node.loopId,
      suggestedFix: "Assign a department or parent loop in topology.parentLoopId."
    });
  }

  for (const node of input.nodes) {
    if (!["workflow_loop", "task_loop"].includes(node.type) || node.metadata?.appNode === true) {
      continue;
    }

    const incident = input.edges.filter((edge) => edge.source === node.id || edge.target === node.id);
    if (!incident.some((edge) => edge.kind === "contains" && edge.target === node.id && edge.semantic)) {
      pushWarning({
        id: `missing-parent:${node.id}`,
        severity: "warning",
        code: "missing_parent",
        message: `${node.label} is missing a semantic parent loop.`,
        nodeId: node.id,
        loopId: node.loopId,
        suggestedFix: "Connect it to a department loop or another workflow loop."
      });
    }
    if (!incident.some((edge) => edge.kind === "owned_by")) {
      pushWarning({
        id: `missing-owner:${node.id}`,
        severity: "info",
        code: "missing_owner",
        message: `${node.label} does not define a human owner.`,
        nodeId: node.id,
        loopId: node.loopId,
        suggestedFix: "Add metadata.owner or an escalation owner."
      });
    }
    const explicitMetrics = Array.isArray(node.metadata?.metrics) && node.metadata.metrics.length > 0;
    if (!explicitMetrics) {
      pushWarning({
        id: `missing-metric:${node.id}`,
        severity: "info",
        code: "missing_metric",
        message: `${node.label} does not define a measured outcome.`,
        nodeId: node.id,
        loopId: node.loopId,
        suggestedFix: "Add a metric to studioExtension, labels, traces, or metrics input."
      });
    }
    if (!incident.some((edge) => edge.kind === "verifies_with")) {
      pushWarning({
        id: `missing-verifier:${node.id}`,
        severity: "warning",
        code: "missing_verifier",
        message: `${node.label} does not define verification logic.`,
        nodeId: node.id,
        loopId: node.loopId,
        suggestedFix: "Add at least one verification binding."
      });
    }
  }

  return warnings.sort((left, right) => severityRank(right.severity) - severityRank(left.severity));
}

function ensureDepartmentLoop(input: {
  department: string;
  departmentNodeIds: Map<string, string>;
  edgeMap: Map<string, TopologyEdge>;
  managementLoopId: string;
  nodeMap: Map<string, TopologyNode>;
  visibleByDefault: boolean;
  plainLabel?: boolean;
}) {
  const key = departmentSlug(input.department);
  const existing = input.departmentNodeIds.get(key);
  if (existing) {
    return existing;
  }

  const nodeId = `loop:department:${key}`;
  input.departmentNodeIds.set(key, nodeId);
  addNode(input.nodeMap, {
    id: nodeId,
    type: "department_loop",
    label: input.plainLabel ? titleize(input.department) : `${titleize(input.department)} Department Loop`,
    subtitle: "Coordinates workflow loops and rollups",
    refId: `department:${key}`,
    loopId: `department:${key}`,
    department: input.department,
    parentId: input.managementLoopId,
    layer: "structure",
    status: "active",
    weight: 5,
    visibleByDefault: input.visibleByDefault,
    isExpandable: true,
    metadata: {
      synthetic: true,
      department: input.department
    }
  });
  addEdge(input.edgeMap, input.nodeMap, {
    source: input.managementLoopId,
    target: nodeId,
    kind: "contains",
    label: "department"
  });

  return nodeId;
}

function ensureInstalledAppNode(input: {
  appNodeIds: Map<string, string>;
  departmentNodeId: string;
  edgeMap: Map<string, TopologyEdge>;
  nodeMap: Map<string, TopologyNode>;
  spec: LoopSpec;
}): string | undefined {
  const appId = input.spec.metadata.labels?.appId;
  if (!appId) return undefined;
  const existing = input.appNodeIds.get(appId);
  if (existing) return existing;
  const nodeId = `app:${appId}`;
  const appName = input.spec.metadata.labels?.appName ?? titleize(appId.split(".").at(-1) ?? appId);
  input.appNodeIds.set(appId, nodeId);
  addNode(input.nodeMap, {
    id: nodeId,
    type: "workflow_loop",
    label: appName,
    subtitle: "Installed Loopgraph App",
    description: `Operates the ${appName} loops, skills, connector bindings, permissions, tests, and outcomes as one application.`,
    refId: appId,
    department: departmentForSpec(input.spec),
    parentId: input.departmentNodeId,
    layer: "structure",
    status: "ready",
    weight: 5,
    visibleByDefault: true,
    isExpandable: true,
    metadata: {
      synthetic: true,
      appNode: true,
      appId,
      appName,
      appVersion: input.spec.metadata.labels?.appVersion,
      appDigest: input.spec.metadata.labels?.appDigest,
      installationId: input.spec.metadata.labels?.installationId,
      owner: input.spec.metadata.owner?.role
    }
  });
  addEdge(input.edgeMap, input.nodeMap, {
    source: input.departmentNodeId,
    target: nodeId,
    kind: "contains",
    label: "installed app"
  });
  return nodeId;
}

function addInstalledAppTopologies(
  nodeMap: Map<string, TopologyNode>,
  edgeMap: Map<string, TopologyEdge>,
  specs: LoopSpec[]
): void {
  const handledApps = new Set<string>();
  for (const spec of specs) {
    const appId = spec.metadata.labels?.appId;
    if (!appId || handledApps.has(appId)) continue;
    const extension = spec.studioExtension as Record<string, unknown> | undefined;
    if (!isRecord(extension?.appTopology)) continue;
    handledApps.add(appId);
    const loopNodeIds = topologyLoopNodeIds(appId, specs);

    const rawObjects = Array.isArray(extension.appTopology.objects) ? extension.appTopology.objects : [];
    const objectNodeIds = new Map<string, string>();
    for (const rawObject of rawObjects) {
      if (!isRecord(rawObject) || typeof rawObject.id !== "string" || typeof rawObject.label !== "string") continue;
      const shared = rawObject.shared !== false;
      const nodeId = shared ? `company-object:${rawObject.id}` : `app-object:${appId}:${rawObject.id}`;
      objectNodeIds.set(rawObject.id, nodeId);
      addNode(nodeMap, {
        id: nodeId,
        type: "memory",
        label: rawObject.label,
        subtitle: typeof rawObject.objectType === "string" ? titleize(rawObject.objectType) : "Company object",
        description: typeof rawObject.description === "string" ? rawObject.description : undefined,
        refId: rawObject.id,
        refType: "memory",
        department: departmentForSpec(spec),
        layer: "data",
        status: "ready",
        weight: 2.6,
        visibleByDefault: false,
        isExpandable: true,
        metadata: {
          appId,
          companyObject: true,
          objectType: rawObject.objectType,
          shared,
          identityKeys: Array.isArray(rawObject.identityKeys) ? rawObject.identityKeys : []
        }
      });
    }

    const rawFlows = Array.isArray(extension.appTopology.flows) ? extension.appTopology.flows : [];
    for (const rawFlow of rawFlows) {
      if (!isRecord(rawFlow) || typeof rawFlow.type !== "string") continue;
      const source = appTopologyEndpointNodeId(rawFlow.source, objectNodeIds, loopNodeIds);
      const target = appTopologyEndpointNodeId(rawFlow.target, objectNodeIds, loopNodeIds);
      if (!source || !target) continue;
      addEdge(edgeMap, nodeMap, {
        source,
        target,
        kind: appTopologyEdgeKind(rawFlow.type),
        label: appTopologyFlowLabel(rawFlow.type),
        semantic: true,
        executable: rawFlow.type === "supports",
        metadata: {
          appId,
          appFlow: true,
          flowId: rawFlow.id,
          flowType: rawFlow.type,
          reason: rawFlow.reason,
          condition: rawFlow.condition
        }
      });
    }
  }
}

function topologyLoopNodeIds(appId: string, specs: LoopSpec[]): Map<string, string> {
  const result = new Map<string, string>();
  const appSpecs = specs.filter((spec) => spec.metadata.labels?.appId === appId);
  for (const spec of appSpecs) result.set(spec.metadata.id, loopNodeId(spec.metadata.id));
  for (const spec of appSpecs) {
    const upstreamLoopId = spec.metadata.labels?.upstreamLoopId;
    if (upstreamLoopId && !result.has(upstreamLoopId)) result.set(upstreamLoopId, loopNodeId(spec.metadata.id));
  }
  return result;
}

function appTopologyEndpointNodeId(
  endpoint: unknown,
  objectNodeIds: Map<string, string>,
  loopNodeIds: Map<string, string>
): string | undefined {
  if (!isRecord(endpoint) || typeof endpoint.kind !== "string" || typeof endpoint.id !== "string") return undefined;
  return endpoint.kind === "loop" ? loopNodeIds.get(endpoint.id) : objectNodeIds.get(endpoint.id);
}

function appTopologyEdgeKind(flowType: string): TopologyEdgeKind {
  if (flowType === "evidence_in") return "observes";
  if (flowType === "supports") return "calls";
  if (flowType === "produces") return "writes_memory";
  return "learns_from";
}

function appTopologyFlowLabel(flowType: string): string {
  if (flowType === "evidence_in") return "evidence enters";
  if (flowType === "supports") return "may support";
  if (flowType === "produces") return "produces evidence";
  return "returns learning";
}

function loopNodeFromSpec(
  spec: LoopSpec,
  input: {
    nodeId: string;
    parentId?: string;
    visibleByDefault: boolean;
    isOrphan: boolean;
    nodeType?: "workflow_loop" | "task_loop";
  }
): TopologyNode {
  const department = departmentForSpec(spec);
  const owner = ownerLabel(spec);
  const metrics = extractMetricNames(spec);
  const runtimeLevel = runtimeLevelForSpec(spec);
  const source = spec.metadata.labels?.source;
  return {
    id: input.nodeId,
    type: input.nodeType ?? (spec.topology?.tags?.includes("task") ? "task_loop" : "workflow_loop"),
    label: spec.metadata.name,
    subtitle: spec.metadata.description ?? spec.trigger.event,
    description: spec.metadata.description,
    refId: spec.metadata.id,
    refType: "loop_spec",
    loopId: spec.metadata.id,
    department,
    parentId: input.parentId,
    parentLoopId: spec.topology?.parentLoopId,
    layer: "structure",
    status: input.isOrphan ? "draft" : "ready",
    weight: input.isOrphan ? 2.5 : 4,
    visibleByDefault: input.visibleByDefault,
    isExpandable: true,
    isOrphan: input.isOrphan,
    metadata: {
      specVersion: spec.metadata.version,
      owner,
      owners: owner ? [owner] : [],
      dataSources: spec.context.sources.map((source) => source.title),
      metrics,
      routine: spec.routine.steps.map((step) => step.name),
      tools: spec.tools.map((tool) => tool.label),
      verification: spec.verification.map((verifier) => verifier.id),
      tags: spec.topology?.tags ?? [],
      trigger: `${spec.trigger.source}:${spec.trigger.event}`,
      source,
      runtimeLevel,
      appId: spec.metadata.labels?.appId,
      appName: spec.metadata.labels?.appName,
      appVersion: spec.metadata.labels?.appVersion,
      appDigest: spec.metadata.labels?.appDigest,
      installationId: spec.metadata.labels?.installationId,
      templateOnly: source === "demo_catalog" || runtimeLevel === "catalog",
      runtime: loopRuntimeMetadata(spec)
    }
  };
}

function runtimeLevelForSpec(spec: LoopSpec): string | undefined {
  const labelRuntimeLevel = spec.metadata.labels?.runtimeLevel;
  if (labelRuntimeLevel) return labelRuntimeLevel;
  const extension = spec.studioExtension as Record<string, unknown> | undefined;
  return typeof extension?.runtimeLevel === "string" ? extension.runtimeLevel : undefined;
}

function loopRuntimeMetadata(spec: LoopSpec): Record<string, unknown> {
  return {
    sourcePath: spec.metadata.labels?.sourcePath,
    inputFixtures: (spec.input.fixtures ?? []).map((fixture) => ({
      id: fixture.id,
      path: fixture.path,
      label: humanizeFixtureId(fixture.id)
    })),
    routing: spec.routing
      ? {
          ready: true,
          problemTypes: spec.routing.problemTypes,
          activationMode: spec.routing.activationMode,
          minimumConfidence: spec.routing.minimumConfidence,
          requiredConnections: spec.routing.requiredConnections
        }
      : {
          ready: false,
          problemTypes: [],
          requiredConnections: []
        }
  };
}

function humanizeFixtureId(value: string): string {
  return value.replace(/[-_]/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function addLoopInternals(
  nodeMap: Map<string, TopologyNode>,
  edgeMap: Map<string, TopologyEdge>,
  spec: LoopSpec,
  visibleByDefault: boolean
) {
  const loopId = spec.metadata.id;
  const loopIdNode = loopNodeId(loopId);
  const owner = ownerLabel(spec);

  for (const source of spec.context.sources) {
    const type = topologyTypeForSource(source.type);
    const nodeId = `source:${loopId}:${source.id}`;
    addNode(nodeMap, {
      id: nodeId,
      type,
      label: source.title,
      subtitle: `${source.type}${source.adapterId ? ` via ${source.adapterId}` : ""}`,
      refId: source.id,
      refType: type === "memory" ? "memory" : type === "integration" ? "integration" : undefined,
      loopId,
      department: departmentForSpec(spec),
      parentId: loopIdNode,
      layer: type === "memory" ? "memory" : "data",
      status: source.trusted ? "ready" : "warning",
      weight: type === "integration" ? 2.4 : 2,
      visibleByDefault,
      isExpandable: false,
      metadata: {
        sourceType: source.type,
        sensitivity: source.sensitivity,
        trusted: source.trusted,
        precedence: source.precedence
      }
    });
    addEdge(edgeMap, nodeMap, {
      source: nodeId,
      target: loopIdNode,
      kind: type === "memory" ? "reads_memory" : "observes",
      label: type === "memory" ? "memory context" : "observes"
    });
  }

  for (const step of spec.routine.steps) {
    const nodeId = `step:${loopId}:${step.id}`;
    addNode(nodeMap, {
      id: nodeId,
      type: "tool_action",
      label: step.name,
      subtitle: `${step.actor} ${step.stepType}`,
      refId: step.id,
      refType: "tool",
      loopId,
      department: departmentForSpec(spec),
      parentId: loopIdNode,
      layer: "action",
      status: "ready",
      weight: 2.2,
      visibleByDefault,
      isExpandable: false,
      metadata: {
        actor: step.actor,
        stepType: step.stepType,
        description: step.description
      }
    });
    addEdge(edgeMap, nodeMap, {
      source: loopIdNode,
      target: nodeId,
      kind: "calls",
      label: "routine",
      executable: step.actor !== "human"
    });
  }

  for (const tool of spec.tools) {
    const policy = spec.policy.allowedActions.find((action) => action.toolKey === tool.key);
    const nodeId = `tool:${loopId}:${tool.key}`;
    addNode(nodeMap, {
      id: nodeId,
      type: "tool_action",
      label: tool.label,
      subtitle: `${tool.adapterId}${tool.writeCapable ? " write-capable" : ""}`,
      refId: tool.key,
      refType: "tool",
      loopId,
      department: departmentForSpec(spec),
      parentId: loopIdNode,
      layer: "action",
      status: policy?.allowed === false ? "blocked" : "ready",
      weight: tool.writeCapable ? 2.8 : 2,
      visibleByDefault,
      isExpandable: false,
      metadata: {
        adapterId: tool.adapterId,
        writeCapable: tool.writeCapable,
        riskLevel: policy?.riskLevel ?? tool.riskLevel,
        requiresApproval: policy?.requiresApproval ?? false,
        customerFacing: policy?.customerFacing ?? false
      }
    });
    addEdge(edgeMap, nodeMap, {
      source: loopIdNode,
      target: nodeId,
      kind: "uses_tool",
      label: "uses tool",
      executable: tool.writeCapable && !policy?.requiresApproval
    });

    if (policy?.requiresApproval) {
      const reviewId = addPolicyReviewNode(nodeMap, spec, policy.toolKey, owner);
      addEdge(edgeMap, nodeMap, {
        source: nodeId,
        target: reviewId,
        kind: "requires_approval",
        label: "requires approval",
        semantic: true,
        executable: false
      });
    }
  }

  for (const verifier of spec.verification) {
    const nodeId = `verifier:${loopId}:${verifier.id}`;
    addNode(nodeMap, {
      id: nodeId,
      type: "verifier",
      label: verifier.id,
      subtitle: verifier.type.replace(/_/g, " "),
      refId: verifier.id,
      loopId,
      department: departmentForSpec(spec),
      parentId: loopIdNode,
      layer: "verification",
      status: "ready",
      weight: 2.5,
      visibleByDefault,
      isExpandable: false,
      metadata: {
        verifierType: verifier.type,
        config: verifier.config
      }
    });
    addEdge(edgeMap, nodeMap, {
      source: nodeId,
      target: loopIdNode,
      kind: "verifies_with",
      label: "verifies"
    });
  }

  if (owner) {
    const ownerNodeId = `owner:${loopId}:${slug(owner)}`;
    addNode(nodeMap, {
      id: ownerNodeId,
      type: "human_owner",
      label: owner,
      subtitle: "Human owner",
      refId: owner,
      loopId,
      department: departmentForSpec(spec),
      parentId: loopIdNode,
      layer: "human",
      status: "ready",
      weight: 2.4,
      visibleByDefault,
      isExpandable: false
    });
    addEdge(edgeMap, nodeMap, {
      source: loopIdNode,
      target: ownerNodeId,
      kind: "owned_by",
      label: "owned by"
    });
  }

  for (const rule of spec.policy.escalationRules) {
    const reviewId = addPolicyReviewNode(nodeMap, spec, rule.id, rule.routeTo.primaryOwner || owner);
    addEdge(edgeMap, nodeMap, {
      source: loopIdNode,
      target: reviewId,
      kind: "requires_approval",
      label: rule.createEscalationCase ? "case review" : "review gate",
      semantic: true,
      executable: false
    });
  }

  const metricNames = extractMetricNames(spec);
  for (const metricName of metricNames.length > 0 ? metricNames : ["Loop health"]) {
    addMetricNode(nodeMap, edgeMap, {
      id: `${loopId}:${slug(metricName)}`,
      loopId,
      name: metricName,
      status: metricNames.length > 0 ? "ready" : "warning"
    }, visibleByDefault);
  }
}

function addPolicyReviewNode(
  nodeMap: Map<string, TopologyNode>,
  spec: LoopSpec,
  key: string,
  owner?: string
) {
  const loopId = spec.metadata.id;
  const reviewId = `review:${loopId}:${slug(key)}`;
  addNode(nodeMap, {
    id: reviewId,
    type: "human_review",
    label: owner ? `${owner} review` : "Human review",
    subtitle: key.replace(/_/g, " "),
    refId: key,
    loopId,
    department: departmentForSpec(spec),
    parentId: loopNodeId(loopId),
    layer: "human",
    status: "open",
    weight: 2.5,
    visibleByDefault: false,
    isExpandable: false
  });
  return reviewId;
}

function addTrace(
  nodeMap: Map<string, TopologyNode>,
  edgeMap: Map<string, TopologyEdge>,
  trace: LoopRunTrace
) {
  updateLoopRuntimeFromTrace(nodeMap, trace);
  const nodeId = `trace:${trace.id}`;
  addNode(nodeMap, {
    id: nodeId,
    type: "trace",
    label: trace.id,
    subtitle: String(trace.status).replace(/_/g, " "),
    refId: trace.id,
    refType: "run_trace",
    loopId: trace.loopId,
    parentId: loopNodeId(trace.loopId),
    layer: "runtime",
    status: trace.status === "COMPLETED" ? "complete" : "active",
    weight: 2,
    visibleByDefault: false,
    isExpandable: false,
    metadata: {
      mode: trace.mode,
      startedAt: trace.startedAt,
      completedAt: trace.completedAt,
      latencyMs: trace.latencyMs,
      estimatedCost: trace.estimatedCost
    }
  });
  addEdge(edgeMap, nodeMap, {
    source: loopNodeId(trace.loopId),
    target: nodeId,
    kind: "writes_trace_to",
    label: "writes trace"
  });
}

function updateLoopRuntimeFromTrace(
  nodeMap: Map<string, TopologyNode>,
  trace: LoopRunTrace
): void {
  const loopNode = nodeMap.get(loopNodeId(trace.loopId));
  if (!loopNode) {
    return;
  }

  const existingMetadata = loopNode.metadata ?? {};
  const existingLatestRun = isRecord(existingMetadata.latestRun) ? existingMetadata.latestRun : undefined;
  const existingLatestAt = typeof existingLatestRun?.startedAt === "string" ? existingLatestRun.startedAt : undefined;
  const traceStartedAt = trace.startedAt;
  const shouldReplaceLatest = !existingLatestAt || traceStartedAt.localeCompare(existingLatestAt) >= 0;
  const openReviewCount = trace.humanReviews.filter((review) => review.status === "open").length;
  const existingOpenReviews = typeof existingMetadata.openReviews === "number" ? existingMetadata.openReviews : 0;

  loopNode.metadata = {
    ...existingMetadata,
    openReviews: existingOpenReviews + openReviewCount,
    ...(shouldReplaceLatest
      ? {
          lastRunAt: trace.completedAt ?? trace.startedAt,
          latestRun: {
            id: trace.id,
            status: trace.status,
            mode: trace.mode,
            startedAt: trace.startedAt,
            completedAt: trace.completedAt
          }
        }
      : {})
  };
}

function addEscalationCase(
  nodeMap: Map<string, TopologyNode>,
  edgeMap: Map<string, TopologyEdge>,
  caseItem: EscalationCase,
  managementLoopId: string
) {
  const nodeId = `case:${caseItem.id}`;
  addNode(nodeMap, {
    id: nodeId,
    type: "escalation_case",
    label: caseItem.summary,
    subtitle: `${caseItem.severity} ${caseItem.status}`,
    refId: caseItem.id,
    refType: "escalation_case",
    loopId: caseItem.sourceLoopId,
    parentId: loopNodeId(caseItem.sourceLoopId),
    layer: "runtime",
    status: caseItem.status === "resolved" || caseItem.status === "closed" ? "complete" : "open",
    weight: ["P0", "P1"].includes(caseItem.severity) ? 3.5 : 2.5,
    visibleByDefault: false,
    isExpandable: false,
    metadata: {
      category: caseItem.category,
      severity: caseItem.severity,
      confidence: caseItem.confidence,
      primaryOwner: caseItem.routing.primaryOwner.role
    }
  });
  addEdge(edgeMap, nodeMap, {
    source: loopNodeId(caseItem.sourceLoopId),
    target: nodeId,
    kind: "escalates_to",
    label: "escalates"
  });
  addEdge(edgeMap, nodeMap, {
    source: nodeId,
    target: managementLoopId,
    kind: "reports_to",
    label: "reported to management",
    semantic: false,
    executable: false
  });
}

function addHumanReviewNode(
  nodeMap: Map<string, TopologyNode>,
  edgeMap: Map<string, TopologyEdge>,
  review: HumanReviewTrace,
  loopId: string
) {
  const nodeId = `review-trace:${review.id}`;
  addNode(nodeMap, {
    id: nodeId,
    type: "human_review",
    label: `${review.role} review`,
    subtitle: review.status.replace(/_/g, " "),
    refId: review.id,
    refType: "human_review",
    loopId,
    parentId: loopNodeId(loopId),
    layer: "runtime",
    status: review.status === "open" ? "open" : review.status === "rejected" ? "blocked" : "complete",
    weight: review.status === "open" ? 3 : 2.2,
    visibleByDefault: false,
    isExpandable: false,
    metadata: {
      runId: review.runId,
      comment: review.comment,
      teacherFeedback: review.teacherFeedback,
      reviewMinutes: review.reviewMinutes,
      reworkMinutes: review.reworkMinutes
    }
  });
  addEdge(edgeMap, nodeMap, {
    source: loopNodeId(loopId),
    target: nodeId,
    kind: "requires_approval",
    label: "human review",
    semantic: true,
    executable: false
  });
}

function addMetricNode(
  nodeMap: Map<string, TopologyNode>,
  edgeMap: Map<string, TopologyEdge>,
  metric: TopologyMetricInput,
  visibleByDefault: boolean
) {
  const nodeId = `metric:${metric.loopId}:${slug(metric.id ?? metric.name)}`;
  addNode(nodeMap, {
    id: nodeId,
    type: "metric",
    label: metric.name,
    subtitle: metric.value === undefined ? "Metric" : String(metric.value),
    refId: metric.id ?? metric.name,
    refType: "metric",
    loopId: metric.loopId,
    parentId: loopNodeId(metric.loopId),
    layer: "measurement",
    status: metric.status ?? "ready",
    weight: metric.value === undefined ? 2 : 2.6,
    visibleByDefault,
    isExpandable: false,
    metadata: {
      value: metric.value
    }
  });
  addEdge(edgeMap, nodeMap, {
    source: loopNodeId(metric.loopId),
    target: nodeId,
    kind: "updates_metric",
    label: "updates metric"
  });
}

function addImprovementNode(
  nodeMap: Map<string, TopologyNode>,
  edgeMap: Map<string, TopologyEdge>,
  item: TopologyImprovementItem
) {
  const status = normalizeImprovementStatus(item.status);
  const nodeId = `improvement:${item.id}`;
  addNode(nodeMap, {
    id: nodeId,
    type: "improvement_item",
    label: item.title,
    subtitle: item.failureMode ?? "Improvement item",
    refId: item.id,
    refType: "improvement_item",
    loopId: item.loopId,
    parentId: loopNodeId(item.loopId),
    layer: "runtime",
    status,
    weight: status === "open" ? 2.8 : 2.1,
    visibleByDefault: false,
    isExpandable: false,
    metadata: {
      sourceTraceId: item.sourceTraceId,
      failureMode: item.failureMode
    }
  });
  addEdge(edgeMap, nodeMap, {
    source: item.sourceTraceId ? `trace:${item.sourceTraceId}` : loopNodeId(item.loopId),
    target: nodeId,
    kind: "learns_from",
    label: "learns"
  });
  addEdge(edgeMap, nodeMap, {
    source: nodeId,
    target: loopNodeId(item.loopId),
    kind: "learns_from",
    label: "improves"
  });
}

function addNode(nodeMap: Map<string, TopologyNode>, node: TopologyNode) {
  if (!nodeMap.has(node.id)) {
    nodeMap.set(node.id, node);
  }
}

function addEdge(
  edgeMap: Map<string, TopologyEdge>,
  nodeMap: Map<string, TopologyNode>,
  edge: {
    source: string;
    target: string;
    kind: TopologyEdgeKind;
    label?: string;
    semantic?: boolean;
    executable?: boolean;
    metadata?: Record<string, unknown>;
  }
) {
  if (edge.source === edge.target || !nodeMap.has(edge.source) || !nodeMap.has(edge.target)) {
    return;
  }

  const id = `${edge.source}->${edge.kind}->${edge.target}`;
  if (edgeMap.has(id)) {
    return;
  }

  edgeMap.set(id, {
    id,
    source: edge.source,
    target: edge.target,
    kind: edge.kind,
    label: edge.label,
    semantic: edge.semantic ?? true,
    executable: edge.executable ?? isExecutableEdge(edge.kind),
    style: edgeStyle(edge.kind),
    metadata: edge.metadata
  });
}

function createFilterCounts(nodes: TopologyNode[]): TopologyFilterCounts {
  const byType = Object.fromEntries(topologyNodeTypes.map((type) => [type, 0])) as Record<TopologyNodeType, number>;
  const byLayer = Object.fromEntries(topologyLayers.map((layer) => [layer, 0])) as Record<TopologyLayer, number>;
  const byStatus = Object.fromEntries(topologyStatuses.map((status) => [status, 0])) as Record<TopologyNodeStatus, number>;
  const byDepartment: Record<string, number> = {};

  for (const node of nodes) {
    byType[node.type] += 1;
    byLayer[node.layer] += 1;
    byStatus[node.status] += 1;
    if (node.department) {
      byDepartment[node.department] = (byDepartment[node.department] ?? 0) + 1;
    }
  }

  return {
    total: nodes.length,
    visibleByDefault: nodes.filter((node) => node.visibleByDefault).length,
    orphans: nodes.filter((node) => node.isOrphan).length,
    byType,
    byLayer,
    byDepartment,
    byStatus
  };
}

function defaultLayerVisibility(mode: TopologyVisibilityMode): Record<TopologyLayer, boolean> {
  if (mode === "brain-map" || mode === "selected-loop") {
    return {
      structure: true,
      data: true,
      action: true,
      verification: true,
      human: true,
      measurement: true,
      runtime: false,
      memory: true
    };
  }

  return {
    structure: true,
    data: false,
    action: false,
    verification: false,
    human: false,
    measurement: false,
    runtime: mode === "runtime-trace-map",
    memory: false
  };
}

function buildBreadcrumbs(nodeId: string, nodes: TopologyNode[]) {
  const nodeMap = new Map(nodes.map((node) => [node.id, node]));
  const breadcrumbs: TopologyNode[] = [];
  let current = nodeMap.get(nodeId);
  const visited = new Set<string>();

  while (current && !visited.has(current.id)) {
    breadcrumbs.push(current);
    visited.add(current.id);
    current = current.parentId ? nodeMap.get(current.parentId) : undefined;
  }

  return breadcrumbs.reverse();
}

function directSemanticConnections(nodeId: string, edges: TopologyEdge[]) {
  const connected = new Set<string>([nodeId]);
  for (const edge of edges) {
    if (!edge.semantic) {
      continue;
    }
    if (edge.source === nodeId) {
      connected.add(edge.target);
    }
    if (edge.target === nodeId) {
      connected.add(edge.source);
    }
  }
  return connected;
}

function findLoopNode(nodes: TopologyNode[], loopIdOrNodeId: string) {
  const candidates = loopLookupCandidates(loopIdOrNodeId);
  return nodes.find(
    (node) =>
      candidates.has(node.id) ||
      (node.loopId ? candidates.has(node.loopId) : false) ||
      (node.refId ? candidates.has(node.refId) : false)
  );
}

function loopLookupCandidates(loopIdOrNodeId: string) {
  const candidates = new Set<string>([
    loopIdOrNodeId,
    loopNodeId(loopIdOrNodeId)
  ]);
  const departmentPrefixes = ["loop:department:", "department:"];
  for (const prefix of departmentPrefixes) {
    if (!loopIdOrNodeId.startsWith(prefix)) {
      continue;
    }
    const department = departmentSlug(loopIdOrNodeId.slice(prefix.length));
    candidates.add(`${prefix}${department}`);
    candidates.add(`department:${department}`);
    candidates.add(`loop:department:${department}`);
  }
  return candidates;
}

function nodeMatchesSearch(node: TopologyNode, search: string) {
  return `${node.label} ${node.subtitle ?? ""} ${node.department ?? ""} ${node.type}`
    .toLowerCase()
    .includes(search);
}

function edgeStyle(kind: TopologyEdgeKind): TopologyEdge["style"] {
  if (["requires_approval", "reports_to"].includes(kind)) {
    return "dashed";
  }
  if (["writes_trace_to", "learns_from", "reads_memory", "writes_memory", "related_to"].includes(kind)) {
    return "dotted";
  }
  return "solid";
}

function isExecutableEdge(kind: TopologyEdgeKind) {
  return ["calls", "uses_tool"].includes(kind);
}

function topologyTypeForSource(type: string): TopologyNodeType {
  if (type === "integration") {
    return "integration";
  }
  if (type === "memory") {
    return "memory";
  }
  if (type === "policy" || type === "fixture") {
    return "context_source";
  }
  return "signal_source";
}

function severityRank(severity: TopologyWarning["severity"]) {
  if (severity === "error") {
    return 3;
  }
  if (severity === "warning") {
    return 2;
  }
  return 1;
}

function normalizeImprovementStatus(status?: TopologyImprovementItem["status"]): TopologyNodeStatus {
  if (status === "blocked" || status === "complete" || status === "warning" || status === "open") {
    return status;
  }
  if (status === "done" || status === "closed" || status === "resolved") {
    return "complete";
  }
  return "open";
}

function departmentForSpec(spec: LoopSpec) {
  const department = spec.topology?.department ?? spec.metadata.labels?.department;
  return department?.trim() || undefined;
}

function departmentSlug(value: string) {
  return slug(value.replace(/_/g, " "));
}

function ownerLabel(spec: LoopSpec) {
  const owner = spec.metadata.owner;
  if (!owner) {
    const escalationOwner = spec.policy.escalationRules.find((rule) => rule.routeTo.primaryOwner)?.routeTo.primaryOwner;
    return escalationOwner || undefined;
  }
  return owner.name ? `${owner.name} (${owner.role})` : owner.role;
}

function extractMetricNames(spec: LoopSpec): string[] {
  const metrics = new Set<string>();
  const labels = spec.metadata.labels ?? {};

  for (const key of ["metric", "primaryMetric", "targetMetric", "target_metric"]) {
    if (labels[key]) {
      metrics.add(labels[key]);
    }
  }

  const extension = spec.studioExtension as Record<string, unknown> | undefined;
  const extensionMetrics = Array.isArray(extension?.metrics) ? extension.metrics : [];
  for (const metric of extensionMetrics) {
    if (typeof metric === "string" && metric.trim()) {
      metrics.add(metric);
    }
  }

  const generatedSpec = isRecord(extension?.generatedSpec) ? extension.generatedSpec : undefined;
  const generatedMetrics = Array.isArray(generatedSpec?.metrics) ? generatedSpec.metrics : [];
  for (const metric of generatedMetrics) {
    if (isRecord(metric) && typeof metric.name === "string") {
      metrics.add(metric.name);
    }
  }

  const answers = isRecord(extension?.answers) ? extension.answers : undefined;
  for (const key of ["targetMetric", "target_metric", "primaryMetric", "metric"]) {
    if (typeof answers?.[key] === "string" && answers[key].trim()) {
      metrics.add(answers[key]);
    }
  }

  return Array.from(metrics);
}

function loopNodeId(loopId: string) {
  return `loop:${loopId}`;
}

function titleize(value: string) {
  return value
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function slug(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "") || "item";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
