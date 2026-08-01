"use client";

import { useMemo, useState, useTransition } from "react";
import type { SemanticTopology } from "@/lib/loopgraph-core/graph";
import type { GraphEditorOperation } from "loopgraph/core";
import type { GraphLayoutOverrides } from "loopgraph/runtime";
import {
  buildBrainGraph,
  filterBrainGraphByDepth,
  filterBrainGraphForDepartmentStory
} from "./graph-adapter";
import { GraphControls } from "./graph-controls";
import { GraphDiagnostics } from "./graph-diagnostics";
import { NodeInspector } from "./node-inspector";
import { ObsidianGraphCanvas } from "./obsidian-graph-canvas";
import type { BrainGraphMode, BrainGraphSettings, BrainGraphStoryPreset } from "./graph-types";
import type { BrainGraphActions } from "./node-inspector";

function settingsForStoryPreset(
  preset: Exclude<BrainGraphStoryPreset, "custom">,
  previewMode: boolean
): BrainGraphSettings {
  if (preset === "product_path") {
    return {
      includeData: true,
      includeMetrics: true,
      includeReviews: true,
      includeImprove: false
    };
  }
  if (preset === "company_map") {
    return {
      includeData: previewMode,
      includeMetrics: false,
      includeReviews: false,
      includeImprove: false
    };
  }
  if (preset === "routing_signals") {
    return {
      includeData: true,
      includeMetrics: true,
      includeReviews: true,
      includeImprove: false
    };
  }
  return {
    includeData: true,
    includeMetrics: true,
    includeReviews: true,
    includeImprove: true
  };
}

export function LoopgraphBrainView({
  actions,
  includeCatalogLoops = false,
  initialLayout = {},
  previewMode = false,
  topologyHash,
  topology
}: {
  actions?: BrainGraphActions;
  includeCatalogLoops?: boolean;
  initialLayout?: GraphLayoutOverrides;
  previewMode?: boolean;
  topologyHash: string;
  topology: SemanticTopology;
}) {
  const initialStoryPreset: Exclude<BrainGraphStoryPreset, "custom"> = previewMode
    ? "product_path"
    : "company_map";
  const [storyPreset, setStoryPreset] = useState<BrainGraphStoryPreset>(initialStoryPreset);
  const [settings, setSettings] = useState<BrainGraphSettings>(() =>
    settingsForStoryPreset(initialStoryPreset, previewMode)
  );
  const [mode, setMode] = useState<BrainGraphMode>("global");
  const [depth, setDepth] = useState(1);
  const [showLabels, setShowLabels] = useState(true);
  const [selectedId, setSelectedId] = useState<string | undefined>();
  const [localCenterId, setLocalCenterId] = useState<string | undefined>();
  const [fitRequest, setFitRequest] = useState(0);
  const [resetRequest, setResetRequest] = useState(0);
  const [editing, setEditing] = useState(false);
  const [pendingMoves, setPendingMoves] = useState<Record<string, { x: number; y: number }>>({});
  const [editMessage, setEditMessage] = useState<string>();
  const [isSubmitting, startSubmitting] = useTransition();
  const baseGraph = useMemo(
    () => buildBrainGraph({
      topology,
      includeCatalogLoops,
      previewStory: previewMode,
      ...settings
    }),
    [includeCatalogLoops, previewMode, settings, topology]
  );
  const storyBaseGraph = useMemo(() => {
    if (storyPreset !== "product_path") {
      return baseGraph;
    }
    return filterBrainGraphForDepartmentStory({
      graph: baseGraph,
      departmentId: "product"
    });
  }, [baseGraph, storyPreset]);
  const selectedNodeExists = selectedId ? storyBaseGraph.nodes.some((node) => node.id === selectedId) : false;
  const effectiveSelectedId = selectedNodeExists ? selectedId : undefined;
  const centerId = localCenterId && storyBaseGraph.nodes.some((node) => node.id === localCenterId)
    ? localCenterId
    : effectiveSelectedId ?? topology.managementLoopId;
  const graph = useMemo(() => {
    if (mode !== "local" || !centerId) {
      return storyBaseGraph;
    }
    return filterBrainGraphByDepth({
      graph: storyBaseGraph,
      centerId,
      depth
    });
  }, [centerId, depth, mode, storyBaseGraph]);
  const selectedNode = effectiveSelectedId
    ? graph.nodes.find((node) => node.id === effectiveSelectedId)
    : graph.nodes.find((node) => node.type === "company_brain");
  const inspectorNode = selectedNode ?? graph.nodes[0];
  const currentFocusId = effectiveSelectedId ?? inspectorNode?.id;
  const brainLabel = topology.metadata.brainLabel ?? "Company Brain";
  const isHermes = topology.metadata.hierarchyMode === "hermes_brain";
  const breadcrumb = inspectorNode ? breadcrumbForNode(inspectorNode, brainLabel, isHermes) : [brainLabel];

  function openLocalGraph(nodeId: string) {
    setSelectedId(nodeId);
    setLocalCenterId(nodeId);
    setMode("local");
    setFitRequest((current) => current + 1);
  }

  function applyStoryPreset(preset: Exclude<BrainGraphStoryPreset, "custom">) {
    setStoryPreset(preset);
    setSettings(settingsForStoryPreset(preset, previewMode));
    setMode("global");
    setFitRequest((current) => current + 1);
  }

  function applyCustomSettings(nextSettings: BrainGraphSettings) {
    setStoryPreset("custom");
    setSettings(nextSettings);
  }

  function submitOperations(operations: GraphEditorOperation[]) {
    if (!actions?.submitGraphEdit || operations.length === 0) return;
    startSubmitting(async () => {
      try {
        const formData = new FormData();
        formData.set("expectedTopologyHash", topologyHash);
        formData.set("operations", JSON.stringify(operations));
        const result = await actions.submitGraphEdit!(formData);
        setEditMessage(result.status === "layout_applied"
          ? `Layout saved (${result.id}).`
          : `Proposal submitted (${result.id}). Hermes design and approval are required before it becomes runnable.`);
        if (result.status === "layout_applied") setPendingMoves({});
      } catch (error) {
        setEditMessage(error instanceof Error ? error.message : "Graph edit failed");
      }
    });
  }

  return (
    <div className={`grid grid-rows-[minmax(520px,1fr)_auto] overflow-hidden rounded-lg border border-line bg-white shadow-sm xl:grid-cols-[minmax(0,1fr)_320px] xl:grid-rows-none ${
      previewMode
        ? "min-h-[980px] xl:min-h-[980px]"
        : "min-h-[760px] xl:h-[calc(100vh-12rem)] xl:min-h-[560px]"
    }`}>
      <section className={`relative overflow-hidden ${previewMode ? "min-h-[720px]" : "min-h-[440px] xl:min-h-0"}`}>
        <div className="absolute left-4 top-4 z-10">
          <GraphControls
            canUseLocal={Boolean(currentFocusId)}
            depth={depth}
            labels={showLabels}
            mode={mode}
            onDepthChange={setDepth}
            onFitView={() => setFitRequest((current) => current + 1)}
            onLabelsChange={setShowLabels}
            onModeChange={(nextMode) => {
              setMode(nextMode);
              if (nextMode === "local" && !localCenterId && currentFocusId) {
                setLocalCenterId(currentFocusId);
              }
              setFitRequest((current) => current + 1);
            }}
            onResetLayout={() => {
              setResetRequest((current) => current + 1);
              setFitRequest((current) => current + 1);
            }}
            onSettingsChange={applyCustomSettings}
            onStoryPresetChange={applyStoryPreset}
            previewMode={previewMode}
            settings={settings}
            storyPreset={storyPreset}
          />
        </div>
        {!previewMode && actions?.submitGraphEdit ? (
          <GraphEditorPanel
            editing={editing}
            isSubmitting={isSubmitting}
            message={editMessage}
            nodes={graph.nodes}
            onEditingChange={setEditing}
            onSaveLayout={() => submitOperations(Object.entries(pendingMoves).map(([nodeId, position]) => ({ kind: "move_node" as const, nodeId, ...position })))}
            onSubmit={submitOperations}
            selectedId={effectiveSelectedId}
          />
        ) : null}
        {previewMode ? <PreviewTraceGuide storyPreset={storyPreset} /> : null}
        <div className="absolute bottom-4 left-4 z-10 max-w-xl space-y-2">
          <div className="rounded-md border border-line bg-white/95 px-3 py-2 text-xs font-medium text-ink/65 shadow-sm backdrop-blur">
            {breadcrumb.join(" / ")}
          </div>
          <GraphDiagnostics diagnostics={graph.diagnostics} />
        </div>
        <ObsidianGraphCanvas
          centerId={mode === "local" ? centerId : undefined}
          edges={graph.edges}
          editable={editing}
          fitRequest={fitRequest}
          graphLabel={`${brainLabel} graph`}
          initialPositions={initialLayout}
          mode={mode}
          nodes={graph.nodes}
          onOpenLocal={openLocalGraph}
          onNodePositionChange={(nodeId, x, y) => setPendingMoves((current) => ({ ...current, [nodeId]: { x, y } }))}
          onSelect={setSelectedId}
          resetRequest={resetRequest}
          selectedId={effectiveSelectedId}
          showLabels={showLabels}
        />
      </section>
      <NodeInspector actions={actions} edges={graph.edges} node={inspectorNode} onOpenLocal={openLocalGraph} />
    </div>
  );
}

function GraphEditorPanel({ editing, isSubmitting, message, nodes, onEditingChange, onSaveLayout, onSubmit, selectedId }: {
  editing: boolean;
  isSubmitting: boolean;
  message?: string;
  nodes: ReturnType<typeof buildBrainGraph>["nodes"];
  onEditingChange: (value: boolean) => void;
  onSaveLayout: () => void;
  onSubmit: (operations: GraphEditorOperation[]) => void;
  selectedId?: string;
}) {
  const [targetId, setTargetId] = useState("");
  const [loopLabel, setLoopLabel] = useState("");
  const [departmentId, setDepartmentId] = useState("product");
  const [purpose, setPurpose] = useState("");
  return (
    <div className="absolute right-4 top-4 z-20 w-80 rounded-md border border-line bg-white/95 p-3 text-xs shadow-lg backdrop-blur">
      <div className="flex items-center justify-between gap-2">
        <div>
          <div className="font-semibold text-ink">Graph editor</div>
          <div className="mt-1 text-ink/55">Layout saves directly. Semantic changes enter approval.</div>
        </div>
        <button className="rounded-md bg-ink px-3 py-2 font-semibold text-white" onClick={() => onEditingChange(!editing)} type="button">{editing ? "Done" : "Edit"}</button>
      </div>
      {editing ? <div className="mt-3 space-y-3 border-t border-line pt-3">
        <button className="w-full rounded-md border border-ink px-3 py-2 font-semibold disabled:opacity-40" disabled={isSubmitting} onClick={onSaveLayout} type="button">Save moved nodes</button>
        <div className="space-y-2 rounded-md bg-paper p-2">
          <div className="font-semibold">Propose a connection</div>
          <div className="text-ink/55">Source: {selectedId ?? "select a node"}</div>
          <select className="w-full rounded border border-line bg-white p-2" onChange={(event) => setTargetId(event.target.value)} value={targetId}>
            <option value="">Choose target</option>
            {nodes.filter((node) => node.id !== selectedId).map((node) => <option key={node.id} value={node.id}>{node.label}</option>)}
          </select>
          <button className="w-full rounded bg-ink p-2 font-semibold text-white disabled:opacity-40" disabled={!selectedId || !targetId || isSubmitting} onClick={() => onSubmit([{ kind: "propose_edge", sourceId: selectedId!, targetId, relation: "learning_returns_to", reason: "User-authored connection requiring Hermes validation." }])} type="button">Submit connection proposal</button>
        </div>
        <div className="space-y-2 rounded-md bg-paper p-2">
          <div className="font-semibold">Propose a workflow loop</div>
          <input className="w-full rounded border border-line bg-white p-2" onChange={(event) => setLoopLabel(event.target.value)} placeholder="Loop name" value={loopLabel} />
          <input className="w-full rounded border border-line bg-white p-2" onChange={(event) => setDepartmentId(event.target.value)} placeholder="Department ID" value={departmentId} />
          <textarea className="w-full rounded border border-line bg-white p-2" onChange={(event) => setPurpose(event.target.value)} placeholder="Problem this loop should solve" value={purpose} />
          <button className="w-full rounded bg-ink p-2 font-semibold text-white disabled:opacity-40" disabled={!loopLabel.trim() || !departmentId.trim() || !purpose.trim() || isSubmitting} onClick={() => onSubmit([{ kind: "propose_node", temporaryId: `draft:${Date.now()}`, nodeType: "workflow_loop", label: loopLabel, departmentId, purpose }])} type="button">Submit loop proposal</button>
        </div>
      </div> : null}
      {message ? <div className="mt-3 rounded border border-line bg-paper p-2 leading-5 text-ink/65">{message}</div> : null}
    </div>
  );
}

function PreviewTraceGuide({ storyPreset }: { storyPreset: BrainGraphStoryPreset }) {
  const productPath = storyPreset === "product_path";
  return (
    <div className="pointer-events-none absolute left-4 top-24 z-10 hidden max-w-lg rounded-md border border-line bg-white/94 p-3 text-xs leading-5 text-ink/65 shadow-sm backdrop-blur md:block">
      <div className="font-semibold text-ink">
        {productPath ? "Follow this event" : "How to read the map"}
      </div>
      <div className="mt-1">
        {productPath
          ? "Product events, support tickets, CRM context, docs, and metrics flow into Hermes Brain. Hermes routes eligible work to Product loops, then outcomes return as evidence."
          : "Data points flow into Hermes Brain. Hermes chooses a department route, Loopgraph validates the selected loop, and loop outcomes return as evidence."}
      </div>
    </div>
  );
}

function breadcrumbForNode(
  node: NonNullable<ReturnType<typeof buildBrainGraph>["nodes"][number]>,
  brainLabel: string,
  isHermes: boolean
) {
  if (node.type === "company_brain") return [brainLabel];
  if (node.type === "management_loop") return [brainLabel, node.label];
  if (node.type === "department_loop") return [brainLabel, ...(node.parentId === "loop:management" ? ["Company Management Loop"] : []), node.label];
  if (node.type === "workflow_loop") {
    return [brainLabel, node.departmentId ? departmentLabel(node.departmentId, isHermes) : "Department", node.label];
  }
  return [brainLabel, node.label];
}

function departmentLabel(department: string, isHermes: boolean) {
  const label = department.replace(/_/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
  return isHermes ? label : `${label} Department Loop`;
}
