import Link from "next/link";
import { MarketplaceAppCard } from "@/components/apps/marketplace-app-card";
import { DepartmentPackCard } from "@/components/apps/department-pack-card";
import { PageHeader } from "@/components/page-header";
import { getMarketplaceViewData } from "@/lib/app-platform/read-model";

export const dynamic = "force-dynamic";

type MarketplacePageProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

export default async function MarketplacePage({ searchParams }: MarketplacePageProps) {
  const params = await searchParams;
  const query = first(params?.q);
  const department = first(params?.department);
  const data = await getMarketplaceViewData({ query, department });

  return (
    <>
      <PageHeader
        eyebrow="Loopgraph App Platform"
        title="Find a business capability for Hermes"
        description="Install complete, governed applications—not loose prompts. Each app brings the loops, Hermes skills, connector requirements, tests, outcomes, and gradual rollout policy needed to own one business result."
        action={data.installedCount > 0 ? (
          <Link className="rounded-md border border-line bg-white px-4 py-2 text-sm font-semibold hover:border-ink" href="/apps">
            {data.installedCount} installed
          </Link>
        ) : undefined}
      />

      <section className="rounded-xl border border-ink bg-ink p-5 text-white sm:p-7">
        <div className="max-w-3xl">
          <div className="text-xs font-semibold uppercase tracking-[0.18em] text-orange-300">Ask by outcome</div>
          <h2 className="mt-2 text-2xl font-semibold tracking-tight sm:text-3xl">What should Hermes handle for your company?</h2>
          <p className="mt-3 text-sm leading-6 text-white/65">
            Try “qualify inbound leads,” “find deals going cold,” or “turn feedback into product problems.”
          </p>
        </div>
        <form className="mt-5 flex flex-col gap-3 sm:flex-row" method="get">
          <input
            aria-label="Search Loopgraph Apps"
            className="min-w-0 flex-1 rounded-md border border-white/20 bg-white px-4 py-3 text-sm text-ink outline-none placeholder:text-ink/40 focus:ring-2 focus:ring-orange-400"
            defaultValue={query}
            name="q"
            placeholder="Qualify inbound leads"
          />
          {department ? <input name="department" type="hidden" value={department} /> : null}
          <button className="rounded-md bg-signal px-5 py-3 text-sm font-semibold text-white hover:bg-orange-600" type="submit">
            Search apps
          </button>
        </form>
      </section>

      <div className="mt-6 flex flex-wrap items-center gap-2" aria-label="Department filters">
        <DepartmentLink active={!department} href={query ? `/marketplace?q=${encodeURIComponent(query)}` : "/marketplace"} label="All departments" />
        {['product', 'sales', 'marketing', 'customer_success', 'engineering', 'ops_finance', 'hr_talent', 'legal_compliance', 'management'].map((item) => {
          const search = new URLSearchParams();
          if (query) search.set("q", query);
          search.set("department", item);
          return <DepartmentLink active={department === item} href={`/marketplace?${search.toString()}`} key={item} label={item.replace(/_/g, " ")} />;
        })}
      </div>

      {data.departmentPacks.length > 0 ? (
        <section className="mt-8">
          <div className="flex items-baseline justify-between gap-4">
            <div>
              <div className="text-xs font-semibold uppercase tracking-[0.16em] text-signal">Start with a complete department</div>
              <h2 className="mt-1 text-xl font-semibold">Prebuilt Hermes topologies</h2>
              <p className="mt-1 max-w-3xl text-sm leading-6 text-ink/55">Choose a Pack to see the ordered Apps, shared company context, and permitted evidence handoffs. Nothing is bulk-installed; Hermes onboards every App through its own governed journey.</p>
            </div>
          </div>
          <div className="mt-4 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {data.departmentPacks.map((entry) => <DepartmentPackCard entry={entry} key={entry.pack.id} />)}
          </div>
        </section>
      ) : null}

      <div className="mt-7 flex items-baseline justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold">{query ? `Results for “${query}”` : "Available applications"}</h2>
          <p className="mt-1 text-sm text-ink/55">{data.results.length} immutable, validated app version{data.results.length === 1 ? "" : "s"}</p>
        </div>
      </div>

      {data.results.length > 0 ? (
        <div className="mt-4 grid gap-5 md:grid-cols-2 xl:grid-cols-3">
          {data.results.map((entry) => <MarketplaceAppCard entry={entry} key={entry.app.id} />)}
        </div>
      ) : (
        <section className="mt-4 rounded-xl border border-dashed border-line bg-white p-10 text-center">
          <h2 className="font-semibold">No app matches this outcome yet</h2>
          <p className="mx-auto mt-2 max-w-xl text-sm leading-6 text-ink/60">
            Clear the search, build a private app from your existing loops, or ask Hermes to identify the missing loop.
          </p>
          <div className="mt-5 flex justify-center gap-3">
            <Link className="rounded-md border border-line px-4 py-2 text-sm font-semibold hover:border-ink" href="/marketplace">Clear search</Link>
            <Link className="rounded-md bg-ink px-4 py-2 text-sm font-semibold text-white" href="/discovery">Build with Hermes</Link>
          </div>
        </section>
      )}
    </>
  );
}

function DepartmentLink({ active, href, label }: { active: boolean; href: string; label: string }) {
  return (
    <Link className={`rounded-full border px-3 py-1.5 text-xs font-semibold capitalize ${active ? "border-ink bg-ink text-white" : "border-line bg-white text-ink/60 hover:border-ink"}`} href={href}>
      {label}
    </Link>
  );
}

function first(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}
