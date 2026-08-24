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
const MAX_WORKFLOW_LOOPS_PER_DEPARTMENT = 3;

const departmentSortOrder = [
  "product",
  "marketing",
  "sales",
  "customer_success",
  "engineering",
  "operations_finance",
  "legal_security",
  "hr",
  "management",
  "custom"
] as const;

type PreviewStoryNodeDefinition = {
  id: string;
  type: Extract<BrainNodeType, "data" | "metric" | "review" | "improvement" | "trace">;
  label: string;
  subtitle: string;
  purpose: string;
  order: number;
  departmentId?: string;
  sourceWorkflowLabel?: string;
};

const previewIncomingSignals: PreviewStoryNodeDefinition[] = [
  {
    id: "preview:data:product-analytics",
    type: "data",
    label: "Product events",
    subtitle: "usage, activation, retention",
    purpose: "Product usage events arrive at Hermes so it can decide whether Product, Marketing, CS, or another loop owns the next action.",
    order: 1
  },
  {
    id: "preview:data:crm",
    type: "data",
    label: "CRM signals",
    subtitle: "pipeline, accounts, ARR",
    purpose: "CRM state tells Hermes whether a problem belongs to Sales, Customer Success, Finance, or Management.",
    order: 2
  },
  {
    id: "preview:data:support",
    type: "data",
    label: "Support tickets",
    subtitle: "pain, sentiment, urgency",
    purpose: "Support volume and customer language become routing evidence for CS, Product, Engineering, or Legal/Security loops.",
    order: 3
  },
  {
    id: "preview:data:ads",
    type: "data",
    label: "Ad platforms",
    subtitle: "spend, CAC, creative fatigue",
    purpose: "Campaign anomalies reach Hermes first; Hermes routes only well-supported marketing problems into Ads or Content loops.",
    order: 4
  },
  {
    id: "preview:data:website",
    type: "data",
    label: "Website",
    subtitle: "forms, conversion, source",
    purpose: "Website events give Hermes enough context to avoid guessing between Marketing, Sales, and Product work.",
    order: 5
  },
  {
    id: "preview:data:billing",
    type: "data",
    label: "Billing",
    subtitle: "invoices, spend, renewals",
    purpose: "Billing and spend events route into Finance/Ops loops when money, approvals, or collections need attention.",
    order: 6
  },
  {
    id: "preview:data:incidents",
    type: "data",
    label: "Incidents",
    subtitle: "alerts, impact, timeline",
    purpose: "Incident events route into Engineering or Legal/Security loops with evidence instead of loose Slack escalation.",
    order: 7
  },
  {
    id: "preview:data:docs",
    type: "data",
    label: "Docs + notes",
    subtitle: "briefs, policies, decisions",
    purpose: "Documents provide trusted context so Hermes can ground loop decisions in source material.",
    order: 8
  },
  {
    id: "preview:data:email-calendar",
    type: "data",
    label: "Email + calendar",
    subtitle: "commitments, meetings, owners",
    purpose: "Email and calendar signals help Hermes find missing follow-up, owner handoffs, and review gates.",
    order: 9
  },
  {
    id: "preview:data:warehouse",
    type: "data",
    label: "Warehouse",
    subtitle: "metrics, cohorts, forecasts",
    purpose: "Warehouse metrics let Hermes compare each loop's work against business outcomes, not only activity.",
    order: 10
  }
];

const previewEvidenceReturns: PreviewStoryNodeDefinition[] = [
  {
    id: "preview:evidence:product",
    type: "metric",
    label: "Product learning",
    subtitle: "adoption + feedback evidence",
    purpose: "Product loop outcomes return as learning evidence for future roadmap and release decisions.",
    order: 1,
    departmentId: "product",
    sourceWorkflowLabel: "Release Learning Loop"
  },
  {
    id: "preview:evidence:marketing",
    type: "metric",
    label: "Pipeline quality",
    subtitle: "qualified pipeline, CAC, activation",
    purpose: "Marketing loop outcomes return as evidence about which channels and messages create qualified customers.",
    order: 2,
    departmentId: "marketing",
    sourceWorkflowLabel: "Campaign Learning Loop"
  },
  {
    id: "preview:evidence:sales",
    type: "metric",
    label: "Deal movement",
    subtitle: "stage age, next step, risk",
    purpose: "Sales loop outcomes return as evidence about which opportunities moved and which risks still need owners.",
    order: 3,
    departmentId: "sales",
    sourceWorkflowLabel: "Deal Risk Loop"
  },
  {
    id: "preview:evidence:cs",
    type: "review",
    label: "Customer health",
    subtitle: "risk, sentiment, renewal context",
    purpose: "Customer Success loop outcomes return as reviewed evidence about accounts needing human relationship work.",
    order: 4,
    departmentId: "customer_success",
    sourceWorkflowLabel: "Customer Health Risk Loop"
  },
  {
    id: "preview:evidence:engineering",
    type: "improvement",
    label: "Incident learning",
    subtitle: "root cause + prevention item",
    purpose: "Engineering loop outcomes return as prevention work instead of repeated incident babysitting.",
    order: 5,
    departmentId: "engineering",
    sourceWorkflowLabel: "Incident Learning Loop"
  },
  {
    id: "preview:evidence:finance",
    type: "metric",
    label: "Forecast variance",
    subtitle: "cash, spend, approvals",
    purpose: "Finance/Ops loop outcomes return as auditable evidence for forecast and approval decisions.",
    order: 6,
    departmentId: "operations_finance",
    sourceWorkflowLabel: "Forecast Variance Loop"
  },
  {
    id: "preview:evidence:legal",
    type: "review",
    label: "Risk packet",
    subtitle: "citation-backed review",
    purpose: "Legal/Security loop outcomes return as reviewed evidence for sensitive approvals and audit trails.",
    order: 7,
    departmentId: "legal_security",
    sourceWorkflowLabel: "Incident Evidence Loop"
  },
  {
    id: "preview:evidence:hr",
    type: "review",
    label: "People review",
    subtitle: "privacy-safe human judgment",
    purpose: "HR loop outcomes return as human-reviewed evidence, never as unchecked automated people decisions.",
    order: 8,
    departmentId: "hr",
    sourceWorkflowLabel: "Retention Signal Loop"
  }
];

const PRODUCT_PREVIEW_SIGNAL_IDS = new Set([
  "preview:data:product-analytics",
  "preview:data:support",
  "preview:data:crm",
  "preview:data:docs",
  "preview:data:warehouse"
]);

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
  const structuralNodes = selectStructuralNodes(input.topology, selectedNodeId, diagnostics, Boolean(input.includeCatalogLoops));
  const structuralNodeIds = new Set(structuralNodes.map((node) => node.id));
  const nodes: BrainGraphNode[] = [];
  const nodeIds = new Set<string>();
  const mapOptions = { previewStory: Boolean(input.previewStory) };

  for (const node of structuralNodes) {
    const mapped = mapTopologyNode(node, mapOptions);
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
    const mapped = mapTopologyNode(node, mapOptions);
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

  if (input.previewStory) {
    addPreviewStoryLayer({ input, nodes, edges, nodeIds });
  }

  addRollupMetadata(nodes, edges);
  diagnostics.visibleNodeCount = nodes.length;

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

export function filterBrainGraphForDepartmentStory(input: {
  graph: BrainGraph;
  departmentId: string;
}): BrainGraph {
  const keepIds = new Set<string>();
  const { departmentId, graph } = input;
  const productStory = departmentId === "product";

  for (const node of graph.nodes) {
    if (node.type === "company_brain") {
      keepIds.add(node.id);
      continue;
    }
    if (node.type === "department_loop" && node.departmentId === departmentId) {
      keepIds.add(node.id);
      continue;
    }
    if (node.type === "workflow_loop" && node.departmentId === departmentId) {
      keepIds.add(node.id);
      continue;
    }
    if (productStory && PRODUCT_PREVIEW_SIGNAL_IDS.has(node.id)) {
      keepIds.add(node.id);
      continue;
    }
    if (
      node.metadata?.previewRole === "evidence_outcome" &&
      node.departmentId === departmentId
    ) {
      keepIds.add(node.id);
    }
  }

  if (!graph.nodes.some((node) => node.type === "department_loop" && node.departmentId === departmentId)) {
    return graph;
  }

  const nodes = graph.nodes.filter((node) => keepIds.has(node.id));
  const edges = graph.edges.filter((edge) => keepIds.has(edge.source) && keepIds.has(edge.target));
  const hiddenNodeIds = [
    ...graph.diagnostics.hiddenNodeIds,
    ...graph.nodes.filter((node) => !keepIds.has(node.id)).map((node) => node.id)
  ];

  return {
    nodes,
    edges,
    diagnostics: {
      ...graph.diagnostics,
      visibleNodeCount: nodes.length,
      hiddenNodeIds
    }
  };
}

function selectStructuralNodes(
  topology: SemanticTopology,
  selectedNodeId: string | undefined,
  diagnostics: BrainGraphDiagnostics,
  includeTemplateOnly: boolean
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
      (includeTemplateOnly || !isTemplateOnly(node))
    )
    .sort(byWorkflowPriority);
  const selectedWorkflow = selectedNodeId
    ? workflowNodes.find((node) => node.id === selectedNodeId)
    : undefined;
  const cappedWorkflowNodes = capWorkflowNodesByDepartment(workflowNodes, selectedWorkflow);

  for (const node of topology.nodes) {
    if (!structureTypes.has(node.type)) {
      continue;
    }
    if (node.isOrphan || (!includeTemplateOnly && isTemplateOnly(node))) {
      diagnostics.hiddenNodeIds.push(node.id);
    }
  }

  for (const node of workflowNodes) {
    if (!cappedWorkflowNodes.some((visibleNode) => visibleNode.id === node.id) && node.id !== selectedWorkflow?.id) {
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

function capWorkflowNodesByDepartment(
  workflowNodes: TopologyNode[],
  selectedWorkflow: TopologyNode | undefined
) {
  const capped: TopologyNode[] = [];
  const countsByDepartment = new Map<string, number>();

  for (const node of workflowNodes) {
    if (node.metadata?.appNode === true) {
      if (capped.length < MAX_DEFAULT_WORKFLOW_LOOPS) capped.push(node);
      continue;
    }
    const department = node.department ?? node.parentId ?? "unassigned";
    const count = countsByDepartment.get(department) ?? 0;

    if (count >= MAX_WORKFLOW_LOOPS_PER_DEPARTMENT || capped.length >= MAX_DEFAULT_WORKFLOW_LOOPS) {
      continue;
    }

    capped.push(node);
    countsByDepartment.set(department, count + 1);
  }

  if (selectedWorkflow && !capped.some((node) => node.id === selectedWorkflow.id)) {
    let sameDepartmentIndex = -1;
    for (let index = capped.length - 1; index >= 0; index -= 1) {
      if (capped[index].department === selectedWorkflow.department) {
        sameDepartmentIndex = index;
        break;
      }
    }
    const replacementIndex = sameDepartmentIndex >= 0
      ? sameDepartmentIndex
      : Math.max(capped.length - 1, 0);
    capped.splice(replacementIndex, capped.length > 0 ? 1 : 0, selectedWorkflow);
  }

  return capped;
}

function mapTopologyNode(
  node: TopologyNode,
  options: { previewStory?: boolean } = {}
): BrainGraphNode | null {
  const type = mapNodeType(node.type);
  if (!type) {
    return null;
  }
  const baseStyle = nodeTypeStyles[type];
  const appNode = node.metadata?.appNode === true;
  const departmentStroke = type === "workflow_loop" ? nodeColorForDepartment(node.department) : undefined;
  const status = mapStatus(node.status);
  const stroke = statusStroke[status] ?? (appNode ? "#f97316" : departmentStroke) ?? baseStyle.stroke;
  const source = typeof node.metadata?.source === "string" ? node.metadata.source : undefined;
  const runtimeLevel = typeof node.metadata?.runtimeLevel === "string" ? node.metadata.runtimeLevel : undefined;
  const isDemoCatalog = source === "demo_catalog";

  return {
    id: node.id,
    type,
    label: isDemoCatalog && type === "workflow_loop" && !options.previewStory ? `Demo: ${node.label}` : node.label,
    subtitle: isDemoCatalog ? [runtimeLabel(runtimeLevel, options.previewStory), node.subtitle].filter(Boolean).join(" · ") : node.subtitle,
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
    radius: appNode ? 36 : radiusForNode(type, node.weight),
    color: appNode ? "#fff7ed" : type === "workflow_loop" ? "#ffffff" : baseStyle.color,
    stroke,
    metadata: {
      ...node.metadata,
      topologyType: node.type,
      topologyLayer: node.layer,
      fullLabel: node.label
    }
  };
}

function runtimeLabel(runtimeLevel: string | undefined, previewStory = false): string | undefined {
  if (!runtimeLevel) return undefined;
  if (previewStory) {
    if (runtimeLevel === "runnable") return "Runnable example";
    if (runtimeLevel === "spec_stub") return "Spec example";
    if (runtimeLevel === "catalog") return "Template";
    return runtimeLevel.replace(/_/g, " ");
  }
  if (runtimeLevel === "runnable") return "Demo catalog · runnable";
  if (runtimeLevel === "spec_stub") return "Demo catalog · spec stub";
  if (runtimeLevel === "catalog") return "Demo catalog";
  return `Demo catalog · ${runtimeLevel}`;
}

function addPreviewStoryLayer({
  input,
  nodes,
  edges,
  nodeIds
}: {
  input: BrainGraphAdapterInput;
  nodes: BrainGraphNode[];
  edges: BrainGraphEdge[];
  nodeIds: Set<string>;
}) {
  const company = nodes.find((node) => node.type === "company_brain") ?? nodes[0];
  if (!company) {
    return;
  }

  if (input.includeData) {
    for (const signal of previewIncomingSignals) {
      addPreviewNode(nodes, nodeIds, signal, "incoming_signal");
      edges.push(styledEdge({
        id: `${signal.id}->${company.id}`,
        source: signal.id,
        target: company.id,
        type: "loop_observes_data",
        label: "business event"
      }));
    }
  }

  if (!input.includeMetrics && !input.includeReviews && !input.includeImprove) {
    return;
  }

  const visibleEvidence = previewEvidenceReturns.filter((item) => {
    if (item.type === "metric") return input.includeMetrics;
    if (item.type === "review") return input.includeReviews;
    if (item.type === "improvement" || item.type === "trace") return input.includeImprove;
    return true;
  });
  const workflowNodes = nodes.filter((node) => node.type === "workflow_loop");

  for (const outcome of visibleEvidence) {
    const sourceWorkflow = findPreviewEvidenceSource(workflowNodes, outcome);
    addPreviewNode(nodes, nodeIds, outcome, "evidence_outcome");

    if (sourceWorkflow) {
      edges.push(styledEdge({
        id: `${sourceWorkflow.id}->${outcome.id}`,
        source: sourceWorkflow.id,
        target: outcome.id,
        type: edgeTypeForPreviewOutcome(outcome.type),
        label: "outcome"
      }));
    }

    edges.push(styledEdge({
      id: `${outcome.id}->${company.id}`,
      source: outcome.id,
      target: company.id,
      type: "loop_learns_from_trace",
      label: "evidence returns",
      dashed: true
    }));
  }
}

function addPreviewNode(
  nodes: BrainGraphNode[],
  nodeIds: Set<string>,
  definition: PreviewStoryNodeDefinition,
  role: "incoming_signal" | "evidence_outcome"
) {
  if (nodeIds.has(definition.id)) {
    return;
  }

  const style = nodeTypeStyles[definition.type];
  nodes.push({
    id: definition.id,
    type: definition.type,
    label: definition.label,
    subtitle: definition.subtitle,
    purpose: definition.purpose,
    departmentId: definition.departmentId,
    status: "ready",
    health: 82,
    radius: definition.type === "data" ? 22 : 24,
    color: style.color,
    stroke: definition.departmentId ? nodeColorForDepartment(definition.departmentId) : style.stroke,
    metadata: {
      previewStory: true,
      previewRole: role,
      previewOrder: definition.order,
      fullLabel: definition.label
    }
  });
  nodeIds.add(definition.id);
}

function findPreviewEvidenceSource(
  workflowNodes: BrainGraphNode[],
  outcome: PreviewStoryNodeDefinition
) {
  const departmentWorkflows = workflowNodes.filter((node) => node.departmentId === outcome.departmentId);
  return (
    departmentWorkflows.find((node) => node.label === outcome.sourceWorkflowLabel) ??
    departmentWorkflows[0] ??
    workflowNodes[0]
  );
}

function edgeTypeForPreviewOutcome(type: PreviewStoryNodeDefinition["type"]): BrainEdgeType {
  if (type === "metric") return "loop_updates_metric";
  if (type === "review") return "loop_requires_review";
  return "loop_learns_from_trace";
}

function styledEdge(input: {
  id: string;
  source: string;
  target: string;
  type: BrainEdgeType;
  label?: string;
  dashed?: boolean;
}): BrainGraphEdge {
  const style = edgeTypeStyles[input.type];

  return {
    id: input.id,
    source: input.source,
    target: input.target,
    type: input.type,
    label: input.label,
    semantic: true,
    executable: false,
    width: style.width,
    color: style.color,
    opacity: style.opacity,
    dashed: input.dashed ?? style.dashed
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
  if (edge.kind === "calls") return "loop_supports_loop";
  if (edge.kind === "writes_memory") return "loop_returns_evidence";
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
      const children = edges.filter((edge) => edge.source === node.id).map((edge) => nodesById.get(edge.target));
      const appCount = children.filter((child) => child?.metadata?.appNode === true).length;
      const childWorkflowCount = children.length;
      node.subtitle = appCount > 0
        ? `${appCount} installed app${appCount === 1 ? "" : "s"} · ${childWorkflowCount} direct workflows`
        : `${childWorkflowCount} workflow loops`;
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
  const departmentRank = departmentSortRank(left.department) - departmentSortRank(right.department);
  if (departmentRank !== 0) {
    return departmentRank;
  }
  return `${left.department ?? ""}:${left.label}`.localeCompare(`${right.department ?? ""}:${right.label}`);
}

function departmentSortRank(department: string | undefined) {
  const index = department ? departmentSortOrder.indexOf(department as (typeof departmentSortOrder)[number]) : -1;
  return index >= 0 ? index : departmentSortOrder.length;
}

function statusPriority(status: TopologyNodeStatus) {
  if (status === "blocked") return 0;
  if (status === "warning" || status === "open") return 1;
  if (status === "active") return 2;
  if (status === "ready") return 3;
  return 4;
}
