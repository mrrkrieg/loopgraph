import type { SemanticTopology } from "@/lib/loopgraph-core/graph";
import Link from "next/link";
import {
  simulateBrainLoopManualEventAction,
  simulateBrainLoopFixtureAction,
  submitBrainGraphEditAction,
  validateBrainLoopAction
} from "@/app/brain/actions";
import type {
  GraphEditorTransactionReceipt,
  GraphLayoutOverrides
} from "loopgraph/runtime";
import { LoopgraphBrainView } from "./loopgraph-brain-view";

export function BrainPageShell({
  includeCatalogLoops = false,
  initialLayout = {},
  initialTransactions = [],
  previewMode = false,
  supervisor,
  topologyHash,
  topology
}: {
  includeCatalogLoops?: boolean;
  initialLayout?: GraphLayoutOverrides;
  initialTransactions?: GraphEditorTransactionReceipt[];
  previewMode?: boolean;
  supervisor?: SupervisorView;
  topologyHash: string;
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
              <StatusChip>{supervisor?.running ? "Supervisor running" : "Supervisor stopped"}</StatusChip>
              <StatusChip>{supervisor?.status ? `Health ${supervisor.status.health}` : "Not checked"}</StatusChip>
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
      {!previewMode ? <SupervisorStrip supervisor={supervisor} /> : null}
      <LoopgraphBrainView
        actions={{
          submitGraphEdit: submitBrainGraphEditAction,
          simulateManualEvent: simulateBrainLoopManualEventAction,
          simulateFixture: simulateBrainLoopFixtureAction,
          validateLoop: validateBrainLoopAction
        }}
        includeCatalogLoops={includeCatalogLoops}
        initialLayout={initialLayout}
        initialTransactions={initialTransactions}
        previewMode={previewMode}
        topologyHash={topologyHash}
        topology={topology}
      />
    </div>
  );
}

function SupervisorStrip({
  supervisor
}: {
  supervisor?: SupervisorView;
}) {
  const status = supervisor?.status;
  const action = status?.recommendedAction;
  return (
    <div className="flex flex-col gap-2 rounded-lg border border-line bg-white px-4 py-3 text-sm text-ink/65 sm:flex-row sm:items-center sm:justify-between">
      <div>
        <span className="font-semibold text-ink">
          {supervisor?.running ? "Local supervisor is running." : status ? "Local supervisor is stopped." : "Local supervisor has not run yet."}
        </span>{" "}
        {status
          ? `Last cycle ${status.health} at ${new Date(status.checkedAt).toLocaleString()}.`
          : "Run setup once, then start the worker, scheduler, route sync, controller, and health checks together."}
      </div>
      <div className="font-mono text-xs text-ink/55">
        {action ?? "loopgraph start"}
      </div>
    </div>
  );
}

type SupervisorView = {
  running: boolean;
  status?: {
    health: "healthy" | "degraded" | "blocked";
    checkedAt: string;
    recommendedAction?: string;
  };
};

function PreviewStoryStrip() {
  return (
    <div className="grid gap-3 md:grid-cols-4">
      <StoryCard
        eyebrow="Preview opens on Product"
        title="Start with one understandable route"
        body="The default canvas follows product events, support tickets, CRM context, docs, and warehouse metrics into Hermes before it shows the full company map."
      />
      <StoryCard
        eyebrow="1. Data points in"
        title="Events land in Hermes first"
        body="Provider webhooks and lifecycle callbacks terminate at Hermes Brain, not at individual workflow loops."
      />
      <StoryCard
        eyebrow="2. Hermes decides"
        title="Product owns the loops"
        body="Hermes routes only when the evidence matches a registered contract, otherwise it asks for context or human choice."
      />
      <StoryCard
        eyebrow="3. Evidence returns"
        title="Outcomes train the map"
        body="Accepted loops record traces, approvals, metrics, and improvement items so future routing decisions get clearer."
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
