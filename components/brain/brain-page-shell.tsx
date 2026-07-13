import type { SemanticTopology } from "@/lib/loopgraph-core/graph";
import { LoopgraphBrainView } from "./loopgraph-brain-view";

export function BrainPageShell({ topology }: { topology: SemanticTopology }) {
  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-4 border-b border-line pb-5 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight text-ink">Company Brain</h1>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-ink/65">
            Maps how company management, department management, and workflow loops route work.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <StatusChip>Registered LoopSpecs</StatusChip>
          <StatusChip>Ready</StatusChip>
          <StatusChip>Demo mode</StatusChip>
        </div>
      </div>
      <LoopgraphBrainView topology={topology} />
    </div>
  );
}

function StatusChip({ children }: { children: React.ReactNode }) {
  return (
    <span className="rounded-md border border-line bg-white px-3 py-1.5 text-xs font-semibold text-ink/65">
      {children}
    </span>
  );
}
