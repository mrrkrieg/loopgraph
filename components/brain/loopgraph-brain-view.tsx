"use client";

import { useMemo, useState } from "react";
import type { SemanticTopology } from "@/lib/loopgraph-core/graph";
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
  previewMode = false,
  topology
}: {
  actions?: BrainGraphActions;
  includeCatalogLoops?: boolean;
  previewMode?: boolean;
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
          fitRequest={fitRequest}
          graphLabel={`${brainLabel} graph`}
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
