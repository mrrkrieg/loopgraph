import Link from "next/link";
import { DiscoveryStepNav } from "@/components/discovery-step-nav";
import { PageHeader } from "@/components/page-header";
import { SectionCard } from "@/components/section-card";
import { StatusPill } from "@/components/status-pill";
import {
  formatDepartmentType,
  type BusinessDiscoverySession,
  type LoopDesignContext,
  type LoopDesignProposal,
  type LoopDesignProposalSet
} from "loopgraph/core";
import {
  buildLoopDesignContext,
  listLoopgraphLoops,
  readDesignRun,
  readLoopDesignProposalSet,
  readLoopMaterializationResult,
  type HermesGraphProjection,
  type LoopMaterializationResult
} from "loopgraph/runtime";
import {
  getActiveLoopgraphProjectRoot,
  getDiscoveryDesignStore
} from "../../../lib/loopgraph-runtime/storage-resolver";
import {
  editBrowserLoopDesignProposalAction,
  materializeBrowserLoopDesignAction,
  simulateBrowserMaterializedLoopAction
} from "../actions";
import {
  getHermesDiscoverySessionForView,
  type DiscoverySearchParams
} from "../view-data";

type QueryParams = Record<string, string | string[] | undefined>;

export default async function CreateLoopsPage({ searchParams }: { searchParams?: DiscoverySearchParams }) {
  const query = await searchParams;
  const sessionId = stringParam(query, "sessionId");
  const requestedDesignRunId = stringParam(query, "designRunId");
  const materializationId = stringParam(query, "materializationId");
  const projectRoot = getActiveLoopgraphProjectRoot();
  const store = getDiscoveryDesignStore();
  const session = await getHermesDiscoverySessionForView(sessionId);
  const designRunId = requestedDesignRunId ?? session?.designRunIds.at(-1);
  const [designRun, proposalSet, materialization, loops, designContext] = await Promise.all([
    designRunId
      ? readDesignRun(projectRoot, designRunId, store)
      : Promise.resolve(undefined),
    designRunId
      ? readLoopDesignProposalSet(projectRoot, designRunId, store)
      : Promise.resolve(undefined),
    materializationId ? readLoopMaterializationResult(projectRoot, materializationId) : Promise.resolve(undefined),
    listLoopgraphLoops({ projectRoot }),
    session ? loadDesignContext(projectRoot, session) : Promise.resolve(undefined)
  ]);
  const proposalGraph = proposalSet ? graphFromProposalSet(proposalSet) : undefined;
  const activeGraph = materialization?.graphProjection ?? proposalGraph ?? loops.graphProjection;
  const activeDesignRunId = designRunId ?? "";
  const materializeFormId = designRunId ? `materialize-${safeDomId(designRunId)}` : "materialize-proposals";

  return (
    <>
      <PageHeader
        eyebrow="Hermes loop design"
        title="Create Loops"
        description="Review the loop proposals Hermes can use, accept the right ones, and materialize them into local LoopSpecs that Hermes routes to from incoming business events."
        action={session && designContext?.readiness === "ready_for_design" ? (
          <Link
            className="rounded-md bg-ink px-4 py-2 text-sm font-semibold text-white"
            href={`/discovery/designing?sessionId=${encodeURIComponent(session.id)}`}
          >
            Open designing
          </Link>
        ) : undefined}
      />
      <DiscoveryStepNav activeHref="/discovery/create-loops" sessionId={sessionId} />

      {!session ? (
        <SectionCard title="Start with a real Hermes/browser session" description="Loop materialization is only enabled for the shared project-local discovery sessions Hermes also sees.">
          <p className="text-sm leading-6 text-ink/65">
            The old demo recommendation path is not the primary flow here. Start or resume a real session, answer the compact bundles, then return here to create Hermes-routable loops.
          </p>
          <Link className="mt-4 inline-flex rounded-md bg-ink px-4 py-2 text-sm font-semibold text-white" href="/discovery">
            Open discovery home
          </Link>
        </SectionCard>
      ) : !proposalSet ? (
        <NoProposalState session={session} designContext={designContext} />
      ) : (
        <div className="grid gap-5 xl:grid-cols-[1.15fr_0.85fr]">
          <div className="space-y-5">
            <SectionCard
              title="Proposed Hermes loops"
              description={designRun
                ? `${proposalSet.proposals.length} proposal(s) from ${formatProviderMode(proposalSet.providerMode)} · ${designRun.reasoningProfile} reasoning`
                : `${proposalSet.proposals.length} proposal(s) ready for review`}
            >
              <div className="mb-4 flex flex-wrap gap-2">
                <StatusPill>{formatDepartmentType(proposalSet.departmentType)}</StatusPill>
                <StatusPill>{proposalSet.validationSummary.valid ? "Validated" : "Needs fixes"}</StatusPill>
                <StatusPill>Design run {designRunId}</StatusPill>
              </div>
              {!proposalSet.validationSummary.valid ? (
                <div className="mb-4 rounded-md border border-red-200 bg-red-50 p-3 text-sm leading-6 text-red-900">
                  <div className="font-semibold">Validation errors</div>
                  <ul className="mt-2 list-disc pl-5">
                    {proposalSet.validationSummary.errors.map((error) => <li key={error}>{error}</li>)}
                  </ul>
                </div>
              ) : null}

              <div className="space-y-4">
                {proposalSet.proposals.map((proposal) => (
                  <ProposalCard
                    key={proposal.proposalId}
                    proposal={proposal}
                    sessionId={session.id}
                    designRunId={activeDesignRunId}
                    expectedOutputHash={designRun?.outputHash}
                    materializeFormId={materializeFormId}
                  />
                ))}
                <form
                  id={materializeFormId}
                  action={materializeBrowserLoopDesignAction}
                  className="flex flex-wrap items-center gap-3 rounded-lg border border-line bg-canvas p-4"
                >
                  <input type="hidden" name="sessionId" value={session.id} />
                  <input type="hidden" name="designRunId" value={activeDesignRunId} />
                  <button
                    className="rounded-md bg-ink px-4 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"
                    type="submit"
                    disabled={!proposalSet.validationSummary.valid}
                  >
                    Materialize selected loops
                  </button>
                  <span className="text-sm leading-6 text-ink/60">
                    Writes local LoopSpecs under `.loopgraph/generated/hermes`, registers routing cards, and keeps all provider webhooks pointed at Hermes.
                  </span>
                </form>
              </div>
            </SectionCard>
          </div>

          <div className="space-y-5">
            <GraphPanel graph={activeGraph} title={materialization ? "Materialized Hermes graph" : "Hermes graph preview"} />
            <ConnectionChecklist proposals={proposalSet.proposals} />
            <MaterializationPanel materialization={materialization} loopCount={loops.count} />
          </div>
        </div>
      )}
    </>
  );
}

function NoProposalState({
  session,
  designContext
}: {
  session: BusinessDiscoverySession;
  designContext?: LoopDesignContext;
}) {
  const ready = designContext?.readiness === "ready_for_design";
  return (
    <div className="grid gap-5 lg:grid-cols-[0.9fr_1.1fr]">
      <SectionCard
        title={ready ? "Ready to design Hermes loops" : "Finish discovery first"}
        description={ready
          ? "The required question bundles are complete. Generate a proposal set, then choose which loops to materialize."
          : "Hermes needs a bounded design context before it can safely decide what loops should exist."}
      >
        <div className="flex flex-wrap gap-2 text-sm">
          <StatusPill>{session.activeDepartmentId ? formatDepartmentType(session.activeDepartmentId) : "No department selected"}</StatusPill>
          <StatusPill>{session.designRunIds.length} design run(s)</StatusPill>
          <StatusPill>Revision {session.revision}</StatusPill>
        </div>
        {ready ? (
          <Link
            className="mt-5 inline-flex rounded-md bg-ink px-4 py-2 text-sm font-semibold text-white"
            href={`/discovery/designing?sessionId=${encodeURIComponent(session.id)}`}
          >
            Open Hermes designing
          </Link>
        ) : (
          <Link
            className="mt-5 inline-flex rounded-md bg-ink px-4 py-2 text-sm font-semibold text-white"
            href={session.activeDepartmentId
              ? `/discovery/questions?sessionId=${encodeURIComponent(session.id)}`
              : `/discovery/departments?sessionId=${encodeURIComponent(session.id)}`}
          >
            Continue discovery
          </Link>
        )}
      </SectionCard>
      <SectionCard title="What Hermes will do next" description="Hermes stays the brain, while Loopgraph stays the local loop runtime and graph.">
        <ol className="list-decimal space-y-2 pl-5 text-sm leading-6 text-ink/65">
          <li>Compile the answered bundles into a bounded design context.</li>
          <li>Design loops with routing contracts, approvals, verification, and required connections.</li>
          <li>After you accept proposals, write local LoopSpecs that Hermes can route events into.</li>
          <li>Run the loops locally with generated synthetic Hermes fixtures before live execution.</li>
        </ol>
        {designContext?.blockers.length ? (
          <div className="mt-4 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm leading-6 text-amber-900">
            <div className="font-semibold">Needed before design</div>
            <ul className="mt-2 list-disc pl-5">
              {designContext.blockers.map((blocker) => <li key={blocker}>{blocker}</li>)}
            </ul>
          </div>
        ) : null}
      </SectionCard>
    </div>
  );
}

function ProposalCard({
  proposal,
  sessionId,
  designRunId,
  expectedOutputHash,
  materializeFormId
}: {
  proposal: LoopDesignProposal;
  sessionId: string;
  designRunId: string;
  expectedOutputHash?: string;
  materializeFormId: string;
}) {
  return (
    <article className="rounded-lg border border-line bg-white p-4">
      <label className="flex items-start gap-3">
        <input
          className="mt-1"
          type="checkbox"
          form={materializeFormId}
          name="acceptedProposalIds"
          value={proposal.proposalId}
          defaultChecked
        />
        <span>
          <span className="block text-base font-semibold text-ink">{proposal.shortName}</span>
          <span className="mt-1 block text-sm leading-6 text-ink/60">{proposal.goal}</span>
        </span>
      </label>

      <div className="mt-4 grid gap-4 md:grid-cols-2">
        <div>
          <div className="text-xs font-semibold uppercase tracking-[0.14em] text-ink/45">Why this loop</div>
          <p className="mt-2 text-sm leading-6 text-ink/65">{proposal.reasoningSummary}</p>
        </div>
        <div>
          <div className="text-xs font-semibold uppercase tracking-[0.14em] text-ink/45">Hermes trigger</div>
          <p className="mt-2 text-sm leading-6 text-ink/65">{proposal.trigger.description}</p>
          <div className="mt-2 flex flex-wrap gap-2">
            {proposal.routing.problemTypes.map((type) => <StatusPill key={type}>{type}</StatusPill>)}
          </div>
        </div>
      </div>

      <div className="mt-4 grid gap-4 md:grid-cols-3">
        <MiniList title="Routine" items={proposal.routineSteps.map((step) => `${step.label} — ${step.actor}`)} />
        <MiniList title="Required from you" items={proposal.requiredFromUser.map((item) => item.label)} />
        <MiniList title="Guardrails" items={[...proposal.forbiddenActions, ...proposal.metrics.guardrails]} />
      </div>

      <details className="mt-4 rounded-lg border border-line bg-canvas p-3">
        <summary className="cursor-pointer text-sm font-semibold text-ink">
          Edit proposal before materializing
        </summary>
        <form action={editBrowserLoopDesignProposalAction} className="mt-4 space-y-4">
          <input type="hidden" name="sessionId" value={sessionId} />
          <input type="hidden" name="designRunId" value={designRunId} />
          <input type="hidden" name="proposalId" value={proposal.proposalId} />
          {expectedOutputHash ? <input type="hidden" name="expectedOutputHash" value={expectedOutputHash} /> : null}
          <div className="grid gap-4 md:grid-cols-2">
            <TextInput label="Name" name="shortName" defaultValue={proposal.shortName} />
            <TextInput label="Owner role" name="ownerRole" defaultValue={proposal.ownerRole} />
            <TextArea label="Goal" name="goal" defaultValue={proposal.goal} />
            <TextArea label="Business outcome" name="businessOutcome" defaultValue={proposal.businessOutcome} />
            <TextArea label="Hermes trigger" name="triggerDescription" defaultValue={proposal.trigger.description} />
            <TextArea label="Work item" name="workItem" defaultValue={proposal.workItem} />
            <TextArea label="Context sources" name="contextSources" defaultValue={proposal.contextSources.join("\n")} />
            <TextArea label="Observed signals" name="observedSignals" defaultValue={proposal.observedSignals.join("\n")} />
            <TextInput label="Primary metric" name="metricsPrimary" defaultValue={proposal.metrics.primary} />
            <TextArea label="Guardrail metrics" name="metricsGuardrails" defaultValue={proposal.metrics.guardrails.join("\n")} />
            <TextArea label="Reviewers / approvers" name="reviewerRoles" defaultValue={proposal.reviewerRoles.join("\n")} />
            <TextArea label="Escalation conditions" name="escalationConditions" defaultValue={proposal.escalationConditions.join("\n")} />
            <TextArea label="Forbidden actions" name="forbiddenActions" defaultValue={proposal.forbiddenActions.join("\n")} />
            <TextArea label="Manual fallbacks" name="manualFallbacks" defaultValue={proposal.manualFallbacks.join("\n")} />
            <TextArea label="Routing problem types" name="routingProblemTypes" defaultValue={proposal.routing.problemTypes.join("\n")} />
            <TextInput label="Routing confidence threshold" name="routingMinimumConfidence" defaultValue={String(proposal.routing.minimumConfidence)} />
          </div>
          <details className="rounded-md border border-line bg-white p-3">
            <summary className="cursor-pointer text-sm font-semibold text-ink/70">Advanced structured fields</summary>
            <div className="mt-4 grid gap-4">
              <TextArea label="Routine steps JSON" name="routineStepsJson" defaultValue={jsonDefault(proposal.routineSteps)} monospace />
              <TextArea label="Proposed actions JSON" name="proposedActionsJson" defaultValue={jsonDefault(proposal.proposedActions)} monospace />
              <TextArea label="Verifiers JSON" name="verifiersJson" defaultValue={jsonDefault(proposal.verifiers)} monospace />
              <TextArea label="Connector requirements JSON" name="connectorRequirementsJson" defaultValue={jsonDefault(proposal.connectorRequirements)} monospace />
              <TextArea label="Required from user JSON" name="requiredFromUserJson" defaultValue={jsonDefault(proposal.requiredFromUser)} monospace />
            </div>
          </details>
          <button className="rounded-md bg-ink px-4 py-2 text-sm font-semibold text-white" type="submit">
            Save edited proposal
          </button>
        </form>
      </details>
    </article>
  );
}

function GraphPanel({ graph, title }: { graph?: HermesGraphProjection; title: string }) {
  const nodesById = new Map((graph?.nodes ?? []).map((node) => [node.id, node]));
  return (
    <SectionCard title={title} description="Provider webhooks go to Hermes first; Hermes chooses the right registered loop from the routing contracts.">
      {!graph || graph.edges.length === 0 ? (
        <p className="text-sm leading-6 text-ink/60">No graph data yet. Generate or materialize proposals to see the Hermes route.</p>
      ) : (
        <div className="space-y-3">
          <div className="flex flex-wrap gap-2">
            {graph.nodes.map((node) => <StatusPill key={node.id}>{node.label}</StatusPill>)}
          </div>
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
        </div>
      )}
    </SectionCard>
  );
}

function ConnectionChecklist({ proposals }: { proposals: LoopDesignProposal[] }) {
  const requirements = uniqueBy(
    proposals.flatMap((proposal) => proposal.connectorRequirements.map((requirement) => ({
      ...requirement,
      proposal: proposal.shortName
    }))),
    (item) => `${item.capability}:${item.requiredFor}:${item.proposal}`
  );
  return (
    <SectionCard title="What to connect" description="These are non-secret connection needs. Add provider webhooks to Hermes, not directly to Loopgraph.">
      {requirements.length === 0 ? (
        <p className="text-sm leading-6 text-ink/60">No connector requirements were proposed.</p>
      ) : (
        <ul className="space-y-2 text-sm leading-6">
          {requirements.map((item) => (
            <li key={`${item.capability}:${item.proposal}`} className="rounded-md border border-line bg-paper px-3 py-2">
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

function MaterializationPanel({
  materialization,
  loopCount
}: {
  materialization?: LoopMaterializationResult;
  loopCount: number;
}) {
  return (
    <SectionCard title="Local run status" description={`${loopCount} registered Loopgraph loop(s) in this project`}>
      {!materialization ? (
        <p className="text-sm leading-6 text-ink/60">
          After materialization, this panel will show the generated loop IDs, safe starter Hermes events, and local run controls.
        </p>
      ) : !materialization.valid ? (
        <div className="text-sm leading-6 text-red-800">
          <div className="font-semibold">Materialization failed</div>
          <ul className="mt-2 list-disc pl-5">
            {materialization.errors.map((error) => <li key={error}>{error}</li>)}
          </ul>
        </div>
      ) : (
        <div className="space-y-3 text-sm">
          {materialization.materializedLoops.map((loop) => (
            <div key={loop.loopId} className="rounded-md border border-line bg-paper px-3 py-2">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-semibold text-ink">{loop.name}</span>
                <StatusPill>{loop.status.replaceAll("_", " ")}</StatusPill>
              </div>
              <p className="mt-2 font-mono text-xs leading-5 text-ink/60">{loop.relativeSpecPath}</p>
              <div className="mt-3 space-y-2">
                <div className="text-xs font-semibold uppercase tracking-[0.14em] text-ink/45">
                  Run locally with synthetic Hermes events
                </div>
                <div className="grid gap-2">
                  {loop.simulation.starterFixtures.map((fixture) => (
                    <form
                      key={fixture.id}
                      action={simulateBrowserMaterializedLoopAction}
                      className="rounded-md border border-line bg-white p-2"
                    >
                      <input type="hidden" name="loopId" value={loop.loopId} />
                      <input type="hidden" name="fixturePath" value={fixture.path} />
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div>
                          <div className="font-semibold text-ink">{fixture.label}</div>
                          <div className="font-mono text-xs leading-5 text-ink/50">{fixture.relativePath}</div>
                        </div>
                        <button
                          className="rounded-md border border-line px-3 py-1.5 text-xs font-semibold text-ink/70 hover:border-ink hover:text-ink"
                          type="submit"
                        >
                          Simulate
                        </button>
                      </div>
                    </form>
                  ))}
                </div>
                <p className="text-xs leading-5 text-ink/55">
                  These runs use generated fixtures only. Live provider webhooks should still be connected to Hermes, which then chooses the right loop.
                </p>
              </div>
              <div className="mt-2 rounded bg-white px-3 py-2 font-mono text-xs leading-5 text-ink/70">
                {loop.simulation.command}
              </div>
            </div>
          ))}
          <ul className="list-disc space-y-1 pl-5 leading-6 text-ink/60">
            {materialization.nextActions.map((action) => <li key={action}>{action}</li>)}
          </ul>
          <Link className="inline-flex rounded-md border border-line px-3 py-2 text-sm font-semibold text-ink/70 hover:border-ink hover:text-ink" href="/topology">
            Open topology
          </Link>
        </div>
      )}
    </SectionCard>
  );
}

function TextInput({
  label,
  name,
  defaultValue
}: {
  label: string;
  name: string;
  defaultValue: string;
}) {
  return (
    <label className="block">
      <span className="text-sm font-semibold text-ink">{label}</span>
      <input
        className="mt-2 min-h-10 w-full rounded-md border border-line bg-white px-3 py-2 text-sm text-ink outline-none transition focus:border-ink"
        name={name}
        defaultValue={defaultValue}
      />
    </label>
  );
}

function TextArea({
  label,
  name,
  defaultValue,
  monospace = false
}: {
  label: string;
  name: string;
  defaultValue: string;
  monospace?: boolean;
}) {
  return (
    <label className="block">
      <span className="text-sm font-semibold text-ink">{label}</span>
      <textarea
        className={`mt-2 min-h-24 w-full rounded-md border border-line bg-white px-3 py-2 text-sm text-ink outline-none transition focus:border-ink ${monospace ? "font-mono text-xs" : ""}`}
        name={name}
        defaultValue={defaultValue}
      />
    </label>
  );
}

function MiniList({ title, items }: { title: string; items: string[] }) {
  return (
    <div>
      <div className="text-xs font-semibold uppercase tracking-[0.14em] text-ink/45">{title}</div>
      <ul className="mt-2 list-disc space-y-1 pl-5 text-sm leading-6 text-ink/65">
        {(items.length ? items : ["Not specified"]).map((item) => <li key={item}>{item}</li>)}
      </ul>
    </div>
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

function formatProviderMode(mode: LoopDesignProposalSet["providerMode"]): string {
  if (mode === "hermes_host") return "Hermes-hosted";
  if (mode === "embedded") return "embedded";
  return "local deterministic fallback";
}

function stringParam(query: QueryParams | undefined, key: string): string | undefined {
  const value = query?.[key];
  return Array.isArray(value) ? value[0] : value;
}

function jsonDefault(value: unknown): string {
  return JSON.stringify(value, null, 2);
}

function safeDomId(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]/g, "_");
}
