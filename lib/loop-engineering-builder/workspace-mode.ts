export type WorkspaceMode = "demo" | "local" | "persisted" | "empty";

export function getWorkspaceMode(input: {
  previewMode?: boolean;
  supabaseConfigured: boolean;
  hasPersistedLoops: boolean;
  hasLocalRegistry: boolean;
}): WorkspaceMode {
  if (input.previewMode) {
    return "demo";
  }

  if (!input.supabaseConfigured) {
    if (input.hasLocalRegistry) return "local";
    return "empty";
  }

  if (input.hasPersistedLoops) return "persisted";
  return "empty";
}

export function workspaceModeBanner(mode: WorkspaceMode): { label: string; className: string } {
  switch (mode) {
    case "demo":
      return {
        label: "Preview mode — rich sample data is shown here so you can see the Hermes Brain flow before connecting your own project.",
        className: "border-amber-200 bg-amber-50 text-amber-900"
      };
    case "local":
      return {
        label: "Local workspace — registered LoopSpecs from .loopgraph/workspace.json. CLI traces in .loopgraph/.",
        className: "border-blue-200 bg-blue-50 text-blue-900"
      };
    case "persisted":
      return {
        label: "Supabase connected — persisted Design Studio workspace.",
        className: "border-green-200 bg-green-50 text-green-900"
      };
    case "empty":
      return {
        label: "Empty local workspace — say `start Loopgraph` in Hermes, start with Product or your chosen department, and accept loops to create your graph. Demo data is not shown.",
        className: "border-slate-200 bg-slate-50 text-slate-800"
      };
  }
}
