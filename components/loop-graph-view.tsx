"use client";

import "@xyflow/react/dist/style.css";

import {
  Background,
  Controls,
  Handle,
  Position,
  ReactFlow,
  type Edge,
  type Node,
  type NodeChange,
  type NodeProps,
  type ReactFlowInstance,
  type XYPosition
} from "@xyflow/react";
import { useEffect, useMemo, useState } from "react";
import type {
  LoopGraphVisual,
  LoopGraphVisualNode,
  LoopGraphVisualNodeKind
} from "@/lib/loop-engineering-builder/loop-graph-visualization";

type LoopGraphViewVariant = "topology" | "template" | "mini";
type LoopGraphAppearance = "light" | "onDark";
type ToggleKind = "data_source" | "owner" | "metric" | "review" | "improvement";

type LoopGraphViewProps = {
  graph: LoopGraphVisual;
  variant?: LoopGraphViewVariant;
  appearance?: LoopGraphAppearance;
  className?: string;
  height?: number | string;
  interactive?: boolean;
  showToggles?: boolean;
  selectedNodeId?: string;
  onSelectNode?: (nodeId: string) => void;
};

type LoopGraphDotNodeData = {
  label: string;
  subtitle?: string;
  kind: LoopGraphVisualNodeKind;
  color: string;
  dotSize: number;
  selected: boolean;
  dimmed: boolean;
  showLabel: boolean;
  variant: LoopGraphViewVariant;
  appearance: LoopGraphAppearance;
};

const nodeTypes = {
  loopGraphDot: LoopGraphDotNode
};

const toggleOptions: Array<{ kind: ToggleKind; label: string }> = [
  { kind: "data_source", label: "Data" },
  { kind: "owner", label: "Owners" },
  { kind: "metric", label: "Metrics" },
  { kind: "review", label: "Reviews" },
  { kind: "improvement", label: "Improve" }
];

const defaultVisibleKinds: Record<ToggleKind, boolean> = {
  data_source: true,
  owner: true,
  metric: true,
  review: true,
  improvement: true
};

export function LoopGraphView({
  graph,
  variant = "template",
  appearance = "light",
  className = "",
  height,
  interactive,
  showToggles,
  selectedNodeId,
  onSelectNode
}: LoopGraphViewProps) {
  const isMini = variant === "mini";
  const isInteractive = interactive ?? !isMini;
  const shouldShowToggles = showToggles ?? variant === "topology";
  const stableNodeTypes = useMemo(() => nodeTypes, []);
  const [isMounted, setIsMounted] = useState(false);
  const [visibleKinds, setVisibleKinds] = useState(defaultVisibleKinds);
  const [localSelectedNodeId, setLocalSelectedNodeId] = useState(
    selectedNodeId ?? graph.selectedNodeId ?? graph.nodes[0]?.id
  );
  const [positionOverrides, setPositionOverrides] = useState<Record<string, XYPosition>>({});
  const [flowInstance, setFlowInstance] =
    useState<ReactFlowInstance<Node<LoopGraphDotNodeData>, Edge> | null>(null);
  const [layoutAnchorNodeId, setLayoutAnchorNodeId] = useState(
    selectedNodeId ?? graph.selectedNodeId ?? graph.nodes[0]?.id
  );

  useEffect(() => {
    setIsMounted(true);
  }, []);

  useEffect(() => {
    setLocalSelectedNodeId(selectedNodeId ?? graph.selectedNodeId ?? graph.nodes[0]?.id);
  }, [graph.id, graph.selectedNodeId, graph.nodes, selectedNodeId]);

  const visibleNodes = useMemo(
    () =>
      graph.nodes.filter((node) => {
        if (!isToggleKind(node.kind)) {
          return true;
        }
        return visibleKinds[node.kind];
      }),
    [graph.nodes, visibleKinds]
  );
  const visibleNodeIds = useMemo(() => new Set(visibleNodes.map((node) => node.id)), [visibleNodes]);
  const visibleEdges = useMemo(
    () => graph.edges.filter((edge) => visibleNodeIds.has(edge.source) && visibleNodeIds.has(edge.target)),
    [graph.edges, visibleNodeIds]
  );
  const graphNodeKey = useMemo(
    () => `${graph.id}:${variant}:${graph.nodes.map((node) => node.id).join("|")}`,
    [graph.id, graph.nodes, variant]
  );
  const activeNodeId = visibleNodeIds.has(localSelectedNodeId ?? "")
    ? localSelectedNodeId
    : visibleNodeIds.has(graph.selectedNodeId ?? "")
      ? graph.selectedNodeId
      : visibleNodes[0]?.id;
  const layoutPrimaryNodeId = variant === "topology" ? layoutAnchorNodeId : activeNodeId;
  const connectedNodeIds = useMemo(
    () => directConnections(activeNodeId, visibleEdges),
    [activeNodeId, visibleEdges]
  );
  const layout = useMemo(
    () => layoutNodes(visibleNodes, visibleEdges, layoutPrimaryNodeId, variant),
    [layoutPrimaryNodeId, variant, visibleEdges, visibleNodes]
  );
  const layoutTopY = useMemo(() => {
    const yPositions = visibleNodes
      .map((node) => layout[node.id]?.y)
      .filter((position): position is number => typeof position === "number");
    return yPositions.length > 0 ? Math.min(...yPositions) : 0;
  }, [layout, visibleNodes]);
  useEffect(() => {
    setPositionOverrides({});
  }, [graphNodeKey]);

  useEffect(() => {
    setLayoutAnchorNodeId((current) => {
      if (current && visibleNodeIds.has(current)) {
        return current;
      }
      if (graph.selectedNodeId && visibleNodeIds.has(graph.selectedNodeId)) {
        return graph.selectedNodeId;
      }
      return visibleNodes[0]?.id;
    });
  }, [graph.selectedNodeId, graphNodeKey, visibleNodeIds, visibleNodes]);

  const flowNodes = useMemo<Node<LoopGraphDotNodeData>[]>(
    () =>
      visibleNodes.map((node) => {
        const isSelected = node.id === activeNodeId;
        const isConnected = !activeNodeId || connectedNodeIds.has(node.id);
        const position = positionOverrides[node.id] ?? layout[node.id] ?? { x: 0, y: 0 };
        return {
          id: node.id,
          type: "loopGraphDot",
          position,
          selectable: isInteractive,
          draggable: isInteractive,
          zIndex: isSelected ? 20 : isConnected ? 12 : 1,
          data: {
            label: node.label,
            subtitle: node.subtitle,
            kind: node.kind,
            color: nodeColor(node.kind, node.department),
            dotSize: dotSize(node, variant, isSelected),
            selected: isSelected,
            dimmed: Boolean(activeNodeId) && !isConnected,
            showLabel: shouldShowNodeLabel(node, variant, isSelected, isConnected),
            variant,
            appearance
          }
        };
      }),
    [
      activeNodeId,
      appearance,
      connectedNodeIds,
      isInteractive,
      layout,
      positionOverrides,
      variant,
      visibleNodes
    ]
  );

  const flowEdges = useMemo<Edge[]>(
    () =>
      visibleEdges.map((edge) => {
        const isConnected =
          !activeNodeId || edge.source === activeNodeId || edge.target === activeNodeId;
        return {
          id: edge.id,
          source: edge.source,
          target: edge.target,
          type: "straight",
          selectable: false,
          interactionWidth: 12,
          style: {
            stroke: edgeStroke(edge, appearance),
            strokeOpacity: activeNodeId ? (isConnected ? 0.72 : 0.12) : isMini ? 0.42 : 0.5,
            strokeWidth: edge.metadata?.executable ? (isConnected ? 1.7 : 1.1) : isConnected ? 1.25 : 0.9,
            strokeDasharray: edgeDashArray(edge)
          }
        };
      }),
    [activeNodeId, appearance, isMini, visibleEdges]
  );

  useEffect(() => {
    if (!flowInstance || !isMounted || variant !== "topology" || graph.nodes.length === 0) {
      return;
    }

    const frame = window.requestAnimationFrame(() => {
      Promise.resolve(flowInstance.fitView({ duration: 0, maxZoom: 0.92, padding: 0.12 })).then(() => {
        const viewport = flowInstance.getViewport();
        flowInstance.setViewport(
          {
            ...viewport,
            y: 42 - layoutTopY * viewport.zoom
          },
          { duration: 0 }
        );
      });
    });

    return () => window.cancelAnimationFrame(frame);
  }, [flowInstance, graph.nodes.length, graphNodeKey, isMounted, layoutTopY, variant]);

  function handleNodesChange(changes: NodeChange<Node<LoopGraphDotNodeData>>[]) {
    if (!isInteractive) {
      return;
    }

    const nextPositions: Record<string, XYPosition> = {};
    for (const change of changes) {
      if (change.type === "position" && change.position) {
        nextPositions[change.id] = change.position;
      }
    }

    if (Object.keys(nextPositions).length > 0) {
      setPositionOverrides((current) => ({
        ...current,
        ...nextPositions
      }));
    }
  }

  function handleSelect(nodeId: string) {
    if (!isInteractive) {
      return;
    }

    setLocalSelectedNodeId(nodeId);
    onSelectNode?.(nodeId);
  }

  const defaultHeight =
    height ?? (variant === "topology" ? "100%" : variant === "mini" ? 98 : 280);

  return (
    <div
      className={`relative overflow-hidden ${
        appearance === "onDark" ? "bg-transparent" : "bg-white"
      } ${className}`}
      data-testid={`loop-graph-${variant}`}
      style={{ height: defaultHeight }}
    >
      {!isMounted ? (
        <StaticGraphPreview
          activeNodeId={activeNodeId}
          appearance={appearance}
          edges={visibleEdges}
          layout={layout}
          nodes={visibleNodes}
          variant={variant}
        />
      ) : null}

      {isMounted && shouldShowToggles ? (
        <div className="absolute left-3 top-3 z-10 flex max-w-[calc(100%-1.5rem)] flex-wrap gap-1.5">
          {toggleOptions.map((option) => {
            const pressed = visibleKinds[option.kind];
            return (
              <button
                aria-pressed={pressed}
                className={`rounded-md border px-2 py-1 text-[11px] font-semibold ${
                  pressed
                    ? "border-ink bg-ink text-white"
                    : "border-line bg-white/90 text-ink/60 hover:border-ink hover:text-ink"
                }`}
                key={option.kind}
                onClick={() =>
                  setVisibleKinds((current) => ({
                    ...current,
                    [option.kind]: !current[option.kind]
                  }))
                }
                type="button"
              >
                {option.label}
              </button>
            );
          })}
        </div>
      ) : null}

      {isMounted ? (
        <ReactFlow
          edges={flowEdges}
          elementsSelectable={isInteractive}
          fitView={variant !== "topology"}
          fitViewOptions={{
            padding: variant === "topology" ? 0.22 : isMini ? 0.12 : 0.18,
            maxZoom: variant === "topology" ? 0.92 : isMini ? 1.25 : 1.08
          }}
          maxZoom={isMini ? 1.6 : 2.1}
          minZoom={isMini ? 0.25 : 0.18}
          nodes={flowNodes}
          nodesConnectable={false}
          nodesDraggable={isInteractive}
          nodeTypes={stableNodeTypes}
          onInit={setFlowInstance}
          onNodeClick={(_, node) => handleSelect(node.id)}
          onNodesChange={handleNodesChange}
          panOnDrag={isInteractive}
          panOnScroll={isInteractive}
          preventScrolling={isInteractive}
          proOptions={{ hideAttribution: true }}
          zoomOnDoubleClick={isInteractive}
          zoomOnPinch={isInteractive}
          zoomOnScroll={isInteractive}
        >
          <Background
            color={appearance === "onDark" ? "rgba(255,255,255,0.12)" : "#e7e3da"}
            gap={variant === "mini" ? 16 : 22}
            size={1}
          />
          {isInteractive && !isMini ? <Controls position="bottom-right" /> : null}
        </ReactFlow>
      ) : null}
    </div>
  );
}

function StaticGraphPreview({
  activeNodeId,
  appearance,
  edges,
  layout,
  nodes,
  variant
}: {
  activeNodeId?: string;
  appearance: LoopGraphAppearance;
  edges: Array<{ id: string; source: string; target: string }>;
  layout: Record<string, XYPosition>;
  nodes: LoopGraphVisualNode[];
  variant: LoopGraphViewVariant;
}) {
  const bounds = graphBounds(nodes, layout, variant);
  const activeConnections = directConnections(activeNodeId, edges);
  const lineColor = appearance === "onDark" ? "rgba(255,255,255,0.42)" : "#c9c5bc";

  return (
    <svg
      aria-hidden="true"
      className="absolute inset-0 h-full w-full"
      preserveAspectRatio="xMidYMid meet"
      viewBox={`${bounds.minX} ${bounds.minY} ${bounds.width} ${bounds.height}`}
    >
      <rect
        fill={appearance === "onDark" ? "transparent" : "#ffffff"}
        height={bounds.height}
        width={bounds.width}
        x={bounds.minX}
        y={bounds.minY}
      />
      {edges.map((edge) => {
        const source = layout[edge.source];
        const target = layout[edge.target];
        if (!source || !target) {
          return null;
        }
        const isConnected = !activeNodeId || edge.source === activeNodeId || edge.target === activeNodeId;
        return (
          <line
            key={edge.id}
            stroke={lineColor}
            strokeOpacity={activeNodeId ? (isConnected ? 0.72 : 0.12) : 0.5}
            strokeWidth={variant === "mini" ? 1.6 : 1.1}
            x1={source.x}
            x2={target.x}
            y1={source.y}
            y2={target.y}
          />
        );
      })}
      {nodes.map((node) => {
        const position = layout[node.id];
        if (!position) {
          return null;
        }
        const selected = node.id === activeNodeId;
        const connected = !activeNodeId || activeConnections.has(node.id);
        const size = dotSize(node, variant, selected);
        return (
          <g key={node.id} opacity={activeNodeId && !connected ? 0.25 : 1}>
            <circle
              cx={position.x}
              cy={position.y}
              fill={nodeColor(node.kind, node.department)}
              r={size / 2}
            />
            {shouldShowNodeLabel(node, variant, selected, connected) ? (
              <text
                fill={appearance === "onDark" ? "rgba(255,255,255,0.72)" : "#6f6a60"}
                fontSize={variant === "topology" ? 11 : 10}
                fontWeight={selected ? 700 : 500}
                x={position.x + size / 2 + 5}
                y={position.y + 3}
              >
                {truncateLabel(node.label, variant === "topology" ? 28 : 22)}
              </text>
            ) : null}
          </g>
        );
      })}
    </svg>
  );
}

function LoopGraphDotNode({ data }: NodeProps<Node<LoopGraphDotNodeData>>) {
  const labelColor = data.appearance === "onDark" ? "rgba(255,255,255,0.86)" : "#28251f";
  const mutedLabelColor = data.appearance === "onDark" ? "rgba(255,255,255,0.45)" : "#6f6a60";

  return (
    <div
      className={`group flex cursor-grab items-center gap-1.5 active:cursor-grabbing ${
        data.dimmed ? "opacity-25" : "opacity-100"
      }`}
      title={data.subtitle ? `${data.label} - ${data.subtitle}` : data.label}
    >
      <Handle
        className="!h-0 !w-0 !border-0 !bg-transparent opacity-0"
        position={Position.Top}
        type="target"
      />
      <span
        className="block shrink-0 rounded-full transition-transform"
        style={{
          width: data.dotSize,
          height: data.dotSize,
          background: data.color,
          boxShadow: data.selected
            ? `0 0 0 5px ${data.appearance === "onDark" ? "rgba(255,255,255,0.18)" : "rgba(17,17,17,0.12)"}, 0 0 22px rgba(249,115,22,0.32)`
            : "0 1px 5px rgba(17,17,17,0.18)"
        }}
      />
      {data.showLabel ? (
        <span
          className={`pointer-events-none block max-w-[180px] whitespace-normal break-words text-[11px] font-medium leading-[1.15] ${
            data.selected ? "font-semibold" : ""
          }`}
          style={{
            color: data.selected ? labelColor : mutedLabelColor,
            textShadow:
              data.appearance === "onDark"
                ? "0 1px 6px rgba(0,0,0,0.5)"
                : "0 1px 6px rgba(255,255,255,0.95)"
          }}
        >
          {data.label}
        </span>
      ) : null}
      <Handle
        className="!h-0 !w-0 !border-0 !bg-transparent opacity-0"
        position={Position.Bottom}
        type="source"
      />
    </div>
  );
}

function layoutNodes(
  nodes: LoopGraphVisualNode[],
  edges: Array<{ source: string; target: string }>,
  selectedNodeId: string | undefined,
  variant: LoopGraphViewVariant
): Record<string, XYPosition> {
  if (nodes.some((node) => node.metadata?.layout === "ego-center")) {
    return layoutEgoNodes(nodes, selectedNodeId, variant);
  }

  const primaryNode =
    nodes.find((node) => node.id === selectedNodeId) ??
    nodes.find((node) => node.kind === "loop" || node.kind === "management") ??
    nodes[0];
  const primaryNodeId = primaryNode?.id;
  const connected = directConnections(primaryNodeId, edges);
  const config = layoutConfig(variant);
  const layout: Record<string, XYPosition> = {};
  const groupedIndexes = new Map<LoopGraphVisualNodeKind, number>();
  const coreNodes = nodes
    .filter((node) => isCoreKind(node.kind) && node.id !== primaryNodeId)
    .sort((left, right) => `${left.department ?? ""}:${left.label}`.localeCompare(`${right.department ?? ""}:${right.label}`));

  if (primaryNodeId) {
    layout[primaryNodeId] = { x: 0, y: 0 };
  }

  coreNodes.forEach((node, index) => {
    const ring = Math.floor(index / Math.max(config.corePerRing, 1));
    const itemsInRing = Math.min(config.corePerRing, coreNodes.length - ring * config.corePerRing);
    const ringIndex = index - ring * config.corePerRing;
    const angle =
      -Math.PI / 2 +
      (Math.PI * 2 * ringIndex) / Math.max(itemsInRing, 1) +
      deterministicFloat(node.id) * 0.28;
    const radius = config.coreRadius + ring * config.ringGap;
    layout[node.id] = {
      x: roundCoord(Math.cos(angle) * radius),
      y: roundCoord(Math.sin(angle) * radius * 0.82)
    };
  });

  nodes.forEach((node) => {
    if (layout[node.id]) {
      return;
    }

    const index = groupedIndexes.get(node.kind) ?? 0;
    groupedIndexes.set(node.kind, index + 1);
    const anchor = scaledAnchor(node.kind, config.scale);
    const angle = index * 2.399963229728653 + deterministicFloat(node.id) * Math.PI;
    const localRadius =
      (Math.sqrt(index + 1) * config.clusterSpread + deterministicFloat(`${node.id}:radius`) * config.jitter) *
      (connected.has(node.id) ? 1 : 1.26);

    layout[node.id] = {
      x: roundCoord(anchor.x + Math.cos(angle) * localRadius),
      y: roundCoord(anchor.y + Math.sin(angle) * localRadius * 0.78)
    };
  });

  return layout;
}

function layoutEgoNodes(
  nodes: LoopGraphVisualNode[],
  selectedNodeId: string | undefined,
  variant: LoopGraphViewVariant
): Record<string, XYPosition> {
  const config = layoutConfig(variant);
  const layout: Record<string, XYPosition> = {};
  const centerNode =
    nodes.find((node) => node.id === selectedNodeId) ??
    nodes.find((node) => node.metadata?.ring === "center") ??
    nodes[0];
  const centerNodeId = centerNode?.id;

  if (centerNodeId) {
    layout[centerNodeId] = { x: 0, y: 0 };
  }

  const ringGroups = new Map<string, LoopGraphVisualNode[]>();
  for (const node of nodes) {
    if (node.id === centerNodeId) {
      continue;
    }
    const ring = String(node.metadata?.ring ?? "inner");
    const key = `${ring}:${node.kind}`;
    ringGroups.set(key, [...(ringGroups.get(key) ?? []), node]);
  }

  for (const [key, group] of ringGroups) {
    const [ring, kind] = key.split(":") as [string, LoopGraphVisualNodeKind];
    const radius = ring === "outer" ? config.coreRadius + config.ringGap : config.coreRadius * 0.72;
    const baseAngle = egoAngle(kind);
    const spread = Math.min(Math.PI / 3, 0.34 + group.length * 0.08);

    group
      .sort((left, right) => left.label.localeCompare(right.label))
      .forEach((node, index) => {
        const centeredIndex = index - (group.length - 1) / 2;
        const angle = baseAngle + centeredIndex * (spread / Math.max(group.length, 1));
        const jitter = (deterministicFloat(node.id) - 0.5) * 18;
        layout[node.id] = {
          x: roundCoord(Math.cos(angle) * (radius + jitter)),
          y: roundCoord(Math.sin(angle) * (radius + jitter) * 0.78)
        };
      });
  }

  return layout;
}

function directConnections(
  nodeId: string | undefined,
  edges: Array<{ source: string; target: string }>
) {
  const connected = new Set<string>();
  if (!nodeId) {
    return connected;
  }

  connected.add(nodeId);
  for (const edge of edges) {
    if (edge.source === nodeId) {
      connected.add(edge.target);
    }
    if (edge.target === nodeId) {
      connected.add(edge.source);
    }
  }
  return connected;
}

function layoutConfig(variant: LoopGraphViewVariant) {
  if (variant === "mini") {
    return {
      scale: 0.34,
      coreRadius: 62,
      corePerRing: 10,
      ringGap: 34,
      clusterSpread: 13,
      jitter: 8
    };
  }
  if (variant === "topology") {
    return {
      scale: 1,
      coreRadius: 310,
      corePerRing: 16,
      ringGap: 130,
      clusterSpread: 54,
      jitter: 30
    };
  }
  return {
    scale: 0.68,
    coreRadius: 170,
    corePerRing: 12,
    ringGap: 70,
    clusterSpread: 32,
    jitter: 18
  };
}

function scaledAnchor(kind: LoopGraphVisualNodeKind, scale: number): XYPosition {
  const anchors: Record<LoopGraphVisualNodeKind, XYPosition> = {
    organization: { x: -60, y: -310 },
    management: { x: 70, y: 265 },
    department: { x: -205, y: -205 },
    loop: { x: 0, y: 0 },
    data_source: { x: -310, y: -65 },
    action: { x: 150, y: -210 },
    verification: { x: 310, y: -65 },
    owner: { x: 235, y: 130 },
    metric: { x: -55, y: 245 },
    review: { x: 345, y: 120 },
    improvement: { x: -285, y: 145 },
    rollup: { x: 80, y: 315 }
  };
  return {
    x: anchors[kind].x * scale,
    y: anchors[kind].y * scale
  };
}

function isCoreKind(kind: LoopGraphVisualNodeKind) {
  return ["organization", "management", "department", "loop", "rollup"].includes(kind);
}

function shouldShowNodeLabel(
  node: LoopGraphVisualNode,
  variant: LoopGraphViewVariant,
  selected: boolean,
  connected: boolean
) {
  if (variant === "mini") {
    return false;
  }
  if (selected || connected) {
    return true;
  }
  if (variant === "topology") {
    return ["organization", "management", "department", "loop", "rollup"].includes(node.kind);
  }
  return (node.weight ?? 1) >= 2;
}

function dotSize(node: LoopGraphVisualNode, variant: LoopGraphViewVariant, selected: boolean) {
  const baseByKind: Record<LoopGraphVisualNodeKind, number> = {
    organization: 18,
    management: 24,
    department: 14,
    loop: 16,
    data_source: 9,
    action: 10,
    verification: 10,
    owner: 10,
    metric: 10,
    review: 11,
    improvement: 11,
    rollup: 14
  };
  const variantScale = variant === "mini" ? 0.72 : variant === "template" ? 0.92 : 1;
  const weighted = baseByKind[node.kind] + Math.max((node.weight ?? 1) - 2, 0) * 2.4;
  return Math.round((weighted + (selected ? 5 : 0)) * variantScale);
}

function edgeStroke(
  edge: { kind?: string; metadata?: Record<string, unknown> },
  appearance: LoopGraphAppearance
) {
  if (edge.metadata?.semantic === false) {
    return appearance === "onDark" ? "rgba(255,255,255,0.25)" : "#b8b0a4";
  }
  if (edge.kind === "requires_approval" || edge.kind === "escalates_to") {
    return "#0f766e";
  }
  if (edge.kind === "writes_trace_to" || edge.kind === "learns_from") {
    return "#7c3aed";
  }
  if (edge.kind === "contains") {
    return appearance === "onDark" ? "rgba(255,255,255,0.5)" : "#8b867d";
  }
  return appearance === "onDark" ? "rgba(255,255,255,0.42)" : "#c9c5bc";
}

function edgeDashArray(edge: { metadata?: Record<string, unknown> }) {
  if (edge.metadata?.style === "dashed") {
    return "6 5";
  }
  if (edge.metadata?.style === "dotted") {
    return "2 6";
  }
  return undefined;
}

function egoAngle(kind: LoopGraphVisualNodeKind) {
  const angles: Record<LoopGraphVisualNodeKind, number> = {
    organization: -Math.PI / 2,
    management: Math.PI / 2,
    department: -Math.PI * 0.72,
    loop: 0,
    data_source: Math.PI,
    action: -Math.PI / 4,
    verification: 0,
    owner: Math.PI / 3,
    metric: Math.PI * 0.72,
    review: Math.PI / 5,
    improvement: Math.PI * 0.86,
    rollup: Math.PI / 2
  };
  return angles[kind];
}

function graphBounds(
  nodes: LoopGraphVisualNode[],
  layout: Record<string, XYPosition>,
  variant: LoopGraphViewVariant
) {
  const positions = nodes.map((node) => layout[node.id]).filter(Boolean);
  if (positions.length === 0) {
    return { minX: -180, minY: -120, width: 360, height: 240 };
  }

  const padding = variant === "mini" ? 28 : 80;
  const xs = positions.map((position) => position.x);
  const ys = positions.map((position) => position.y);
  const minX = Math.min(...xs) - padding;
  const maxX = Math.max(...xs) + padding;
  const minY = Math.min(...ys) - padding;
  const maxY = Math.max(...ys) + padding;

  return {
    minX: roundCoord(minX),
    minY: roundCoord(minY),
    width: roundCoord(Math.max(maxX - minX, 1)),
    height: roundCoord(Math.max(maxY - minY, 1))
  };
}

function truncateLabel(label: string, maxLength: number) {
  if (label.length <= maxLength) {
    return label;
  }
  return `${label.slice(0, maxLength - 3)}...`;
}

function roundCoord(value: number) {
  return Math.round(value * 1000) / 1000;
}

function nodeColor(kind: LoopGraphVisualNodeKind, department?: string) {
  if (kind === "management") return "#111111";
  if (kind === "organization") return "#45413a";
  if (kind === "department") return "#6f6a60";
  if (kind === "data_source") return "#8b867d";
  if (kind === "action") return "#f97316";
  if (kind === "verification") return "#2563eb";
  if (kind === "owner") return "#d97706";
  if (kind === "metric") return "#16a34a";
  if (kind === "review") return "#0f766e";
  if (kind === "improvement") return "#7c3aed";
  if (kind === "rollup") return "#111111";
  if (department === "marketing") return "#f97316";
  if (department === "sales") return "#16a34a";
  if (department === "product") return "#2563eb";
  if (department === "customer_success") return "#0f766e";
  if (department === "engineering") return "#0284c7";
  if (department === "operations_finance") return "#dc2626";
  if (department === "hr") return "#d97706";
  if (department === "legal_security") return "#7c3aed";
  return "#111111";
}

function isToggleKind(kind: LoopGraphVisualNodeKind): kind is ToggleKind {
  return ["data_source", "owner", "metric", "review", "improvement"].includes(kind);
}

function deterministicFloat(value: string) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return ((hash >>> 0) % 10000) / 10000;
}
