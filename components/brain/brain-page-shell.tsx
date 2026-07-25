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
  previewMode = false,
  topology
}: {
  includeCatalogLoops?: boolean;
  previewMode?: boolean;
  topology: SemanticTopology;
}) {
  const brainLabel = topology.metadata.brainLabel ?? "Company Brain";
  const isHermes = topology.metadata.hierarchyMode === "hermes_brain";
  const catalogToggleHref = includeCatalogLoops ? "/brain?catalog=0" : "/brain?catalog=1";

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-4 border-b border-line pb-5 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight text-ink">{brainLabel}</h1>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-ink/65">
            {previewMode
              ? "Public preview: business data points enter Hermes Brain, Hermes chooses the right department loop, and loop outcomes return as evidence."
              : isHermes
              ? "Maps how Hermes receives business events and routes them into department workflow loops."
              : "Maps how company management, department management, and workflow loops route work."}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {previewMode ? (
            <>
              <StatusChip>Hosted preview</StatusChip>
              <StatusChip>Sample company map</StatusChip>
              <StatusChip>Hermes routing</StatusChip>
              <StatusChip>Local installs stay sparse</StatusChip>
            </>
          ) : (
            <>
              <StatusChip>Registered LoopSpecs</StatusChip>
              <StatusChip>Ready</StatusChip>
              <StatusChip>{isHermes ? "Hermes routing" : "Demo mode"}</StatusChip>
              <StatusChip>{includeCatalogLoops ? "Catalog visible" : "Catalog hidden"}</StatusChip>
            </>
          )}
          <Link
            className="rounded-md border border-line bg-white px-3 py-1.5 text-xs font-semibold text-ink/65 hover:border-ink hover:text-ink"
            href={catalogToggleHref}
          >
            {includeCatalogLoops
              ? previewMode ? "View sparse install state" : "Hide catalog"
              : "Show catalog preview"}
          </Link>
        </div>
      </div>
      {previewMode ? <PreviewStoryStrip /> : null}
      <LoopgraphBrainView
        actions={{
          simulateManualEvent: simulateBrainLoopManualEventAction,
          simulateFixture: simulateBrainLoopFixtureAction,
          validateLoop: validateBrainLoopAction
        }}
        includeCatalogLoops={includeCatalogLoops}
        previewMode={previewMode}
        topology={topology}
      />
    </div>
  );
}

function PreviewStoryStrip() {
  return (
    <div className="grid gap-3 md:grid-cols-3">
      <StoryCard
        eyebrow="1. Data points in"
        title="Events land in Hermes first"
        body="Ads, CRM, support, product analytics, incidents, docs, billing, email, calendar, and warehouse metrics become routing evidence."
      />
      <StoryCard
        eyebrow="2. Hermes decides"
        title="Departments own loops"
        body="Hermes Brain does not blindly run everything. It chooses Product, Marketing, Sales, CS, Engineering, Finance/Ops, Legal/Security, HR, or Management loops."
      />
      <StoryCard
        eyebrow="3. Evidence returns"
        title="Loops improve the company graph"
        body="Each loop records outcomes, reviews, metrics, and improvement items so the next decision has better context."
      />
    </div>
  );
}

function StoryCard({
  eyebrow,
  title,
  body
}: {
  eyebrow: string;
  title: string;
  body: string;
}) {
  return (
    <div className="rounded-lg border border-line bg-white p-4 shadow-sm">
      <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-orange-600">{eyebrow}</div>
      <h2 className="mt-2 text-base font-semibold text-ink">{title}</h2>
      <p className="mt-2 text-sm leading-6 text-ink/62">{body}</p>
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
