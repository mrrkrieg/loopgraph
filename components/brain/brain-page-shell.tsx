import type { SemanticTopology } from "@/lib/loopgraph-core/graph";
import Link from "next/link";
import {
  simulateBrainLoopManualEventAction,
  simulateBrainLoopFixtureAction,
  validateBrainLoopAction
} from "@/app/brain/actions";
import { LoopgraphBrainView } from "./loopgraph-brain-view";

export function BrainPageShell({
  includeCatalogLoops = false,
  topology
}: {
  includeCatalogLoops?: boolean;
  topology: SemanticTopology;
}) {
  const brainLabel = topology.metadata.brainLabel ?? "Company Brain";
  const isHermes = topology.metadata.hierarchyMode === "hermes_brain";

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-4 border-b border-line pb-5 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight text-ink">{brainLabel}</h1>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-ink/65">
            {isHermes
              ? "Maps how Hermes receives business events and routes them into department workflow loops."
              : "Maps how company management, department management, and workflow loops route work."}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <StatusChip>Registered LoopSpecs</StatusChip>
          <StatusChip>Ready</StatusChip>
          <StatusChip>{isHermes ? "Hermes routing" : "Demo mode"}</StatusChip>
          <StatusChip>{includeCatalogLoops ? "Demo catalog visible" : "Demo catalog hidden"}</StatusChip>
          <Link
            className="rounded-md border border-line bg-white px-3 py-1.5 text-xs font-semibold text-ink/65 hover:border-ink hover:text-ink"
            href={includeCatalogLoops ? "/brain" : "/brain?catalog=1"}
          >
            {includeCatalogLoops ? "Hide catalog" : "Show catalog preview"}
          </Link>
        </div>
      </div>
      <LoopgraphBrainView
        actions={{
          simulateManualEvent: simulateBrainLoopManualEventAction,
          simulateFixture: simulateBrainLoopFixtureAction,
          validateLoop: validateBrainLoopAction
        }}
        includeCatalogLoops={includeCatalogLoops}
        topology={topology}
      />
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
