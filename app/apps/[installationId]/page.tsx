import Link from "next/link";
import { notFound } from "next/navigation";
import { AppStatusPill } from "@/components/apps/app-status-pill";
import { PageHeader } from "@/components/page-header";
import { SectionCard } from "@/components/section-card";
import { getInstalledAppViewData } from "@/lib/app-platform/read-model";
import { activateInstalledAppAction, operateInstalledAppAction } from "../actions";

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
  const latestEval = data.evaluations.at(-1);
  return (
    <>
      <div className="mb-4 text-sm text-ink/50"><Link className="hover:text-ink" href="/apps">Installed Apps</Link> / {data.detail.app.name}</div>
      <PageHeader
        eyebrow={`${data.detail.app.department.replace(/_/g, " ")} · Installed App`}
        title={data.detail.app.name}
        description={data.detail.app.summary}
        action={<AppStatusPill state={data.installation.state} readiness={data.readiness.state} />}
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <ScoreCard label="Readiness" value={`${data.readiness.score}%`} detail={data.readiness.state.replace(/_/g, " ")} />
        <ScoreCard label="Configured stack" value={data.detail.manifest.presets.find((preset) => preset.id === data.installation.presetId)?.name ?? data.installation.presetId} detail={`${Object.keys(data.installation.connectionBindings).length} capability bindings`} />
        <ScoreCard label="Conformance" value={latestEval?.status ?? "not run"} detail={latestEval ? `${latestEval.metrics.passed}/${latestEval.metrics.total} scenarios` : "Provider writes remain blocked"} />
        <ScoreCard label="Mode" value={data.installation.mode.replace(/_/g, " ")} detail={`v${data.installation.version} pinned`} />
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,1fr)_21rem]">
        <div className="space-y-6">
          <SectionCard title="Readiness checks" description="Promotion is evidence-derived. A downloaded or installed app is never automatically eligible to receive live work.">
            <div className="space-y-3">{data.readiness.checks.map((check) => <div className="grid gap-3 rounded-md border border-line p-3 sm:grid-cols-[8rem_minmax(0,1fr)_5rem]" key={check.id}><div className="text-xs font-semibold uppercase tracking-[0.1em] text-ink/45">{check.category}</div><div className="text-sm text-ink/70">{check.summary}</div><div className={`text-right text-xs font-semibold uppercase ${check.status === "pass" ? "text-emerald-700" : check.status === "fail" ? "text-red-700" : "text-orange-700"}`}>{check.status}</div></div>)}</div>
          </SectionCard>

          <SectionCard title="Installed loops" description="These LoopSpecs remain independently inspectable under Advanced, while this page operates them as one business application.">
            <div className="grid gap-3 sm:grid-cols-2">{data.detail.loops.map((loop) => <Link className="rounded-md border border-line p-4 hover:border-ink" href={`/loops/${encodeURIComponent(loop.id)}`} key={loop.id}><div className="font-semibold">{loop.name}</div><p className="mt-2 text-sm leading-6 text-ink/55">{loop.description}</p></Link>)}</div>
          </SectionCard>

          <SectionCard title="Capability and permission bindings">
            <div className="overflow-x-auto"><table className="w-full min-w-[42rem] text-left text-sm"><thead className="text-xs uppercase tracking-[0.1em] text-ink/40"><tr><th className="pb-3">Capability</th><th className="pb-3">Provider binding</th><th className="pb-3">Authority</th><th className="pb-3">Decision</th></tr></thead><tbody className="divide-y divide-line">{data.installation.permissions.map((permission) => <tr key={permission.capability}><td className="py-3 font-mono text-xs">{permission.capability}</td><td className="py-3 font-mono text-xs">{data.installation.connectionBindings[permission.capability] ?? "not connected"}</td><td className="py-3 capitalize">{permission.authority}</td><td className="py-3 capitalize">{permission.decision.replace(/_/g, " ")}</td></tr>)}</tbody></table></div>
          </SectionCard>
        </div>

        <aside className="space-y-4 lg:sticky lg:top-6 lg:self-start">
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
function nextAction(state: string, readiness: string) { if (state === "ready_to_test" || state === "broken") return "Run the deterministic, write-blocked conformance suite and inspect every failure."; if (state === "simulation_passed") return "Activate in shadow mode to observe real routing without committing provider work."; if (readiness === "ready_for_recommend") return "Review shadow evidence, false positives, and human burden before recommendation mode."; if (state === "paused") return "Resolve the pause reason before resuming at the previous safe mode."; return "Monitor routing quality, approvals, failures, review burden, and outcomes."; }
