import Link from "next/link";
import { DiscoveryStepNav } from "@/components/discovery-step-nav";
import { PageHeader } from "@/components/page-header";
import { SectionCard } from "@/components/section-card";
import { StatusPill } from "@/components/status-pill";
import {
  formatDepartmentType,
  type BusinessDiscoverySession,
  type DesignRun,
  type LoopDesignContext,
  type LoopDesignProposalSet
} from "loopgraph/core";
import {
  buildLoopDesignContext,
  readDesignRun,
  readLoopDesignProposalSet,
  type HermesGraphProjection
} from "loopgraph/runtime";
import {
  getActiveLoopgraphProjectRoot,
  getDiscoveryDesignStore
} from "../../../lib/loopgraph-runtime/storage-resolver";
import { generateBrowserLoopDesignAction } from "../actions";
import {
  getHermesDiscoverySessionForView,
  type DiscoverySearchParams
} from "../view-data";

type QueryParams = Record<string, string | string[] | undefined>;

export default async function DiscoveryDesigningPage({ searchParams }: { searchParams?: DiscoverySearchParams }) {
  const query = await searchParams;
  const sessionId = stringParam(query, "sessionId");
  const requestedDesignRunId = stringParam(query, "designRunId");
  const projectRoot = getActiveLoopgraphProjectRoot();
  const store = getDiscoveryDesignStore();
  const session = await getHermesDiscoverySessionForView(sessionId);
  const designRunId = requestedDesignRunId ?? session?.designRunIds.at(-1);
  const [designContext, designRun, proposalSet] = await Promise.all([
    session ? loadDesignContext(projectRoot, session) : Promise.resolve(undefined),
    designRunId
      ? readDesignRun(projectRoot, designRunId, store)
      : Promise.resolve(undefined),
    designRunId
      ? readLoopDesignProposalSet(projectRoot, designRunId, store)
      : Promise.resolve(undefined)
  ]);
  const ready = designContext?.readiness === "ready_for_design";

  return (
    <>
      <PageHeader
        eyebrow="Hermes loop design"
        title="Designing"
        description="This is the reasoning handoff: Hermes receives the bounded discovery context, decides which loops should exist, validates the proposal set, and prepares the graph for review."
        action={session && ready ? (
          <form action={generateBrowserLoopDesignAction}>
            <input type="hidden" name="sessionId" value={session.id} />
            {session.activeDepartmentId ? <input type="hidden" name="department" value={session.activeDepartmentId} /> : null}
            <input type="hidden" name="maxProposals" value="2" />
            <button className="rounded-md bg-ink px-4 py-2 text-sm font-semibold text-white" type="submit">
              Run Hermes design
            </button>
          </form>
        ) : undefined}
      />
      <DiscoveryStepNav activeHref="/discovery/designing" sessionId={sessionId} />

      {!session ? (
        <SectionCard title="Start with a real Hermes/browser session" description="The designing stage needs the shared project-local session Hermes also sees.">
          <p className="text-sm leading-6 text-ink/65">
            Start or resume a real discovery session, confirm the project, choose a department, and answer the five compact bundles before design.
          </p>
          <Link className="mt-4 inline-flex rounded-md bg-ink px-4 py-2 text-sm font-semibold text-white" href="/discovery">
            Open discovery home
          </Link>
        </SectionCard>
      ) : !session.activeDepartmentId ? (
        <SectionCard title="Choose a department first" description="Hermes designs loops for one selected department at a time.">
          <Link
            className="inline-flex rounded-md bg-ink px-4 py-2 text-sm font-semibold text-white"
            href={`/discovery/departments?sessionId=${encodeURIComponent(session.id)}`}
          >
            Choose departments
          </Link>
        </SectionCard>
      ) : !ready ? (
        <DesignNotReady session={session} designContext={designContext} />
      ) : (
        <div className="grid gap-5 xl:grid-cols-[1fr_1fr]">
          <div className="space-y-5">
            <DesignContextPanel session={session} designContext={designContext} />
            <DesignProgressPanel designRun={designRun} proposalSet={proposalSet} />
          </div>
          <div className="space-y-5">
            {proposalSet && designRun ? (
              <>
                <DesignOutputPanel session={session} designRun={designRun} proposalSet={proposalSet} />
                <GraphPreviewPanel graph={graphFromProposalSet(proposalSet)} />
                <ConnectionPreviewPanel proposalSet={proposalSet} />
              </>
            ) : (
              <>
                <CandidateLoopsPanel designContext={designContext} />
                <ConnectorStatusPanel designContext={designContext} />
              </>
            )}
          </div>
        </div>
      )}
    </>
  );
}

function DesignNotReady({
  session,
  designContext
}: {
  session: BusinessDiscoverySession;
  designContext?: LoopDesignContext;
}) {
  const blockers = designContext?.blockers ?? ["The design context could not be compiled yet."];
  return (
    <div className="grid gap-5 lg:grid-cols-[0.9fr_1.1fr]">
      <SectionCard title="Finish discovery before Hermes designs loops" description="Hermes should not invent loops until the required operating context is confirmed.">
        <div className="flex flex-wrap gap-2">
          <StatusPill>{session.activeDepartmentId ? formatDepartmentType(session.activeDepartmentId) : "No department"}</StatusPill>
          <StatusPill>Revision {session.revision}</StatusPill>
          <StatusPill>{session.questionQueue.filter((item) => item.status === "answered").length} answered</StatusPill>
        </div>
        <ul className="mt-4 list-disc space-y-2 pl-5 text-sm leading-6 text-ink/65">
          {blockers.map((blocker) => <li key={blocker}>{blocker}</li>)}
        </ul>
        <Link
          className="mt-5 inline-flex rounded-md bg-ink px-4 py-2 text-sm font-semibold text-white"
          href={`/discovery/questions?sessionId=${encodeURIComponent(session.id)}`}
        >
          Continue questions
        </Link>
      </SectionCard>
      <SectionCard title="Why Hermes waits" description="The brain needs enough signal to route future business problems correctly.">
        <ol className="list-decimal space-y-2 pl-5 text-sm leading-6 text-ink/65">
          <li>Current stack and safe data sources tell Hermes what evidence it can trust.</li>
          <li>The recurring problem defines which business events should trigger a loop.</li>
          <li>Automation boundaries prevent unsafe write actions and customer-facing mistakes.</li>
          <li>Outcome proof and ownership rules tell Hermes how to verify and escalate work.</li>
        </ol>
      </SectionCard>
    </div>
  );
}

function DesignContextPanel({
  session,
  designContext
}: {
  session: BusinessDiscoverySession;
  designContext: LoopDesignContext;
}) {
  return (
    <SectionCard
      title="Hermes design context"
      description="This is the bounded packet Hermes uses to decide which loops should exist. Private chain-of-thought is not stored; only useful summaries and validated proposals are persisted."
    >
      <div className="flex flex-wrap gap-2 text-sm">
        <StatusPill>{formatDepartmentType(designContext.departmentType)}</StatusPill>
        <StatusPill>{designContext.confirmedAnswers.length} confirmed answers</StatusPill>
        <StatusPill>{designContext.deterministicCandidates.length} candidate loop(s)</StatusPill>
        <StatusPill>{session.designRunIds.length} design run(s)</StatusPill>
      </div>
      <dl className="mt-4 grid gap-3 text-sm">
        <div>
          <dt className="text-xs uppercase tracking-[0.14em] text-ink/45">Context hash</dt>
          <dd className="mt-1 font-mono text-xs leading-5 text-ink/65">{designContext.contextHash}</dd>
        </div>
        <div>
          <dt className="text-xs uppercase tracking-[0.14em] text-ink/45">Project</dt>
          <dd className="mt-1 text-ink/70">
            {designContext.projectSummary.displayName} · {designContext.projectSummary.registeredSpecCount} registered loop(s)
          </dd>
        </div>
        <div>
          <dt className="text-xs uppercase tracking-[0.14em] text-ink/45">Safety boundaries</dt>
          <dd className="mt-1 text-ink/70">
            {designContext.companyBoundaries.length ? designContext.companyBoundaries.join("; ") : "No forbidden actions were supplied."}
          </dd>
        </div>
      </dl>
      <form action={generateBrowserLoopDesignAction} className="mt-5 flex flex-wrap items-center gap-3">
        <input type="hidden" name="sessionId" value={session.id} />
        <input type="hidden" name="department" value={designContext.departmentType} />
        <input type="hidden" name="maxProposals" value="2" />
        <button className="rounded-md bg-ink px-4 py-2 text-sm font-semibold text-white" type="submit">
          {session.designRunIds.length ? "Run another Hermes design" : "Design Hermes loops"}
        </button>
        {session.designRunIds.length ? (
          <Link
            className="text-sm font-medium text-ink/60 hover:text-ink"
            href={`/discovery/create-loops?sessionId=${encodeURIComponent(session.id)}&designRunId=${encodeURIComponent(session.designRunIds.at(-1)!)}`}
          >
            Review latest proposals
          </Link>
        ) : null}
      </form>
    </SectionCard>
  );
}

function DesignProgressPanel({
  designRun,
  proposalSet
}: {
  designRun?: DesignRun;
  proposalSet?: LoopDesignProposalSet;
}) {
  const steps = [
    { label: "Compile company brain context", status: "complete", detail: "Project profile, department, answers, and boundaries are ready." },
    { label: "Choose candidate loops", status: "complete", detail: "Hermes can separate workflows such as ads vs. content instead of creating one vague department loop." },
    {
      label: "Reason over loop design",
      status: designRun ? "complete" : "ready",
      detail: designRun ? `${designRun.reasoningProfile} reasoning · ${formatProviderMode(designRun.providerMode)}` : "Ready for Hermes-hosted reasoning or local deterministic fallback."
    },
    {
      label: "Validate routing and safety",
      status: proposalSet ? (proposalSet.validationSummary.valid ? "complete" : "needs_attention") : "waiting",
      detail: proposalSet
        ? proposalSet.validationSummary.valid
          ? "Proposal schemas, routing contracts, approvals, and connector needs validated."
          : `${proposalSet.validationSummary.errors.length} validation issue(s) need editing.`
        : "Runs after Hermes returns a proposal set."
    },
    {
      label: "Prepare graph review",
      status: proposalSet ? "complete" : "waiting",
      detail: proposalSet ? "The route preview is ready for the Hermes Loops review step." : "Waiting for proposed loops."
    }
  ];

  return (
    <SectionCard title="Design progress" description="The stage is explicit so users can understand why the loops exist before they materialize them.">
      <ol className="space-y-3">
        {steps.map((step, index) => (
          <li key={step.label} className="rounded-lg border border-line bg-white p-3">
            <div className="flex flex-wrap items-center gap-2">
              <StatusPill>{index + 1}</StatusPill>
              <span className="font-semibold text-ink">{step.label}</span>
              <StatusPill>{step.status.replaceAll("_", " ")}</StatusPill>
            </div>
            <p className="mt-2 text-sm leading-6 text-ink/60">{step.detail}</p>
          </li>
        ))}
      </ol>
    </SectionCard>
  );
}

function CandidateLoopsPanel({ designContext }: { designContext: LoopDesignContext }) {
  return (
    <SectionCard title="Candidate loops" description="Hermes starts from these candidates, then uses the discovery answers to decide what should become real proposals.">
      <div className="space-y-3">
        {designContext.deterministicCandidates.map((candidate) => (
          <article key={candidate.id} className="rounded-lg border border-line bg-white p-3">
            <div className="font-semibold text-ink">{candidate.name}</div>
            <p className="mt-2 text-sm leading-6 text-ink/60">{candidate.whyCandidate}</p>
            <div className="mt-3 flex flex-wrap gap-2">
              {candidate.expectedRoutingProblemTypes.map((problemType) => <StatusPill key={problemType}>{problemType}</StatusPill>)}
            </div>
          </article>
        ))}
      </div>
    </SectionCard>
  );
}

function ConnectorStatusPanel({ designContext }: { designContext: LoopDesignContext }) {
  return (
    <SectionCard title="Known connection status" description="Before live use, provider webhooks and connectors should point to Hermes as the brain.">
      {designContext.connectorStatus.length === 0 ? (
        <p className="text-sm leading-6 text-ink/60">No connector status was inferred from the answers yet. Hermes can still generate simulation-ready loops with manual fallbacks.</p>
      ) : (
        <ul className="space-y-2">
          {designContext.connectorStatus.map((item) => (
            <li key={item.capability} className="rounded-md border border-line bg-paper px-3 py-2 text-sm">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-semibold text-ink">{item.capability}</span>
                <StatusPill>{item.status.replaceAll("_", " ")}</StatusPill>
              </div>
              <div className="mt-1 text-xs leading-5 text-ink/50">
                Evidence answers: {item.sourceAnswerIds.length ? item.sourceAnswerIds.join(", ") : "none"}
              </div>
            </li>
          ))}
        </ul>
      )}
    </SectionCard>
  );
}

function DesignOutputPanel({
  session,
  designRun,
  proposalSet
}: {
  session: BusinessDiscoverySession;
  designRun: DesignRun;
  proposalSet: LoopDesignProposalSet;
}) {
  return (
    <SectionCard
      title="Hermes design output"
      description={`${proposalSet.proposals.length} proposed loop(s) are ready for review and local materialization.`}
    >
      <div className="flex flex-wrap gap-2 text-sm">
        <StatusPill>{proposalSet.validationSummary.valid ? "Validated" : "Needs edits"}</StatusPill>
        <StatusPill>{formatProviderMode(designRun.providerMode)}</StatusPill>
        <StatusPill>{designRun.reasoningProfile} reasoning</StatusPill>
      </div>
      <p className="mt-3 font-mono text-xs leading-5 text-ink/55">{designRun.id}</p>
      {!proposalSet.validationSummary.valid ? (
        <div className="mt-4 rounded-md border border-red-200 bg-red-50 p-3 text-sm leading-6 text-red-900">
          <div className="font-semibold">Validation errors</div>
          <ul className="mt-2 list-disc pl-5">
            {proposalSet.validationSummary.errors.map((error) => <li key={error}>{error}</li>)}
          </ul>
        </div>
      ) : null}
      <div className="mt-4 space-y-3">
        {proposalSet.proposals.map((proposal) => (
          <article key={proposal.proposalId} className="rounded-lg border border-line bg-paper p-3">
            <div className="font-semibold text-ink">{proposal.shortName}</div>
            <p className="mt-2 text-sm leading-6 text-ink/65">{proposal.goal}</p>
            <p className="mt-2 text-sm leading-6 text-ink/55">Trigger: {proposal.trigger.description}</p>
            <div className="mt-3 flex flex-wrap gap-2">
              {proposal.routing.problemTypes.map((problemType) => <StatusPill key={problemType}>{problemType}</StatusPill>)}
            </div>
          </article>
        ))}
      </div>
      <Link
        className="mt-5 inline-flex rounded-md bg-ink px-4 py-2 text-sm font-semibold text-white"
        href={`/discovery/create-loops?sessionId=${encodeURIComponent(session.id)}&designRunId=${encodeURIComponent(designRun.id)}`}
      >
        Review and materialize Hermes loops
      </Link>
    </SectionCard>
  );
}

function GraphPreviewPanel({ graph }: { graph: HermesGraphProjection }) {
  const nodesById = new Map(graph.nodes.map((node) => [node.id, node]));
  return (
    <SectionCard title="Loop graph preview" description="All provider events enter Hermes first; Hermes then routes to the loop whose contract best matches the business problem.">
      <ol className="space-y-2 text-sm">
        {graph.edges.map((edge) => (
          <li key={`${edge.source}:${edge.target}:${edge.label}`} className="rounded-md border border-line bg-paper px-3 py-2">
            <span className="font-medium text-ink">{nodesById.get(edge.source)?.label ?? edge.source}</span>
            <span className="px-2 text-ink/35">→</span>
            <span className="font-medium text-ink">{nodesById.get(edge.target)?.label ?? edge.target}</span>
            <span className="ml-2 text-ink/50">({edge.label}{edge.executable ? ", executable" : ""})</span>
          </li>
        ))}
      </ol>
    </SectionCard>
  );
}

function ConnectionPreviewPanel({ proposalSet }: { proposalSet: LoopDesignProposalSet }) {
  const requirements = uniqueBy(
    proposalSet.proposals.flatMap((proposal) => proposal.connectorRequirements.map((requirement) => ({
      ...requirement,
      proposal: proposal.shortName
    }))),
    (item) => `${item.proposal}:${item.capability}:${item.requiredFor}`
  );
  return (
    <SectionCard title="What you will connect" description="These are non-secret requirements. Webhooks and live provider events should be added to Hermes, not directly to individual loops.">
      {requirements.length === 0 ? (
        <p className="text-sm leading-6 text-ink/60">No connector requirements were proposed.</p>
      ) : (
        <ul className="space-y-2 text-sm leading-6">
          {requirements.map((item) => (
            <li key={`${item.proposal}:${item.capability}`} className="rounded-md border border-line bg-paper px-3 py-2">
              <div className="font-semibold text-ink">{item.capability}</div>
              <div className="text-ink/60">{item.proposal} · required for {item.requiredFor}</div>
              <div className="text-ink/60">{item.reason}</div>
            </li>
          ))}
        </ul>
      )}
    </SectionCard>
  );
}

async function loadDesignContext(
  projectRoot: string,
  session: BusinessDiscoverySession
): Promise<LoopDesignContext | undefined> {
  try {
    return await buildLoopDesignContext({
      projectRoot,
      store: getDiscoveryDesignStore(),
      sessionId: session.id,
      department: session.activeDepartmentId
    });
  } catch {
    return undefined;
  }
}

function graphFromProposalSet(proposalSet: LoopDesignProposalSet): HermesGraphProjection {
  return dedupeGraph({
    nodes: proposalSet.proposals.flatMap((proposal) => proposal.topologyPreview.nodes),
    edges: proposalSet.proposals.flatMap((proposal) => proposal.topologyPreview.edges)
  });
}

function dedupeGraph(graph: HermesGraphProjection): HermesGraphProjection {
  return {
    nodes: uniqueBy(graph.nodes, (node) => node.id),
    edges: uniqueBy(graph.edges, (edge) => `${edge.source}:${edge.target}:${edge.label}`)
  };
}

function uniqueBy<T>(items: T[], key: (item: T) => string): T[] {
  return Array.from(new Map(items.map((item) => [key(item), item])).values());
}

function formatProviderMode(mode: DesignRun["providerMode"]): string {
  if (mode === "hermes_host") return "Hermes-hosted";
  if (mode === "embedded") return "embedded";
  return "local deterministic fallback";
}

function stringParam(query: QueryParams | undefined, key: string): string | undefined {
  const value = query?.[key];
  return Array.isArray(value) ? value[0] : value;
}
