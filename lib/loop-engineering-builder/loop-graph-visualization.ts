import type { LoopSpec } from "./loop-spec-schema";
import type {
  LoopEgoGraph,
  SemanticTopology,
  TopologyNode,
  TopologyNodeType
} from "../loopgraph-core/graph";
import {
  sequenceGroupForVisualNode,
  sequenceIndexForVisualNode
} from "./loop-graph-layout";
import type {
  LoopGraph,
  LoopGraphNode,
  LoopGraphNodeKind,
  LoopRecord,
  LoopTemplate
} from "./types";

export type LoopGraphVisualNodeKind =
  | "organization"
  | "management"
  | "department"
  | "loop"
  | "trigger"
  | "data_source"
  | "action"
  | "verification"
  | "owner"
  | "metric"
  | "review"
  | "improvement"
  | "rollup";

export type LoopGraphVisualNode = {
  id: string;
  label: string;
  kind: LoopGraphVisualNodeKind;
  subtitle?: string;
  detail?: string;
  department?: string;
  health?: number;
  weight?: number;
  sourceNodeId?: string;
  metadata?: Record<string, unknown>;
};

export type LoopGraphVisualEdge = {
  id: string;
  source: string;
  target: string;
  label?: string;
  kind?: string;
  metadata?: Record<string, unknown>;
};

export type LoopGraphVisual = {
  id: string;
  title: string;
  valueLabel?: string;
  selectedNodeId?: string;
  layoutMode?: "brain-map";
  nodes: LoopGraphVisualNode[];
  edges: LoopGraphVisualEdge[];
};

export function buildTemplateLoopGraph(template: LoopTemplate): LoopGraphVisual {
  const scope = `template:${template.id}`;
  const centerId = `${scope}:loop`;
  const graph = createGraphBuilder(scope);
  const primaryMetric =
    template.primaryMetric ?? template.defaultMetrics?.[0] ?? "Quality-adjusted output";

  graph.addNode({
    id: centerId,
    kind: "loop",
    label: template.name,
    subtitle: template.businessOutcome ?? template.goal ?? template.description,
    detail: template.description,
    department: template.department,
    weight: 5,
    metadata: {
      templateId: template.id,
      runtimeLevel: template.runtimeLevel,
      loopType: template.loopType
    }
  });

  const dataSources = valuesFromConnections(template, "data_source", template.requiredDataSources, [
    "Workspace signals"
  ]).slice(0, 4);
  const actionSteps = normalizedValues(template.routine, ["Draft next action"]).slice(0, 3);
  const verificationChecks = normalizedValues(template.verification, ["Verify output"]).slice(0, 2);
  const owners = valuesFromConnections(template, "owner", template.defaultOwners, ["Loop owner"]).slice(0, 2);
  const metrics = valuesFromConnections(template, "metric", template.defaultMetrics ?? [primaryMetric], [
    primaryMetric
  ]).slice(0, 3);
  const reviewItems = valuesFromConnections(template, "review", template.escalation, [
    "Human review checkpoint"
  ]).slice(0, 2);
  const improvements = valuesFromConnections(template, "improvement", template.secondaryMetrics, [
    "Trace-backed improvement"
  ]).slice(0, 1);
  const rollups = valuesFromConnections(template, "rollup", ["Management Loop"], ["Management Loop"]).slice(0, 1);

  const dataNodeIds = dataSources.map((source, index) =>
    graph.addNode({
      id: graph.nodeId("data", source, index),
      kind: "data_source",
      label: source,
      subtitle: "Observed signal",
      weight: 2
    })
  );
  dataNodeIds.forEach((nodeId) => graph.addEdge(nodeId, centerId, "observes", "observes"));

  const actionNodeIds = actionSteps.map((step, index) =>
    graph.addNode({
      id: graph.nodeId("action", step, index),
      kind: "action",
      label: step,
      subtitle: "Routine action",
      weight: index === 0 ? 3 : 2
    })
  );
  actionNodeIds.forEach((nodeId, index) => {
    graph.addEdge(index === 0 ? centerId : actionNodeIds[index - 1], nodeId, "acts", "routine");
  });

  const verificationNodeIds = verificationChecks.map((check, index) =>
    graph.addNode({
      id: graph.nodeId("verification", check, index),
      kind: "verification",
      label: check,
      subtitle: "Trust check",
      weight: 2
    })
  );
  verificationNodeIds.forEach((nodeId, index) => {
    graph.addEdge(actionNodeIds[index % actionNodeIds.length] ?? centerId, nodeId, "verifies", "verifies");
  });

  const ownerNodeIds = owners.map((owner, index) =>
    graph.addNode({
      id: graph.nodeId("owner", owner, index),
      kind: "owner",
      label: owner,
      subtitle: "Human owner",
      weight: 2
    })
  );
  ownerNodeIds.forEach((nodeId) => graph.addEdge(centerId, nodeId, "owned_by", "owned by"));

  const reviewNodeIds = reviewItems.map((review, index) =>
    graph.addNode({
      id: graph.nodeId("review", review, index),
      kind: "review",
      label: review,
      subtitle: "Review gate",
      weight: 2
    })
  );
  reviewNodeIds.forEach((nodeId, index) =>
    graph.addEdge(verificationNodeIds[index % verificationNodeIds.length] ?? centerId, nodeId, "review", "review")
  );

  const metricNodeIds = metrics.map((metric, index) =>
    graph.addNode({
      id: graph.nodeId("metric", metric, index),
      kind: "metric",
      label: metric,
      subtitle: "Measured outcome",
      weight: index === 0 ? 3 : 2
    })
  );
  metricNodeIds.forEach((nodeId) => graph.addEdge(centerId, nodeId, "measured_by", "measured by"));

  const improvementNodeIds = improvements.map((item, index) =>
    graph.addNode({
      id: graph.nodeId("improvement", item, index),
      kind: "improvement",
      label: item,
      subtitle: "Learning loop",
      weight: 2
    })
  );
  improvementNodeIds.forEach((nodeId) => {
    graph.addEdge(reviewNodeIds[0] ?? verificationNodeIds[0] ?? centerId, nodeId, "learns", "learns");
    graph.addEdge(nodeId, centerId, "improves", "improves");
  });

  const rollupNodeIds = rollups.map((rollup, index) =>
    graph.addNode({
      id: graph.nodeId("rollup", rollup, index),
      kind: "rollup",
      label: rollup,
      subtitle: "Operating review",
      weight: 3
    })
  );
  rollupNodeIds.forEach((nodeId) => {
    graph.addEdge(metricNodeIds[0] ?? centerId, nodeId, "rolls_up_to", "rolls up");
    graph.addEdge(centerId, nodeId, "rolls_up_to", "management review");
  });

  return {
    id: scope,
    title: template.name,
    valueLabel: primaryMetric,
    selectedNodeId: centerId,
    nodes: graph.nodes,
    edges: graph.edges
  };
}

export function buildLoopSpecGraph(input: {
  loop: LoopRecord;
  spec: LoopSpec;
}): LoopGraphVisual {
  const { loop, spec } = input;
  const scope = `loop:${loop.id}`;
  const centerId = `${scope}:logic`;
  const graph = createGraphBuilder(scope);

  graph.addNode({
    id: centerId,
    kind: "loop",
    label: loop.name,
    subtitle: spec.targetMetric,
    detail: spec.goal,
    department: loop.department,
    weight: 5,
    metadata: {
      loopId: loop.id,
      templateId: loop.templateId,
      status: loop.status
    }
  });

  const dataSources = normalizedValues(
    spec.dataSources.map((source) => source.name),
    spec.inputs.map((inputSource) => inputSource.name),
    ["Workspace signals"]
  ).slice(0, 4);
  const actionSteps = normalizedValues(
    spec.routine.map((step) => step.stepName),
    ["Draft next action"]
  ).slice(0, 4);
  const verificationChecks = normalizedValues(
    spec.verification.map((check) => check.name),
    ["Verify output"]
  ).slice(0, 3);
  const metrics = normalizedValues(
    spec.metrics.map((metric) => metric.name),
    [spec.targetMetric]
  ).slice(0, 3);
  const reviewItems = normalizedValues(
    spec.escalation.map((item) => item.ownerRole),
    [spec.humanOwner, "Human review checkpoint"]
  ).slice(0, 2);
  const rollups = normalizedValues(spec.managementReviewOutput.rollupMetrics, [
    "Management review"
  ]).slice(0, 2);

  const dataNodeIds = dataSources.map((source, index) =>
    graph.addNode({
      id: graph.nodeId("data", source, index),
      kind: "data_source",
      label: source,
      subtitle: "Input signal",
      weight: 2
    })
  );
  dataNodeIds.forEach((nodeId) => graph.addEdge(nodeId, centerId, "observes", "observes"));

  const actionNodeIds = actionSteps.map((step, index) =>
    graph.addNode({
      id: graph.nodeId("action", step, index),
      kind: "action",
      label: step,
      subtitle: "Routine step",
      weight: index === 0 ? 3 : 2
    })
  );
  actionNodeIds.forEach((nodeId, index) => {
    graph.addEdge(index === 0 ? centerId : actionNodeIds[index - 1], nodeId, "acts", "routine");
  });

  const verificationNodeIds = verificationChecks.map((check, index) =>
    graph.addNode({
      id: graph.nodeId("verification", check, index),
      kind: "verification",
      label: check,
      subtitle: "Verification",
      weight: 2
    })
  );
  verificationNodeIds.forEach((nodeId, index) => {
    graph.addEdge(actionNodeIds[index % actionNodeIds.length] ?? centerId, nodeId, "verifies", "verifies");
  });

  const ownerId = graph.addNode({
    id: graph.nodeId("owner", spec.humanOwner, 0),
    kind: "owner",
    label: spec.humanOwner,
    subtitle: "Human owner",
    weight: 2
  });
  graph.addEdge(centerId, ownerId, "owned_by", "owned by");

  const reviewNodeIds = reviewItems.map((review, index) =>
    graph.addNode({
      id: graph.nodeId("review", review, index),
      kind: "review",
      label: review,
      subtitle: "Escalation owner",
      weight: 2
    })
  );
  reviewNodeIds.forEach((nodeId, index) =>
    graph.addEdge(verificationNodeIds[index % verificationNodeIds.length] ?? ownerId, nodeId, "review", "review")
  );

  const metricNodeIds = metrics.map((metric, index) =>
    graph.addNode({
      id: graph.nodeId("metric", metric, index),
      kind: "metric",
      label: metric,
      subtitle: "Metric",
      weight: index === 0 ? 3 : 2
    })
  );
  metricNodeIds.forEach((nodeId) => graph.addEdge(centerId, nodeId, "measured_by", "measured by"));

  const improvementId = graph.addNode({
    id: graph.nodeId("improvement", "Trace-backed improvement", 0),
    kind: "improvement",
    label: "Trace-backed improvement",
    subtitle: "Learning loop",
    weight: 2
  });
  graph.addEdge(reviewNodeIds[0] ?? verificationNodeIds[0] ?? centerId, improvementId, "learns", "learns");
  graph.addEdge(improvementId, centerId, "improves", "improves");

  const rollupNodeIds = rollups.map((rollup, index) =>
    graph.addNode({
      id: graph.nodeId("rollup", rollup, index),
      kind: "rollup",
      label: rollup,
      subtitle: "Management review",
      weight: 3
    })
  );
  rollupNodeIds.forEach((nodeId) => {
    graph.addEdge(metricNodeIds[0] ?? centerId, nodeId, "rolls_up_to", "rolls up");
    graph.addEdge(centerId, nodeId, "rolls_up_to", "management review");
  });

  return {
    id: scope,
    title: loop.name,
    valueLabel: spec.targetMetric,
    selectedNodeId: centerId,
    nodes: graph.nodes,
    edges: graph.edges
  };
}

export function buildTopologyVisualGraph(graph: LoopGraph): LoopGraphVisual {
  return {
    id: "topology",
    title: "Company Loopgraph",
    valueLabel: graph.sourceLabel,
    selectedNodeId: graph.view.selectedNodeId,
    nodes: graph.nodes.map((node) => ({
      id: node.id,
      sourceNodeId: node.id,
      kind: visualKindForTopology(node.kind),
      label: node.label,
      subtitle: node.subtitle,
      department: node.department,
      health: node.health,
      weight: topologyWeight(node),
      metadata: node.metadata
    })),
    edges: graph.edges.map((edge) => ({
      id: edge.id,
      source: edge.source,
      target: edge.target,
      kind: edge.kind,
      label: edge.label
    }))
  };
}

export function buildSemanticTopologyVisualGraph(
  topology: SemanticTopology | LoopEgoGraph,
  options: { includeWorkflowTriggers?: boolean } = {}
): LoopGraphVisual {
  const nodes: LoopGraphVisualNode[] = topology.nodes.map((node) => ({
    id: node.id,
    sourceNodeId: node.id,
    kind: visualKindForSemanticTopology(node.type),
    label: node.label,
    subtitle: node.subtitle,
    department: node.department,
    weight: node.weight,
    metadata: {
      ...node.metadata,
      semanticType: node.type,
      semanticLayer: node.layer,
      status: node.status,
      refId: node.refId,
      refType: node.refType,
      loopId: node.loopId,
      parentId: node.parentId,
      visibleByDefault: node.visibleByDefault,
      isOrphan: node.isOrphan,
      ...visualLayoutMetadataForTopologyNode(node)
    }
  }));
  const edges: LoopGraphVisualEdge[] = topology.edges.map((edge) => ({
    id: edge.id,
    source: edge.source,
    target: edge.target,
    kind: edge.kind,
    label: edge.label,
    metadata: {
      semantic: edge.semantic,
      executable: edge.executable,
      style: edge.style
    }
  }));

  const triggerNodeIds = new Set<string>();
  if ("centerNodeId" in topology) {
    const centerNode = topology.nodes.find((node) => node.id === topology.centerNodeId);
    addTriggerVisualNode(centerNode, nodes, edges, triggerNodeIds);
  }

  if (options.includeWorkflowTriggers) {
    for (const node of topology.nodes) {
      addTriggerVisualNode(node, nodes, edges, triggerNodeIds);
    }
  }

  return {
    id: topology.id,
    title: topology.id.startsWith("ego:")
      ? "Selected Loop Logic"
      : "Semantic Company Topology",
    valueLabel: `${topology.filterCounts.total} semantic nodes`,
    selectedNodeId: "centerNodeId" in topology
      ? topology.centerNodeId
      : topology.selectedLoopId
        ? `loop:${topology.selectedLoopId}`
        : topology.managementLoopId,
    nodes,
    edges
  };
}

function addTriggerVisualNode(
  topologyNode: TopologyNode | undefined,
  nodes: LoopGraphVisualNode[],
  edges: LoopGraphVisualEdge[],
  triggerNodeIds: Set<string>
) {
  const triggerLabel = triggerLabelForVisualNode(topologyNode);
  if (
    !topologyNode ||
    !triggerLabel ||
    (topologyNode.type !== "workflow_loop" && topologyNode.type !== "task_loop")
  ) {
    return;
  }

  const triggerId = `trigger:${topologyNode.id}`;
  if (triggerNodeIds.has(triggerId)) {
    return;
  }
  triggerNodeIds.add(triggerId);

  nodes.push({
    id: triggerId,
    kind: "trigger",
    label: triggerLabel,
    subtitle: "Trigger event",
    sourceNodeId: topologyNode.id,
    department: topologyNode.department,
    weight: 3,
    metadata: {
      triggerFor: topologyNode.id,
      parentId: topologyNode.id,
      semanticLayer: "structure",
      semanticType: "trigger",
      loopId: topologyNode.loopId,
      sequenceGroup: "trigger",
      sequenceIndex: 0,
      clusterId: topologyNode.id
    }
  });
  edges.push({
    id: `${triggerId}->${topologyNode.id}`,
    source: triggerId,
    target: topologyNode.id,
    kind: "triggers",
    label: "triggers",
    metadata: {
      semantic: true,
      executable: true,
      style: "solid"
    }
  });
}

function triggerLabelForVisualNode(node?: { metadata?: Record<string, unknown> }) {
  const trigger = node?.metadata?.trigger;
  if (typeof trigger !== "string" || trigger.trim().length === 0) {
    return undefined;
  }
  return trigger.replace(/[:_]+/g, " ");
}

function visualLayoutMetadataForTopologyNode(node: TopologyNode) {
  const kind = visualKindForSemanticTopology(node.type);
  const layoutNode = {
    id: node.id,
    kind,
    label: node.label,
    metadata: {
      semanticLayer: node.layer,
      semanticType: node.type
    }
  };

  return {
    sequenceGroup: sequenceGroupForVisualNode(layoutNode),
    sequenceIndex: sequenceIndexForVisualNode(layoutNode),
    clusterId: node.loopId ? `loop:${node.loopId}` : node.parentId
  };
}

export function visualKindForTopology(kind: LoopGraphNodeKind): LoopGraphVisualNodeKind {
  if (kind === "management_loop") return "management";
  if (kind === "human_owner") return "owner";
  return kind;
}

export function visualKindForSemanticTopology(type: TopologyNodeType): LoopGraphVisualNodeKind {
  if (type === "company") return "organization";
  if (type === "management_loop") return "management";
  if (type === "department_loop") return "department";
  if (type === "workflow_loop" || type === "task_loop") return "loop";
  if (type === "signal_source" || type === "integration" || type === "context_source" || type === "memory") {
    return "data_source";
  }
  if (type === "tool_action") return "action";
  if (type === "verifier") return "verification";
  if (type === "human_owner") return "owner";
  if (type === "human_review" || type === "escalation_case") return "review";
  if (type === "metric") return "metric";
  return "improvement";
}

function topologyWeight(node: LoopGraphNode) {
  if (node.kind === "management_loop") return node.id === "loop:management" ? 6 : 5;
  if (node.kind === "organization") return 4;
  if (node.kind === "department") return 3;
  if (node.kind === "loop") return node.health && node.health < 75 ? 4 : 3;
  if (node.kind === "metric") return 2.2;
  return 2;
}

function createGraphBuilder(scope: string) {
  const nodes: LoopGraphVisualNode[] = [];
  const edges: LoopGraphVisualEdge[] = [];
  const nodeIds = new Set<string>();
  const edgeIds = new Set<string>();

  return {
    nodes,
    edges,
    nodeId(kind: string, label: string, index: number) {
      return `${scope}:${kind}:${slug(label)}:${index}`;
    },
    addNode(node: LoopGraphVisualNode) {
      const id = uniqueId(node.id, nodeIds);
      nodeIds.add(id);
      nodes.push({
        ...node,
        id
      });
      return id;
    },
    addEdge(source: string, target: string, kind: string, label?: string) {
      if (!nodeIds.has(source) || !nodeIds.has(target) || source === target) {
        return;
      }

      const id = uniqueId(`${scope}:edge:${kind}:${source}:${target}`, edgeIds);
      edgeIds.add(id);
      edges.push({
        id,
        source,
        target,
        kind,
        label
      });
    }
  };
}

function valuesFromConnections(
  template: LoopTemplate,
  kind: NonNullable<LoopTemplate["connections"]>[number]["kind"],
  fallbackValues?: string[],
  finalFallback: string[] = []
) {
  const connected = template.connections
    ?.filter((connection) => connection.kind === kind)
    .map((connection) => connection.target);
  return normalizedValues(connected, fallbackValues, finalFallback);
}

function normalizedValues(...groups: Array<Array<string | undefined> | undefined>) {
  const values = groups
    .flatMap((group) => group ?? [])
    .map((value) => value?.trim())
    .filter((value): value is string => Boolean(value));
  return Array.from(new Set(values));
}

function uniqueId(baseId: string, seen: Set<string>) {
  if (!seen.has(baseId)) {
    return baseId;
  }

  let index = 2;
  while (seen.has(`${baseId}-${index}`)) {
    index += 1;
  }
  return `${baseId}-${index}`;
}

function slug(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "") || "node";
}
