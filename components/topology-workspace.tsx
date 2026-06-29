"use client";

import "@xyflow/react/dist/style.css";

import ELK from "elkjs/lib/elk.bundled.js";
import {
  Background,
  Controls,
  Handle,
  Position,
  ReactFlow,
  applyNodeChanges,
  type Edge,
  type Node,
  type NodeChange,
  type NodeProps
} from "@xyflow/react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState, useTransition } from "react";
import type {
  LoopGraph,
  LoopGraphEdge,
  LoopGraphNode,
  LoopGraphNodeKind,
  LoopHealthSummary
} from "@/lib/loop-engineering-builder/types";

type TopologyWorkspaceProps = {
  graph: LoopGraph;
};

type TopologyNodeData = LoopGraphNode & {
  selected: boolean;
};

const elk = new ELK();

const nodeWidthByKind: Record<LoopGraphNodeKind, number> = {
  organization: 190,
  management_loop: 220,
  department: 180,
  loop: 230,
  data_source: 132,
  human_owner: 150,
  review: 170,
  metric: 150,
  improvement: 180
};

const nodeHeightByKind: Record<LoopGraphNodeKind, number> = {
  organization: 76,
  management_loop: 122,
  department: 70,
  loop: 94,
  data_source: 46,
  human_owner: 54,
  review: 64,
  metric: 54,
  improvement: 66
};

const nodeTypes = {
  topology: TopologyNode
};

export function TopologyWorkspace({ graph }: TopologyWorkspaceProps) {
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const [isPending, startTransition] = useTransition();
  const requestedSelectedNodeId =
    searchParams.get("node") ?? graph.view.selectedNodeId ?? graph.nodes[0]?.id;
  const hiddenParam = searchParams.get("hidden") ?? "";
  const hiddenNodeIds = useMemo(
    () => new Set(hiddenParam.split(",").filter(Boolean)),
    [hiddenParam]
  );
  const activeFilter = searchParams.get("department") ?? "all";
  const activeSearch = searchParams.get("q") ?? "";
  const attentionOnly = searchParams.get("attention") === "1";
  const filteredGraphBase = useMemo(
    () => filterGraph(graph, activeFilter, attentionOnly, activeSearch, requestedSelectedNodeId),
    [activeFilter, activeSearch, attentionOnly, graph, requestedSelectedNodeId]
  );
  const filteredGraph = useMemo(
    () => hideGraphNodes(filteredGraphBase, hiddenNodeIds),
    [filteredGraphBase, hiddenNodeIds]
  );
  const [nodes, setNodes] = useState<Node<TopologyNodeData>[]>([]);
  const [edges, setEdges] = useState<Edge[]>([]);
  const selectedNode =
    filteredGraph.nodes.find((node) => node.id === requestedSelectedNodeId) ??
    filteredGraph.nodes[0] ??
    graph.nodes[0];
  const selectedNodeId = selectedNode?.id;
  const selectedHealth = selectedNode?.metadata?.loopId
    ? graph.health.find((item) => item.loopId === selectedNode.metadata?.loopId)
    : graph.health[0];

  function handleNodesChange(changes: NodeChange<Node<TopologyNodeData>>[]) {
    setNodes((currentNodes) => applyNodeChanges(changes, currentNodes));
  }

  useEffect(() => {
    let cancelled = false;

    async function layoutGraph() {
      const topologyLayout = positionTopology(filteredGraph.nodes, selectedNodeId);
      if (topologyLayout) {
        setNodes(
          filteredGraph.nodes.map<Node<TopologyNodeData>>((node) => ({
            id: node.id,
            type: "topology",
            position: topologyLayout[node.id] ?? { x: 0, y: 0 },
            data: {
              ...node,
              selected: node.id === selectedNodeId
            }
          }))
        );
        setEdges(toFlowEdges(filteredGraph.edges));
        return;
      }

      const layout = await elk.layout({
        id: "root",
        layoutOptions: {
          "elk.algorithm": "layered",
          "elk.direction": "DOWN",
          "elk.spacing.nodeNode": "48",
          "elk.layered.spacing.nodeNodeBetweenLayers": "70",
          "elk.edgeRouting": "ORTHOGONAL"
        },
        children: filteredGraph.nodes.map((node) => ({
          id: node.id,
          width: nodeWidthByKind[node.kind],
          height: nodeHeightByKind[node.kind]
        })),
        edges: filteredGraph.edges.map((edge) => ({
          id: edge.id,
          sources: [edge.source],
          targets: [edge.target]
        }))
      });

      if (cancelled) {
        return;
      }

      const laidOutNodes = filteredGraph.nodes.map<Node<TopologyNodeData>>((node) => {
        const layoutNode = layout.children?.find((child) => child.id === node.id);
        return {
          id: node.id,
          type: "topology",
          position: {
            x: layoutNode?.x ?? 0,
            y: layoutNode?.y ?? 0
          },
          data: {
            ...node,
            selected: node.id === selectedNodeId
          }
        };
      });

      const laidOutEdges = toFlowEdges(filteredGraph.edges);
      setNodes(laidOutNodes);
      setEdges(laidOutEdges);
    }

    layoutGraph();
    return () => {
      cancelled = true;
    };
  }, [filteredGraph, selectedNodeId]);

  function updateParams(next: Record<string, string | undefined>) {
    const params = new URLSearchParams(searchParams.toString());
    for (const [key, value] of Object.entries(next)) {
      if (!value || value === "all") {
        params.delete(key);
      } else {
        params.set(key, value);
      }
    }
    startTransition(() => router.replace(`${pathname}?${params.toString()}`, { scroll: false }));
  }

  function removeSelectedNode() {
    if (!selectedNode) {
      return;
    }

    const nextHiddenNodeIds = new Set(hiddenNodeIds);
    nextHiddenNodeIds.add(selectedNode.id);

    updateParams({
      hidden: serializeHiddenNodeIds(nextHiddenNodeIds)
    });
  }

  return (
    <div className="grid min-h-[calc(100vh-3rem)] gap-4 lg:grid-cols-[230px_minmax(620px,1fr)_290px]">
      <aside className="order-2 rounded-md border border-line bg-white p-4 lg:order-none lg:min-h-[calc(100vh-3rem)]">
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="text-xs font-semibold uppercase tracking-[0.16em] text-ink/45">Snapshot</div>
            <h1 className="mt-1 text-xl font-semibold">Loop Topology</h1>
          </div>
          <span className="rounded-md border border-line px-2 py-1 text-xs font-semibold text-ink/60">
            {filteredGraph.nodes.length}/{graph.nodes.length} nodes
          </span>
        </div>

        <div className="mt-5 grid gap-3">
          <label className="text-xs font-semibold uppercase tracking-[0.14em] text-ink/45">
            Department
            <select
              className="mt-2 w-full rounded-md border border-line bg-white px-3 py-2 text-sm font-medium normal-case tracking-normal text-ink"
              value={activeFilter}
              onChange={(event) => updateParams({ department: event.target.value })}
            >
              <option value="all">All departments</option>
              {departmentOptions(graph.nodes).map((department) => (
                <option key={department.value} value={department.value}>
                  {department.label}
                </option>
              ))}
            </select>
          </label>
          <label className="text-xs font-semibold uppercase tracking-[0.14em] text-ink/45">
            Search
            <input
              className="mt-2 w-full rounded-md border border-line bg-white px-3 py-2 text-sm font-medium normal-case tracking-normal text-ink"
              onChange={(event) => updateParams({ q: event.target.value })}
              placeholder="Find loop, metric, owner"
              value={activeSearch}
            />
          </label>
          <label className="flex items-center justify-between rounded-md border border-line px-3 py-2 text-sm font-medium">
            Needs attention
            <input
              checked={attentionOnly}
              className="h-4 w-4 accent-ink"
              onChange={(event) => updateParams({ attention: event.target.checked ? "1" : undefined })}
              type="checkbox"
            />
          </label>
          {hiddenNodeIds.size > 0 ? (
            <button
              className="rounded-md border border-line px-3 py-2 text-left text-sm font-medium text-ink/70 hover:bg-paper hover:text-ink"
              data-testid="restore-hidden-nodes"
              onClick={() => updateParams({ hidden: undefined })}
              type="button"
            >
              Restore removed nodes ({hiddenNodeIds.size})
            </button>
          ) : null}
        </div>

        <div className="mt-6">
          <div className="text-xs font-semibold uppercase tracking-[0.16em] text-ink/45">Outline</div>
          <div className="mt-3 space-y-1">
            {filteredGraph.nodes
              .filter((node) => ["management_loop", "department", "loop"].includes(node.kind))
              .map((node) => (
                <button
                  className={`w-full rounded-md px-3 py-2 text-left text-sm ${
                    node.id === selectedNodeId
                      ? "bg-ink text-white"
                      : "text-ink/75 hover:bg-paper hover:text-ink"
                  }`}
                  key={node.id}
                  onClick={() => updateParams({ node: node.id })}
                  type="button"
                >
                  <span className="block font-medium">{node.label}</span>
                  <span className="mt-0.5 block truncate text-xs opacity-70">{node.subtitle}</span>
                </button>
              ))}
          </div>
        </div>

        <div className="mt-6 grid grid-cols-2 gap-2 text-xs">
          {legendItems.map((item) => (
            <div className="flex items-center gap-2 rounded-md border border-line px-2 py-2" key={item.label}>
              <span className="h-2.5 w-2.5 rounded-full" style={{ background: item.color }} />
              <span>{item.label}</span>
            </div>
          ))}
        </div>
      </aside>

      <section className="order-1 flex min-h-[680px] flex-col overflow-hidden rounded-md border border-line bg-white lg:order-none lg:min-h-[calc(100vh-3rem)]">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-4 py-3">
          <div>
            <div className="text-xs font-semibold uppercase tracking-[0.16em] text-ink/45">Canvas</div>
            <div className="text-lg font-semibold">Company Loopgraph</div>
          </div>
          <div className="flex items-center gap-2 text-xs text-ink/60">
            <span className="rounded-md border border-line px-2 py-1">Layered layout</span>
            <span className="rounded-md border border-line px-2 py-1">URL state</span>
            <span className="rounded-md border border-line px-2 py-1">{graph.sourceLabel ?? "Workspace"}</span>
            <span className="rounded-md border border-line px-2 py-1">{isPending ? "Syncing" : "Ready"}</span>
          </div>
        </div>
        <div className="min-h-0 flex-1">
          <ReactFlow
            edges={edges}
            elementsSelectable
            fitView
            fitViewOptions={{ padding: 0.16, maxZoom: 0.95 }}
            key={`${nodes.length}:${edges.length}:${activeFilter}:${activeSearch}:${attentionOnly}`}
            maxZoom={1.8}
            minZoom={0.2}
            nodes={nodes}
            nodesDraggable
            nodeTypes={nodeTypes}
            onNodeClick={(_, node) => updateParams({ node: node.id })}
            onNodesChange={handleNodesChange}
            proOptions={{ hideAttribution: true }}
          >
            <Background color="#e7e2d8" gap={22} size={1} />
            <Controls position="bottom-right" />
          </ReactFlow>
        </div>
        <TraceRail graph={filteredGraph} health={selectedHealth} node={selectedNode} />
      </section>

      <aside className="order-3 rounded-md border border-line bg-white p-4 lg:order-none lg:min-h-[calc(100vh-3rem)]">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="text-xs font-semibold uppercase tracking-[0.16em] text-ink/45">Inspector</div>
            <h2 className="mt-1 text-xl font-semibold">{selectedNode?.label ?? "Loopgraph"}</h2>
            <p className="mt-1 text-sm text-ink/60">{selectedNode?.subtitle ?? "Select a node to inspect it."}</p>
          </div>
          <span className="rounded-md border border-line px-2 py-1 text-xs font-semibold">
            {selectedNode?.kind.replace(/_/g, " ") ?? "node"}
          </span>
        </div>
        {selectedNode ? (
          <div className="mt-4 rounded-md border border-line bg-paper p-3">
            <button
              className="w-full rounded-md border border-line bg-white px-3 py-2 text-left text-sm font-semibold text-ink hover:border-ink"
              data-testid="remove-selected-node"
              onClick={removeSelectedNode}
              type="button"
            >
              Remove from topology
            </button>
            <p className="mt-2 text-xs leading-5 text-ink/55">
              Hides this node and its connected edges from the current view. The loop data is not deleted.
            </p>
          </div>
        ) : null}

        <InspectorBody health={selectedHealth} node={selectedNode} />
      </aside>
    </div>
  );
}

function TopologyNode({ data }: NodeProps<Node<TopologyNodeData>>) {
  const selected = data.selected;
  const isManagement = data.kind === "management_loop";
  return (
    <div
      className={`cursor-grab rounded-md border bg-white px-4 py-3 shadow-sm active:cursor-grabbing ${
        selected ? "border-ink ring-2 ring-ink/10" : "border-line"
      } ${isManagement ? "min-w-52 text-center" : "min-w-40"}`}
    >
      <Handle className="opacity-0" position={Position.Top} type="target" />
      <div className="flex items-start gap-3">
        <div
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md text-sm font-bold text-white"
          style={{ background: nodeColor(data.kind, data.department) }}
        >
          {nodeIcon(data)}
        </div>
        <div className={isManagement ? "mx-auto" : "min-w-0"}>
          <div className="text-sm font-semibold leading-5">{data.label}</div>
          {data.subtitle ? (
            <div className="mt-1 line-clamp-2 text-xs leading-4 text-ink/55">{data.subtitle}</div>
          ) : null}
          {typeof data.health === "number" ? (
            <div className="mt-2 inline-flex rounded-full bg-paper px-2 py-0.5 text-[11px] font-semibold text-ink/70">
              Health {data.health}
            </div>
          ) : null}
        </div>
      </div>
      <Handle className="opacity-0" position={Position.Bottom} type="source" />
    </div>
  );
}

function TraceRail({
  graph,
  health,
  node
}: {
  graph: LoopGraph;
  health?: LoopHealthSummary;
  node?: LoopGraphNode;
}) {
  const loopId = node?.metadata?.loopId as string | undefined;
  const relatedEdges = loopId
    ? graph.edges.filter((edge) => edge.source.includes(loopId) || edge.target.includes(loopId))
    : graph.edges.slice(0, 4);
  return (
    <div className="border-t border-line bg-paper/80 px-4 py-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="text-xs font-semibold uppercase tracking-[0.16em] text-ink/45">Trace</div>
          <div className="text-sm font-semibold">{node?.label ?? "Latest Run"} - topology context</div>
        </div>
        <div className="rounded-md border border-line bg-white px-3 py-2 text-sm font-semibold">
          Net saved {formatMinutes(health?.netTimeSavedMinutes ?? 0)}
        </div>
      </div>
      <div className="mt-3 grid gap-2 md:grid-cols-4">
        {relatedEdges.slice(0, 4).map((edge) => (
          <div className="rounded-md border border-line bg-white px-3 py-2 text-xs" key={edge.id}>
            <div className="font-semibold capitalize">{edge.kind.replace(/_/g, " ")}</div>
            <div className="mt-1 text-ink/55">{edge.label ?? "relationship"}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

function InspectorBody({
  health,
  node
}: {
  health?: LoopHealthSummary;
  node?: LoopGraphNode;
}) {
  const source = node?.metadata?.source as string | undefined;
  const sourcePath = node?.metadata?.sourcePath as string | undefined;
  const runtimeLevel = node?.metadata?.runtimeLevel as string | undefined;
  const dataSources = (node?.metadata?.dataSources as string[] | undefined) ?? [];
  const owners = (node?.metadata?.owners as string[] | undefined) ?? [];
  const metrics = (node?.metadata?.metrics as string[] | undefined) ?? [];

  return (
    <div className="mt-4 space-y-4">
      {source || runtimeLevel || sourcePath ? (
        <div className="rounded-md border border-line p-3">
          <div className="text-xs font-semibold uppercase tracking-[0.14em] text-ink/45">Source</div>
          <div className="mt-2 grid gap-2 text-xs text-ink/65">
            {source ? <InspectorLine label="Origin" value={source.replace(/_/g, " ")} /> : null}
            {runtimeLevel ? <InspectorLine label="Template" value={runtimeLevel.replace(/_/g, " ")} /> : null}
            {sourcePath ? <InspectorLine label="Spec path" value={sourcePath} /> : null}
          </div>
        </div>
      ) : null}
      <div className="grid grid-cols-2 gap-3">
        <InspectorMetric label="Health" value={`${health?.healthScore ?? node?.health ?? 72}`} />
        <InspectorMetric label="Open Reviews" value={`${health?.openReviews ?? node?.metadata?.openReviews ?? 0}`} />
        <InspectorMetric label="Net Saved" value={formatMinutes(health?.netTimeSavedMinutes ?? 0)} />
        <InspectorMetric label="Botsitting" value={formatMinutes(health?.botsittingMinutes ?? 0)} />
      </div>
      <div className="rounded-md border border-line p-3">
        <div className="text-xs font-semibold uppercase tracking-[0.14em] text-ink/45">Connections</div>
        <div className="mt-2 grid gap-2 text-sm leading-6 text-ink/70">
          <InspectorLine label="Data" value={dataSources.slice(0, 4).join(", ") || "Not defined"} />
          <InspectorLine label="Owners" value={owners.slice(0, 3).join(", ") || "Not defined"} />
          <InspectorLine label="Metrics" value={metrics.slice(0, 3).join(", ") || "Not defined"} />
        </div>
      </div>
      <div className="rounded-md border border-line p-3">
        <div className="text-xs font-semibold uppercase tracking-[0.14em] text-ink/45">Human Review</div>
        <div className="mt-2 text-sm leading-6 text-ink/70">
          Pending judgment, rejected output, or edited output becomes an improvement item so the loop can learn from traces.
        </div>
      </div>
      <div className="rounded-md border border-line p-3">
        <div className="text-xs font-semibold uppercase tracking-[0.14em] text-ink/45">Measurement</div>
        <div className="mt-2 text-sm leading-6 text-ink/70">
          Net value subtracts review, rework, escalation, governance, and botsitting before claiming saved time.
        </div>
      </div>
    </div>
  );
}

function InspectorLine({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <span className="font-semibold text-ink">{label}:</span>{" "}
      <span className="break-words">{value}</span>
    </div>
  );
}

function InspectorMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-line bg-paper px-3 py-3">
      <div className="text-xs text-ink/50">{label}</div>
      <div className="mt-1 text-lg font-semibold">{value}</div>
    </div>
  );
}

function filterGraph(
  graph: LoopGraph,
  department: string,
  attentionOnly: boolean,
  search: string,
  selectedNodeId?: string
): LoopGraph {
  const selectedLoopId = selectedNodeId?.startsWith("loop:")
    ? selectedNodeId.replace("loop:", "")
    : undefined;
  const attentionLoopIds = new Set(
    graph.health
      .filter((item) => item.healthScore < 78 || item.openReviews > 0 || item.openImprovements > 0)
      .map((item) => item.loopId)
  );
  const nodes = graph.nodes.filter((node) => {
    const isCore = ["organization", "management_loop", "department", "loop"].includes(node.kind);
    const isAlwaysVisible = ["organization", "management_loop"].includes(node.kind);
    const nodeLoopId = node.metadata?.loopId as string | undefined;
    const isSelectedContext =
      Boolean(selectedLoopId) &&
      (nodeLoopId === selectedLoopId ||
        graph.edges.some((edge) => {
          const selectedEdgeSource = edge.source === `loop:${selectedLoopId}`;
          const selectedEdgeTarget = edge.target === `loop:${selectedLoopId}`;
          return (
            (selectedEdgeSource && edge.target === node.id) ||
            (selectedEdgeTarget && edge.source === node.id)
          );
        }));
    const matchesDepartment =
      department === "all" || node.department === department || isAlwaysVisible || isSelectedContext;
    const matchesAttention = !attentionOnly || isAlwaysVisible || (nodeLoopId && attentionLoopIds.has(nodeLoopId));
    const normalizedSearch = search.trim().toLowerCase();
    const matchesSearch =
      normalizedSearch.length === 0 ||
      isAlwaysVisible ||
      isSelectedContext ||
      `${node.label} ${node.subtitle ?? ""} ${node.department ?? ""}`.toLowerCase().includes(normalizedSearch);
    return (isCore || isSelectedContext) && matchesDepartment && matchesAttention && matchesSearch;
  });
  const nodeIds = new Set(nodes.map((node) => node.id));
  const edges = graph.edges.filter((edge) => nodeIds.has(edge.source) && nodeIds.has(edge.target));

  return {
    ...graph,
    nodes,
    edges
  };
}

function hideGraphNodes(graph: LoopGraph, hiddenNodeIds: Set<string>): LoopGraph {
  if (hiddenNodeIds.size === 0) {
    return graph;
  }

  const nodes = graph.nodes.filter((node) => !hiddenNodeIds.has(node.id));
  const visibleNodeIds = new Set(nodes.map((node) => node.id));
  const edges = graph.edges.filter(
    (edge) =>
      visibleNodeIds.has(edge.source) &&
      visibleNodeIds.has(edge.target) &&
      !hiddenNodeIds.has(edge.source) &&
      !hiddenNodeIds.has(edge.target)
  );

  return {
    ...graph,
    nodes,
    edges
  };
}

function serializeHiddenNodeIds(hiddenNodeIds: Set<string>) {
  return Array.from(hiddenNodeIds).sort().join(",");
}

function positionTopology(nodes: LoopGraphNode[], selectedNodeId?: string) {
  const loopNodes = nodes.filter((node) => node.kind === "loop");
  const management = nodes.find((node) => node.kind === "management_loop");
  if (!management || loopNodes.length === 0 || nodes.length > 24) {
    return null;
  }

  const selectedLoopNode = nodes.find(
    (node) => node.id === selectedNodeId && node.kind === "loop"
  );
  const contextNodes = nodes.filter((node) => !["loop", "management_loop"].includes(node.kind));
  const dataSources = contextNodes.filter((node) => node.kind === "data_source");
  const humanOwners = contextNodes.filter((node) => node.kind === "human_owner");
  const departments = contextNodes.filter((node) => node.kind === "department");
  const reviews = contextNodes.filter((node) => node.kind === "review");
  const metrics = contextNodes.filter((node) => node.kind === "metric");
  const improvements = contextNodes.filter((node) => node.kind === "improvement");
  const otherContext = contextNodes.filter(
    (node) =>
      !["data_source", "human_owner", "department", "review", "metric", "improvement"].includes(node.kind)
  );
  const loopSlots: Record<string, { x: number; y: number }> = {
    marketing: { x: 110, y: 250 },
    sales: { x: 420, y: 250 },
    product: { x: 730, y: 250 },
    legal_security: { x: 110, y: 410 },
    customer_success: { x: 890, y: 410 },
    hr: { x: 110, y: 570 },
    operations_finance: { x: 420, y: 570 },
    engineering: { x: 730, y: 570 }
  };
  const departmentOrder = Object.keys(loopSlots);
  const loopSlotCounts: Record<string, number> = {};
  let fallbackSlot = 0;
  const positions: Record<string, { x: number; y: number }> = {
    [management.id]: { x: 500, y: 410 }
  };

  [...loopNodes].sort(sortByDepartment(departmentOrder)).forEach((node) => {
    const department = String(node.department ?? "unknown");
    const baseSlot = loopSlots[department];
    if (!baseSlot) {
      const column = fallbackSlot % 3;
      const row = Math.floor(fallbackSlot / 3);
      fallbackSlot += 1;
      positions[node.id] = {
        x: 160 + column * 310,
        y: 250 + row * 160
      };
      return;
    }

    const slotIndex = loopSlotCounts[department] ?? 0;
    loopSlotCounts[department] = slotIndex + 1;
    positions[node.id] = {
      x: baseSlot.x + slotIndex * 34,
      y: baseSlot.y + slotIndex * 104
    };
  });

  const selectedAnchor = selectedLoopNode
    ? positions[selectedLoopNode.id]
    : positions[loopNodes[0]?.id] ?? positions[management.id];
  const contextCenterX = clamp(selectedAnchor.x + 110, 220, 900);

  placeRow(positions, dataSources, {
    centerX: contextCenterX,
    gap: 180,
    minX: 20,
    y: 20
  });
  placeRow(positions, [...departments, ...humanOwners], {
    centerX: contextCenterX,
    gap: 230,
    minX: 20,
    y: 135
  });
  placeRow(positions, reviews, {
    centerX: 580,
    gap: 300,
    minX: 160,
    y: 735
  });
  placeRow(positions, [...metrics, ...improvements], {
    centerX: 580,
    gap: 320,
    minX: 160,
    y: 840
  });
  placeRow(positions, otherContext, {
    centerX: 580,
    gap: 210,
    minX: 160,
    y: 945
  });

  return positions;
}

function sortByDepartment(departmentOrder: string[]) {
  return (left: LoopGraphNode, right: LoopGraphNode) => {
    const leftIndex = departmentOrder.indexOf(String(left.department ?? ""));
    const rightIndex = departmentOrder.indexOf(String(right.department ?? ""));
    const normalizedLeftIndex = leftIndex === -1 ? departmentOrder.length : leftIndex;
    const normalizedRightIndex = rightIndex === -1 ? departmentOrder.length : rightIndex;

    if (normalizedLeftIndex !== normalizedRightIndex) {
      return normalizedLeftIndex - normalizedRightIndex;
    }

    return left.label.localeCompare(right.label);
  };
}

function placeRow(
  positions: Record<string, { x: number; y: number }>,
  nodes: LoopGraphNode[],
  options: {
    centerX: number;
    gap: number;
    minX: number;
    y: number;
  }
) {
  const startX = options.centerX - ((nodes.length - 1) * options.gap) / 2;

  nodes.forEach((node, index) => {
    positions[node.id] = {
      x: Math.max(options.minX, startX + index * options.gap),
      y: options.y
    };
  });
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

function toFlowEdges(edges: LoopGraphEdge[]): Edge[] {
  return edges.map<Edge>((edge) => ({
    id: edge.id,
    source: edge.source,
    target: edge.target,
    label: edge.label,
    animated: edge.kind === "improves" || edge.kind === "escalates_to",
    type: "smoothstep",
    className: `loopgraph-edge loopgraph-edge-${edge.kind}`,
    style: {
      stroke: edgeColor(edge.kind),
      strokeWidth: edge.kind === "rolls_up_to" ? 2.5 : 1.8
    },
    labelStyle: {
      fill: "#5f5b53",
      fontSize: 10,
      fontWeight: 600
    }
  }));
}

function departmentOptions(nodes: LoopGraphNode[]) {
  const departments = Array.from(new Set(nodes.map((node) => node.department).filter(Boolean)));
  return departments.map((department) => ({
    value: String(department),
    label: String(department).replace(/_/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase())
  }));
}

function nodeColor(kind: LoopGraphNodeKind, department?: string) {
  if (kind === "management_loop") return "#111111";
  if (kind === "review") return "#2563eb";
  if (kind === "improvement") return "#7c3aed";
  if (kind === "data_source") return "#6f6a60";
  if (kind === "human_owner") return "#d97706";
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

function edgeColor(kind: LoopGraphEdge["kind"]) {
  if (kind === "escalates_to") return "#2563eb";
  if (kind === "improves") return "#7c3aed";
  if (kind === "data_flow") return "#9a948a";
  if (kind === "owned_by") return "#d97706";
  if (kind === "measured_by") return "#16a34a";
  return "#111111";
}

function nodeIcon(node: LoopGraphNode) {
  if (node.kind === "management_loop") return "M";
  if (node.kind === "review") return "R";
  if (node.kind === "improvement") return "I";
  if (node.kind === "data_source") return "D";
  if (node.kind === "human_owner") return "H";
  return node.label.slice(0, 1);
}

function formatMinutes(minutes: number) {
  if (minutes < 60) return `${minutes}m`;
  return `${Math.round((minutes / 60) * 10) / 10}h`;
}

const legendItems = [
  { label: "Rollup", color: "#111111" },
  { label: "Review", color: "#2563eb" },
  { label: "Improve", color: "#7c3aed" },
  { label: "Data", color: "#9a948a" }
];
