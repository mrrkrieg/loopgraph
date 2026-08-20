import Link from "next/link";
import { notFound } from "next/navigation";
import { AppStatusPill } from "@/components/apps/app-status-pill";
import { PageHeader } from "@/components/page-header";
import { SectionCard } from "@/components/section-card";
import { getDepartmentPackViewData } from "@/lib/app-platform/read-model";

export const dynamic = "force-dynamic";

export default async function DepartmentPackPage({ params }: { params: Promise<{ packId: string }> }) {
  const { packId } = await params;
  let data;
  try {
    data = await getDepartmentPackViewData(decodeURIComponent(packId));
  } catch (error) {
    if (error instanceof Error && /not found/i.test(error.message)) notFound();
    throw error;
  }
  const appById = new Map(data.applications.map((entry) => [entry.app.id, entry.app]));

  return (
    <>
      <div className="mb-4 text-sm text-ink/50">
        <Link className="hover:text-ink" href="/marketplace">Marketplace</Link> / Department Packs / {data.pack.name}
      </div>
      <PageHeader
        eyebrow={`${data.pack.department.replace(/_/g, " ")} · Department Pack`}
        title={data.pack.name}
        description={data.pack.summary}
        action={<span className="rounded-full border border-line bg-white px-3 py-1.5 text-xs font-semibold">{data.progress.installed}/{data.progress.total} Apps installed</span>}
      />

      <section className="rounded-xl border border-ink bg-ink p-6 text-white">
        <div className="text-xs font-semibold uppercase tracking-[0.16em] text-orange-300">The operating result</div>
        <div className="mt-4 grid gap-3 md:grid-cols-2">
          {data.pack.businessOutcomes.map((outcome) => <div className="rounded-lg border border-white/15 bg-white/5 p-4 text-sm leading-6 text-white/80" key={outcome}>{outcome}</div>)}
        </div>
      </section>

      <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,1fr)_21rem]">
        <div className="space-y-6">
          <SectionCard title="Hermes installation order" description="Each App is independently versioned, tested, and approved. The Pack only declares a safe order and dependencies; viewing it never installs or activates anything.">
            <ol className="space-y-3">
              {data.applications.map((entry) => (
                <li className="grid gap-4 rounded-lg border border-line p-4 sm:grid-cols-[2.5rem_minmax(0,1fr)_auto] sm:items-center" key={entry.app.id}>
                  <div className="flex h-9 w-9 items-center justify-center rounded-full bg-paper text-sm font-semibold">{entry.definition.installOrder}</div>
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <Link className="font-semibold hover:text-signal" href={`/marketplace/${encodeURIComponent(entry.app.id)}`}>{entry.app.name}</Link>
                      <span className="text-xs capitalize text-ink/45">{entry.definition.role}</span>
                    </div>
                    <p className="mt-1 text-sm leading-6 text-ink/55">{entry.definition.reason}</p>
                    {entry.definition.dependsOn.length > 0 ? <div className="mt-2 text-xs text-ink/40">Depends on {entry.definition.dependsOn.map((id) => appById.get(id)?.name ?? id).join(", ")}</div> : null}
                  </div>
                  <AppStatusPill state={entry.installation?.state} readiness={entry.readiness?.state} />
                </li>
              ))}
            </ol>
          </SectionCard>

          <SectionCard title="Permitted cross-App topology" description="Hermes may use these relationships for supporting work and learning returns. A Pack edge is permission to consider a handoff, not permission to execute a provider write.">
            {data.pack.topology.length > 0 ? (
              <div className="space-y-3">
                {data.pack.topology.map((edge) => (
                  <div className="grid gap-2 rounded-lg border border-line bg-paper/25 p-4 text-sm sm:grid-cols-[minmax(0,1fr)_7rem_minmax(0,1fr)] sm:items-center" key={edge.id}>
                    <span className="font-semibold">{appById.get(edge.sourceAppId)?.name ?? edge.sourceAppId}</span>
                    <span className="text-xs font-semibold uppercase tracking-[0.08em] text-signal sm:text-center">{edge.type.replace(/_/g, " ")} →</span>
                    <span className="font-semibold sm:text-right">{appById.get(edge.targetAppId)?.name ?? edge.targetAppId}</span>
                    <span className="text-xs leading-5 text-ink/50 sm:col-span-3">{edge.reason}{edge.condition ? ` Condition: ${edge.condition}` : ""}</span>
                  </div>
                ))}
              </div>
            ) : <p className="text-sm text-ink/55">This Pack starts with one complete App. Its internal loop topology is visible on the App page.</p>}
          </SectionCard>
        </div>

        <aside className="space-y-4 lg:sticky lg:top-6 lg:self-start">
          <section className="rounded-xl border border-line bg-white p-5 shadow-sm">
            <div className="text-xs font-semibold uppercase tracking-[0.14em] text-ink/45">Exact next action</div>
            <p className="mt-3 text-sm leading-6 text-ink/65">{data.nextAction.reason}</p>
            {data.nextAction.appId ? <Link className="mt-5 flex w-full items-center justify-center rounded-md bg-signal px-4 py-3 text-sm font-semibold text-white hover:bg-orange-600" href={`/marketplace/${encodeURIComponent(data.nextAction.appId)}`}>Review the next App</Link> : <Link className="mt-5 flex w-full items-center justify-center rounded-md bg-ink px-4 py-3 text-sm font-semibold text-white" href="/apps">Operate installed Apps</Link>}
          </section>
          <SectionCard title="Shared company context">
            <ul className="space-y-2 text-sm text-ink/60">{data.pack.sharedContextKeys.map((key) => <li className="rounded-md bg-paper px-3 py-2 font-mono text-xs" key={key}>{key}</li>)}</ul>
          </SectionCard>
          <SectionCard title="Shared capabilities">
            <ul className="space-y-2 text-sm text-ink/60">{data.pack.sharedCapabilities.map((capability) => <li className="rounded-md bg-paper px-3 py-2 font-mono text-xs" key={capability}>{capability}</li>)}</ul>
          </SectionCard>
        </aside>
      </div>
    </>
  );
}
