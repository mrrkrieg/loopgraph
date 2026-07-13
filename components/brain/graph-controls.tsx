"use client";

import type { BrainGraphMode, BrainGraphSettings } from "./graph-types";

export function GraphControls({
  mode,
  depth,
  settings,
  labels,
  canUseLocal,
  onModeChange,
  onDepthChange,
  onSettingsChange,
  onLabelsChange,
  onFitView,
  onResetLayout
}: {
  mode: BrainGraphMode;
  depth: number;
  settings: BrainGraphSettings;
  labels: boolean;
  canUseLocal: boolean;
  onModeChange: (mode: BrainGraphMode) => void;
  onDepthChange: (depth: number) => void;
  onSettingsChange: (settings: BrainGraphSettings) => void;
  onLabelsChange: (labels: boolean) => void;
  onFitView: () => void;
  onResetLayout: () => void;
}) {
  return (
    <div className="pointer-events-auto flex max-w-[calc(100vw-2rem)] flex-wrap items-center gap-2 rounded-md border border-line bg-white/95 p-2 text-xs shadow-sm backdrop-blur">
      <div className="flex overflow-hidden rounded-md border border-line">
        <button
          className={`px-3 py-1.5 font-semibold ${mode === "global" ? "bg-ink text-white" : "bg-white text-ink/65 hover:bg-paper"}`}
          onClick={() => onModeChange("global")}
          type="button"
        >
          Global
        </button>
        <button
          className={`px-3 py-1.5 font-semibold ${mode === "local" ? "bg-ink text-white" : "bg-white text-ink/65 hover:bg-paper"} disabled:cursor-not-allowed disabled:opacity-40`}
          disabled={!canUseLocal}
          onClick={() => onModeChange("local")}
          type="button"
        >
          Local
        </button>
      </div>
      <div className="flex overflow-hidden rounded-md border border-line">
        {[1, 2, 3].map((item) => (
          <button
            className={`px-2.5 py-1.5 font-semibold ${depth === item ? "bg-paper text-ink" : "text-ink/55 hover:bg-paper"}`}
            key={item}
            onClick={() => onDepthChange(item)}
            type="button"
          >
            {item}
          </button>
        ))}
      </div>
      <Toggle label="Data" selected={settings.includeData} onClick={() => onSettingsChange({ ...settings, includeData: !settings.includeData })} />
      <Toggle label="Metrics" selected={settings.includeMetrics} onClick={() => onSettingsChange({ ...settings, includeMetrics: !settings.includeMetrics })} />
      <Toggle label="Reviews" selected={settings.includeReviews} onClick={() => onSettingsChange({ ...settings, includeReviews: !settings.includeReviews })} />
      <Toggle label="Improve" selected={settings.includeImprove} onClick={() => onSettingsChange({ ...settings, includeImprove: !settings.includeImprove })} />
      <Toggle label="Labels" selected={labels} onClick={() => onLabelsChange(!labels)} />
      <button className="rounded-md border border-line px-3 py-1.5 font-semibold text-ink/70 hover:border-ink hover:text-ink" onClick={onFitView} type="button">
        Fit
      </button>
      <button className="rounded-md border border-line px-3 py-1.5 font-semibold text-ink/70 hover:border-ink hover:text-ink" onClick={onResetLayout} type="button">
        Reset
      </button>
    </div>
  );
}

function Toggle({ label, selected, onClick }: { label: string; selected: boolean; onClick: () => void }) {
  return (
    <button
      aria-pressed={selected}
      className={`rounded-md border px-3 py-1.5 font-semibold ${
        selected ? "border-ink bg-ink text-white" : "border-line bg-white text-ink/65 hover:border-ink hover:text-ink"
      }`}
      onClick={onClick}
      type="button"
    >
      {label}
    </button>
  );
}
