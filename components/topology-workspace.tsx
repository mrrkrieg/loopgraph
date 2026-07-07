"use client";

import { usePathname, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { LoopGraphView } from "@/components/loop-graph-view";
import { buildSemanticTopologyVisualGraph } from "@/lib/loop-engineering-builder/loop-graph-visualization";
import {
  buildLoopEgoGraph,
  getVisibleTopology,
  type LoopEgoGraph,
  type SemanticTopology,
  type TopologyEdge,
  type TopologyLayer,
  type TopologyNode,
  type TopologyVisibilityMode
} from "@/lib/loopgraph-core/graph";

type TopologyWorkspaceProps = {
  topology: SemanticTopology;
};

type LayerState = Record<TopologyLayer, boolean>;
type TopologyUrlState = {
  nodeId: string;
  mode: TopologyVisibilityMode;
  department: string;
  search: string;
  attentionOnly: boolean;
  showDrafts: boolean;
  hidden: string;
};

const companyLayerDefaults: LayerState = {
  structure: true,
  data: false,
  action: false,
  verification: false,
  human: false,
  measurement: false,
  runtime: false,
  memory: false
};

const selectedLayerDefaults: LayerState = {
  structure: true,
  data: true,
  action: true,
  verification: true,
  human: true,
  measurement: true,
  runtime: false,
  memory: true
};

const brainLayerDefaults: LayerState = {
  structure: true,
  data: true,
  action: true,
  verification: true,
  human: true,
  measurement: true,
  runtime: false,
  memory: true
};

const layerOptions: Array<{ layer: TopologyLayer; label: string }> = [
  { layer: "data", label: "Data" },
  { layer: "action", label: "Actions" },
  { layer: "verification", label: "Checks" },
  { layer: "human", label: "People" },
  { layer: "measurement", label: "Metrics" },
  { layer: "runtime", label: "Runtime" }
];

export function TopologyWorkspace({ topology }: TopologyWorkspaceProps) {
  const searchParams = useSearchParams();
  const pathname = usePathname();
  const searchParamString = searchParams.toString();
  const [urlState, setUrlState] = useState<TopologyUrlState>(() =>
    createTopologyUrlState(searchParams, topology)
  );
  const [companyLayers, setCompanyLayers] = useState<LayerState>(companyLayerDefaults);
  const [selectedLayers, setSelectedLayers] = useState<LayerState>(selectedLayerDefaults);
  const [brainLayers, setBrainLayers] = useState<LayerState>(brainLayerDefaults);

  useEffect(() => {
    setUrlState(createTopologyUrlState(new URLSearchParams(searchParamString), topology));
  }, [searchParamString, topology]);

  const hiddenNodeIds = useMemo(
    () => new Set(urlState.hidden.split(",").filter(Boolean)),
    [urlState.hidden]
  );
  const activeMode = urlState.mode;
  const activeFilter = urlState.department;
  const activeSearch = urlState.search;
  const attentionOnly = urlState.attentionOnly;
  const showDrafts = urlState.showDrafts;
  const isBrainMode = activeMode === "brain-map";
  const selectedNode =
    findTopologyNode(topology.nodes, urlState.nodeId) ??
    findTopologyNode(topology.nodes, topology.managementLoopId) ??
    topology.nodes[0];
  const selectedLoopId = selectedNode?.loopId ?? topology.selectedLoopId;
  const selectedLoopNode = selectedLoopId
    ? findLoopTopologyNode(topology.nodes, selectedLoopId)
    : selectedNode && isLoopNode(selectedNode)
      ? selectedNode
      : undefined;
  const selectedFocusIsWorkflow = selectedLoopNode ? isWorkflowLoopNode(selectedLoopNode) : false;
  const activeLayers = activeMode === "brain-map"
    ? brainLayers
    : activeMode === "selected-loop"
      ? selectedFocusIsWorkflow
        ? selectedLayers
        : companyLayerDefaults
      : companyLayers;
  const semanticGraph = useMemo(() => {
    if (activeMode === "selected-loop" && selectedLoopId) {
      return buildLoopEgoGraph({
        topology,
        loopId: selectedLoopId,
        depth: selectedFocusIsWorkflow ? 2 : 1,
        enabledLayers: activeLayers
      });
    }

    return getVisibleTopology(topology, {
      mode: activeMode,
      department: activeFilter,
      search: activeSearch,
      attentionOnly,
      showOrphans: showDrafts,
      selectedLoopId,
      enabledLayers: activeLayers
    });
  }, [
    activeFilter,
    activeLayers,
    activeMode,
    activeSearch,
    attentionOnly,
    selectedLoopId,
    selectedFocusIsWorkflow,
    showDrafts,
    topology
  ]);
  const displayGraph = useMemo(
    () => hideSemanticNodes(semanticGraph, hiddenNodeIds),
    [hiddenNodeIds, semanticGraph]
  );
  const displayNodeIds = useMemo(
    () => new Set(displayGraph.nodes.map((node) => node.id)),
    [displayGraph.nodes]
  );
  const selectedGraphNode =
    displayGraph.nodes.find((node) => node.id === urlState.nodeId) ??
    displayGraph.nodes.find((node) => node.loopId === selectedLoopId) ??
    displayGraph.nodes[0];
  const selectedNodeId = selectedGraphNode?.id;
  const visualGraph = useMemo(
    () => ({
      ...buildSemanticTopologyVisualGraph(displayGraph, {
        includeWorkflowTriggers: activeMode === "brain-map"
      }),
      layoutMode: activeMode === "brain-map" ? "brain-map" as const : undefined,
      selectedNodeId
    }),
    [activeMode, displayGraph, selectedNodeId]
  );

  function updateParams(next: Record<string, string | undefined>) {
    setUrlState((current) => applyTopologyUrlPatch(current, next, topology));
    replaceTopologyParams(pathname, next);
  }

  function toggleLayer(layer: TopologyLayer) {
    const setLayers = activeMode === "brain-map"
      ? setBrainLayers
      : activeMode === "selected-loop"
        ? setSelectedLayers
        : setCompanyLayers;
    setLayers((current) => ({
      ...current,
      [layer]: !current[layer]
    }));
  }

  function selectNode(nodeId: string) {
    const nextNode = topology.nodes.find((node) => node.id === nodeId);
    updateParams({
      node: nodeId,
      view: activeMode === "brain-map"
        ? "brain-map"
        : nextNode?.isExpandable
          ? "selected-loop"
          : activeMode
    });
  }

  function hideSelectedNode() {
    if (!selectedNodeId) {
      return;
    }
    const nextHiddenIds = new Set(hiddenNodeIds);
    nextHiddenIds.add(selectedNodeId);
    updateParams({ hidden: Array.from(nextHiddenIds).sort().join(",") });
  }

  return (
    <div
      className={`grid gap-4 lg:h-[calc(100vh-7rem)] lg:min-h-[720px] lg:overflow-hidden ${
        isBrainMode
          ? "lg:grid-cols-[250px_minmax(0,1fr)] 2xl:grid-cols-[280px_minmax(900px,1fr)]"
          : "lg:grid-cols-[250px_minmax(0,1fr)_310px] 2xl:grid-cols-[280px_minmax(760px,1fr)_330px]"
      }`}
    >
      <aside className="order-2 flex min-h-0 flex-col rounded-md border border-line bg-white p-4 lg:order-none lg:h-full lg:overflow-hidden">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="text-xs font-semibold uppercase tracking-[0.16em] text-ink/45">Semantic graph</div>
            <h1 className="mt-1 text-xl font-semibold">Loop Topology</h1>
          </div>
          <span className="rounded-md border border-line px-2 py-1 text-xs font-semibold text-ink/60">
            {displayGraph.nodes.length}/{topology.nodes.length}
          </span>
        </div>

        <div className="mt-4 grid gap-3">
          <ViewModeControl mode={activeMode} onChange={(mode) => updateParams({ view: mode })} />
          <label className="text-xs font-semibold uppercase tracking-[0.14em] text-ink/45">
            Department
            <select
              className="mt-2 w-full rounded-md border border-line bg-white px-3 py-2 text-sm font-medium normal-case tracking-normal text-ink"
              value={activeFilter}
              onChange={(event) => updateParams({ department: event.target.value })}
            >
              <option value="all">All departments</option>
              {departmentOptions(topology.nodes).map((department) => (
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
          <div className="grid grid-cols-2 gap-2">
            <ToggleButton
              active={attentionOnly}
              label="Attention"
              onClick={() => updateParams({ attention: attentionOnly ? undefined : "1" })}
            />
            <ToggleButton
              active={showDrafts}
              label={`Drafts ${topology.orphanNodes.length}`}
              onClick={() => updateParams({ drafts: showDrafts ? undefined : "1" })}
            />
          </div>
        </div>

        <div className="mt-5">
          <div className="text-xs font-semibold uppercase tracking-[0.16em] text-ink/45">Layers</div>
          <div className="mt-2 grid grid-cols-2 gap-2">
            {layerOptions.map((option) => (
              <ToggleButton
                active={activeLayers[option.layer]}
                disabled={activeMode === "selected-loop" && !selectedFocusIsWorkflow}
                key={option.layer}
                label={`${option.label} ${topology.filterCounts.byLayer[option.layer]}`}
                onClick={() => toggleLayer(option.layer)}
              />
            ))}
          </div>
        </div>

        {hiddenNodeIds.size > 0 ? (
          <button
            className="mt-4 rounded-md border border-line px-3 py-2 text-left text-sm font-medium text-ink/70 hover:bg-paper hover:text-ink"
            data-testid="restore-hidden-nodes"
            onClick={() => updateParams({ hidden: undefined })}
            type="button"
          >
            Restore hidden nodes ({hiddenNodeIds.size})
          </button>
        ) : null}

        <div className="mt-5 min-h-0 flex-1 overflow-y-auto pr-1">
          <div className="text-xs font-semibold uppercase tracking-[0.16em] text-ink/45">Loops</div>
          <div className="mt-3 space-y-1">
            {topology.nodes
              .filter((node) => isLoopNode(node) && (!node.isOrphan || showDrafts))
              .sort(sortLoopNodes)
              .map((node) => (
                <button
                  className={`w-full rounded-md px-3 py-2 text-left text-sm ${
                    node.id === selectedNodeId
                      ? "bg-ink text-white"
                      : displayNodeIds.has(node.id)
                        ? "text-ink/75 hover:bg-paper hover:text-ink"
                        : "text-ink/35 hover:bg-paper hover:text-ink/70"
                  }`}
                  key={node.id}
                  onClick={() => selectNode(node.id)}
                  type="button"
                >
                  <span className="block font-medium">{node.label}</span>
                  <span className="mt-0.5 block truncate text-xs opacity-70">
                    {node.department ? titleize(node.department) : node.type.replace(/_/g, " ")}
                  </span>
                </button>
              ))}
          </div>
        </div>
      </aside>

      <section className="order-1 flex min-h-[680px] flex-col overflow-hidden rounded-md border border-line bg-white lg:order-none lg:h-full lg:min-h-0">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-4 py-3">
          <div>
            <div className="text-xs font-semibold uppercase tracking-[0.16em] text-ink/45">
              {activeMode === "brain-map"
                ? "Company brain"
                : activeMode === "selected-loop"
                  ? "Selected loop"
                  : "Company topology"}
            </div>
            <div className="text-lg font-semibold">{selectedGraphNode?.label ?? "Company Loopgraph"}</div>
            <Breadcrumbs graph={displayGraph} />
          </div>
          <div className="flex items-center gap-2 text-xs text-ink/60">
            <span className="rounded-md border border-line px-2 py-1">{topology.metadata.sourceLabel}</span>
            <span className="rounded-md border border-line px-2 py-1">Ready</span>
          </div>
        </div>
        <div className="min-h-[420px] flex-1 lg:min-h-0">
          <LoopGraphView
            className="h-full"
            graph={visualGraph}
            onSelectNode={selectNode}
            selectedNodeId={selectedNodeId}
            showToggles={false}
            variant="topology"
          />
        </div>
        {isBrainMode ? null : (
          <TraceRail edges={displayGraph.edges} node={selectedGraphNode} nodes={displayGraph.nodes} />
        )}
      </section>

      {isBrainMode ? null : (
      <aside className="order-3 rounded-md border border-line bg-white p-4 lg:order-none lg:h-full lg:min-h-0 lg:overflow-y-auto">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="text-xs font-semibold uppercase tracking-[0.16em] text-ink/45">Inspector</div>
            <h2 className="mt-1 text-xl font-semibold">{selectedGraphNode?.label ?? "Loopgraph"}</h2>
            <p className="mt-1 text-sm text-ink/60">
              {selectedGraphNode?.subtitle ?? "Select a loop or related node to inspect it."}
            </p>
          </div>
          <span className="rounded-md border border-line px-2 py-1 text-xs font-semibold">
            {selectedGraphNode?.type.replace(/_/g, " ") ?? "node"}
          </span>
        </div>

        {selectedGraphNode ? (
          <div className="mt-4 rounded-md border border-line bg-paper p-3">
            <button
              className="w-full rounded-md border border-line bg-white px-3 py-2 text-left text-sm font-semibold text-ink hover:border-ink"
              data-testid="remove-selected-node"
              onClick={hideSelectedNode}
              type="button"
            >
              Hide from current view
            </button>
            <p className="mt-2 text-xs leading-5 text-ink/55">
              This only hides the node on the canvas. The LoopSpec and runtime records stay intact.
            </p>
          </div>
        ) : null}

        <InspectorBody
          edges={displayGraph.edges}
          node={selectedGraphNode}
          topology={topology}
        />
      </aside>
      )}
    </div>
  );
}

function createTopologyUrlState(
  searchParams: Pick<URLSearchParams, "get">,
  topology: SemanticTopology
): TopologyUrlState {
  return {
    nodeId: searchParams.get("node") ??
      (topology.selectedLoopId ? `loop:${topology.selectedLoopId}` : topology.managementLoopId),
    mode: normalizeMode(searchParams.get("view")),
    department: searchParams.get("department") ?? "all",
    search: searchParams.get("q") ?? "",
    attentionOnly: searchParams.get("attention") === "1",
    showDrafts: searchParams.get("drafts") === "1",
    hidden: searchParams.get("hidden") ?? ""
  };
}

function applyTopologyUrlPatch(
  current: TopologyUrlState,
  next: Record<string, string | undefined>,
  topology: SemanticTopology
): TopologyUrlState {
  return {
    nodeId: Object.prototype.hasOwnProperty.call(next, "node")
      ? next.node ?? topology.managementLoopId
      : current.nodeId,
    mode: Object.prototype.hasOwnProperty.call(next, "view")
      ? normalizeMode(next.view ?? null)
      : current.mode,
    department: Object.prototype.hasOwnProperty.call(next, "department")
      ? next.department ?? "all"
      : current.department,
    search: Object.prototype.hasOwnProperty.call(next, "q")
      ? next.q ?? ""
      : current.search,
    attentionOnly: Object.prototype.hasOwnProperty.call(next, "attention")
      ? next.attention === "1"
      : current.attentionOnly,
    showDrafts: Object.prototype.hasOwnProperty.call(next, "drafts")
      ? next.drafts === "1"
      : current.showDrafts,
    hidden: Object.prototype.hasOwnProperty.call(next, "hidden")
      ? next.hidden ?? ""
      : current.hidden
  };
}

function replaceTopologyParams(pathname: string, next: Record<string, string | undefined>) {
  if (typeof window === "undefined") {
    return;
  }

  const params = new URLSearchParams(window.location.search);
  for (const [key, value] of Object.entries(next)) {
    if (!value || value === "all" || (key === "view" && value === "company")) {
      params.delete(key);
    } else {
      params.set(key, value);
    }
  }

  const nextUrl = params.toString() ? `${pathname}?${params.toString()}` : pathname;
  window.history.replaceState(window.history.state, "", nextUrl);
}

function ViewModeControl({
  mode,
  onChange
}: {
  mode: TopologyVisibilityMode;
  onChange: (mode: TopologyVisibilityMode) => void;
}) {
  const modes: Array<{ value: TopologyVisibilityMode; label: string }> = [
    { value: "company", label: "Org" },
    { value: "selected-loop", label: "Loop" },
    { value: "brain-map", label: "Brain" },
    { value: "department-map", label: "Dept" },
    { value: "runtime-trace-map", label: "Trace" }
  ];

  return (
    <div className="grid grid-cols-5 gap-1 rounded-md border border-line bg-paper p-1">
      {modes.map((item) => (
        <button
          className={`min-w-0 rounded px-1.5 py-1.5 text-center text-xs font-semibold ${
            mode === item.value ? "bg-white text-ink shadow-sm" : "text-ink/55 hover:text-ink"
          }`}
          key={item.value}
          onClick={() => onChange(item.value)}
          type="button"
        >
          {item.label}
        </button>
      ))}
    </div>
  );
}

function ToggleButton({
  active,
  disabled,
  label,
  onClick
}: {
  active: boolean;
  disabled?: boolean;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      aria-pressed={active}
      className={`rounded-md border px-2 py-2 text-left text-xs font-semibold disabled:cursor-not-allowed disabled:opacity-45 ${
        active
          ? "border-ink bg-ink text-white"
          : disabled
            ? "border-line bg-white text-ink/45"
            : "border-line bg-white text-ink/60 hover:border-ink hover:text-ink"
      }`}
      disabled={disabled}
      onClick={onClick}
      type="button"
    >
      {label}
    </button>
  );
}

function Breadcrumbs({ graph }: { graph: SemanticTopology | LoopEgoGraph }) {
  const breadcrumbs = "breadcrumbs" in graph ? graph.breadcrumbs : [];
  if (breadcrumbs.length === 0) {
    return null;
  }

  return (
    <div className="mt-1 flex max-w-full flex-wrap gap-1 text-xs text-ink/50">
      {breadcrumbs.map((node, index) => (
        <span key={node.id}>
          {index > 0 ? " / " : ""}
          {node.label}
        </span>
      ))}
    </div>
  );
}

function TraceRail({
  edges,
  node,
  nodes
}: {
  edges: TopologyEdge[];
  node?: TopologyNode;
  nodes: TopologyNode[];
}) {
  const relatedEdges = relatedEdgesForNode(edges, node).slice(0, 5);
  const nodeMap = new Map(nodes.map((item) => [item.id, item]));

  return (
    <div className="border-t border-line bg-paper/80 px-4 py-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="text-xs font-semibold uppercase tracking-[0.16em] text-ink/45">Relationships</div>
          <div className="text-sm font-semibold">{node?.label ?? "Topology"} context</div>
        </div>
        <div className="rounded-md border border-line bg-white px-3 py-2 text-sm font-semibold">
          {relatedEdges.length} direct edges
        </div>
      </div>
      <div className="mt-3 grid gap-2 md:grid-cols-5">
        {relatedEdges.map((edge) => {
          const otherNode = nodeMap.get(edge.source === node?.id ? edge.target : edge.source);
          return (
            <div className="rounded-md border border-line bg-white px-3 py-2 text-xs" key={edge.id}>
              <div className="font-semibold capitalize">{edge.kind.replace(/_/g, " ")}</div>
              <div className="mt-1 truncate text-ink/55">{otherNode?.label ?? edge.label ?? "relationship"}</div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function InspectorBody({
  edges,
  node,
  topology
}: {
  edges: TopologyEdge[];
  node?: TopologyNode;
  topology: SemanticTopology;
}) {
  const relatedEdges = relatedEdgesForNode(edges, node);
  const nodeWarnings = topology.warnings.filter(
    (warning) => warning.nodeId === node?.id || warning.loopId === node?.loopId
  );
  const dataSources = asStringList(node?.metadata?.dataSources);
  const owners = asStringList(node?.metadata?.owners);
  const metrics = asStringList(node?.metadata?.metrics);
  const routine = asStringList(node?.metadata?.routine);
  const sourcePath = node?.metadata?.sourcePath as string | undefined;

  return (
    <div className="mt-4 space-y-4">
      <div className="grid grid-cols-2 gap-3">
        <InspectorMetric label="Layer" value={node?.layer ?? "structure"} />
        <InspectorMetric label="Status" value={node?.status ?? "ready"} />
        <InspectorMetric label="Edges" value={`${relatedEdges.length}`} />
        <InspectorMetric label="Warnings" value={`${nodeWarnings.length}`} />
      </div>

      <div className="rounded-md border border-line p-3">
        <div className="text-xs font-semibold uppercase tracking-[0.14em] text-ink/45">Contract</div>
        <div className="mt-2 grid gap-2 text-sm leading-6 text-ink/70">
          <InspectorLine label="Data" value={dataSources.slice(0, 4).join(", ") || "Not defined"} />
          <InspectorLine label="Routine" value={routine.slice(0, 3).join(", ") || "Not defined"} />
          <InspectorLine label="Owners" value={owners.slice(0, 3).join(", ") || "Not defined"} />
          <InspectorLine label="Metrics" value={metrics.slice(0, 3).join(", ") || "Not defined"} />
          {sourcePath ? <InspectorLine label="Spec" value={sourcePath} /> : null}
        </div>
      </div>

      <div className="rounded-md border border-line p-3">
        <div className="text-xs font-semibold uppercase tracking-[0.14em] text-ink/45">Semantic Edges</div>
        <div className="mt-2 grid gap-2">
          {relatedEdges.slice(0, 8).map((edge) => (
            <div className="rounded-md bg-paper px-2 py-2 text-xs" key={edge.id}>
              <span className="font-semibold">{edge.kind.replace(/_/g, " ")}</span>
              <span className="ml-2 text-ink/55">
                {edge.semantic ? "semantic" : "informational"}
                {edge.executable ? " / executable" : ""}
              </span>
            </div>
          ))}
        </div>
      </div>

      <DiagnosticsPanel topology={topology} warnings={nodeWarnings.length > 0 ? nodeWarnings : topology.warnings} />
    </div>
  );
}

function DiagnosticsPanel({
  topology,
  warnings
}: {
  topology: SemanticTopology;
  warnings: SemanticTopology["warnings"];
}) {
  return (
    <div className="rounded-md border border-line p-3">
      <div className="flex items-center justify-between gap-3">
        <div className="text-xs font-semibold uppercase tracking-[0.14em] text-ink/45">Diagnostics</div>
        <span className="rounded-md border border-line px-2 py-1 text-xs font-semibold">
          {topology.orphanNodes.length} drafts
        </span>
      </div>
      <div className="mt-2 grid gap-2 text-xs leading-5 text-ink/65">
        {warnings.slice(0, 5).map((warning) => (
          <div className="rounded-md bg-paper px-2 py-2" key={warning.id}>
            <div className="font-semibold text-ink">{warning.code.replace(/_/g, " ")}</div>
            <div>{warning.message}</div>
          </div>
        ))}
        {warnings.length === 0 ? <div>No topology warnings for this selection.</div> : null}
      </div>
    </div>
  );
}

function relatedEdgesForNode(edges: TopologyEdge[], node?: TopologyNode) {
  if (!node) {
    return edges.slice(0, 5);
  }
  return edges.filter((edge) => edge.source === node.id || edge.target === node.id);
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
      <div className="mt-1 truncate text-sm font-semibold capitalize">{value.replace(/_/g, " ")}</div>
    </div>
  );
}

function hideSemanticNodes<T extends SemanticTopology | LoopEgoGraph>(graph: T, hiddenNodeIds: Set<string>): T {
  if (hiddenNodeIds.size === 0) {
    return graph;
  }

  const nodes = graph.nodes.filter((node) => !hiddenNodeIds.has(node.id));
  const nodeIds = new Set(nodes.map((node) => node.id));
  const edges = graph.edges.filter(
    (edge) => nodeIds.has(edge.source) && nodeIds.has(edge.target)
  );
  return {
    ...graph,
    nodes,
    edges
  };
}

function normalizeMode(value: string | null): TopologyVisibilityMode {
  if (
    value === "selected-loop" ||
    value === "brain-map" ||
    value === "department-map" ||
    value === "runtime-trace-map"
  ) {
    return value;
  }
  return "company";
}

function departmentOptions(nodes: TopologyNode[]) {
  const departments = Array.from(new Set(nodes.map((node) => node.department).filter(Boolean)));
  return departments.sort().map((department) => ({
    value: String(department),
    label: titleize(String(department))
  }));
}

function isLoopNode(node: TopologyNode) {
  return ["management_loop", "department_loop", "workflow_loop", "task_loop"].includes(node.type);
}

function findLoopTopologyNode(nodes: TopologyNode[], id?: string | null) {
  if (!id) {
    return undefined;
  }
  const candidates = topologyNodeCandidates(id);
  return nodes.find(
    (node) =>
      isLoopNode(node) &&
      (candidates.has(node.id) ||
        (node.loopId ? candidates.has(node.loopId) : false) ||
        (node.refId ? candidates.has(node.refId) : false))
  );
}

function findTopologyNode(nodes: TopologyNode[], id?: string | null) {
  if (!id) {
    return undefined;
  }
  const candidates = topologyNodeCandidates(id);
  return nodes.find(
    (node) =>
      candidates.has(node.id) ||
      (node.loopId ? candidates.has(node.loopId) : false) ||
      (node.refId ? candidates.has(node.refId) : false)
  );
}

function topologyNodeCandidates(id: string) {
  const candidates = new Set<string>([id]);
  const prefixes = ["loop:department:", "department:"];
  for (const prefix of prefixes) {
    if (!id.startsWith(prefix)) {
      continue;
    }
    const department = slugDepartment(id.slice(prefix.length));
    candidates.add(`${prefix}${department}`);
    candidates.add(`department:${department}`);
    candidates.add(`loop:department:${department}`);
  }
  return candidates;
}

function slugDepartment(value: string) {
  return value
    .replace(/_/g, " ")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "") || "department";
}

function isWorkflowLoopNode(node: TopologyNode) {
  return node.type === "workflow_loop" || node.type === "task_loop";
}

function sortLoopNodes(left: TopologyNode, right: TopologyNode) {
  const typeOrder = ["management_loop", "department_loop", "workflow_loop", "task_loop"];
  return (
    typeOrder.indexOf(left.type) - typeOrder.indexOf(right.type) ||
    `${left.department ?? ""}:${left.label}`.localeCompare(`${right.department ?? ""}:${right.label}`)
  );
}

function asStringList(value: unknown) {
  return Array.isArray(value) ? value.map((item) => String(item)).filter(Boolean) : [];
}

function titleize(value: string) {
  return value
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}
