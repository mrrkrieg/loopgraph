export type WorkspaceMode = "demo" | "local" | "persisted" | "empty";

export function getWorkspaceMode(input: {
  supabaseConfigured: boolean;
  hasPersistedLoops: boolean;
  hasLocalRegistry: boolean;
}): WorkspaceMode {
  if (!input.supabaseConfigured) {
    if (input.hasLocalRegistry) return "local";
    return "demo";
  }

  if (input.hasPersistedLoops) return "persisted";
  return "empty";
}

export function workspaceModeBanner(mode: WorkspaceMode): { label: string; className: string } {
  switch (mode) {
    case "demo":
      return {
        label: "Demo mode — Acme sample data. Configure Supabase for persistence or run CLI simulate for .loopgraph/ traces.",
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
        label: "Supabase connected — empty workspace. Run seed script or create a loop. Demo data is not shown.",
        className: "border-slate-200 bg-slate-50 text-slate-800"
      };
  }
}
