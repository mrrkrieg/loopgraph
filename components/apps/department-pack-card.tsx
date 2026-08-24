import Link from "next/link";
import type { DepartmentPackSearchEntry } from "@/lib/app-platform/read-model";

export function DepartmentPackCard({ entry }: { entry: DepartmentPackSearchEntry }) {
  const { pack } = entry;
  return (
    <article className="flex h-full flex-col rounded-xl border border-line bg-paper/35 p-5 transition hover:border-ink/35 hover:bg-white">
      <div className="text-xs font-semibold uppercase tracking-[0.16em] text-signal">
        {pack.department.replace(/_/g, " ")} · Department Pack
      </div>
      <h3 className="mt-2 text-lg font-semibold tracking-tight">{pack.name}</h3>
      <p className="mt-2 text-sm leading-6 text-ink/60">{pack.summary}</p>
      <div className="mt-4 flex flex-wrap gap-2 text-xs text-ink/55">
        <span className="rounded-full border border-line bg-white px-2.5 py-1">{pack.apps.length} App{pack.apps.length === 1 ? "" : "s"}</span>
        <span className="rounded-full border border-line bg-white px-2.5 py-1">{pack.topology.length} handoff{pack.topology.length === 1 ? "" : "s"}</span>
      </div>
      <div className="mt-auto pt-5">
        <Link className="inline-flex items-center text-sm font-semibold text-ink hover:text-signal" href={`/marketplace/departments/${encodeURIComponent(pack.id)}`}>
          Open the topology →
        </Link>
      </div>
    </article>
  );
}
