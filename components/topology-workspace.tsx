"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState, useTransition } from "react";
import { LoopGraphView } from "@/components/loop-graph-view";
import { buildTopologyVisualGraph } from "@/lib/loop-engineering-builder/loop-graph-visualization";
import type {
  LoopGraph,
  LoopGraphNode,
  LoopHealthSummary
} from "@/lib/loop-engineering-builder/types";

type TopologyWorkspaceProps = {
  graph: LoopGraph;
};

export function TopologyWorkspace({ graph }: TopologyWorkspaceProps) {
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const [isPending, startTransition] = useTransition();
  const requestedSelectedNodeId =
    searchParams.get("node") ?? graph.view.selectedNodeId ?? graph.nodes[0]?.id;
  const [localSelectedNodeId, setLocalSelectedNodeId] = useState(requestedSelectedNodeId);
  const hiddenParam = searchParams.get("hidden") ?? "";
  const hiddenNodeIds = useMemo(
    () => new Set(hiddenParam.split(",").filter(Boolean)),
    [hiddenParam]
  );
  const activeFilter = searchParams.get("department") ?? "all";
  const activeSearch = searchParams.get("q") ?? "";
  const attentionOnly = searchParams.get("attention") === "1";
  const filteredGraphBase = useMemo(
    () => filterGraph(graph, activeFilter, attentionOnly, activeSearch, localSelectedNodeId),
    [activeFilter, activeSearch, attentionOnly, graph, localSelectedNodeId]
  );
  const filteredGraph = useMemo(
    () => hideGraphNodes(filteredGraphBase, hiddenNodeIds),
    [filteredGraphBase, hiddenNodeIds]
  );
  const selectedNode =
    filteredGraph.nodes.find((node) => node.id === localSelectedNodeId) ??
    filteredGraph.nodes[0] ??
    graph.nodes[0];
  const selectedNodeId = selectedNode?.id;
  const selectedHealth = selectedNode?.metadata?.loopId
    ? graph.health.find((item) => item.loopId === selectedNode.metadata?.loopId)
    : graph.health[0];
  const visualGraph = useMemo(
    () => ({
      ...buildTopologyVisualGraph(filteredGraph),
      selectedNodeId
    }),
    [filteredGraph, selectedNodeId]
  );

  useEffect(() => {
    setLocalSelectedNodeId(requestedSelectedNodeId);
  }, [requestedSelectedNodeId]);

  function updateParams(next: Record<string, string | undefined>) {
    const params = new URLSearchParams(
      typeof window === "undefined" ? searchParams.toString() : window.location.search
    );
    for (const [key, value] of Object.entries(next)) {
      if (!value || value === "all") {
        params.delete(key);
      } else {
        params.set(key, value);
      }
    }
    const nextUrl = params.toString() ? `${pathname}?${params.toString()}` : pathname;
    const keys = Object.keys(next);

    if (Object.prototype.hasOwnProperty.call(next, "node")) {
      setLocalSelectedNodeId(next.node ?? graph.view.selectedNodeId ?? graph.nodes[0]?.id);
    }

    if (keys.length === 1 && keys[0] === "node" && typeof window !== "undefined") {
      window.history.replaceState(window.history.state, "", nextUrl);
      return;
    }

    startTransition(() => router.replace(nextUrl, { scroll: false }));
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
    <div className="grid gap-4 lg:min-h-0 lg:flex-1 lg:grid-cols-[220px_minmax(0,1fr)_280px] lg:overflow-hidden 2xl:grid-cols-[230px_minmax(620px,1fr)_290px]">
      <aside className="order-2 flex flex-col rounded-md border border-line bg-white p-4 lg:order-none lg:h-full lg:min-h-0 lg:overflow-hidden">
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

        <div className="mt-6 min-h-0 lg:flex-1 lg:overflow-y-auto lg:pr-1">
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

        <div className="mt-6 grid shrink-0 grid-cols-2 gap-2 text-xs">
          {legendItems.map((item) => (
            <div className="flex items-center gap-2 rounded-md border border-line px-2 py-2" key={item.label}>
              <span className="h-2.5 w-2.5 rounded-full" style={{ background: item.color }} />
              <span>{item.label}</span>
            </div>
          ))}
        </div>
      </aside>

      <section className="order-1 flex min-h-[680px] flex-col overflow-hidden rounded-md border border-line bg-white lg:order-none lg:h-full lg:min-h-0">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-4 py-3">
          <div>
            <div className="text-xs font-semibold uppercase tracking-[0.16em] text-ink/45">Canvas</div>
            <div className="text-lg font-semibold">Company Loopgraph</div>
          </div>
          <div className="flex items-center gap-2 text-xs text-ink/60">
            <span className="rounded-md border border-line px-2 py-1">Interactive graph</span>
            <span className="rounded-md border border-line px-2 py-1">URL state</span>
            <span className="rounded-md border border-line px-2 py-1">{graph.sourceLabel ?? "Workspace"}</span>
            <span className="rounded-md border border-line px-2 py-1">{isPending ? "Syncing" : "Ready"}</span>
          </div>
        </div>
        <div className="min-h-0 flex-1">
          <LoopGraphView
            className="h-full"
            graph={visualGraph}
            onSelectNode={(nodeId) => updateParams({ node: nodeId })}
            selectedNodeId={selectedNodeId}
            showToggles
            variant="topology"
          />
        </div>
        <TraceRail graph={filteredGraph} health={selectedHealth} node={selectedNode} />
      </section>

      <aside className="order-3 rounded-md border border-line bg-white p-4 lg:order-none lg:h-full lg:min-h-0 lg:overflow-y-auto">
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
  const normalizedSearch = search.trim().toLowerCase();
  const attentionLoopIds = new Set(
    graph.health
      .filter((item) => item.healthScore < 78 || item.openReviews > 0 || item.openImprovements > 0)
      .map((item) => item.loopId)
  );
  const coreNodes = graph.nodes.filter((node) => {
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
    const matchesSearch =
      normalizedSearch.length === 0 ||
      isAlwaysVisible ||
      isSelectedContext ||
      `${node.label} ${node.subtitle ?? ""} ${node.department ?? ""}`.toLowerCase().includes(normalizedSearch);
    return isCore && matchesDepartment && matchesAttention && matchesSearch;
  });
  const coreNodeIds = new Set(coreNodes.map((node) => node.id));
  const visibleLoopNodeIds = new Set(
    coreNodes
      .filter((node) => ["loop", "management_loop"].includes(node.kind) && node.metadata?.loopId)
      .map((node) => node.id)
  );
  const contextNodeIds = new Set<string>();
  for (const edge of graph.edges) {
    if (visibleLoopNodeIds.has(edge.source)) {
      contextNodeIds.add(edge.target);
    }
    if (visibleLoopNodeIds.has(edge.target)) {
      contextNodeIds.add(edge.source);
    }
  }
  const nodes = graph.nodes.filter((node) => coreNodeIds.has(node.id) || contextNodeIds.has(node.id));
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

function departmentOptions(nodes: LoopGraphNode[]) {
  const departments = Array.from(new Set(nodes.map((node) => node.department).filter(Boolean)));
  return departments.map((department) => ({
    value: String(department),
    label: String(department).replace(/_/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase())
  }));
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
