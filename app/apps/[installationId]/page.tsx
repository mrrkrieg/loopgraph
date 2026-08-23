import Link from "next/link";
import { notFound } from "next/navigation";
import { AppStatusPill } from "@/components/apps/app-status-pill";
import { AppOnboardingProgress } from "@/components/apps/app-onboarding-progress";
import { AppLifecycleRecoveryNotice, recoveryInstruction } from "@/components/apps/app-lifecycle-recovery";
import { InstalledAppActionsPanel, InstalledAppActivityPanel, InstalledAppOutcomesPanel, InstalledAppTopologyPanel } from "@/components/apps/installed-app-operations";
import { PageHeader } from "@/components/page-header";
import { SectionCard } from "@/components/section-card";
import { getInstalledAppViewData } from "@/lib/app-platform/read-model";
import { appOnboardingProgressForView } from "@/lib/app-platform/install-wizard";
import {
  activationEvidenceRefs,
  currentActivationApproval,
  type BrowserActivationMode
} from "@/lib/app-platform/app-activation-handoff";
import { installedAppPresentation } from "@/lib/app-platform/private-app-handoff";
import { isHostedAuthRequired } from "@/lib/auth/hosted-config";
import {
  activateInstalledAppAction,
  approveInstalledAppActivationAction,
  applyInstalledAppUpdateAction,
  configureInstalledAppAction,
  detachInstalledAppAction,
  duplicateInstalledAppAction,
  labelAppEvaluationAction,
  overlayInstalledAppAction,
  operateInstalledAppAction,
  replayInstalledAppAction,
  rollbackInstalledAppAction,
  uninstallInstalledAppAction
} from "../actions";

export const dynamic = "force-dynamic";

export default async function InstalledAppDetailPage({ params, searchParams }: {
  params: Promise<{ installationId: string }>;
  searchParams: Promise<{ created?: string }>;
}) {
  const [{ installationId }, query] = await Promise.all([params, searchParams]);
  let data;
  try {
    data = await getInstalledAppViewData(decodeURIComponent(installationId));
  } catch (error) {
    if (error instanceof Error && /not found/i.test(error.message)) notFound();
    throw error;
  }
  const latestSynthetic = data.evaluations.filter((evaluation) => evaluation.level === "synthetic").at(-1);
  const latestReplay = data.evaluations.filter((evaluation) => evaluation.level === "historical_replay").at(-1);
  const installedLoopByName = new Map(data.installedLoops.map((loop) => [loop.name, loop]));
  const unfinishedOperations = data.lifecycleOperations.filter((operation) => operation.status !== "completed");
  const recovery = unfinishedOperations[0];
  const activationRecoveryApproval = recovery?.action === "activate" && recovery.activation
    ? data.activationApprovals.find((approval) => approval.id === recovery.activation?.approvalReceiptId)
    : undefined;
  const presentation = installedAppPresentation({
    appName: data.detail.app.name,
    installationId: data.installation.id,
    derivation: data.installation.derivation
  });
  const evidenceRefs = activationEvidenceRefs(data.promotionRecommendation.evidenceRefs);
  const shadowApproval = currentActivationApproval({
    installation: data.installation,
    approvals: data.activationApprovals,
    mode: "shadow"
  });
  const recommendApproval = currentActivationApproval({
    installation: data.installation,
    approvals: data.activationApprovals,
    mode: "recommend"
  });
  return (
    <>
      <div className="mb-4 text-sm text-ink/50"><Link className="hover:text-ink" href="/apps">Installed Apps</Link> / {data.detail.app.name}</div>
      <PageHeader
        eyebrow={`${data.detail.app.department.replace(/_/g, " ")} · ${presentation.kindLabel}`}
        title={presentation.title}
        description={presentation.kind === "private_derived" ? presentation.description : data.detail.app.summary}
        action={<AppStatusPill state={data.installation.state} readiness={data.readiness.state} />}
      />

      {query.created === "duplicate" && presentation.kind === "private_derived" ? (
        <div className="mb-6 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm leading-6 text-emerald-900">
          Private App created. This is the new independently configurable installation; the upstream App remains unchanged.
        </div>
      ) : null}

      {unfinishedOperations.length > 0 ? <div className="mb-6"><AppLifecycleRecoveryNotice operations={unfinishedOperations} /></div> : null}

      <div className="mb-6">
        <AppOnboardingProgress compact journey={appOnboardingProgressForView(data.onboardingJourney)} />
      </div>

      {presentation.derivation && presentation.publisherPrompt ? (
        <div className="mb-6">
          <SectionCard
            title="Private App workspace"
            description="The duplicate is installed only in this workspace. It is not a Marketplace release and it cannot overwrite the upstream App."
          >
            <div className="grid gap-x-6 sm:grid-cols-2 xl:grid-cols-3">
              <Definition label="Private App ID" value={presentation.derivation.derivedAppId} mono />
              <Definition label="Upstream App" value={presentation.derivation.upstreamAppId} mono />
              <Definition label="Upstream version" value={presentation.derivation.upstreamVersion} />
              <Definition label="Upstream artifact" value={presentation.derivation.upstreamDigest} mono />
              <Definition label="Parent installation" value={presentation.derivation.parentInstallationId ?? "Not recorded"} mono />
              <Definition label="Created by" value={presentation.derivation.createdBy} />
            </div>
            <div className="mt-4 rounded-md border border-line bg-surface p-4">
              <div className="text-xs font-semibold uppercase tracking-[0.1em] text-ink/40">Ask Hermes when this variant is ready to reuse</div>
              <p className="mt-2 select-all text-sm leading-6 text-ink/70">{presentation.publisherPrompt}</p>
            </div>
            <p className="mt-3 text-xs leading-5 text-ink/50">Hermes will use the governed capture → preview → validate → sign → private-publish tools. Capture copies behavior and declared key names, never company values, credentials, provider payloads, tenant IDs, or private references.</p>
          </SectionCard>
        </div>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-6">
        <ScoreCard label="Maturity" value={data.maturity.maturity.replace(/_/g, " ")} detail="Evidence-derived ceiling" />
        <ScoreCard label="Readiness" value={`${data.readiness.score}%`} detail={data.readiness.state.replace(/_/g, " ")} />
        <ScoreCard label="Configured stack" value={data.detail.manifest.presets.find((preset) => preset.id === data.installation.presetId)?.name ?? data.installation.presetId} detail={`${Object.keys(data.installation.operationBindings).length} executable capability bindings`} />
        <ScoreCard label="Conformance" value={latestSynthetic?.status ?? "not run"} detail={latestSynthetic ? `${latestSynthetic.metrics.passed}/${latestSynthetic.metrics.total} scenarios` : "Provider writes remain blocked"} />
        <ScoreCard label="Historical preview" value={latestReplay?.status ?? "not run"} detail={latestReplay ? `${latestReplay.metrics.eventCount} events · ${latestReplay.metrics.providerWrites} writes` : "Bounded and read-only"} />
        <ScoreCard label="Mode" value={data.installation.mode.replace(/_/g, " ")} detail={`v${data.installation.version} pinned`} />
      </div>

      <div className="mt-6">
        <InstalledAppTopologyPanel operations={data.operations} />
      </div>

      <div className="mt-6">
        <InstalledAppActivityPanel operations={data.operations} />
      </div>

      <div className="mt-6">
        <InstalledAppActionsPanel canApproveActions={isHostedAuthRequired()} operations={data.operations} />
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,1fr)_21rem]">
        <div className="min-w-0 space-y-6">
          <SectionCard title="Operational maturity" description="Maturity cannot skip a gate. Each level is tied to evidence from this exact installed artifact; catalog signatures and publisher claims do not count as production proof.">
            <div className="space-y-3">
              {data.maturity.gates.map((gate) => (
                <div className={`rounded-md border p-4 ${gate.status === "achieved" ? "border-emerald-200 bg-emerald-50" : "border-line bg-paper/40"}`} key={gate.level}>
                  <div className="flex items-center justify-between gap-3">
                    <div className="font-semibold capitalize">{gate.level.replace(/_/g, " ")}</div>
                    <span className={`text-xs font-semibold uppercase tracking-[0.1em] ${gate.status === "achieved" ? "text-emerald-700" : "text-orange-700"}`}>{gate.status}</span>
                  </div>
                  <p className="mt-2 text-sm leading-6 text-ink/65">{gate.summary}</p>
                  {gate.remediation ? <p className="mt-2 text-xs leading-5 text-orange-800">Next: {gate.remediation}</p> : null}
                  {gate.evidenceRefs.length > 0 ? <details className="mt-3 text-xs text-ink/45"><summary className="cursor-pointer font-semibold">Evidence ({gate.evidenceRefs.length})</summary><div className="mt-2 space-y-1 font-mono">{gate.evidenceRefs.map((reference) => <div className="break-all" key={reference}>{reference}</div>)}</div></details> : null}
                </div>
              ))}
            </div>
          </SectionCard>

          <SectionCard title="Readiness checks" description="Promotion is evidence-derived. A downloaded or installed app is never automatically eligible to receive live work.">
            <div className="space-y-3">{data.readiness.checks.map((check) => <div className="grid gap-3 rounded-md border border-line p-3 sm:grid-cols-[8rem_minmax(0,1fr)_5rem]" key={check.id}><div className="text-xs font-semibold uppercase tracking-[0.1em] text-ink/45">{check.category}</div><div className="text-sm text-ink/70">{check.summary}</div><div className={`text-right text-xs font-semibold uppercase ${check.status === "pass" ? "text-emerald-700" : check.status === "fail" ? "text-red-700" : "text-orange-700"}`}>{check.status}</div></div>)}</div>
          </SectionCard>

          <SectionCard title="Installed loops" description="These LoopSpecs remain independently inspectable under Advanced, while this page operates them as one business application.">
            <div className="grid gap-3 sm:grid-cols-2">{data.detail.loops.map((loop) => {
              const installedLoop = installedLoopByName.get(loop.name);
              const content = <><div className="font-semibold">{loop.name}</div><p className="mt-2 text-sm leading-6 text-ink/55">{loop.description}</p></>;
              return installedLoop
                ? <Link className="rounded-md border border-line p-4 hover:border-ink" href={`/loops/${encodeURIComponent(installedLoop.id)}`} key={loop.id}>{content}</Link>
                : <div className="rounded-md border border-line p-4" key={loop.id}>{content}</div>;
            })}</div>
          </SectionCard>

          <SectionCard title="Historical preview" description="Replay a bounded normalized event set through the installed app. The engine records decisions and review burden but cannot write to a provider or promote the app.">
            {latestReplay ? (
              <div className="space-y-3">
                {latestReplay.scenarios.map((scenario) => (
                  <div className="rounded-md border border-line p-4" key={scenario.id}>
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <div className="font-semibold">{scenario.sourceEventId ?? scenario.id}</div>
                        <div className="mt-1 text-sm text-ink/55">{scenario.actualAction?.replace(/_/g, " ")}{scenario.actualRoute ? ` → ${scenario.actualRoute}` : ""}</div>
                        {scenario.reason ? <p className="mt-2 text-sm leading-6 text-ink/60">{scenario.reason}</p> : null}
                      </div>
                      <span className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-semibold ${scenario.humanLabel === "correct" ? "border-emerald-200 bg-emerald-50 text-emerald-800" : scenario.humanLabel === "false_positive" ? "border-red-200 bg-red-50 text-red-800" : "border-orange-200 bg-orange-50 text-orange-800"}`}>{(scenario.humanLabel ?? "awaiting_review").replace(/_/g, " ")}</span>
                    </div>
                    <div className="mt-3 flex flex-wrap gap-2">
                      {(["correct", "incomplete", "false_positive"] as const).map((label) => (
                        <EvaluationLabelForm
                          installationId={data.installation.id}
                          key={label}
                          label={label}
                          runId={latestReplay.id}
                          scenarioId={scenario.id}
                        />
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm leading-6 text-ink/60">Run synthetic conformance first, then ask Hermes to replay an approved date range or provide a normalized export below.</p>
            )}
            {latestSynthetic?.status === "passed" ? (
              <details className="mt-4 rounded-md border border-line p-4">
                <summary className="cursor-pointer text-sm font-semibold">Run a bounded normalized dataset</summary>
                <form action={replayInstalledAppAction} className="mt-4 space-y-3">
                  <input name="installationId" type="hidden" value={data.installation.id} />
                  <textarea
                    aria-label="Historical replay dataset"
                    className="min-h-48 w-full rounded-md border border-line bg-white p-3 font-mono text-xs"
                    name="dataset"
                    placeholder={'{"from":"2026-08-01T00:00:00.000Z","to":"2026-08-08T00:00:00.000Z","maxEvents":100,"events":[...]}' }
                    required
                  />
                  <p className="text-xs leading-5 text-ink/50">Maximum 500 events and 90 days. Raw provider credentials are never accepted. All actions are write-blocked and tagged as replay evidence.</p>
                  <button className="rounded-md bg-ink px-4 py-2.5 text-sm font-semibold text-white" type="submit">Run historical preview</button>
                </form>
              </details>
            ) : null}
          </SectionCard>

          <SectionCard title="Promotion recommendation" description="This recommendation is evidence-derived and advisory. It never changes the installed app mode automatically.">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-md bg-surface p-4">
              <div><div className="text-xs font-semibold uppercase tracking-[0.1em] text-ink/40">Recommended mode</div><div className="mt-1 text-lg font-semibold capitalize">{data.promotionRecommendation.recommendedMode.replace(/_/g, " ")}</div></div>
              <div className="text-right"><div className="text-xs font-semibold uppercase tracking-[0.1em] text-ink/40">Auto-promote</div><div className="mt-1 font-semibold">Never</div></div>
            </div>
            <div className="space-y-3">{data.promotionRecommendation.gates.map((gate) => <div className="grid gap-3 rounded-md border border-line p-3 sm:grid-cols-[10rem_minmax(0,1fr)_5rem]" key={gate.id}><div className="text-xs font-semibold uppercase tracking-[0.1em] text-ink/45">{gate.id.replace(/-/g, " ")}</div><div className="text-sm text-ink/70">{gate.summary}</div><div className={`text-right text-xs font-semibold uppercase ${gate.status === "pass" ? "text-emerald-700" : gate.status === "fail" ? "text-red-700" : "text-orange-700"}`}>{gate.status}</div></div>)}</div>
          </SectionCard>

          <InstalledAppOutcomesPanel operations={data.operations} />

          <SectionCard title="Capability and permission bindings">
            <div className="overflow-x-auto"><table className="w-full min-w-[48rem] text-left text-sm"><thead className="text-xs uppercase tracking-[0.1em] text-ink/40"><tr><th className="pb-3">Capability</th><th className="pb-3">Executable route</th><th className="pb-3">Connection</th><th className="pb-3">Authority</th><th className="pb-3">Decision</th></tr></thead><tbody className="divide-y divide-line">{data.installation.permissions.map((permission) => { const operation = data.installation.operationBindings[permission.capability]; return <tr key={permission.capability}><td className="py-3 font-mono text-xs">{permission.capability}</td><td className="py-3 font-mono text-xs">{operation ? `${operation.providerId}:${operation.operation}` : "not executable"}</td><td className="py-3 font-mono text-xs">{operation?.executor === "loopgraph_runtime" ? "Loopgraph runtime" : data.installation.connectionBindings[permission.capability] ?? "not connected"}</td><td className="py-3 capitalize">{permission.authority}</td><td className="py-3 capitalize">{permission.decision.replace(/_/g, " ")}</td></tr>; })}</tbody></table></div>
          </SectionCard>

          <SectionCard title="Customize and maintain" description="Company changes stay in a version-bound overlay. Every change returns the app to write-blocked testing; the immutable marketplace artifact is never edited in place.">
            {recovery ? (
              <p className="rounded-md border border-orange-200 bg-orange-50 p-4 text-sm leading-6 text-orange-950">
                Configuration, overlay, and duplicate controls are hidden until the exact {recovery.action} recovery finishes. Use the recovery action shown at right; replacement mutations are blocked by the backend as well.
              </p>
            ) : <div className="space-y-3">
              <details className="rounded-md border border-line p-4">
                <summary className="cursor-pointer text-sm font-semibold">Change confirmed setup</summary>
                <form action={configureInstalledAppAction} className="mt-4 space-y-3">
                  <input name="installationId" type="hidden" value={data.installation.id} />
                  <input name="expectedConfigurationDigest" type="hidden" value={data.diff.effectiveConfigurationDigest} />
                  <textarea className="min-h-40 w-full rounded-md border border-line p-3 font-mono text-xs" defaultValue={JSON.stringify(data.installation.configuration.values, null, 2)} name="values" required />
                  <button className="rounded-md bg-ink px-4 py-2 text-sm font-semibold text-white" type="submit">Save and require retest</button>
                </form>
              </details>

              <details className="rounded-md border border-line p-4">
                <summary className="cursor-pointer text-sm font-semibold">Edit company overlay</summary>
                <form action={overlayInstalledAppAction} className="mt-4 space-y-3">
                  <input name="installationId" type="hidden" value={data.installation.id} />
                  <input name="expectedArtifactDigest" type="hidden" value={data.installation.artifactDigest} />
                  <input name="expectedOverlayRevision" type="hidden" value={data.installation.overlay?.revision ?? 0} />
                  <textarea className="min-h-40 w-full rounded-md border border-line p-3 font-mono text-xs" defaultValue={JSON.stringify({ operations: data.installation.overlay?.operations ?? [] }, null, 2)} name="overlay" required />
                  <p className="text-xs leading-5 text-ink/50">Supported operations set/remove <code>/values/…</code> fields or enable/disable declared modules. Unknown paths fail closed.</p>
                  <button className="rounded-md bg-ink px-4 py-2 text-sm font-semibold text-white" type="submit">Apply overlay and retest</button>
                </form>
              </details>

              <details className="rounded-md border border-line p-4">
                <summary className="cursor-pointer text-sm font-semibold">Duplicate as a private app</summary>
                <form action={duplicateInstalledAppAction} className="mt-4 space-y-3">
                  <input name="installationId" type="hidden" value={data.installation.id} />
                  <input name="expectedArtifactDigest" type="hidden" value={data.installation.artifactDigest} />
                  <input name="expectedUpdatedAt" type="hidden" value={data.installation.updatedAt} />
                  <label className="block text-xs font-semibold uppercase tracking-[0.1em] text-ink/45" htmlFor="derivedAppId">Private app ID</label>
                  <input className="w-full rounded-md border border-line px-3 py-2 font-mono text-sm" id="derivedAppId" name="derivedAppId" placeholder="private.sales.my-lead-qualification" required />
                  <label className="block text-xs font-semibold uppercase tracking-[0.1em] text-ink/45" htmlFor="duplicateOverlay">Optional initial overlay</label>
                  <textarea className="min-h-28 w-full rounded-md border border-line p-3 font-mono text-xs" defaultValue={'{"operations":[]}'} id="duplicateOverlay" name="overlay" />
                  <button className="rounded-md border border-line bg-white px-4 py-2 text-sm font-semibold hover:border-ink" type="submit">Create private duplicate</button>
                </form>
              </details>
            </div>}
          </SectionCard>

          {data.updatePlan && !recovery ? (
            <SectionCard title={`Update available · v${data.updatePlan.toVersion}`} description="Updates are three-way merges: original base + company overlay + new immutable base. Permission increases and conflicts require explicit review.">
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="rounded-md bg-surface p-4"><div className="text-xs font-semibold uppercase tracking-[0.1em] text-ink/40">Graph change</div><div className="mt-2 text-sm">+{data.updatePlan.graphDiff.nodesAdded.length} / −{data.updatePlan.graphDiff.nodesRemoved.length} nodes</div></div>
                <div className="rounded-md bg-surface p-4"><div className="text-xs font-semibold uppercase tracking-[0.1em] text-ink/40">Overlay conflicts</div><div className="mt-2 text-sm">{data.updatePlan.merge.conflicts.length}</div></div>
              </div>
              <form action={applyInstalledAppUpdateAction} className="mt-4 space-y-3">
                <input name="installationId" type="hidden" value={data.installation.id} />
                <textarea className="hidden" name="plan" readOnly value={JSON.stringify(data.updatePlan)} />
                {data.updatePlan.permissionChanges.filter((change) => change.change !== "unchanged").map((change) => (
                  <label className="flex items-start gap-3 rounded-md border border-line p-3 text-sm" key={`${change.capability}:${change.authority}`}>
                    <input className="mt-1" name="approvedPermissionCapabilities" required={change.requiresReview} type="checkbox" value={change.capability} />
                    <span><span className="font-mono text-xs">{change.capability}</span><span className="ml-2 capitalize text-ink/55">{change.change.replace(/_/g, " ")}</span></span>
                  </label>
                ))}
                {data.updatePlan.merge.conflicts.length > 0 ? <p className="rounded-md bg-orange-50 p-3 text-sm text-orange-900">Resolve overlay conflicts through Hermes or the CLI before applying this update.</p> : null}
                <button className="rounded-md bg-ink px-4 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-40" disabled={data.updatePlan.merge.conflicts.length > 0} type="submit">Apply reviewed update</button>
              </form>
            </SectionCard>
          ) : null}

          <SectionCard title="Lifecycle history" description="Every configuration, overlay, repair, duplicate, update, rollback, detach, and uninstall decision receives an accountable receipt.">
            {data.lifecycleReceipts.length > 0 ? <div className="space-y-2">{data.lifecycleReceipts.slice().reverse().map((receipt) => <div className="rounded-md border border-line p-3" key={receipt.id}><div className="flex items-center justify-between gap-3"><span className="text-sm font-semibold capitalize">{receipt.action.replace(/_/g, " ")}</span><span className="text-xs text-ink/40">{new Date(receipt.createdAt).toLocaleString()}</span></div><p className="mt-2 text-xs leading-5 text-ink/55">{receipt.reason}</p></div>)}</div> : <p className="text-sm text-ink/55">No lifecycle mutations have been recorded after installation.</p>}
          </SectionCard>

          <SectionCard title="Danger zone" description="These operations require the current immutable digest so a stale browser tab cannot change a newer installation.">
            <div className="space-y-3">
              {!recovery && data.diff.history.length > 0 ? <form action={rollbackInstalledAppAction} className="rounded-md border border-orange-200 bg-orange-50 p-4"><input name="installationId" type="hidden" value={data.installation.id} /><input name="expectedArtifactDigest" type="hidden" value={data.installation.artifactDigest} /><div className="text-sm font-semibold text-orange-950">Roll back to the prior exact revision</div><p className="mt-1 text-xs leading-5 text-orange-900/70">The restored revision returns to simulation and must pass conformance again.</p><button className="mt-3 rounded-md border border-orange-300 bg-white px-4 py-2 text-sm font-semibold text-orange-950" type="submit">Roll back</button></form> : null}
              {!recovery && data.installation.derivation && !data.installation.derivation.detachedAt ? <form action={detachInstalledAppAction} className="rounded-md border border-orange-200 bg-orange-50 p-4"><input name="installationId" type="hidden" value={data.installation.id} /><input name="expectedArtifactDigest" type="hidden" value={data.installation.artifactDigest} /><input name="expectedUpdatedAt" type="hidden" value={data.installation.updatedAt} /><div className="text-sm font-semibold text-orange-950">Detach private app from upstream</div><p className="mt-1 text-xs leading-5 text-orange-900/70">Pins a local immutable snapshot and permanently disables upstream updates.</p><button className="mt-3 rounded-md border border-orange-300 bg-white px-4 py-2 text-sm font-semibold text-orange-950" type="submit">Detach from upstream</button></form> : null}
              {!recovery || recovery.action === "uninstall" ? <details className="rounded-md border border-red-200 bg-red-50 p-4" id="app-uninstall" open={recovery?.action === "uninstall"}><summary className="cursor-pointer text-sm font-semibold text-red-950">{recovery?.action === "uninstall" ? "Finish interrupted uninstall" : "Uninstall app"}</summary><form action={uninstallInstalledAppAction} className="mt-4 space-y-3"><input name="installationId" type="hidden" value={data.installation.id} /><input name="expectedArtifactDigest" type="hidden" value={data.installation.artifactDigest} /><input className="w-full rounded-md border border-red-200 bg-white px-3 py-2 text-sm" name="reason" placeholder={recovery?.action === "uninstall" ? "Re-enter the exact original removal reason" : "Why is this app being removed?"} required /><input className="w-full rounded-md border border-red-200 bg-white px-3 py-2 font-mono text-sm" name="confirmation" placeholder="Type UNINSTALL" required /><p className="text-xs leading-5 text-red-900/70">Only exclusively owned generated assets are removed. Shared connections, mappings, company context, identities, and evidence remain. {recovery?.action === "uninstall" ? "Recovery requires the same signed-in actor and exact original reason; only its digest was journaled." : "Retrying the exact interrupted removal is idempotent."}</p><button className="rounded-md bg-red-700 px-4 py-2 text-sm font-semibold text-white" type="submit">{recovery?.action === "uninstall" ? "Reconcile and finish uninstall" : "Uninstall owned assets"}</button></form></details> : <p className="rounded-md border border-orange-200 bg-orange-50 p-4 text-sm leading-6 text-orange-950">Danger-zone mutations are unavailable while {recovery.action} recovery is pending.</p>}
            </div>
          </SectionCard>
        </div>

        <aside className="min-w-0 space-y-4 lg:sticky lg:top-6 lg:self-start">
          <SectionCard title="Recommended next action">
            <p className="text-sm leading-6 text-ink/65">{recovery ? recoveryInstruction(recovery) : nextAction(data.installation.state, data.readiness.state)}</p>
            {recovery ? recovery.action === "activate" ? (
              recovery.activation && activationRecoveryApproval && recovery.activation.targetMode !== "execute_with_approval" ? (
                <ActivationRecoveryControl
                  approvalReceiptId={activationRecoveryApproval.id}
                  installationId={data.installation.id}
                  mode={recovery.activation.targetMode}
                  operationId={recovery.id}
                />
              ) : <p className="mt-4 rounded-md border border-orange-300 bg-white p-3 text-xs leading-5 text-orange-900/75">This exact activation cannot be resumed from the browser. Use the Hermes or CLI retry returned by the onboarding journey; do not create a replacement approval.</p>
            ) : recovery.action === "pause" || recovery.action === "resume" ? (
              <div className="mt-4"><OperationForm action={recovery.action} installationId={data.installation.id} label={`Reconcile and finish ${recovery.action}`} primary /></div>
            ) : recovery.action === "configure" ? (
              <p className="mt-4 rounded-md border border-orange-300 bg-white p-3 text-xs leading-5 text-orange-900/75">Return to the Hermes, CLI, or browser submission that still holds the original confirmed values and retry it as the same actor. Loopgraph intentionally retains only the values digest, so this page cannot reconstruct or reveal them.</p>
            ) : recovery.action === "overlay" ? (
              <p className="mt-4 rounded-md border border-orange-300 bg-white p-3 text-xs leading-5 text-orange-900/75">Return to the Hermes, CLI, or browser submission that still holds the original overlay operations and retry it as the same actor. Loopgraph intentionally retains only the operations digest and exact source/target topology, so this page cannot reconstruct or substitute the requested customization.</p>
            ) : recovery.action === "detach" && recovery.detach ? (
              <form action={detachInstalledAppAction} className="mt-4"><input name="installationId" type="hidden" value={data.installation.id} /><input name="expectedArtifactDigest" type="hidden" value={recovery.detach.sourceArtifactDigest} /><input name="expectedUpdatedAt" type="hidden" value={recovery.detach.fromUpdatedAt} /><button className="w-full rounded-md bg-orange-700 px-4 py-2.5 text-sm font-semibold text-white" type="submit">Verify snapshot and finish detach</button></form>
            ) : recovery.action === "update" ? (
              data.updatePlan && recovery.update?.planDigest === data.updatePlan.planDigest ? (
                <form action={applyInstalledAppUpdateAction} className="mt-4 space-y-3">
                  <input name="installationId" type="hidden" value={data.installation.id} />
                  <textarea className="hidden" name="plan" readOnly value={JSON.stringify(data.updatePlan)} />
                  {(recovery.update?.approvedPermissionCapabilities ?? []).map((capability) => (
                    <input key={capability} name="approvedPermissionCapabilities" type="hidden" value={capability} />
                  ))}
                  <button className="w-full rounded-md bg-orange-700 px-4 py-2.5 text-sm font-semibold text-white" type="submit">Reconcile and finish update</button>
                </form>
              ) : <p className="mt-4 rounded-md border border-orange-300 bg-white p-3 text-xs leading-5 text-orange-900/75">This exact reviewed update is not present in this browser session. Return to the Hermes or CLI session holding the original plan and retry it with the same actor and recorded permission approvals; do not create a replacement plan.</p>
            ) : recovery.action === "rollback" ? (
              <form action={rollbackInstalledAppAction} className="mt-4"><input name="installationId" type="hidden" value={data.installation.id} /><input name="expectedArtifactDigest" type="hidden" value={recovery.rollback?.sourceArtifactDigest ?? data.installation.artifactDigest} /><button className="w-full rounded-md bg-orange-700 px-4 py-2.5 text-sm font-semibold text-white" type="submit">Reconcile and finish rollback</button></form>
            ) : <a className="mt-4 inline-flex w-full items-center justify-center rounded-md bg-orange-700 px-4 py-2.5 text-sm font-semibold text-white" href={recovery.action === "uninstall" ? "#app-uninstall" : `/marketplace/${encodeURIComponent(data.detail.app.id)}/install`}>{recovery.action === "uninstall" ? "Finish recovery" : "Return to exact install"}</a> : <div className="mt-4 space-y-2">
              {data.installation.state === "ready_to_test" || data.installation.state === "broken" ? <OperationForm action="test" installationId={data.installation.id} label="Run conformance tests" primary /> : null}
              {data.installation.state === "simulation_passed" ? <ActivationControl evidenceRefs={evidenceRefs} installationId={data.installation.id} mode="shadow" receipt={shadowApproval} /> : null}
              {data.installation.state === "shadow" && data.readiness.state === "ready_for_recommend" ? <ActivationControl evidenceRefs={evidenceRefs} installationId={data.installation.id} mode="recommend" receipt={recommendApproval} /> : null}
              {data.installation.state === "paused" ? <OperationForm action="resume" installationId={data.installation.id} label="Resume app" primary /> : <OperationForm action="pause" installationId={data.installation.id} label="Pause app" />}
              <OperationForm
                action="repair"
                installationId={data.installation.id}
                label="Repair generated assets"
                expectedArtifactDigest={data.installation.artifactDigest}
                expectedUpdatedAt={data.installation.updatedAt}
              />
            </div>}
          </SectionCard>
          <SectionCard title="Pinned installation">
            <Definition label="Installation" value={data.installation.id} mono />
            <Definition label="Artifact" value={data.installation.artifactDigest} mono />
            <Definition label="Installed by" value={data.installation.installedBy} />
            <Definition label="Updated" value={new Date(data.installation.updatedAt).toLocaleString()} />
          </SectionCard>
        </aside>
      </div>
    </>
  );
}

function ScoreCard({ label, value, detail }: { label: string; value: string; detail: string }) { return <div className="rounded-xl border border-line bg-white p-4 shadow-sm"><div className="text-xs font-semibold uppercase tracking-[0.12em] text-ink/40">{label}</div><div className="mt-2 text-lg font-semibold capitalize">{value}</div><div className="mt-1 text-xs text-ink/45">{detail}</div></div>; }
function Definition({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) { return <div className="border-b border-line py-3 last:border-0"><div className="text-xs font-semibold uppercase tracking-[0.1em] text-ink/40">{label}</div><div className={`mt-1 break-all text-xs text-ink/65 ${mono ? "font-mono" : ""}`}>{value}</div></div>; }
function OperationForm({ action, installationId, label, primary = false, expectedArtifactDigest, expectedUpdatedAt }: { action: "test" | "pause" | "resume" | "repair"; installationId: string; label: string; primary?: boolean; expectedArtifactDigest?: string; expectedUpdatedAt?: string }) { return <form action={operateInstalledAppAction}><input name="installationId" type="hidden" value={installationId} /><input name="action" type="hidden" value={action} />{expectedArtifactDigest ? <input name="expectedArtifactDigest" type="hidden" value={expectedArtifactDigest} /> : null}{expectedUpdatedAt ? <input name="expectedUpdatedAt" type="hidden" value={expectedUpdatedAt} /> : null}<button className={`w-full rounded-md px-4 py-2.5 text-sm font-semibold ${primary ? "bg-ink text-white" : "border border-line bg-white hover:border-ink"}`} type="submit">{label}</button></form>; }
function ActivationRecoveryControl({
  installationId,
  operationId,
  mode,
  approvalReceiptId
}: {
  installationId: string;
  operationId: string;
  mode: BrowserActivationMode;
  approvalReceiptId: string;
}) {
  return (
    <form action={activateInstalledAppAction} className="mt-4 rounded-md border border-orange-300 bg-white p-3">
      <input name="installationId" type="hidden" value={installationId} />
      <input name="mode" type="hidden" value={mode} />
      <input name="approvalReceiptId" type="hidden" value={approvalReceiptId} />
      <p className="text-xs leading-5 text-orange-900/75">This resumes operation <span className="font-mono">{operationId}</span> with its original content-bound authority. It does not create or extend an approval.</p>
      <button className="mt-3 w-full rounded-md bg-orange-700 px-4 py-2.5 text-sm font-semibold text-white" type="submit">Reconcile and finish {mode.replace(/_/g, " ")} activation</button>
    </form>
  );
}
function ActivationControl({
  installationId,
  mode,
  evidenceRefs,
  receipt
}: {
  installationId: string;
  mode: BrowserActivationMode;
  evidenceRefs: string[];
  receipt?: { id: string; approvedBy: string; approvedAt: string; expiresAt: string; reason: string };
}) {
  const modeLabel = mode === "shadow" ? "shadow" : "recommendation";
  if (receipt) {
    return (
      <div className="rounded-md border border-emerald-200 bg-emerald-50 p-3">
        <div className="text-xs font-semibold uppercase tracking-[0.1em] text-emerald-800">Approval ready</div>
        <p className="mt-1 text-xs leading-5 text-emerald-900/75">{receipt.approvedBy} approved {modeLabel} mode at {new Date(receipt.approvedAt).toLocaleString()}. The receipt expires {new Date(receipt.expiresAt).toLocaleString()} and can be consumed only once against this exact App state and artifact.</p>
        <p className="mt-2 text-xs leading-5 text-emerald-950"><span className="font-semibold">Reason:</span> {receipt.reason}</p>
        <form action={activateInstalledAppAction} className="mt-3">
          <input name="installationId" type="hidden" value={installationId} />
          <input name="mode" type="hidden" value={mode} />
          <input name="approvalReceiptId" type="hidden" value={receipt.id} />
          <button className="w-full rounded-md bg-emerald-800 px-4 py-2.5 text-sm font-semibold text-white" type="submit">Apply approved {modeLabel} activation</button>
        </form>
      </div>
    );
  }
  return (
    <details className="rounded-md border border-line bg-white p-3">
      <summary className="cursor-pointer text-sm font-semibold">Review {modeLabel} activation</summary>
      <form action={approveInstalledAppActivationAction} className="mt-3 space-y-3">
        <input name="installationId" type="hidden" value={installationId} />
        <input name="mode" type="hidden" value={mode} />
        {evidenceRefs.map((reference) => <input key={reference} name="evidenceRef" type="hidden" value={reference} />)}
        <p className="text-xs leading-5 text-ink/55">Approval does not activate the App. It creates a 15-minute receipt bound to this installation, artifact, current state, target mode, approver, reason, and evidence. Activation is a separate action.</p>
        <label className="block text-xs font-semibold uppercase tracking-[0.1em] text-ink/45" htmlFor={`activation-reason-${mode}`}>Approval reason</label>
        <textarea className="min-h-24 w-full rounded-md border border-line p-2 text-xs" id={`activation-reason-${mode}`} maxLength={2000} name="reason" placeholder={`Why is this App ready for ${modeLabel} mode?`} required />
        <label className="flex items-start gap-2 text-xs leading-5 text-ink/65">
          <input className="mt-1" name="confirmation" required type="checkbox" value="APPROVE" />
          <span>I approve this exact transition and understand that the receipt expires and cannot authorize a different artifact or mode.</span>
        </label>
        <button className="w-full rounded-md border border-line px-4 py-2.5 text-sm font-semibold hover:border-ink" type="submit">Create activation approval</button>
      </form>
    </details>
  );
}
function EvaluationLabelForm({ installationId, runId, scenarioId, label }: { installationId: string; runId: string; scenarioId: string; label: "correct" | "incomplete" | "false_positive" }) { return <form action={labelAppEvaluationAction} className="flex items-center rounded-md border border-line bg-white"><input name="installationId" type="hidden" value={installationId} /><input name="runId" type="hidden" value={runId} /><input name="scenarioId" type="hidden" value={scenarioId} /><input name="label" type="hidden" value={label} /><label className="sr-only" htmlFor={`${scenarioId}-${label}-minutes`}>Review minutes</label><input className="w-12 border-r border-line px-2 py-1.5 text-xs" defaultValue="1" id={`${scenarioId}-${label}-minutes`} min="0" name="reviewMinutes" step="0.5" type="number" /><button className="px-3 py-1.5 text-xs font-semibold capitalize hover:bg-surface" type="submit">{label.replace(/_/g, " ")}</button></form>; }
function nextAction(state: string, readiness: string) { if (state === "ready_to_test" || state === "broken") return "Run the deterministic, write-blocked conformance suite and inspect every failure."; if (state === "simulation_passed") return "Activate in shadow mode to observe real routing without committing provider work."; if (readiness === "ready_for_recommend") return "Review shadow evidence, false positives, and human burden before recommendation mode."; if (state === "paused") return "Resolve the pause reason before resuming at the previous safe mode."; return "Monitor routing quality, approvals, failures, review burden, and outcomes."; }
