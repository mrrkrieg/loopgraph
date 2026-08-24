import Link from "next/link";
import type { CompanyBlueprintSearchEntry } from "@/lib/app-platform/read-model";

export function CompanyBlueprintCard({ entry }: { entry: CompanyBlueprintSearchEntry }) {
  const { blueprint } = entry;
  return (
    <article className="rounded-xl border border-ink bg-ink p-6 text-white shadow-sm">
      <div className="text-xs font-semibold uppercase tracking-[0.16em] text-orange-300">Company Blueprint</div>
      <div className="mt-3 grid gap-6 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end">
        <div>
          <h2 className="text-2xl font-semibold tracking-tight">{blueprint.name}</h2>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-white/65">{blueprint.summary}</p>
          <div className="mt-4 flex flex-wrap gap-2 text-xs text-white/70">
            <span className="rounded-full border border-white/15 px-2.5 py-1">{blueprint.packs.length} departments</span>
            <span className="rounded-full border border-white/15 px-2.5 py-1">{blueprint.objectContracts.length} canonical objects</span>
            <span className="rounded-full border border-white/15 px-2.5 py-1">{blueprint.topology.length} evidence contracts</span>
          </div>
        </div>
        <Link className="inline-flex items-center justify-center rounded-md bg-signal px-5 py-3 text-sm font-semibold text-white hover:bg-orange-600" href={`/marketplace/companies/${encodeURIComponent(blueprint.id)}`}>
          Open the company map
        </Link>
      </div>
    </article>
  );
}
