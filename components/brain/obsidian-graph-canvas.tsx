"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { curvedEdgePath } from "./graph-geometry";
import { getLayoutBounds, useObsidianForceLayout } from "./use-obsidian-force-layout";
import type { BrainGraphEdge, BrainGraphMode, BrainGraphNode } from "./graph-types";

type Transform = {
  x: number;
  y: number;
  k: number;
};

type DragState =
  | { kind: "none" }
  | { kind: "pan"; pointerId: number; startX: number; startY: number; origin: Transform }
  | { kind: "node"; pointerId: number; nodeId: string; offsetX: number; offsetY: number };

export function ObsidianGraphCanvas({
  nodes,
  edges,
  mode,
  centerId,
  selectedId,
  showLabels,
  graphLabel = "Hermes Brain graph",
  onSelect,
  onOpenLocal,
  fitRequest,
  resetRequest,
  editable = false,
  initialPositions = {},
  onNodePositionChange
}: {
  nodes: BrainGraphNode[];
  edges: BrainGraphEdge[];
  mode: BrainGraphMode;
  centerId?: string;
  selectedId?: string;
  showLabels: boolean;
  graphLabel?: string;
  onSelect: (nodeId: string) => void;
  onOpenLocal: (nodeId: string) => void;
  fitRequest: number;
  resetRequest: number;
  editable?: boolean;
  initialPositions?: Record<string, { x: number; y: number }>;
  onNodePositionChange?: (nodeId: string, x: number, y: number) => void;
}) {
  const svgRef = useRef<SVGSVGElement | null>(null);
  const fitViewRef = useRef<() => void>(() => undefined);
  const [transform, setTransform] = useState<Transform>({ x: 420, y: 330, k: 0.88 });
  const [hoveredId, setHoveredId] = useState<string | undefined>();
  const [dragState, setDragState] = useState<DragState>({ kind: "none" });
  const { nodes: positionedNodes, setNodePosition, resetLayout } = useObsidianForceLayout({
    nodes,
    edges,
    mode,
    centerId
  }, initialPositions);
  const nodesById = useMemo(() => new Map(positionedNodes.map((node) => [node.id, node])), [positionedNodes]);
  const neighborIds = useMemo(() => {
    const activeId = hoveredId ?? selectedId;
    const ids = new Set<string>();
    if (!activeId) {
      return ids;
    }
    ids.add(activeId);
    for (const edge of edges) {
      if (edge.source === activeId) ids.add(edge.target);
      if (edge.target === activeId) ids.add(edge.source);
    }
    return ids;
  }, [edges, hoveredId, selectedId]);

  const fitView = useCallback(() => {
    const svg = svgRef.current;
    if (!svg || positionedNodes.length === 0) {
      return;
    }
    const bounds = getLayoutBounds(positionedNodes);
    const rect = svg.getBoundingClientRect();
    const padding = 120;
    const scale = Math.min(
      1.25,
      Math.max(0.28, Math.min(rect.width / (bounds.width + padding * 2), rect.height / (bounds.height + padding * 2)))
    );
    setTransform({
      k: scale,
      x: rect.width / 2 - (bounds.minX + bounds.width / 2) * scale,
      y: rect.height / 2 - (bounds.minY + bounds.height / 2) * scale
    });
  }, [positionedNodes]);

  useEffect(() => {
    fitViewRef.current = fitView;
  }, [fitView]);

  useEffect(() => {
    fitView();
  }, [fitRequest, fitView]);

  useEffect(() => {
    resetLayout();
  }, [resetLayout, resetRequest]);

  useEffect(() => {
    fitViewRef.current();
  }, [centerId, mode]);

  function clientToGraph(clientX: number, clientY: number) {
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect) {
      return { x: 0, y: 0 };
    }
    return {
      x: (clientX - rect.left - transform.x) / transform.k,
      y: (clientY - rect.top - transform.y) / transform.k
    };
  }

  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) {
      return;
    }
    const svgElement = svg;

    function handleNativeWheel(event: WheelEvent) {
      event.preventDefault();
      const rect = svgElement.getBoundingClientRect();

      setTransform((current) => {
        if (!event.ctrlKey && !event.metaKey && !event.altKey) {
          return {
            ...current,
            x: current.x - event.deltaX,
            y: current.y - event.deltaY
          };
        }

        const nextScale = clamp(current.k * (event.deltaY > 0 ? 0.9 : 1.1), 0.18, 2.3);
        const graphX = (event.clientX - rect.left - current.x) / current.k;
        const graphY = (event.clientY - rect.top - current.y) / current.k;
        return {
          k: nextScale,
          x: event.clientX - rect.left - graphX * nextScale,
          y: event.clientY - rect.top - graphY * nextScale
        };
      });
    }

    svgElement.addEventListener("wheel", handleNativeWheel, { passive: false });
    return () => svgElement.removeEventListener("wheel", handleNativeWheel);
  }, []);


  function handleCanvasPointerDown(event: React.PointerEvent<SVGSVGElement>) {
    event.currentTarget.setPointerCapture(event.pointerId);
    setDragState({
      kind: "pan",
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      origin: transform
    });
  }

  function handleNodePointerDown(event: React.PointerEvent<SVGGElement>, node: BrainGraphNode) {
    event.stopPropagation();
    if (!editable) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    const point = clientToGraph(event.clientX, event.clientY);
    setDragState({
      kind: "node",
      pointerId: event.pointerId,
      nodeId: node.id,
      offsetX: (node.x ?? 0) - point.x,
      offsetY: (node.y ?? 0) - point.y
    });
  }

  function handlePointerMove(event: React.PointerEvent<SVGSVGElement>) {
    if (dragState.kind === "pan" && dragState.pointerId === event.pointerId) {
      setTransform({
        ...dragState.origin,
        x: dragState.origin.x + event.clientX - dragState.startX,
        y: dragState.origin.y + event.clientY - dragState.startY
      });
      return;
    }
    if (dragState.kind === "node" && dragState.pointerId === event.pointerId) {
      const point = clientToGraph(event.clientX, event.clientY);
      setNodePosition(dragState.nodeId, point.x + dragState.offsetX, point.y + dragState.offsetY);
    }
  }

  function handlePointerUp(event: React.PointerEvent<SVGSVGElement>) {
    if (dragState.kind !== "none" && dragState.pointerId === event.pointerId) {
      if (dragState.kind === "node") {
        const node = nodesById.get(dragState.nodeId);
        if (node) onNodePositionChange?.(node.id, node.x, node.y);
      }
      setDragState({ kind: "none" });
    }
  }

  return (
    <svg
      ref={svgRef}
      aria-label={graphLabel}
      className="h-full min-h-0 w-full cursor-grab touch-none bg-[radial-gradient(circle_at_1px_1px,rgba(17,17,17,0.12)_1px,transparent_0)] [background-size:22px_22px] active:cursor-grabbing"
      onPointerDown={handleCanvasPointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
      role="img"
    >
      <defs>
        <marker id="brain-arrow" markerHeight="8" markerWidth="8" orient="auto" refX="7" refY="4">
          <path d="M0,0 L8,4 L0,8 Z" fill="#57534e" />
        </marker>
      </defs>
      <g transform={`translate(${transform.x} ${transform.y}) scale(${transform.k})`}>
        <g className="edges">
          {edges.map((edge) => {
            const source = nodesById.get(edge.source);
            const target = nodesById.get(edge.target);
            if (!source || !target) {
              return null;
            }
            const path = curvedEdgePath({ source, target, curve: edge.type === "department_contains_loop" ? 0.08 : 0.16 });
            if (!path) {
              return null;
            }
            const highlighted = neighborIds.size === 0 || (neighborIds.has(edge.source) && neighborIds.has(edge.target));
            return (
              <path
                className="transition-opacity duration-150"
                d={path}
                fill="none"
                key={edge.id}
                markerEnd="url(#brain-arrow)"
                opacity={highlighted ? edge.opacity : 0.08}
                stroke={edge.color}
                strokeDasharray={edge.dashed ? "8 7" : undefined}
                strokeLinecap="round"
                strokeWidth={highlighted ? edge.width : Math.max(edge.width - 0.4, 0.7)}
              />
            );
          })}
        </g>
        <g className="nodes">
          {positionedNodes.map((node) => {
            const selected = node.id === selectedId;
            const focused = neighborIds.size === 0 || neighborIds.has(node.id);
            const showFullLabel = showLabels && (focused || ["company_brain", "management_loop", "department_loop", "workflow_loop"].includes(node.type));
            const appNode = node.metadata?.appNode === true;
            const lines = compactLabel(node.label, node.radius);
            return (
              <g
                aria-label={node.label}
                className="cursor-pointer outline-none transition-opacity duration-150"
                key={node.id}
                opacity={focused ? 1 : 0.24}
                onClick={(event) => {
                  event.stopPropagation();
                  onSelect(node.id);
                }}
                onDoubleClick={(event) => {
                  event.stopPropagation();
                  if (isLoopNode(node)) {
                    onOpenLocal(node.id);
                  }
                }}
                onPointerDown={(event) => handleNodePointerDown(event, node)}
                onPointerEnter={() => setHoveredId(node.id)}
                onPointerLeave={() => setHoveredId(undefined)}
                role="button"
                tabIndex={0}
                transform={`translate(${node.x} ${node.y})`}
              >
                <circle
                  fill={node.color}
                  r={node.radius}
                  stroke={selected ? "#111111" : node.stroke}
                  strokeWidth={selected ? 4 : appNode ? 3 : node.type === "workflow_loop" ? 2.5 : 2}
                />
                {node.status === "blocked" || node.status === "needs_attention" ? (
                  <circle fill="none" r={node.radius + 5} stroke={node.status === "blocked" ? "#dc2626" : "#f97316"} strokeWidth="2" />
                ) : null}
                <text
                  dominantBaseline="middle"
                  fill={node.type === "company_brain" || node.type === "management_loop" ? "#ffffff" : "#111111"}
                  fontSize={node.radius >= 42 ? 11 : node.radius >= 28 ? 9 : 8}
                  fontWeight={700}
                  pointerEvents="none"
                  textAnchor="middle"
                >
                  {lines.map((line, index) => (
                    <tspan dy={index === 0 ? `${-(lines.length - 1) * 0.55}em` : "1.1em"} key={`${line}-${index}`} x="0">
                      {line}
                    </tspan>
                  ))}
                </text>
                {showFullLabel ? (
                  <text
                    fill="#111111"
                    fontSize="11"
                    fontWeight={600}
                    opacity="0.78"
                    pointerEvents="none"
                    textAnchor="middle"
                    y={node.radius + 18}
                  >
                    {truncate(node.label, 34)}
                  </text>
                ) : null}
              </g>
            );
          })}
        </g>
      </g>
    </svg>
  );
}

function compactLabel(label: string, radius: number) {
  const words = label.replace(/\b(Loop|Department|Management)\b/g, "").trim().split(/\s+/).filter(Boolean);
  if (radius < 23) {
    return [initials(label)];
  }
  if (radius < 34) {
    return [words[0]?.slice(0, 10) ?? initials(label)];
  }
  const first = words[0] ?? label;
  const second = words[1] ?? (label.includes("Management") ? "Mgmt" : "Loop");
  return [first.slice(0, 11), second.slice(0, 11)];
}

function initials(label: string) {
  const letters = label.match(/\b[A-Za-z0-9]/g) ?? [];
  return letters.slice(0, 2).join("").toUpperCase() || "L";
}

function truncate(value: string, max: number) {
  return value.length > max ? `${value.slice(0, max - 1)}…` : value;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

function isLoopNode(node: BrainGraphNode) {
  return node.type === "management_loop" || node.type === "department_loop" || node.type === "workflow_loop";
}
