import Link from "next/link";
import { notFound } from "next/navigation";
import { AppStatusPill } from "@/components/apps/app-status-pill";
import { PageHeader } from "@/components/page-header";
import { SectionCard } from "@/components/section-card";
import { getInstalledAppViewData } from "@/lib/app-platform/read-model";
import {
  activateInstalledAppAction,
  labelAppEvaluationAction,
  operateInstalledAppAction,
  replayInstalledAppAction
} from "../actions";

export const dynamic = "force-dynamic";

export default async function InstalledAppDetailPage({ params }: { params: Promise<{ installationId: string }> }) {
  const { installationId } = await params;
  let data;
  try {
    data = await getInstalledAppViewData(decodeURIComponent(installationId));
  } catch (error) {
    if (error instanceof Error && /not found/i.test(error.message)) notFound();
    throw error;
  }
  const latestSynthetic = data.evaluations.filter((evaluation) => evaluation.level === "synthetic").at(-1);
  const latestReplay = data.evaluations.filter((evaluation) => evaluation.level === "historical_replay").at(-1);
  return (
    <>
      <div className="mb-4 text-sm text-ink/50"><Link className="hover:text-ink" href="/apps">Installed Apps</Link> / {data.detail.app.name}</div>
      <PageHeader
        eyebrow={`${data.detail.app.department.replace(/_/g, " ")} · Installed App`}
        title={data.detail.app.name}
        description={data.detail.app.summary}
        action={<AppStatusPill state={data.installation.state} readiness={data.readiness.state} />}
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
        <ScoreCard label="Readiness" value={`${data.readiness.score}%`} detail={data.readiness.state.replace(/_/g, " ")} />
        <ScoreCard label="Configured stack" value={data.detail.manifest.presets.find((preset) => preset.id === data.installation.presetId)?.name ?? data.installation.presetId} detail={`${Object.keys(data.installation.connectionBindings).length} capability bindings`} />
        <ScoreCard label="Conformance" value={latestSynthetic?.status ?? "not run"} detail={latestSynthetic ? `${latestSynthetic.metrics.passed}/${latestSynthetic.metrics.total} scenarios` : "Provider writes remain blocked"} />
        <ScoreCard label="Historical preview" value={latestReplay?.status ?? "not run"} detail={latestReplay ? `${latestReplay.metrics.eventCount} events · ${latestReplay.metrics.providerWrites} writes` : "Bounded and read-only"} />
        <ScoreCard label="Mode" value={data.installation.mode.replace(/_/g, " ")} detail={`v${data.installation.version} pinned`} />
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,1fr)_21rem]">
        <div className="min-w-0 space-y-6">
          <SectionCard title="Readiness checks" description="Promotion is evidence-derived. A downloaded or installed app is never automatically eligible to receive live work.">
            <div className="space-y-3">{data.readiness.checks.map((check) => <div className="grid gap-3 rounded-md border border-line p-3 sm:grid-cols-[8rem_minmax(0,1fr)_5rem]" key={check.id}><div className="text-xs font-semibold uppercase tracking-[0.1em] text-ink/45">{check.category}</div><div className="text-sm text-ink/70">{check.summary}</div><div className={`text-right text-xs font-semibold uppercase ${check.status === "pass" ? "text-emerald-700" : check.status === "fail" ? "text-red-700" : "text-orange-700"}`}>{check.status}</div></div>)}</div>
          </SectionCard>

          <SectionCard title="Installed loops" description="These LoopSpecs remain independently inspectable under Advanced, while this page operates them as one business application.">
            <div className="grid gap-3 sm:grid-cols-2">{data.detail.loops.map((loop) => <Link className="rounded-md border border-line p-4 hover:border-ink" href={`/loops/${encodeURIComponent(loop.id)}`} key={loop.id}><div className="font-semibold">{loop.name}</div><p className="mt-2 text-sm leading-6 text-ink/55">{loop.description}</p></Link>)}</div>
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

          <SectionCard title="Capability and permission bindings">
            <div className="overflow-x-auto"><table className="w-full min-w-[42rem] text-left text-sm"><thead className="text-xs uppercase tracking-[0.1em] text-ink/40"><tr><th className="pb-3">Capability</th><th className="pb-3">Provider binding</th><th className="pb-3">Authority</th><th className="pb-3">Decision</th></tr></thead><tbody className="divide-y divide-line">{data.installation.permissions.map((permission) => <tr key={permission.capability}><td className="py-3 font-mono text-xs">{permission.capability}</td><td className="py-3 font-mono text-xs">{data.installation.connectionBindings[permission.capability] ?? "not connected"}</td><td className="py-3 capitalize">{permission.authority}</td><td className="py-3 capitalize">{permission.decision.replace(/_/g, " ")}</td></tr>)}</tbody></table></div>
          </SectionCard>
        </div>

        <aside className="min-w-0 space-y-4 lg:sticky lg:top-6 lg:self-start">
          <SectionCard title="Recommended next action">
            <p className="text-sm leading-6 text-ink/65">{nextAction(data.installation.state, data.readiness.state)}</p>
            <div className="mt-4 space-y-2">
              {data.installation.state === "ready_to_test" || data.installation.state === "broken" ? <OperationForm action="test" installationId={data.installation.id} label="Run conformance tests" primary /> : null}
              {data.installation.state === "simulation_passed" ? <ActivationForm installationId={data.installation.id} mode="shadow" label="Activate in shadow" /> : null}
              {data.installation.state === "shadow" && data.readiness.state === "ready_for_recommend" ? <ActivationForm installationId={data.installation.id} mode="recommend" label="Promote to recommend" /> : null}
              {data.installation.state === "paused" ? <OperationForm action="resume" installationId={data.installation.id} label="Resume app" primary /> : <OperationForm action="pause" installationId={data.installation.id} label="Pause app" />}
            </div>
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
function OperationForm({ action, installationId, label, primary = false }: { action: "test" | "pause" | "resume"; installationId: string; label: string; primary?: boolean }) { return <form action={operateInstalledAppAction}><input name="installationId" type="hidden" value={installationId} /><input name="action" type="hidden" value={action} /><button className={`w-full rounded-md px-4 py-2.5 text-sm font-semibold ${primary ? "bg-ink text-white" : "border border-line bg-white hover:border-ink"}`} type="submit">{label}</button></form>; }
function ActivationForm({ installationId, mode, label }: { installationId: string; mode: "shadow" | "recommend"; label: string }) { return <form action={activateInstalledAppAction}><input name="installationId" type="hidden" value={installationId} /><input name="mode" type="hidden" value={mode} /><button className="w-full rounded-md bg-ink px-4 py-2.5 text-sm font-semibold text-white" type="submit">{label}</button></form>; }
function EvaluationLabelForm({ installationId, runId, scenarioId, label }: { installationId: string; runId: string; scenarioId: string; label: "correct" | "incomplete" | "false_positive" }) { return <form action={labelAppEvaluationAction} className="flex items-center rounded-md border border-line bg-white"><input name="installationId" type="hidden" value={installationId} /><input name="runId" type="hidden" value={runId} /><input name="scenarioId" type="hidden" value={scenarioId} /><input name="label" type="hidden" value={label} /><label className="sr-only" htmlFor={`${scenarioId}-${label}-minutes`}>Review minutes</label><input className="w-12 border-r border-line px-2 py-1.5 text-xs" defaultValue="1" id={`${scenarioId}-${label}-minutes`} min="0" name="reviewMinutes" step="0.5" type="number" /><button className="px-3 py-1.5 text-xs font-semibold capitalize hover:bg-surface" type="submit">{label.replace(/_/g, " ")}</button></form>; }
function nextAction(state: string, readiness: string) { if (state === "ready_to_test" || state === "broken") return "Run the deterministic, write-blocked conformance suite and inspect every failure."; if (state === "simulation_passed") return "Activate in shadow mode to observe real routing without committing provider work."; if (readiness === "ready_for_recommend") return "Review shadow evidence, false positives, and human burden before recommendation mode."; if (state === "paused") return "Resolve the pause reason before resuming at the previous safe mode."; return "Monitor routing quality, approvals, failures, review burden, and outcomes."; }
