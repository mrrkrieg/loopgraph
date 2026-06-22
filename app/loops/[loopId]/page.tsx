import Link from "next/link";
import { MetricCard } from "@/components/metric-card";
import { SectionCard } from "@/components/section-card";
import { StatusPill } from "@/components/status-pill";
import { getDemoWorkspace } from "@/lib/loop-engineering-builder/demo-data";
import { titleCase } from "@/lib/loop-engineering-builder/demo-helpers";

export default function LoopOverviewPage() {
  const workspace = getDemoWorkspace();

  return (
    <div className="grid gap-5">
      <div className="grid gap-4 md:grid-cols-4">
        <MetricCard label="Status" value={titleCase(workspace.loop.status)} />
        <MetricCard label="Autonomy" value={titleCase(workspace.loop.autonomyLevel)} />
        <MetricCard label="Questions" value={`${workspace.progress.percent}%`} note={`${workspace.progress.answered}/${workspace.progress.totalRequired} answered`} />
        <MetricCard label="Open reviews" value={workspace.loop.openReviews} />
      </div>
      <SectionCard title="Loop shape">
        <div className="grid gap-3 md:grid-cols-3">
          <div className="rounded-md border border-line bg-paper p-3">
            <div className="text-xs uppercase tracking-[0.14em] text-ink/45">Target metric</div>
            <div className="mt-1 font-medium">{workspace.loop.targetMetric}</div>
          </div>
          <div className="rounded-md border border-line bg-paper p-3">
            <div className="text-xs uppercase tracking-[0.14em] text-ink/45">Business outcome</div>
            <div className="mt-1 font-medium">{workspace.loop.businessOutcome}</div>
          </div>
          <div className="rounded-md border border-line bg-paper p-3">
            <div className="text-xs uppercase tracking-[0.14em] text-ink/45">Cadence</div>
            <div className="mt-1 font-medium">{workspace.loop.cadence}</div>
          </div>
        </div>
      </SectionCard>
      <SectionCard title="Generated outputs">
        <div className="flex flex-wrap gap-2 text-sm">
          <StatusPill>Loop spec validated with Zod</StatusPill>
          <StatusPill>Implementation artifacts generated</StatusPill>
          <StatusPill>Manual run traced</StatusPill>
          <StatusPill>Human review pending</StatusPill>
        </div>
        <div className="mt-4 flex flex-wrap gap-3">
          <Link href={`/loops/${workspace.loop.id}/spec`} className="rounded-md bg-ink px-4 py-2 text-sm font-semibold text-white">
            View spec
          </Link>
          <Link href={`/loops/${workspace.loop.id}/implementation`} className="rounded-md border border-ink px-4 py-2 text-sm font-semibold">
            Copy artifacts
          </Link>
        </div>
      </SectionCard>
    </div>
  );
}
