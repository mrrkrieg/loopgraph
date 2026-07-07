"use client";

import "@xyflow/react/dist/style.css";

import {
  applyNodeChanges,
  Background,
  Controls,
  Handle,
  MarkerType,
  Position,
  ReactFlow,
  type Edge,
  type Node,
  type NodeChange,
  type NodeProps,
  type ReactFlowInstance,
  type XYPosition
} from "@xyflow/react";
import { useEffect, useMemo, useRef, useState } from "react";
import type {
  LoopGraphVisual,
  LoopGraphVisualEdge,
  LoopGraphVisualNode,
  LoopGraphVisualNodeKind
} from "@/lib/loop-engineering-builder/loop-graph-visualization";
import {
  compactArcLayout,
  descendantIdsByParentId,
  orbitOuterRadius,
  packClusterRows,
  packedOrbitLayout,
  sortByLoopSequence
} from "@/lib/loop-engineering-builder/loop-graph-layout";

type LoopGraphViewVariant = "topology" | "template" | "mini";
type LoopGraphAppearance = "light" | "onDark";
type ToggleKind = "data_source" | "owner" | "metric" | "review" | "improvement";
type HandleSide = "top" | "right" | "bottom" | "left";
type LoopNodeRole = "standard" | "core" | "satellite" | "trigger";

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
  visualSize: number;
  selected: boolean;
  dimmed: boolean;
  childLoopCount: number;
  isLoopVisual: boolean;
  role: LoopNodeRole;
  labelSide: "left" | "right";
  showLabel: boolean;
  variant: LoopGraphViewVariant;
  appearance: LoopGraphAppearance;
};

const nodeTypes = {
  loopGraphDot: LoopGraphDotNode
};

const centerNodeOrigin: [number, number] = [0.5, 0.5];
const handleSides: HandleSide[] = ["top", "right", "bottom", "left"];
const loopCoreLayoutSize = 168;
const loopSatelliteGap = 32;
const reactFlowProOptions = { hideAttribution: true };

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
  const cameraKeyRef = useRef<string | undefined>(undefined);
  const isDraggingRef = useRef(false);

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
  const visibleNodeById = useMemo(
    () => new Map(visibleNodes.map((node) => [node.id, node])),
    [visibleNodes]
  );
  const visibleEdges = useMemo(
    () => graph.edges.filter((edge) => visibleNodeIds.has(edge.source) && visibleNodeIds.has(edge.target)),
    [graph.edges, visibleNodeIds]
  );
  const childLoopCounts = useMemo(
    () => directChildLoopCounts(visibleNodes, visibleEdges),
    [visibleEdges, visibleNodes]
  );
  const isBrainMapView = variant === "topology" && graph.layoutMode === "brain-map";
  const egoCenterNode = useMemo(
    () => visibleNodes.find((node) => node.metadata?.layout === "ego-center"),
    [visibleNodes]
  );
  const isLoopLogicView = variant === "topology" && Boolean(egoCenterNode && isWorkflowSemanticNode(egoCenterNode));
  const graphNodeKey = useMemo(
    () => `${graph.id}:${variant}:${graph.nodes.map((node) => node.id).join("|")}`,
    [graph.id, graph.nodes, variant]
  );
  const cameraKey = `${graphNodeKey}:${graph.layoutMode ?? "default"}`;
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
    () => layoutNodes(visibleNodes, visibleEdges, layoutPrimaryNodeId, variant, graph.layoutMode),
    [graph.layoutMode, layoutPrimaryNodeId, variant, visibleEdges, visibleNodes]
  );
  const sequenceEdges = useMemo(
    () => buildLoopSequenceEdges(visibleNodes, layout, variant),
    [layout, variant, visibleNodes]
  );
  const brainFlowEdges = useMemo(
    () => buildBrainFlowEdges(visibleNodes, visibleEdges, variant, graph.layoutMode),
    [graph.layoutMode, variant, visibleEdges, visibleNodes]
  );
  const renderedEdges = useMemo(
    () => [...visibleEdges, ...brainFlowEdges, ...sequenceEdges],
    [brainFlowEdges, sequenceEdges, visibleEdges]
  );
  const flowRenderableEdges = useMemo(
    () =>
      renderedEdges.filter((edge) =>
        !shouldHideBrainMapStructuralEdge(edge, visibleNodeById, isBrainMapView) &&
        !shouldHideLoopOrbitSpokeEdge(edge, visibleNodeById, isLoopLogicView || isBrainMapView, sequenceEdges)
      ),
    [isBrainMapView, isLoopLogicView, renderedEdges, sequenceEdges, visibleNodeById]
  );
  const descendantIdsByNodeId = useMemo(
    () => descendantIdsByParentId(visibleNodes),
    [visibleNodes]
  );
  const layoutTopY = useMemo(() => {
    const yPositions = visibleNodes
      .map((node) => layout[node.id]?.y)
      .filter((position): position is number => typeof position === "number");
    return yPositions.length > 0 ? Math.min(...yPositions) : 0;
  }, [layout, visibleNodes]);
  useEffect(() => {
    if (isDraggingRef.current) {
      return;
    }
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

  const baseFlowNodes = useMemo<Node<LoopGraphDotNodeData>[]>(
    () =>
      visibleNodes.map((node) => {
        const isSelected = node.id === activeNodeId;
        const isConnected = variant === "topology" || !activeNodeId || connectedNodeIds.has(node.id);
        const position = positionOverrides[node.id] ?? layout[node.id] ?? { x: 0, y: 0 };
        const nodeRole = nodeRoleForLoopLogic(node, egoCenterNode, isLoopLogicView, isBrainMapView, variant);
        const nodeDotSize = dotSize(node, variant, isSelected);
        const nodeIsLoopVisual = variant === "topology" && isLoopVisualKind(node.kind);
        const nodeVisualSize = visualNodeSize(node.kind, variant, nodeDotSize, isSelected, nodeRole);
        return {
          id: node.id,
          type: "loopGraphDot",
          position,
          initialHeight: nodeVisualSize,
          initialWidth: nodeVisualSize,
          selectable: isInteractive,
          draggable: isInteractive,
          style: {
            height: nodeVisualSize,
            width: nodeVisualSize
          },
          zIndex: isSelected ? 20 : isConnected ? 12 : 1,
          data: {
            label: node.label,
            subtitle: node.subtitle,
            kind: node.kind,
            color: nodeColor(node.kind, node.department),
            dotSize: nodeDotSize,
            visualSize: nodeVisualSize,
            selected: isSelected,
            dimmed: Boolean(activeNodeId) && !isConnected,
            childLoopCount: childLoopCounts.get(node.id) ?? 0,
            isLoopVisual: nodeIsLoopVisual,
            role: nodeRole,
            labelSide: variant === "topology" && position.x > 180 ? "left" : "right",
            showLabel: nodeRole === "standard" && shouldShowNodeLabel(node, variant, isSelected, isConnected),
            variant,
            appearance
          }
        };
      }),
    [
      activeNodeId,
      appearance,
      childLoopCounts,
      connectedNodeIds,
      egoCenterNode,
      isInteractive,
      isBrainMapView,
      isLoopLogicView,
      layout,
      positionOverrides,
      variant,
      visibleNodes
    ]
  );
  const [flowNodes, setFlowNodes] = useState<Node<LoopGraphDotNodeData>[]>(baseFlowNodes);
  const flowNodesRef = useRef<Node<LoopGraphDotNodeData>[]>(baseFlowNodes);
  const flowNodeGraphKeyRef = useRef<string | undefined>(undefined);
  const flowPositionById = useMemo(
    () => positionMapFromFlowNodes(flowNodes.length > 0 ? flowNodes : baseFlowNodes),
    [baseFlowNodes, flowNodes]
  );

  const flowEdges = useMemo<Edge[]>(
    () =>
      flowRenderableEdges.map((edge) => {
        const isConnected =
          variant === "topology" || !activeNodeId || edge.source === activeNodeId || edge.target === activeNodeId;
        const sourcePosition = flowPositionById.get(edge.source) ?? positionOverrides[edge.source] ?? layout[edge.source];
        const targetPosition = flowPositionById.get(edge.target) ?? positionOverrides[edge.target] ?? layout[edge.target];
        const sourceSide = sourcePosition && targetPosition
          ? sideToward(sourcePosition, targetPosition)
          : "right";
        const targetSide = sourcePosition && targetPosition
          ? sideToward(targetPosition, sourcePosition)
          : "left";
        return {
          id: edge.id,
          source: edge.source,
          sourceHandle: `${sourceSide}-source`,
          target: edge.target,
          targetHandle: `${targetSide}-target`,
          type: edgeType(edge),
          selectable: false,
          interactionWidth: 12,
          markerEnd: edgeMarker(edge, appearance),
          style: {
            stroke: edgeStroke(edge, appearance),
            strokeOpacity: variant === "topology"
              ? (edge.metadata?.loopSequence || edge.metadata?.brainFlow ? 0.9 : 0.8)
              : activeNodeId
                ? (isConnected ? 0.72 : 0)
                : isMini
                  ? 0.42
                  : 0.5,
            strokeWidth: variant === "topology"
              ? topologyEdgeWidth(edge)
              : edge.metadata?.executable
                ? (isConnected ? 1.7 : 1.1)
                : isConnected
                  ? 1.25
                  : 0.9,
            strokeDasharray: edgeDashArray(edge)
          }
        };
      }),
    [activeNodeId, appearance, flowPositionById, flowRenderableEdges, isMini, layout, positionOverrides, variant]
  );
  const fitViewOptions = useMemo(
    () => ({
      padding: variant === "topology" ? 0.22 : isMini ? 0.12 : 0.18,
      maxZoom: variant === "topology" ? 0.92 : isMini ? 1.25 : 1.08
    }),
    [isMini, variant]
  );
  useEffect(() => {
    setFlowNodes((current) => {
      const shouldReset = flowNodeGraphKeyRef.current !== graphNodeKey;
      flowNodeGraphKeyRef.current = graphNodeKey;
      const next = shouldReset ? baseFlowNodes : mergeFlowNodes(current, baseFlowNodes);
      flowNodesRef.current = next;
      return next;
    });
  }, [baseFlowNodes, graphNodeKey]);

  useEffect(() => {
    flowNodesRef.current = flowNodes;
  }, [flowNodes]);

  useEffect(() => {
    if (!flowInstance || !isMounted || variant !== "topology" || graph.nodes.length === 0) {
      return;
    }
    if (cameraKeyRef.current === cameraKey) {
      return;
    }
    cameraKeyRef.current = cameraKey;

    const frame = window.requestAnimationFrame(() => {
      if (isBrainMapView) {
        const cameraNodeId = preferredBrainCameraNodeId(
          graph.selectedNodeId ?? activeNodeId,
          visibleNodeById
        );
        const cameraCenter = brainCameraCenter(
          cameraNodeId,
          visibleNodes,
          visibleNodeById,
          layout
        ) ?? layout[activeNodeId ?? ""];
        if (cameraCenter) {
          flowInstance.setCenter(cameraCenter.x, cameraCenter.y, {
            duration: 0,
            zoom: window.innerWidth < 700 ? 0.2 : 0.28
          });
        }
        return;
      }
      if (isLoopLogicView) {
        flowInstance.fitView({ duration: 0, maxZoom: 0.86, padding: 0.28 });
        return;
      }
      Promise.resolve(flowInstance.fitView({ duration: 0, maxZoom: 0.92, padding: 0.2 })).then(() => {
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
  }, [
    activeNodeId,
    cameraKey,
    flowInstance,
    graph.nodes.length,
    graph.selectedNodeId,
    isBrainMapView,
    isLoopLogicView,
    isMounted,
    layout,
    layoutTopY,
    variant,
    visibleNodes,
    visibleNodeById
  ]);

  function handleNodesChange(changes: NodeChange<Node<LoopGraphDotNodeData>>[]) {
    if (!isInteractive) {
      return;
    }

    setFlowNodes((current) => {
      const next = applyClusterNodeChanges(changes, current, descendantIdsByNodeId);
      flowNodesRef.current = next;
      return next;
    });
  }

  function handleNodeDragStart() {
    isDraggingRef.current = true;
  }

  function handleNodeDragStop() {
    isDraggingRef.current = false;
    setPositionOverrides(positionOverridesFromFlowNodes(flowNodesRef.current, layout));
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
          fitViewOptions={fitViewOptions}
          maxZoom={isMini ? 1.6 : 2.1}
          minZoom={isMini ? 0.25 : 0.18}
          nodeClickDistance={4}
          nodeDragThreshold={4}
          nodes={flowNodes}
          nodesConnectable={false}
          nodesDraggable={isInteractive}
          nodeOrigin={centerNodeOrigin}
          nodeTypes={nodeTypes}
          onInit={setFlowInstance}
          onNodeDragStart={handleNodeDragStart}
          onNodeDragStop={handleNodeDragStop}
          onNodeClick={(_, node) => handleSelect(node.id)}
          onNodesChange={handleNodesChange}
          panOnDrag={isInteractive}
          panOnScroll={isInteractive}
          preventScrolling={isInteractive}
          proOptions={reactFlowProOptions}
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

function mergeFlowNodes(
  currentNodes: Node<LoopGraphDotNodeData>[],
  nextNodes: Node<LoopGraphDotNodeData>[]
) {
  if (currentNodes.length !== nextNodes.length) {
    return nextNodes;
  }

  const currentById = new Map(currentNodes.map((node) => [node.id, node]));
  if (nextNodes.some((node) => !currentById.has(node.id))) {
    return nextNodes;
  }

  return nextNodes.map((nextNode) => {
    const currentNode = currentById.get(nextNode.id);
    if (!currentNode) {
      return nextNode;
    }
    return {
      ...currentNode,
      ...nextNode,
      position: currentNode.position,
      dragging: currentNode.dragging,
      selected: currentNode.selected
    };
  });
}

function applyClusterNodeChanges(
  changes: NodeChange<Node<LoopGraphDotNodeData>>[],
  currentNodes: Node<LoopGraphDotNodeData>[],
  descendantIdsByNodeId: Map<string, string[]>
) {
  const changedNodes = applyNodeChanges(changes, currentNodes);
  const previousById = new Map(currentNodes.map((node) => [node.id, node]));
  const changedById = new Map(changedNodes.map((node) => [node.id, node]));
  const explicitlyMovedIds = new Set<string>();
  const movementDeltas: Array<{ dx: number; dy: number; nodeId: string }> = [];

  for (const change of changes) {
    if (change.type !== "position" || !change.position) {
      continue;
    }
    const previousPosition = previousById.get(change.id)?.position;
    const nextPosition = changedById.get(change.id)?.position ?? change.position;
    if (!previousPosition) {
      continue;
    }
    const dx = nextPosition.x - previousPosition.x;
    const dy = nextPosition.y - previousPosition.y;
    if (Math.abs(dx) < 0.001 && Math.abs(dy) < 0.001) {
      continue;
    }
    explicitlyMovedIds.add(change.id);
    movementDeltas.push({ dx, dy, nodeId: change.id });
  }

  if (movementDeltas.length === 0) {
    return changedNodes;
  }

  return changedNodes.map((node) => {
    if (explicitlyMovedIds.has(node.id)) {
      return node;
    }

    let dx = 0;
    let dy = 0;
    for (const movement of movementDeltas) {
      if (!descendantIdsByNodeId.get(movement.nodeId)?.includes(node.id)) {
        continue;
      }
      dx += movement.dx;
      dy += movement.dy;
    }

    if (Math.abs(dx) < 0.001 && Math.abs(dy) < 0.001) {
      return node;
    }

    return {
      ...node,
      position: {
        x: roundCoord(node.position.x + dx),
        y: roundCoord(node.position.y + dy)
      }
    };
  });
}

function positionMapFromFlowNodes(nodes: Node<LoopGraphDotNodeData>[]) {
  return new Map(nodes.map((node) => [node.id, node.position]));
}

function positionOverridesFromFlowNodes(
  nodes: Node<LoopGraphDotNodeData>[],
  layout: Record<string, XYPosition>
) {
  const overrides: Record<string, XYPosition> = {};
  for (const node of nodes) {
    const basePosition = layout[node.id];
    if (
      !basePosition ||
      Math.abs(node.position.x - basePosition.x) > 0.5 ||
      Math.abs(node.position.y - basePosition.y) > 0.5
    ) {
      overrides[node.id] = {
        x: roundCoord(node.position.x),
        y: roundCoord(node.position.y)
      };
    }
  }
  return overrides;
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
  const childLoopCounts = directChildLoopCounts(nodes, edges);
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
            strokeOpacity={variant === "topology" ? 0.72 : activeNodeId ? (isConnected ? 0.72 : 0) : 0.5}
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
        const visualSize = visualNodeSize(node.kind, variant, size, selected);
        const isLoopVisual = variant === "topology" && isLoopVisualKind(node.kind);
        const childLoopCount = childLoopCounts.get(node.id) ?? 0;
        return (
          <g key={node.id} opacity={activeNodeId && !connected ? 0.25 : 1}>
            {isLoopVisual ? (
              <>
                <circle
                  cx={position.x}
                  cy={position.y}
                  fill="none"
                  r={visualSize / 2}
                  stroke={nodeColor(node.kind, node.department)}
                  strokeDasharray={`${Math.max(visualSize * 1.7, 1)} ${Math.max(visualSize * 0.38, 1)}`}
                  strokeLinecap="round"
                  strokeOpacity={selected ? 0.78 : 0.5}
                  strokeWidth={selected ? 2 : 1.5}
                  transform={`rotate(-28 ${position.x} ${position.y})`}
                />
                {Array.from({ length: Math.min(childLoopCount, 6) }).map((_, index) => {
                  const angle = -Math.PI / 2 + (Math.PI * 2 * index) / Math.max(Math.min(childLoopCount, 6), 1);
                  const radius = visualSize / 2 - 4;
                  return (
                    <circle
                      cx={position.x + Math.cos(angle) * radius}
                      cy={position.y + Math.sin(angle) * radius}
                      fill={nodeColor(node.kind, node.department)}
                      key={index}
                      r={2}
                      stroke="#fff"
                      strokeWidth={0.8}
                    />
                  );
                })}
              </>
            ) : null}
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
  const dotOffset = (data.visualSize - data.dotSize) / 2;
  const title = data.childLoopCount > 0
    ? `${data.label} - manages ${data.childLoopCount} child loop${data.childLoopCount === 1 ? "" : "s"}`
    : data.subtitle
      ? `${data.label} - ${data.subtitle}`
      : data.label;

  return (
    <div
      className={`group relative cursor-grab active:cursor-grabbing ${
        data.dimmed ? "opacity-25" : "opacity-100"
      }`}
      data-child-loop-count={data.childLoopCount}
      data-loop-visual={data.isLoopVisual ? "true" : "false"}
      data-loop-role={data.role}
      style={{
        height: data.visualSize,
        width: data.visualSize
      }}
      title={title}
    >
      {handleSides.map((side) => (
        <Handle
          className="!h-1.5 !w-1.5 !border-0 !bg-transparent !opacity-0"
          id={`${side}-source`}
          key={`${side}-source`}
          position={handlePosition(side)}
          type="source"
        />
      ))}
      {handleSides.map((side) => (
        <Handle
          className="!h-1.5 !w-1.5 !border-0 !bg-transparent !opacity-0"
          id={`${side}-target`}
          key={`${side}-target`}
          position={handlePosition(side)}
          type="target"
        />
      ))}
      {data.role !== "standard" ? (
        <OrbitalLoopNode data={data} />
      ) : (
        <>
          {data.isLoopVisual ? <LoopShell data={data} /> : null}
          <span
            className="absolute block rounded-full transition-transform"
            style={{
              height: data.dotSize,
              left: dotOffset,
              top: dotOffset,
              width: data.dotSize,
              background: data.color,
              boxShadow: data.selected
                ? `0 0 0 5px ${data.appearance === "onDark" ? "rgba(255,255,255,0.18)" : "rgba(17,17,17,0.12)"}, 0 0 22px rgba(249,115,22,0.32)`
                : "0 1px 5px rgba(17,17,17,0.18)"
            }}
          />
          {data.showLabel ? (
            <span
              className={`pointer-events-none absolute top-1/2 block max-w-[180px] -translate-y-1/2 whitespace-normal break-words text-[11px] font-medium leading-[1.15] ${
                data.selected ? "font-semibold" : ""
              }`}
              style={{
                ...(data.labelSide === "left"
                  ? { right: data.visualSize + 6, textAlign: "right" as const }
                  : { left: data.visualSize + 6, textAlign: "left" as const }),
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
        </>
      )}
    </div>
  );
}

function OrbitalLoopNode({ data }: { data: LoopGraphDotNodeData }) {
  const isCore = data.role === "core";
  const isTrigger = data.role === "trigger";
  const isInternal = data.role === "satellite" && !data.isLoopVisual;
  const borderColor = isTrigger ? "#68645d" : isInternal ? "#74716f" : data.color;
  const label = isTrigger ? data.label : compactLoopNodeLabel(data.label, isCore);
  const showFullLabel = data.selected && !isCore;

  return (
    <>
      <span
        className="absolute inset-0 flex items-center justify-center rounded-full border bg-white text-center font-semibold text-ink shadow-[0_2px_7px_rgba(17,17,17,0.08)]"
        style={{
          borderColor,
          borderWidth: isCore ? 3.5 : data.selected ? 3 : 2.5,
          boxShadow: data.selected
            ? `0 0 0 5px ${data.color}22, 0 8px 24px rgba(17,17,17,0.12)`
            : "0 2px 7px rgba(17,17,17,0.08)",
          color: "#2f2d29",
          fontSize: isCore ? 12.5 : 11.5,
          lineHeight: isCore ? 1.2 : 1.08,
          padding: isCore ? 13 : 8
        }}
      >
        <span className="line-clamp-3 max-w-full break-words">
          {label}
        </span>
      </span>
      {isInternal ? (
        <span
          aria-hidden="true"
          className="absolute rounded-full"
          style={{
            background: data.color,
            height: 8,
            right: 9,
            top: 9,
            width: 8
          }}
        />
      ) : null}
      {!isCore ? (
        <span
          className={`pointer-events-none absolute left-1/2 top-[calc(100%+6px)] z-30 max-w-[180px] -translate-x-1/2 rounded-md border border-line bg-white px-2 py-1 text-center text-[11px] font-semibold leading-[1.15] text-ink shadow-[0_6px_18px_rgba(17,17,17,0.12)] transition-opacity ${
            showFullLabel ? "opacity-100" : "opacity-0 group-hover:opacity-100"
          }`}
        >
          {data.label}
        </span>
      ) : null}
    </>
  );
}

function LoopShell({ data }: { data: LoopGraphDotNodeData }) {
  const ringOpacity = data.selected ? 0.84 : 0.56;
  const secondaryOpacity = data.selected ? 0.24 : 0.16;
  const markerCount = Math.min(data.childLoopCount, 6);
  const markerRadius = data.visualSize / 2 - 4;
  const markerCenter = data.visualSize / 2;

  return (
    <>
      <span
        aria-hidden="true"
        className="absolute rounded-full"
        style={{
          inset: 0,
          borderColor: `${data.color} ${data.color} transparent ${data.color}`,
          borderStyle: "solid",
          borderWidth: data.selected ? 2 : 1.5,
          opacity: ringOpacity,
          transform: "rotate(-28deg)"
        }}
      />
      <span
        aria-hidden="true"
        className="absolute rounded-full"
        style={{
          inset: 4,
          border: `1px solid ${data.color}`,
          opacity: secondaryOpacity
        }}
      />
      <span
        aria-hidden="true"
        className="absolute"
        style={{
          borderRight: `2px solid ${data.color}`,
          borderTop: `2px solid ${data.color}`,
          height: 6,
          opacity: ringOpacity,
          right: 2,
          top: data.visualSize * 0.25,
          transform: "rotate(52deg)",
          width: 6
        }}
      />
      <span
        aria-hidden="true"
        className="absolute"
        style={{
          borderBottom: `2px solid ${data.color}`,
          borderLeft: `2px solid ${data.color}`,
          bottom: data.visualSize * 0.25,
          height: 6,
          left: 2,
          opacity: ringOpacity,
          transform: "rotate(52deg)",
          width: 6
        }}
      />
      {Array.from({ length: markerCount }).map((_, index) => {
        const angle = -Math.PI / 2 + (Math.PI * 2 * index) / Math.max(markerCount, 1);
        return (
          <span
            aria-hidden="true"
            className="absolute rounded-full border border-white/90"
            key={index}
            style={{
              background: data.color,
              height: 4,
              left: markerCenter + Math.cos(angle) * markerRadius - 2,
              opacity: data.selected ? 0.92 : 0.7,
              top: markerCenter + Math.sin(angle) * markerRadius - 2,
              width: 4
            }}
          />
        );
      })}
    </>
  );
}

function layoutNodes(
  nodes: LoopGraphVisualNode[],
  edges: Array<{ source: string; target: string }>,
  selectedNodeId: string | undefined,
  variant: LoopGraphViewVariant,
  layoutMode?: LoopGraphVisual["layoutMode"]
): Record<string, XYPosition> {
  if (variant === "topology" && layoutMode === "brain-map") {
    return layoutBrainMapNodes(nodes);
  }

  if (nodes.some((node) => node.metadata?.layout === "ego-center")) {
    return layoutEgoNodes(nodes, selectedNodeId);
  }

  if (variant === "topology") {
    return layoutCompanyTopologyNodes(nodes);
  }

  return layoutClusterNodes(nodes, edges, selectedNodeId, variant);
}

function layoutBrainMapNodes(nodes: LoopGraphVisualNode[]): Record<string, XYPosition> {
  const layout: Record<string, XYPosition> = {};
  const sortedNodes = stableSortNodes(nodes);
  const children = childrenByParentId(sortedNodes);
  const rootNode = sortedNodes.find((node) => node.kind === "organization");
  const managementNode = sortedNodes.find((node) => node.kind === "management");
  const departmentNodes = stableSortNodes(sortedNodes.filter((node) => node.kind === "department"));
  const workflowLoops = stableSortNodes(sortedNodes.filter(isWorkflowSemanticNode));
  const clusterRadiusByLoopId = new Map<string, number>();
  for (const loop of workflowLoops) {
    clusterRadiusByLoopId.set(loop.id, brainClusterRadius(loop, children));
  }
  const clusterRows = packClusterRows(
    workflowLoops.map((loop) => ({
      id: loop.id,
      radius: clusterRadiusByLoopId.get(loop.id) ?? 150,
      rowKey: loop.department ?? "unassigned",
      sortKey: `${loop.department ?? ""}:${loop.label}`
    })),
    {
      columnGap: 300,
      minRowHeight: 470,
      rowGap: 210
    }
  );

  if (rootNode) {
    layout[rootNode.id] = { x: -980, y: 0 };
  }
  if (managementNode) {
    layout[managementNode.id] = { x: -740, y: 0 };
  }

  for (const department of departmentNodes) {
    const y = clusterRows.rowCenters[department.department ?? "unassigned"];
    if (typeof y === "number") {
      layout[department.id] = { x: -470, y };
    }
  }

  for (const loop of workflowLoops) {
    const center = clusterRows.centers[loop.id];
    if (!center) {
      continue;
    }
    const shiftedCenter = {
      x: roundCoord(center.x + 90),
      y: center.y
    };
    layout[loop.id] = shiftedCenter;
    placeWorkflowCluster(layout, loop, children, shiftedCenter);
  }

  placeGroup(
    layout,
    sortedNodes.filter((node) => !layout[node.id] && isLoopVisualKind(node.kind)),
    -120,
    0,
    88
  );
  placeGroup(
    layout,
    sortedNodes.filter((node) => !layout[node.id]),
    240,
    Object.values(clusterRows.rowCenters).length > 0
      ? Math.max(...Object.values(clusterRows.rowCenters)) + 240
      : 0,
    64
  );

  return layout;
}

function placeWorkflowCluster(
  layout: Record<string, XYPosition>,
  loop: LoopGraphVisualNode,
  children: Map<string, LoopGraphVisualNode[]>,
  center: XYPosition
) {
  const childNodes = stableSortNodes(children.get(loop.id) ?? []);
  const triggerNodes = childNodes.filter((node) => node.kind === "trigger");
  const orbitNodes = childNodes.filter((node) => node.kind !== "trigger" && !isLoopVisualKind(node.kind));
  const childLoops = childNodes.filter((node) => isLoopVisualKind(node.kind) && node.id !== loop.id);
  const orbitLayout = packedOrbitLayout({
    center,
    nodes: orbitNodes,
    sizeForNode: brainNodeSizeForLayout,
    centerSize: loopCoreLayoutSize,
    minGap: loopSatelliteGap
  });

  Object.assign(layout, orbitLayout);

  const orbitRadius = orbitOuterRadius(
    orbitNodes,
    brainNodeSizeForLayout,
    loopCoreLayoutSize,
    loopSatelliteGap
  );
  triggerNodes.forEach((node, index) => {
    layout[node.id] = {
      x: roundCoord(center.x - orbitRadius - 112),
      y: roundCoord(center.y + (index - (triggerNodes.length - 1) / 2) * 116)
    };
  });
  placeGroup(layout, childLoops, center.x + orbitRadius + 140, center.y, 104);
}

function brainClusterRadius(
  loop: LoopGraphVisualNode,
  children: Map<string, LoopGraphVisualNode[]>
) {
  const childNodes = children.get(loop.id) ?? [];
  const orbitNodes = childNodes.filter((node) => node.kind !== "trigger" && !isLoopVisualKind(node.kind));
  const triggerCount = childNodes.filter((node) => node.kind === "trigger").length;
  return Math.max(
    150,
    orbitOuterRadius(
      orbitNodes,
      brainNodeSizeForLayout,
      loopCoreLayoutSize,
      loopSatelliteGap
    ) + (triggerCount > 0 ? 132 : 44)
  );
}

function layoutClusterNodes(
  nodes: LoopGraphVisualNode[],
  edges: Array<{ source: string; target: string }>,
  selectedNodeId: string | undefined,
  variant: LoopGraphViewVariant
): Record<string, XYPosition> {
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

function layoutCompanyTopologyNodes(nodes: LoopGraphVisualNode[]): Record<string, XYPosition> {
  const layout: Record<string, XYPosition> = {};
  const sortedNodes = stableSortNodes(nodes);
  const rootNode = sortedNodes.find((node) => node.kind === "organization");
  const managementNode = sortedNodes.find((node) => node.kind === "management");
  const departmentNodes = sortedNodes.filter((node) => node.kind === "department");
  const childNodes = childrenByParentId(sortedNodes);
  const sectionGap = 38;
  const loopGap = 58;
  let cursorY = 0;

  const departmentBlocks = departmentNodes.map((department) => {
    const childLoops = stableSortNodes((childNodes.get(department.id) ?? []).filter((node) => node.kind === "loop"));
    const height = Math.max(96, Math.max(childLoops.length, 1) * loopGap);
    const centerY = cursorY + height / 2;
    cursorY += height + sectionGap;
    return { department, childLoops, centerY };
  });
  const totalHeight = Math.max(cursorY - sectionGap, 0);
  const offsetY = totalHeight / 2;

  if (rootNode) {
    layout[rootNode.id] = { x: -520, y: 0 };
  }
  if (managementNode) {
    layout[managementNode.id] = { x: -250, y: 0 };
  }

  for (const block of departmentBlocks) {
    const y = roundCoord(block.centerY - offsetY);
    layout[block.department.id] = { x: 40, y };
    placeLoopTree({
      childNodes,
      layout,
      parentId: block.department.id,
      x: 330,
      centerY: y,
      gap: loopGap
    });
  }

  const rootChildren = childNodes.get(rootNode?.id ?? "") ?? [];
  const managementChildren = childNodes.get(managementNode?.id ?? "") ?? [];
  const unplacedCoreChildren = stableSortNodes([...rootChildren, ...managementChildren]).filter(
    (node) => !layout[node.id] && isCoreKind(node.kind)
  );
  placeGroup(layout, unplacedCoreChildren, 40, 0, 72);

  const unplacedLoops = sortedNodes.filter((node) => node.kind === "loop" && !layout[node.id]);
  placeGroup(layout, unplacedLoops, departmentNodes.length > 0 ? 610 : 40, 0, loopGap);

  const laneAnchors: Array<[LoopGraphVisualNodeKind, XYPosition, number]> = [
    ["data_source", { x: -130, y: -230 }, 48],
    ["action", { x: 620, y: -180 }, 52],
    ["verification", { x: 690, y: 20 }, 52],
    ["owner", { x: 500, y: 225 }, 50],
    ["review", { x: 690, y: 225 }, 50],
    ["metric", { x: 210, y: 235 }, 50],
    ["improvement", { x: 430, y: 345 }, 50],
    ["rollup", { x: -20, y: 275 }, 50]
  ];

  for (const [kind, anchor, gap] of laneAnchors) {
    placeGroup(
      layout,
      sortedNodes.filter((node) => node.kind === kind && !layout[node.id]),
      anchor.x,
      anchor.y,
      gap
    );
  }

  placeGroup(
    layout,
    sortedNodes.filter((node) => !layout[node.id]),
    780,
    0,
    52
  );

  return layout;
}

function layoutEgoNodes(
  nodes: LoopGraphVisualNode[],
  selectedNodeId: string | undefined
): Record<string, XYPosition> {
  const graphCenterNode =
    nodes.find((node) => node.metadata?.layout === "ego-center") ??
    nodes.find((node) => node.metadata?.ring === "center");
  const centerNode =
    graphCenterNode ??
    nodes.find((node) => node.id === selectedNodeId) ??
    nodes[0];

  if (!centerNode || !isWorkflowSemanticNode(centerNode)) {
    return layoutStructureEgoNodes(nodes, centerNode);
  }

  return layoutWorkflowEgoNodes(nodes, centerNode);
}

function layoutStructureEgoNodes(
  nodes: LoopGraphVisualNode[],
  centerNode: LoopGraphVisualNode | undefined
): Record<string, XYPosition> {
  const layout: Record<string, XYPosition> = {};
  const sortedNodes = stableSortNodes(nodes);
  const centerNodeId = centerNode?.id;

  if (centerNodeId) {
    layout[centerNodeId] = { x: 0, y: 0 };
  }

  const parentNode = sortedNodes.find((node) => node.id === parentIdOf(centerNode));
  const children = sortedNodes.filter((node) => parentIdOf(node) === centerNodeId);
  const childLoops = children.filter((node) => isLoopVisualKind(node.kind));
  const childRemainder = children.filter((node) => !isLoopVisualKind(node.kind));
  const structuralRemainder = sortedNodes.filter(
    (node) => node.id !== centerNodeId && node.id !== parentNode?.id && !children.includes(node)
  );

  placeGroup(layout, parentNode ? [parentNode] : [], -280, -96, 72);
  placeOrbitArc(layout, childLoops, { x: 0, y: 0 }, 295, -0.8, 0.8);
  placeGroup(layout, childRemainder, 310, 0, 58);
  placeGroup(layout, structuralRemainder, -20, 220, 58);

  return layout;
}

function layoutWorkflowEgoNodes(
  nodes: LoopGraphVisualNode[],
  centerNode: LoopGraphVisualNode
): Record<string, XYPosition> {
  const layout: Record<string, XYPosition> = {
    [centerNode.id]: { x: 0, y: 0 }
  };
  const sortedNodes = stableSortNodes(nodes);
  const nodeMap = new Map(sortedNodes.map((node) => [node.id, node]));
  const triggerNode = sortedNodes.find((node) => node.kind === "trigger" && node.metadata?.triggerFor === centerNode.id);
  const parentChain: LoopGraphVisualNode[] = [];
  let parentId = parentIdOf(centerNode);

  while (parentId) {
    const parentNode = nodeMap.get(parentId);
    if (!parentNode || layout[parentNode.id] || parentChain.includes(parentNode)) {
      break;
    }
    parentChain.push(parentNode);
    parentId = parentIdOf(parentNode);
  }

  const childLoops = sortedNodes.filter(
    (node) => node.kind === "loop" && node.id !== centerNode.id && parentIdOf(node) === centerNode.id
  );
  const orbitNodes = loopOrbitNodes(sortedNodes, centerNode.id).filter((node) => !layout[node.id]);
  Object.assign(
    layout,
    packedOrbitLayout({
      center: { x: 0, y: 0 },
      nodes: orbitNodes,
      sizeForNode: brainNodeSizeForLayout,
      centerSize: loopCoreLayoutSize,
      minGap: loopSatelliteGap
    })
  );
  const outerRadius = orbitOuterRadius(
    orbitNodes,
    brainNodeSizeForLayout,
    loopCoreLayoutSize,
    loopSatelliteGap
  );
  Object.assign(
    layout,
    compactArcLayout({
      center: { x: 0, y: 0 },
      endAngle: -2.12,
      nodes: [...parentChain].reverse(),
      radius: outerRadius + 96,
      sizeForNode: brainNodeSizeForLayout,
      startAngle: -2.82
    })
  );
  Object.assign(
    layout,
    compactArcLayout({
      center: { x: 0, y: 0 },
      endAngle: -0.08,
      nodes: childLoops,
      radius: outerRadius + 112,
      sizeForNode: brainNodeSizeForLayout,
      startAngle: -0.78
    })
  );

  if (triggerNode) {
    layout[triggerNode.id] = { x: roundCoord(-outerRadius - 128), y: 0 };
  }

  placeGroup(layout, sortedNodes.filter((node) => !layout[node.id]), outerRadius + 170, 185, 82);

  return layout;
}

function loopOrbitNodes(nodes: LoopGraphVisualNode[], centerNodeId: string) {
  return stableSortNodes(nodes.filter((node) =>
    parentIdOf(node) === centerNodeId &&
    node.kind !== "trigger" &&
    !isLoopVisualKind(node.kind)
  ));
}

function placeOrbitArc(
  layout: Record<string, XYPosition>,
  nodes: LoopGraphVisualNode[],
  center: XYPosition,
  radius: number,
  startAngle: number,
  endAngle: number
) {
  const sortedNodes = stableSortNodes(nodes.filter((node) => !layout[node.id]));
  if (sortedNodes.length === 0) {
    return;
  }

  const span = sortedNodes.length === 1 ? 0 : endAngle - startAngle;
  const baseAngle = sortedNodes.length === 1 ? 0 : startAngle;
  sortedNodes.forEach((node, index) => {
    const angle = baseAngle + (span * index) / Math.max(sortedNodes.length - 1, 1);
    layout[node.id] = {
      x: roundCoord(center.x + Math.cos(angle) * radius),
      y: roundCoord(center.y + Math.sin(angle) * radius)
    };
  });
}

function placeLoopTree(input: {
  childNodes: Map<string, LoopGraphVisualNode[]>;
  layout: Record<string, XYPosition>;
  parentId: string;
  x: number;
  centerY: number;
  gap: number;
}) {
  const children = stableSortNodes((input.childNodes.get(input.parentId) ?? []).filter(
    (node) => node.kind === "loop" && !input.layout[node.id]
  ));
  const startY = input.centerY - ((children.length - 1) * input.gap) / 2;

  children.forEach((node, index) => {
    const y = roundCoord(startY + index * input.gap);
    input.layout[node.id] = { x: input.x, y };
    placeLoopTree({
      childNodes: input.childNodes,
      layout: input.layout,
      parentId: node.id,
      x: input.x + 230,
      centerY: y,
      gap: Math.max(input.gap - 8, 46)
    });
  });
}

function placeGroup(
  layout: Record<string, XYPosition>,
  nodes: LoopGraphVisualNode[],
  x: number,
  centerY: number,
  gap: number
) {
  const sortedNodes = stableSortNodes(nodes.filter((node) => !layout[node.id]));
  const startY = centerY - ((sortedNodes.length - 1) * gap) / 2;

  sortedNodes.forEach((node, index) => {
    layout[node.id] = {
      x,
      y: roundCoord(startY + index * gap)
    };
  });
}

function stableSortNodes(nodes: LoopGraphVisualNode[]) {
  return [...nodes].sort((left, right) =>
    `${kindSortRank(left.kind)}:${left.department ?? ""}:${left.label}:${left.id}`.localeCompare(
      `${kindSortRank(right.kind)}:${right.department ?? ""}:${right.label}:${right.id}`
    )
  );
}

function kindSortRank(kind: LoopGraphVisualNodeKind) {
  const order: LoopGraphVisualNodeKind[] = [
    "organization",
    "management",
    "department",
    "loop",
    "trigger",
    "data_source",
    "action",
    "verification",
    "owner",
    "review",
    "metric",
    "improvement",
    "rollup"
  ];
  return order.indexOf(kind);
}

function childrenByParentId(nodes: LoopGraphVisualNode[]) {
  const children = new Map<string, LoopGraphVisualNode[]>();
  for (const node of nodes) {
    const parentId = parentIdOf(node);
    if (!parentId) {
      continue;
    }
    children.set(parentId, [...(children.get(parentId) ?? []), node]);
  }
  return children;
}

function parentIdOf(node?: LoopGraphVisualNode) {
  return typeof node?.metadata?.parentId === "string" ? node.metadata.parentId : undefined;
}

function preferredBrainCameraNodeId(
  nodeId: string | undefined,
  nodeById: Map<string, LoopGraphVisualNode>
) {
  const node = nodeId ? nodeById.get(nodeId) : undefined;
  if (!node) {
    return nodeId;
  }
  if (isWorkflowSemanticNode(node)) {
    return node.id;
  }
  const parentId = parentIdOf(node);
  const parent = parentId ? nodeById.get(parentId) : undefined;
  return parent && isWorkflowSemanticNode(parent) ? parent.id : node.id;
}

function brainCameraCenter(
  nodeId: string | undefined,
  nodes: LoopGraphVisualNode[],
  nodeById: Map<string, LoopGraphVisualNode>,
  layout: Record<string, XYPosition>
) {
  const node = nodeId ? nodeById.get(nodeId) : undefined;
  if (!node) {
    return undefined;
  }

  if (isWorkflowSemanticNode(node) && node.department) {
    const sameDepartmentLoops = nodes
      .filter((candidate) => isWorkflowSemanticNode(candidate) && candidate.department === node.department)
      .map((candidate) => layout[candidate.id])
      .filter((position): position is XYPosition => Boolean(position));
    if (sameDepartmentLoops.length > 1) {
      return averagePosition(sameDepartmentLoops);
    }
  }

  if (node.kind === "department") {
    const departmentLoops = nodes
      .filter((candidate) => isWorkflowSemanticNode(candidate) && candidate.department === node.department)
      .map((candidate) => layout[candidate.id])
      .filter((position): position is XYPosition => Boolean(position));
    if (departmentLoops.length > 0) {
      return averagePosition([layout[node.id], ...departmentLoops].filter(Boolean) as XYPosition[]);
    }
  }

  return layout[node.id];
}

function averagePosition(positions: XYPosition[]) {
  const totals = positions.reduce(
    (acc, position) => ({
      x: acc.x + position.x,
      y: acc.y + position.y
    }),
    { x: 0, y: 0 }
  );
  return {
    x: roundCoord(totals.x / positions.length),
    y: roundCoord(totals.y / positions.length)
  };
}

function semanticTypeOf(node: LoopGraphVisualNode) {
  return typeof node.metadata?.semanticType === "string" ? node.metadata.semanticType : undefined;
}

function isWorkflowSemanticNode(node: LoopGraphVisualNode) {
  const semanticType = semanticTypeOf(node);
  return semanticType === "workflow_loop" || semanticType === "task_loop";
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

function directChildLoopCounts(
  nodes: LoopGraphVisualNode[],
  edges: Array<{ source: string; target: string; kind?: string }>
) {
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const counts = new Map<string, number>();

  for (const edge of edges) {
    if (edge.kind !== "contains") {
      continue;
    }
    const source = nodeById.get(edge.source);
    const target = nodeById.get(edge.target);
    if (!source || !target || !isLoopVisualKind(source.kind) || !isLoopVisualKind(target.kind)) {
      continue;
    }
    counts.set(edge.source, (counts.get(edge.source) ?? 0) + 1);
  }

  return counts;
}

function buildLoopSequenceEdges(
  nodes: LoopGraphVisualNode[],
  layout: Record<string, XYPosition>,
  variant: LoopGraphViewVariant
): LoopGraphVisualEdge[] {
  if (variant !== "topology") {
    return [];
  }

  const nodesByParent = new Map<string, LoopGraphVisualNode[]>();
  for (const node of nodes) {
    const parentId = parentIdOf(node);
    if (!parentId || isLoopVisualKind(node.kind) || node.kind === "trigger") {
      continue;
    }
    nodesByParent.set(parentId, [...(nodesByParent.get(parentId) ?? []), node]);
  }

  const edges: LoopGraphVisualEdge[] = [];
  for (const [parentId, group] of nodesByParent) {
    if (group.length < 2 || !layout[parentId]) {
      continue;
    }
    const ordered = sortByLoopSequence(group);

    ordered.forEach((source, index) => {
      const target = ordered[(index + 1) % ordered.length];
      if (!target) {
        return;
      }
      edges.push({
        id: `loop-sequence:${parentId}:${source.id}->${target.id}`,
        source: source.id,
        target: target.id,
        kind: "loop_sequence",
        label: "sequence",
        metadata: {
          executable: true,
          loopSequence: true,
          semantic: true,
          style: "solid"
        }
      });
    });
  }

  return edges;
}

function buildBrainFlowEdges(
  nodes: LoopGraphVisualNode[],
  visibleEdges: LoopGraphVisualEdge[],
  variant: LoopGraphViewVariant,
  layoutMode?: LoopGraphVisual["layoutMode"]
): LoopGraphVisualEdge[] {
  if (variant !== "topology" || layoutMode !== "brain-map") {
    return [];
  }

  const workflowLoops = stableSortNodes(nodes.filter(isWorkflowSemanticNode));
  const departmentLoops = stableSortNodes(nodes.filter((node) => node.kind === "department"));
  const edges: LoopGraphVisualEdge[] = [];
  const existingEdgeIds = new Set(visibleEdges.map((edge) => `${edge.source}->${edge.target}:${edge.kind ?? ""}`));
  const workflowByDepartment = new Map<string, LoopGraphVisualNode[]>();

  for (const workflow of workflowLoops) {
    const key = workflow.department ?? "unassigned";
    workflowByDepartment.set(key, [...(workflowByDepartment.get(key) ?? []), workflow]);
  }

  for (const department of departmentLoops) {
    const departmentWorkflows = stableSortNodes(workflowByDepartment.get(department.department ?? "unassigned") ?? []);
    if (departmentWorkflows.length === 0) {
      continue;
    }
    addBrainFlowEdge(edges, existingEdgeIds, department.id, departmentWorkflows[0].id, "manages");
    departmentWorkflows.forEach((workflow, index) => {
      const nextWorkflow = departmentWorkflows[index + 1];
      if (nextWorkflow) {
        addBrainFlowEdge(edges, existingEdgeIds, workflow.id, nextWorkflow.id, "loop_flow");
      }
    });
  }

  const departmentKeys = Array.from(workflowByDepartment.keys()).sort();
  departmentKeys.forEach((departmentKey, index) => {
    const currentDepartmentWorkflows = stableSortNodes(workflowByDepartment.get(departmentKey) ?? []);
    const nextDepartmentWorkflows = stableSortNodes(workflowByDepartment.get(departmentKeys[index + 1] ?? "") ?? []);
    const currentLast = currentDepartmentWorkflows[currentDepartmentWorkflows.length - 1];
    const nextFirst = nextDepartmentWorkflows[0];
    if (currentLast && nextFirst) {
      addBrainFlowEdge(edges, existingEdgeIds, currentLast.id, nextFirst.id, "loop_flow");
    }
  });

  return edges;
}

function addBrainFlowEdge(
  edges: LoopGraphVisualEdge[],
  existingEdgeIds: Set<string>,
  source: string,
  target: string,
  kind: string
) {
  const edgeKey = `${source}->${target}:${kind}`;
  if (source === target || existingEdgeIds.has(edgeKey)) {
    return;
  }
  existingEdgeIds.add(edgeKey);
  edges.push({
    id: `brain-flow:${kind}:${source}->${target}`,
    source,
    target,
    kind,
    label: kind === "manages" ? "manages" : "loop flow",
    metadata: {
      brainFlow: true,
      executable: true,
      semantic: true,
      style: "solid"
    }
  });
}

function shouldHideLoopOrbitSpokeEdge(
  edge: LoopGraphVisualEdge,
  nodeById: Map<string, LoopGraphVisualNode>,
  shouldHideOrbitSpokes: boolean,
  sequenceEdges: LoopGraphVisualEdge[]
) {
  if (
    !shouldHideOrbitSpokes ||
    edge.kind === "triggers" ||
    edge.kind === "contains" ||
    edge.metadata?.loopSequence
  ) {
    return false;
  }

  const source = nodeById.get(edge.source);
  const target = nodeById.get(edge.target);
  if (!source || !target) {
    return false;
  }

  const sourceParentId = parentIdOf(source);
  const targetParentId = parentIdOf(target);
  const centerId = sourceParentId === target.id
    ? target.id
    : targetParentId === source.id
      ? source.id
      : undefined;
  if (!centerId) {
    return false;
  }

  return sequenceEdges.some((sequenceEdge) => {
    const sequenceSource = nodeById.get(sequenceEdge.source);
    return sequenceSource ? parentIdOf(sequenceSource) === centerId : false;
  });
}

function shouldHideBrainMapStructuralEdge(
  edge: LoopGraphVisualEdge,
  nodeById: Map<string, LoopGraphVisualNode>,
  isBrainMapView: boolean
) {
  if (!isBrainMapView || edge.metadata?.brainFlow || edge.metadata?.loopSequence || edge.kind !== "contains") {
    return false;
  }

  const source = nodeById.get(edge.source);
  const target = nodeById.get(edge.target);
  if (!source || !target) {
    return false;
  }

  const sourceIsDepartment = source.kind === "department";
  const sourceIsWorkflow = isWorkflowSemanticNode(source);
  const targetIsWorkflow = isWorkflowSemanticNode(target);
  return targetIsWorkflow && (sourceIsDepartment || sourceIsWorkflow);
}

function nodeRoleForLoopLogic(
  node: LoopGraphVisualNode,
  egoCenterNode: LoopGraphVisualNode | undefined,
  isLoopLogicView: boolean,
  isBrainMapView: boolean,
  variant: LoopGraphViewVariant
): LoopNodeRole {
  if (variant !== "topology") {
    return "standard";
  }
  if (node.kind === "trigger") {
    return "trigger";
  }
  if (isBrainMapView) {
    if (isWorkflowSemanticNode(node) || node.kind === "management") {
      return "core";
    }
    if (parentIdOf(node) && !isLoopVisualKind(node.kind)) {
      return "satellite";
    }
    if (isLoopVisualKind(node.kind)) {
      return "satellite";
    }
    return "standard";
  }
  if (egoCenterNode?.id === node.id) {
    return "core";
  }
  if (isLoopLogicView && egoCenterNode && parentIdOf(node) === egoCenterNode.id && !isLoopVisualKind(node.kind)) {
    return "satellite";
  }
  if (isLoopVisualKind(node.kind)) {
    return node.kind === "management" && !egoCenterNode ? "core" : "satellite";
  }
  return "standard";
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
    trigger: { x: -260, y: 0 },
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
    trigger: 18,
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

function visualNodeSize(
  kind: LoopGraphVisualNodeKind,
  variant: LoopGraphViewVariant,
  dotSizeValue: number,
  selected: boolean,
  role: LoopNodeRole = "standard"
) {
  if (variant === "topology") {
    if (role === "core") {
      return selected ? 154 : 144;
    }
    if (role === "satellite") {
      return selected ? 96 : 88;
    }
    if (role === "trigger") {
      return selected ? 116 : 108;
    }
  }

  if (variant !== "topology" || !isLoopVisualKind(kind)) {
    return dotSizeValue;
  }

  const minimumShellByKind: Partial<Record<LoopGraphVisualNodeKind, number>> = {
    management: 54,
    department: 44,
    loop: 42,
    rollup: 42
  };
  return Math.max(minimumShellByKind[kind] ?? 42, dotSizeValue + 20) + (selected ? 4 : 0);
}

function brainNodeSizeForLayout(node: LoopGraphVisualNode) {
  if (node.kind === "trigger") {
    return visualNodeSize(node.kind, "topology", 18, false, "trigger");
  }
  if (isWorkflowSemanticNode(node) || node.kind === "management") {
    return visualNodeSize(node.kind, "topology", 24, false, "core");
  }
  if (isLoopVisualKind(node.kind)) {
    return visualNodeSize(node.kind, "topology", 16, false, "satellite");
  }
  return visualNodeSize(node.kind, "topology", dotSize(node, "topology", false), false, "satellite");
}

function isLoopVisualKind(kind: LoopGraphVisualNodeKind) {
  return kind === "management" || kind === "department" || kind === "loop" || kind === "rollup";
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
  if (edge.metadata?.brainFlow) {
    return appearance === "onDark" ? "rgba(255,255,255,0.78)" : "#68645d";
  }
  if (edge.kind === "triggers" || edge.metadata?.loopSequence) {
    return appearance === "onDark" ? "rgba(255,255,255,0.68)" : "#74716f";
  }
  if (edge.kind === "contains") {
    return appearance === "onDark" ? "rgba(255,255,255,0.58)" : "#746f66";
  }
  return appearance === "onDark" ? "rgba(255,255,255,0.46)" : "#a8a197";
}

function topologyEdgeWidth(edge: { kind?: string; metadata?: Record<string, unknown> }) {
  if (edge.metadata?.brainFlow) {
    return 3;
  }
  if (edge.metadata?.loopSequence) {
    return 2.35;
  }
  if (edge.kind === "triggers") {
    return 2.45;
  }
  if (edge.kind === "contains") {
    return 2.05;
  }
  return edge.metadata?.executable ? 1.9 : 1.45;
}

function edgeType(edge: { kind?: string; metadata?: Record<string, unknown> }) {
  if (edge.metadata?.brainFlow || edge.metadata?.loopSequence) {
    return "simplebezier";
  }
  if (edge.kind === "contains" || edge.kind === "triggers") {
    return "smoothstep";
  }
  return "straight";
}

function edgeMarker(
  edge: { kind?: string; metadata?: Record<string, unknown> },
  appearance: LoopGraphAppearance
) {
  if (edge.kind === "contains" || edge.kind === "triggers" || edge.metadata?.loopSequence || edge.metadata?.brainFlow || edge.metadata?.executable) {
    const color = edgeStroke(edge, appearance);
    return {
      color,
      height: edge.metadata?.brainFlow ? 20 : 14,
      type: MarkerType.ArrowClosed,
      width: edge.metadata?.brainFlow ? 20 : 14
    };
  }
  return undefined;
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

function sideToward(from: XYPosition, to: XYPosition): HandleSide {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  if (Math.abs(dx) >= Math.abs(dy)) {
    return dx >= 0 ? "right" : "left";
  }
  return dy >= 0 ? "bottom" : "top";
}

function handlePosition(side: HandleSide) {
  if (side === "top") {
    return Position.Top;
  }
  if (side === "right") {
    return Position.Right;
  }
  if (side === "bottom") {
    return Position.Bottom;
  }
  return Position.Left;
}

function compactLoopNodeLabel(label: string, isCore: boolean) {
  const normalizedLabel = label.replace(/[_:.]+/g, " ").replace(/\s+/g, " ").trim();
  if (isCore) {
    return normalizedLabel;
  }
  const words = normalizedLabel.split(/\s+/).filter(Boolean);
  if (words.length <= 2) {
    return normalizedLabel;
  }
  return words.slice(0, 2).join(" ");
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
  if (kind === "trigger") return "#74716f";
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
