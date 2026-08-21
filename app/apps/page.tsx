import Link from "next/link";
import { AppLifecycleRecoveryNotice } from "@/components/apps/app-lifecycle-recovery";
import { AppStatusPill } from "@/components/apps/app-status-pill";
import { PageHeader } from "@/components/page-header";
import { getInstalledAppsViewData } from "@/lib/app-platform/read-model";

export const dynamic = "force-dynamic";

export default async function InstalledAppsPage() {
  const data = await getInstalledAppsViewData();
  const readinessById = new Map(data.readiness.map((readiness) => [readiness.installationId, readiness]));
  const appByInstallationId = new Map(data.applications.map((entry) => [entry.installation.id, entry.app]));
  const unfinishedOperations = data.lifecycleOperations.filter((operation) => operation.status !== "completed");
  return (
    <>
      <PageHeader
        eyebrow="Workspace applications"
        title="Installed Apps"
        description="Operate each business capability as one application: connections, configuration, routing quality, approvals, failures, outcomes, and the next recommended action."
        action={<Link className="rounded-md bg-ink px-4 py-2 text-sm font-semibold text-white" href="/marketplace">Find an app</Link>}
      />
      {unfinishedOperations.length > 0 ? <div className="mb-6"><AppLifecycleRecoveryNotice operations={unfinishedOperations} /></div> : null}
      {data.installations.length === 0 ? (
        <section className="rounded-xl border border-dashed border-line bg-white px-6 py-14 text-center">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-ink text-lg font-semibold text-white">H</div>
          <h2 className="mt-5 text-xl font-semibold">Your workspace has no installed apps</h2>
          <p className="mx-auto mt-2 max-w-xl text-sm leading-6 text-ink/60">This is intentionally empty. Local Loopgraph shows only applications you install for this company—never preview data or someone else’s loops.</p>
          <div className="mt-6 flex flex-wrap justify-center gap-3"><Link className="rounded-md bg-signal px-4 py-2.5 text-sm font-semibold text-white" href="/marketplace">Explore Marketplace</Link><Link className="rounded-md border border-line px-4 py-2.5 text-sm font-semibold hover:border-ink" href="/discovery">Ask Hermes to identify a loop</Link></div>
        </section>
      ) : (
        <div className="grid gap-5 lg:grid-cols-2">
          {data.installations.map((installation) => {
            const readiness = readinessById.get(installation.id);
            const app = appByInstallationId.get(installation.id);
            const recovery = unfinishedOperations.find((operation) => operation.installationId === installation.id);
            return (
              <article className="rounded-xl border border-line bg-white p-5 shadow-sm" key={installation.id}>
                <div className="flex items-start justify-between gap-3"><div><div className="text-xs font-semibold uppercase tracking-[0.14em] text-signal">{app?.department.replace(/_/g, " ") ?? "application"}</div><h2 className="mt-2 text-xl font-semibold">{app?.name ?? installation.appId}</h2><div className="mt-1 font-mono text-xs text-ink/40">{installation.appId} · v{installation.version}</div></div><AppStatusPill state={installation.state} readiness={readiness?.state} /></div>
                <div className="mt-5 grid grid-cols-3 gap-3"><Metric label="Readiness" value={`${readiness?.score ?? 0}%`} /><Metric label="Loops" value={String(installation.ownedAssets.filter((asset) => asset.kind === "loop_spec").length)} /><Metric label="Reviews" value={String(installation.permissions.filter((permission) => permission.decision === "approval_required").length)} /></div>
                <div className="mt-5 border-t border-line pt-4"><div className="text-xs font-semibold uppercase tracking-[0.12em] text-ink/40">Recommended next action</div><p className="mt-2 text-sm text-ink/70">{recovery ? "Finish the interrupted lifecycle operation before testing, promotion, updates, or removal." : recommendedAction(installation.state, readiness?.state)}</p></div>
                <Link className="mt-5 inline-flex w-full items-center justify-center rounded-md bg-ink px-4 py-2.5 text-sm font-semibold text-white" href={`/apps/${encodeURIComponent(installation.id)}`}>Open application</Link>
              </article>
            );
          })}
        </div>
      )}
    </>
  );
}

function Metric({ label, value }: { label: string; value: string }) { return <div className="rounded-md bg-paper p-3"><div className="text-lg font-semibold">{value}</div><div className="mt-1 text-[0.65rem] font-semibold uppercase tracking-[0.12em] text-ink/40">{label}</div></div>; }

function recommendedAction(state: string, readiness?: string) {
  if (state === "ready_to_test") return "Run the write-blocked conformance suite.";
  if (state === "simulation_passed") return "Review evidence and activate in shadow mode.";
  if (state === "paused") return "Resolve the pause reason, then resume at the prior safe mode.";
  if (readiness === "blocked") return "Resolve the failed readiness checks before promotion.";
  return "Monitor routing quality, review burden, and observed outcomes.";
}
