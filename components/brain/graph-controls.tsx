"use client";

import type { BrainGraphMode, BrainGraphSettings, BrainGraphStoryPreset } from "./graph-types";

const storyPresets: Array<{
  id: Exclude<BrainGraphStoryPreset, "custom">;
  label: string;
  description: string;
}> = [
  {
    id: "company_map",
    label: "Company map",
    description: "Data enters Hermes; Hermes routes to department loops."
  },
  {
    id: "routing_signals",
    label: "Routing signals",
    description: "Show signals, metrics, and review gates behind routing."
  },
  {
    id: "evidence_return",
    label: "Evidence returns",
    description: "Show outcomes feeding learning back into Hermes."
  }
];

export function GraphControls({
  mode,
  depth,
  settings,
  storyPreset,
  labels,
  canUseLocal,
  previewMode = false,
  onModeChange,
  onDepthChange,
  onSettingsChange,
  onStoryPresetChange,
  onLabelsChange,
  onFitView,
  onResetLayout
}: {
  mode: BrainGraphMode;
  depth: number;
  settings: BrainGraphSettings;
  storyPreset: BrainGraphStoryPreset;
  labels: boolean;
  canUseLocal: boolean;
  previewMode?: boolean;
  onModeChange: (mode: BrainGraphMode) => void;
  onDepthChange: (depth: number) => void;
  onSettingsChange: (settings: BrainGraphSettings) => void;
  onStoryPresetChange: (preset: Exclude<BrainGraphStoryPreset, "custom">) => void;
  onLabelsChange: (labels: boolean) => void;
  onFitView: () => void;
  onResetLayout: () => void;
}) {
  return (
    <div className="pointer-events-auto flex max-w-[calc(100vw-2rem)] flex-wrap items-center gap-2 rounded-md border border-line bg-white/95 p-2 text-xs shadow-sm backdrop-blur">
      <div className="flex flex-wrap gap-1 rounded-md border border-line bg-paper p-1">
        {storyPresets.map((preset) => {
          const selected = storyPreset === preset.id;
          return (
            <button
              className={`rounded px-3 py-1.5 text-left font-semibold ${
                selected
                  ? "bg-ink text-white"
                  : "bg-white text-ink/65 hover:bg-white hover:text-ink"
              }`}
              key={preset.id}
              onClick={() => onStoryPresetChange(preset.id)}
              title={preset.description}
              type="button"
            >
              {preset.label}
            </button>
          );
        })}
        {storyPreset === "custom" ? (
          <span className="rounded px-3 py-1.5 font-semibold text-ink/55">
            Custom layers
          </span>
        ) : null}
      </div>

      <div className="flex overflow-hidden rounded-md border border-line">
        <button
          className={`px-3 py-1.5 font-semibold ${mode === "global" ? "bg-ink text-white" : "bg-white text-ink/65 hover:bg-paper"}`}
          onClick={() => onModeChange("global")}
          type="button"
        >
          {previewMode ? "Full map" : "Global"}
        </button>
        <button
          className={`px-3 py-1.5 font-semibold ${mode === "local" ? "bg-ink text-white" : "bg-white text-ink/65 hover:bg-paper"} disabled:cursor-not-allowed disabled:opacity-40`}
          disabled={!canUseLocal}
          onClick={() => onModeChange("local")}
          type="button"
        >
          Focus selected
        </button>
      </div>

      {mode === "local" ? (
        <div className="flex overflow-hidden rounded-md border border-line">
          {[1, 2, 3].map((item) => (
            <button
              className={`px-2.5 py-1.5 font-semibold ${depth === item ? "bg-paper text-ink" : "text-ink/55 hover:bg-paper"}`}
              key={item}
              onClick={() => onDepthChange(item)}
              type="button"
            >
              {item} hop{item > 1 ? "s" : ""}
            </button>
          ))}
        </div>
      ) : null}

      <button className="rounded-md border border-line px-3 py-1.5 font-semibold text-ink/70 hover:border-ink hover:text-ink" onClick={onFitView} type="button">
        Fit map
      </button>

      <details className="group relative">
        <summary className="cursor-pointer list-none rounded-md border border-line px-3 py-1.5 font-semibold text-ink/65 hover:border-ink hover:text-ink">
          Layers
        </summary>
        <div className="absolute left-0 top-[calc(100%+0.5rem)] z-20 grid min-w-56 gap-2 rounded-md border border-line bg-white p-3 shadow-lg">
          <LayerToggle label="Incoming data" selected={settings.includeData} onClick={() => onSettingsChange({ ...settings, includeData: !settings.includeData })} />
          <LayerToggle label="Metrics" selected={settings.includeMetrics} onClick={() => onSettingsChange({ ...settings, includeMetrics: !settings.includeMetrics })} />
          <LayerToggle label="Human reviews" selected={settings.includeReviews} onClick={() => onSettingsChange({ ...settings, includeReviews: !settings.includeReviews })} />
          <LayerToggle label="Improvements" selected={settings.includeImprove} onClick={() => onSettingsChange({ ...settings, includeImprove: !settings.includeImprove })} />
          <LayerToggle label="Labels" selected={labels} onClick={() => onLabelsChange(!labels)} />
          <button className="rounded-md border border-line px-3 py-1.5 text-left font-semibold text-ink/70 hover:border-ink hover:text-ink" onClick={onResetLayout} type="button">
            Reset layout
          </button>
        </div>
      </details>
    </div>
  );
}

function LayerToggle({ label, selected, onClick }: { label: string; selected: boolean; onClick: () => void }) {
  return (
    <button
      aria-pressed={selected}
      className={`rounded-md border px-3 py-1.5 text-left font-semibold ${
        selected ? "border-ink bg-ink text-white" : "border-line bg-white text-ink/65 hover:border-ink hover:text-ink"
      }`}
      onClick={onClick}
      type="button"
    >
      {label}
    </button>
  );
}
