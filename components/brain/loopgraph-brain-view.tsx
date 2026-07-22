"use client";

import { useMemo, useState } from "react";
import type { SemanticTopology } from "@/lib/loopgraph-core/graph";
import { buildBrainGraph, filterBrainGraphByDepth } from "./graph-adapter";
import { GraphControls } from "./graph-controls";
import { GraphDiagnostics } from "./graph-diagnostics";
import { NodeInspector } from "./node-inspector";
import { ObsidianGraphCanvas } from "./obsidian-graph-canvas";
import type { BrainGraphMode, BrainGraphSettings } from "./graph-types";
import type { BrainGraphActions } from "./node-inspector";

const defaultSettings: BrainGraphSettings = {
  includeData: false,
  includeMetrics: false,
  includeReviews: false,
  includeImprove: false
};

export function LoopgraphBrainView({
  actions,
  includeCatalogLoops = false,
  topology
}: {
  actions?: BrainGraphActions;
  includeCatalogLoops?: boolean;
  topology: SemanticTopology;
}) {
  const [settings, setSettings] = useState<BrainGraphSettings>(defaultSettings);
  const [mode, setMode] = useState<BrainGraphMode>("global");
  const [depth, setDepth] = useState(1);
  const [showLabels, setShowLabels] = useState(true);
  const [selectedId, setSelectedId] = useState<string | undefined>();
  const [localCenterId, setLocalCenterId] = useState<string | undefined>();
  const [fitRequest, setFitRequest] = useState(0);
  const [resetRequest, setResetRequest] = useState(0);
  const baseGraph = useMemo(() => buildBrainGraph({ topology, includeCatalogLoops, ...settings }), [includeCatalogLoops, settings, topology]);
  const selectedNodeExists = selectedId ? baseGraph.nodes.some((node) => node.id === selectedId) : false;
  const effectiveSelectedId = selectedNodeExists ? selectedId : undefined;
  const centerId = localCenterId && baseGraph.nodes.some((node) => node.id === localCenterId)
    ? localCenterId
    : effectiveSelectedId ?? topology.managementLoopId;
  const graph = useMemo(() => {
    if (mode !== "local" || !centerId) {
      return baseGraph;
    }
    return filterBrainGraphByDepth({
      graph: baseGraph,
      centerId,
      depth
    });
  }, [baseGraph, centerId, depth, mode]);
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

  return (
    <div className="grid min-h-[760px] grid-rows-[minmax(440px,1fr)_auto] overflow-hidden rounded-lg border border-line bg-white shadow-sm xl:h-[calc(100vh-12rem)] xl:min-h-[560px] xl:grid-cols-[minmax(0,1fr)_320px] xl:grid-rows-none">
      <section className="relative min-h-[440px] overflow-hidden xl:min-h-0">
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
            onSettingsChange={setSettings}
            settings={settings}
          />
        </div>
        <div className="absolute bottom-4 left-4 z-10 max-w-xl space-y-2">
          <div className="rounded-md border border-line bg-white/95 px-3 py-2 text-xs font-medium text-ink/65 shadow-sm backdrop-blur">
            {breadcrumb.join(" / ")}
          </div>
          <GraphDiagnostics diagnostics={graph.diagnostics} />
        </div>
        <ObsidianGraphCanvas
          centerId={mode === "local" ? centerId : undefined}
          edges={graph.edges}
          fitRequest={fitRequest}
          mode={mode}
          nodes={graph.nodes}
          onOpenLocal={openLocalGraph}
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
