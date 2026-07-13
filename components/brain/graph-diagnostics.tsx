import type { BrainGraphDiagnostics } from "./graph-types";

export function GraphDiagnostics({ diagnostics }: { diagnostics: BrainGraphDiagnostics }) {
  if (diagnostics.removedEdges.length === 0 && diagnostics.hiddenNodeIds.length === 0) {
    return null;
  }

  return (
    <details className="rounded-md border border-line bg-white px-3 py-2 text-xs text-ink/60">
      <summary className="cursor-pointer font-semibold text-ink">Graph diagnostics</summary>
      <div className="mt-2 grid gap-1">
        <div>{diagnostics.visibleNodeCount} visible nodes from {diagnostics.sourceNodeCount} semantic nodes.</div>
        <div>{diagnostics.hiddenNodeIds.length} nodes hidden by default view or layer controls.</div>
        <div>{diagnostics.removedEdges.length} edges removed because an endpoint is hidden or unsupported.</div>
      </div>
    </details>
  );
}
