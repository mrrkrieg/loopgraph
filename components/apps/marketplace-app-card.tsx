import Link from "next/link";
import type { MarketplaceSearchEntry } from "@/lib/app-platform/read-model";
import { AppStatusPill } from "./app-status-pill";

export function MarketplaceAppCard({ entry }: { entry: MarketplaceSearchEntry }) {
  const latest = entry.app.versions.find((version) => version.version === entry.app.latestVersion)!;
  return (
    <article className="flex h-full flex-col rounded-xl border border-line bg-white p-5 shadow-sm transition hover:-translate-y-0.5 hover:border-ink/30 hover:shadow-md">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-xs font-semibold uppercase tracking-[0.16em] text-signal">
            {entry.app.department.replace(/_/g, " ")}
          </div>
          <h2 className="mt-2 text-xl font-semibold tracking-tight text-ink">{entry.app.name}</h2>
        </div>
        <AppStatusPill state={entry.installation?.state} readiness={entry.readiness?.state} />
      </div>
      <p className="mt-3 text-sm leading-6 text-ink/65">{entry.app.summary}</p>
      <div className="mt-5 grid grid-cols-2 gap-3 border-y border-line py-4 text-xs">
        <Fact label="Includes" value={`${latest.modules.length} modules`} />
        <Fact label="Stacks" value={`${latest.presets.length} presets`} />
        <Fact label="Maturity" value={latest.maturity.replace(/_/g, " ")} />
        <Fact label="Version" value={`v${latest.version}`} />
      </div>
      <div className="mt-4 flex flex-wrap gap-2">
        {latest.presets.map((preset) => (
          <span className="rounded-full bg-paper px-2.5 py-1 text-xs text-ink/65" key={preset.id}>
            {preset.name}
          </span>
        ))}
      </div>
      <div className="mt-auto pt-5">
        <Link
          className="inline-flex w-full items-center justify-center rounded-md bg-ink px-4 py-2.5 text-sm font-semibold text-white hover:bg-ink/85"
          href={`/marketplace/${encodeURIComponent(entry.app.id)}`}
        >
          {entry.installation ? "Open installed app" : "View app"}
        </Link>
      </div>
    </article>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="font-semibold uppercase tracking-[0.12em] text-ink/40">{label}</div>
      <div className="mt-1 capitalize text-ink/75">{value}</div>
    </div>
  );
}
