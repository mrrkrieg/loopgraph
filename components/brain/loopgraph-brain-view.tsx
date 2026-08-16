"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import type { SemanticTopology } from "@/lib/loopgraph-core/graph";
import type { GraphEditorOperation, GraphEditorTransaction } from "loopgraph/core";
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
  initialTransactions = [],
  previewMode = false,
  topologyHash,
  topology
}: {
  actions?: BrainGraphActions;
  includeCatalogLoops?: boolean;
  initialLayout?: GraphLayoutOverrides;
  initialTransactions?: GraphEditorTransaction[];
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
  const [recentTransactions, setRecentTransactions] = useState(() =>
    initialTransactions.slice(0, 5).map(summarizeTransaction)
  );
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
        const lifecycle = result.proposalLifecycle[0];
        setEditMessage(result.status === "layout_applied"
          ? `Layout saved (${result.id}).`
          : lifecycle?.nextAction === "answer_questions"
            ? `Proposal submitted (${result.id}). Hermes opened design task ${lifecycle.designTaskId}; answer the requested evidence questions before design continues.`
            : lifecycle?.nextAction === "review_proposal"
              ? `Proposal submitted (${result.id}). Change set ${lifecycle.graphChangeSetId} is ready for accountable review.`
              : `Proposal submitted (${result.id}). Hermes design task ${lifecycle?.designTaskId ?? "is queued"}; approval is still required before it becomes runnable.`);
        setRecentTransactions((current) => [{
          id: result.id,
          status: result.status,
          operationCount: operations.length,
          createdAt: new Date().toISOString(),
          opportunityId: lifecycle?.opportunityId,
          graphChangeSetId: lifecycle?.graphChangeSetId,
          designTaskId: lifecycle?.designTaskId,
          discoverySessionId: lifecycle?.discoverySessionId,
          nextAction: lifecycle?.nextAction
        }, ...current.filter((item) => item.id !== result.id)].slice(0, 5));
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
        {!previewMode && !includeCatalogLoops && actions?.submitGraphEdit ? (
          <GraphEditorPanel
            editing={editing}
            isSubmitting={isSubmitting}
            message={editMessage}
            nodes={graph.nodes}
            pendingMoveCount={Object.keys(pendingMoves).length}
            onEditingChange={setEditing}
            onSaveLayout={() => submitOperations(Object.entries(pendingMoves).map(([nodeId, position]) => ({ kind: "move_node" as const, nodeId, ...position })))}
            onSubmit={submitOperations}
            recentTransactions={recentTransactions}
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

function GraphEditorPanel({ editing, isSubmitting, message, nodes, onEditingChange, onSaveLayout, onSubmit, pendingMoveCount, recentTransactions, selectedId }: {
  editing: boolean;
  isSubmitting: boolean;
  message?: string;
  nodes: ReturnType<typeof buildBrainGraph>["nodes"];
  onEditingChange: (value: boolean) => void;
  onSaveLayout: () => void;
  onSubmit: (operations: GraphEditorOperation[]) => void;
  pendingMoveCount: number;
  recentTransactions: Array<{
    id: string;
    status: string;
    operationCount: number;
    createdAt: string;
    opportunityId?: string;
    graphChangeSetId?: string;
    designTaskId?: string;
    discoverySessionId?: string;
    nextAction?: "answer_questions" | "await_hermes" | "review_proposal";
  }>;
  selectedId?: string;
}) {
  const [targetId, setTargetId] = useState("");
  const [relation, setRelation] = useState<"brain_routes_to" | "department_contains_loop" | "learning_returns_to">("learning_returns_to");
  const [loopLabel, setLoopLabel] = useState("");
  const [departmentId, setDepartmentId] = useState("product");
  const [purpose, setPurpose] = useState("");
  const sourceNode = nodes.find((node) => node.id === selectedId);
  const validSource = relation === "brain_routes_to"
    ? sourceNode?.type === "company_brain"
    : relation === "department_contains_loop"
      ? sourceNode?.type === "department_loop"
      : sourceNode?.type === "workflow_loop";
  const eligibleTargets = nodes.filter((node) => {
    if (node.id === selectedId) return false;
    if (relation === "brain_routes_to" || relation === "department_contains_loop") {
      return node.type === "workflow_loop";
    }
    return ["company_brain", "department_loop", "workflow_loop"].includes(node.type);
  });
  const validTarget = eligibleTargets.some((node) => node.id === targetId);
  return (
    <div className="absolute right-4 top-36 z-20 max-h-[calc(100%-10rem)] w-80 max-w-[calc(100%-2rem)] overflow-y-auto rounded-md border border-line bg-white/95 p-3 text-xs shadow-lg backdrop-blur md:top-4 md:max-h-[calc(100%-2rem)]">
      <div className="flex items-center justify-between gap-2">
        <div>
          <div className="font-semibold text-ink">Graph editor</div>
          <div className="mt-1 text-ink/55">Layout saves directly. Semantic changes enter approval.</div>
        </div>
        <button className="rounded-md bg-ink px-3 py-2 font-semibold text-white" onClick={() => onEditingChange(!editing)} type="button">{editing ? "Done" : "Edit"}</button>
      </div>
      {editing ? <div className="mt-3 space-y-3 border-t border-line pt-3">
        <button className="w-full rounded-md border border-ink px-3 py-2 font-semibold disabled:opacity-40" disabled={isSubmitting || pendingMoveCount === 0} onClick={onSaveLayout} type="button">Save moved nodes ({pendingMoveCount})</button>
        <div className="space-y-2 rounded-md bg-paper p-2">
          <div className="font-semibold">Propose a connection</div>
          <div className="text-ink/55">Source: {selectedId ?? "select a node"}</div>
          <select className="w-full rounded border border-line bg-white p-2" onChange={(event) => setTargetId(event.target.value)} value={targetId}>
            <option value="">Choose target</option>
            {eligibleTargets.map((node) => <option key={node.id} value={node.id}>{node.label}</option>)}
          </select>
          <select className="w-full rounded border border-line bg-white p-2" onChange={(event) => {
            setRelation(event.target.value as typeof relation);
            setTargetId("");
          }} value={relation}>
            <option value="brain_routes_to">Hermes routes to</option>
            <option value="department_contains_loop">Department owns loop</option>
            <option value="learning_returns_to">Evidence returns to</option>
          </select>
          {!validSource ? <div className="text-[11px] leading-4 text-ink/55">
            {relation === "brain_routes_to"
              ? "Select Hermes Brain as the source."
              : relation === "department_contains_loop"
                ? "Select a department as the source."
                : "Select a workflow loop as the source."}
          </div> : null}
          <button className="w-full rounded bg-ink p-2 font-semibold text-white disabled:opacity-40" disabled={!selectedId || !validSource || !validTarget || isSubmitting} onClick={() => onSubmit([{ kind: "propose_edge", sourceId: selectedId!, targetId, relation, reason: "User-authored connection requiring Hermes validation." }])} type="button">Submit connection proposal</button>
        </div>
        <div className="space-y-2 rounded-md bg-paper p-2">
          <div className="font-semibold">Propose a workflow loop</div>
          <input className="w-full rounded border border-line bg-white p-2" onChange={(event) => setLoopLabel(event.target.value)} placeholder="Loop name" value={loopLabel} />
          <input className="w-full rounded border border-line bg-white p-2" onChange={(event) => setDepartmentId(event.target.value)} placeholder="Department ID" value={departmentId} />
          <textarea className="w-full rounded border border-line bg-white p-2" onChange={(event) => setPurpose(event.target.value)} placeholder="Problem this loop should solve" value={purpose} />
          <button className="w-full rounded bg-ink p-2 font-semibold text-white disabled:opacity-40" disabled={!loopLabel.trim() || !departmentId.trim() || !purpose.trim() || isSubmitting} onClick={() => onSubmit([{ kind: "propose_node", temporaryId: `draft:${Date.now()}`, nodeType: "workflow_loop", label: loopLabel, departmentId, purpose }])} type="button">Submit loop proposal</button>
        </div>
      </div> : null}
      {message ? <div aria-live="polite" className="mt-3 rounded border border-line bg-paper p-2 leading-5 text-ink/65">{message}</div> : null}
      {recentTransactions.length > 0 ? <div className={`mt-3 border-t border-line pt-3 ${editing ? "" : "hidden sm:block"}`}>
        <div className="font-semibold">Recent backend receipts</div>
        <div className="mt-2 space-y-2">{recentTransactions.map((transaction) => <div className="rounded border border-line px-2 py-1.5" key={transaction.id}>
          <div className="flex items-center justify-between gap-2"><span className="truncate font-mono text-[10px]">{transaction.id}</span><span className="whitespace-nowrap text-[10px] font-semibold uppercase text-ink/45">{transaction.status.replace(/_/g, " ")}</span></div>
          <div className="mt-1 text-[10px] text-ink/45">{transaction.operationCount} operation{transaction.operationCount === 1 ? "" : "s"} · {new Date(transaction.createdAt).toLocaleString()}</div>
          {transaction.graphChangeSetId ? <div className="mt-2 flex flex-wrap gap-2">
            <Link className="font-semibold text-ink underline underline-offset-2" href="/operate/changes">Review change</Link>
            {transaction.nextAction === "answer_questions" && transaction.discoverySessionId ? <Link className="font-semibold text-ink underline underline-offset-2" href={`/discovery/questions?sessionId=${encodeURIComponent(transaction.discoverySessionId)}`}>Answer Hermes</Link> : null}
          </div> : null}
        </div>)}</div>
      </div> : null}
    </div>
  );
}

function summarizeTransaction(transaction: GraphEditorTransaction) {
  return {
    id: transaction.id,
    status: transaction.status,
    operationCount: transaction.operations.length,
    createdAt: transaction.createdAt
  };
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
