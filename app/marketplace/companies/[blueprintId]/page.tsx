import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/page-header";
import { SectionCard } from "@/components/section-card";
import { getCompanyBlueprintViewData } from "@/lib/app-platform/read-model";

export const dynamic = "force-dynamic";

export default async function CompanyBlueprintPage({ params }: { params: Promise<{ blueprintId: string }> }) {
  const { blueprintId } = await params;
  let data;
  try {
    data = await getCompanyBlueprintViewData(decodeURIComponent(blueprintId));
  } catch (error) {
    if (error instanceof Error && /not found/i.test(error.message)) notFound();
    throw error;
  }
  const packById = new Map(data.departmentPacks.map((entry) => [entry.pack.id, entry.pack]));

  return (
    <>
      <div className="mb-4 text-sm text-ink/50"><Link className="hover:text-ink" href="/marketplace">Marketplace</Link> / Company Blueprints / {data.blueprint.name}</div>
      <PageHeader
        eyebrow="Hermes Brain · Company Blueprint"
        title={data.blueprint.name}
        description={data.blueprint.summary}
        action={<span className="rounded-full border border-line bg-white px-3 py-1.5 text-xs font-semibold">{data.progress.completedPacks}/{data.progress.totalPacks} departments ready</span>}
      />

      <section className="rounded-xl border border-ink bg-ink p-6 text-white">
        <div className="text-xs font-semibold uppercase tracking-[0.16em] text-orange-300">Company profile</div>
        <p className="mt-3 max-w-4xl text-lg leading-8 text-white/80">{data.blueprint.companyProfile}</p>
        <div className="mt-5 grid gap-3 md:grid-cols-3">{data.blueprint.businessOutcomes.map((outcome) => <div className="rounded-lg border border-white/15 bg-white/5 p-4 text-sm leading-6 text-white/75" key={outcome}>{outcome}</div>)}</div>
      </section>

      <div className="mt-6 grid gap-6 xl:grid-cols-[minmax(0,1fr)_21rem]">
        <div className="space-y-6">
          <SectionCard title="Hermes Brain company map" description="Hermes receives company events, resolves the canonical object, and considers only eligible Apps inside these Department Packs. The map declares context and evidence relationships; it does not grant execution authority.">
            <div className="overflow-x-auto pb-2">
              <div className="min-w-[48rem] py-5">
                <div className="mx-auto flex h-28 w-28 items-center justify-center rounded-full bg-ink text-center text-sm font-semibold text-white">Hermes<br />Brain</div>
                <div className="mx-auto h-8 w-px bg-ink/25" />
                <div className="grid grid-cols-3 gap-3">
                  {data.departmentPacks.map((entry) => (
                    <Link className="rounded-lg border border-line bg-white p-4 text-center transition hover:border-signal" href={`/marketplace/departments/${encodeURIComponent(entry.pack.id)}`} key={entry.pack.id}>
                      <div className="text-xs font-semibold uppercase tracking-[0.08em] text-signal">{entry.definition.installOrder} · {entry.definition.role}</div>
                      <div className="mt-2 font-semibold">{entry.pack.name}</div>
                      <div className="mt-1 text-xs text-ink/45">{entry.progress.installed}/{entry.progress.total} Apps installed</div>
                    </Link>
                  ))}
                </div>
              </div>
            </div>
          </SectionCard>

          <SectionCard title="Cross-department evidence contracts" description="Hermes may consider a handoff only when the canonical object and the edge condition match. The receiving Department Pack still applies its own routing, context, connection, exclusion, and approval rules.">
            <div className="space-y-3">
              {data.blueprint.topology.map((edge) => (
                <div className="grid gap-2 rounded-lg border border-line bg-paper/25 p-4 text-sm lg:grid-cols-[minmax(0,1fr)_9rem_minmax(0,1fr)] lg:items-center" key={edge.id}>
                  <span className="font-semibold">{packById.get(edge.sourcePackId)?.name ?? edge.sourcePackId}</span>
                  <span className="text-xs font-semibold uppercase tracking-[0.08em] text-signal lg:text-center">{edge.type.replace(/_/g, " ")} →</span>
                  <span className="font-semibold lg:text-right">{packById.get(edge.targetPackId)?.name ?? edge.targetPackId}</span>
                  <div className="text-xs leading-5 text-ink/50 lg:col-span-3"><span className="font-mono text-ink/70">{edge.objectType}</span> · {edge.reason} Condition: {edge.condition}</div>
                </div>
              ))}
            </div>
          </SectionCard>

          <SectionCard title="Canonical company objects" description="Provider records become useful across departments only after entity resolution produces one stable company object and preserves source evidence.">
            <div className="grid gap-4 md:grid-cols-2">
              {data.blueprint.objectContracts.map((contract) => (
                <article className="rounded-lg border border-line p-4" key={contract.objectType}>
                  <h3 className="font-mono text-sm font-semibold">{contract.objectType}</h3>
                  <p className="mt-2 text-sm leading-6 text-ink/55">{contract.description}</p>
                  <div className="mt-3 text-xs text-ink/45">Identity: {contract.identityKeys.join(" + ")}</div>
                  <div className="mt-2 text-xs text-ink/45">Evidence: {contract.requiredEvidenceFields.join(", ")}</div>
                </article>
              ))}
            </div>
          </SectionCard>
        </div>

        <aside className="space-y-4 xl:sticky xl:top-6 xl:self-start">
          <section className="rounded-xl border border-line bg-white p-5 shadow-sm">
            <div className="text-xs font-semibold uppercase tracking-[0.14em] text-ink/45">Exact next action</div>
            <p className="mt-3 text-sm leading-6 text-ink/65">{data.nextAction.reason}</p>
            {data.nextAction.packId ? <Link className="mt-5 flex w-full items-center justify-center rounded-md bg-signal px-4 py-3 text-sm font-semibold text-white hover:bg-orange-600" href={`/marketplace/departments/${encodeURIComponent(data.nextAction.packId)}`}>Open the next Department Pack</Link> : <Link className="mt-5 flex w-full items-center justify-center rounded-md bg-ink px-4 py-3 text-sm font-semibold text-white" href="/brain">Operate the company map</Link>}
          </section>
          <SectionCard title="Shared context">
            <ul className="space-y-2">{data.blueprint.sharedContextKeys.map((key) => <li className="rounded-md bg-paper px-3 py-2 font-mono text-xs text-ink/60" key={key}>{key}</li>)}</ul>
          </SectionCard>
          <SectionCard title="Object coverage">
            <div className="space-y-2 text-xs text-ink/55">{data.blueprint.topology.map((edge) => edge.objectType).filter((value, index, values) => values.indexOf(value) === index).map((objectType) => <div className="flex items-center justify-between gap-3" key={objectType}><span className="font-mono">{objectType}</span><span>{data.blueprint.topology.filter((edge) => edge.objectType === objectType).length} routes</span></div>)}</div>
          </SectionCard>
        </aside>
      </div>
    </>
  );
}
