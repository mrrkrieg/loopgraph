import Link from "next/link";
import { MetricCard } from "@/components/metric-card";
import { SectionCard } from "@/components/section-card";
import { StatusPill } from "@/components/status-pill";
import { titleCase } from "@/lib/loop-engineering-builder/demo-helpers";
import { getWorkspace } from "@/lib/loop-engineering-builder/workspace";
import { filterRunsForLoop } from "@/lib/loopgraph-runtime/run-filters";
import { getStorageAdapter } from "@/lib/loopgraph-runtime/storage-resolver";

export default async function LoopOverviewPage({
  params
}: {
  params: Promise<{ loopId: string }>;
}) {
  const { loopId } = await params;
  const workspace = await getWorkspace(loopId);
  const storage = getStorageAdapter();
  const runs = filterRunsForLoop(await storage.listRuns(), loopId);
  const latestRun = runs[0] ? await storage.getRun(runs[0].id) : null;

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
      <SectionCard title="Runtime status">
        <div className="flex flex-wrap gap-2 text-sm">
          <StatusPill>{latestRun ? `Latest run: ${latestRun.status}` : "No persisted runs"}</StatusPill>
          {latestRun && <StatusPill>{latestRun.mode === "execute" ? "Live execute" : "Simulate / fixture"}</StatusPill>}
          {latestRun?.status === "WAITING_FOR_REVIEW" && <StatusPill>Human review required</StatusPill>}
          {latestRun?.status === "COMPLETED" && <StatusPill>Run completed</StatusPill>}
        </div>
        <div className="mt-4 flex flex-wrap gap-3">
          <Link href={`/loops/${workspace.loop.id}/runs`} className="rounded-md bg-ink px-4 py-2 text-sm font-semibold text-white">
            View runs
          </Link>
          <Link href={`/loops/${workspace.loop.id}/spec`} className="rounded-md border border-ink px-4 py-2 text-sm font-semibold">
            View spec
          </Link>
          {latestRun?.status === "WAITING_FOR_REVIEW" && (
            <Link href={`/loops/${workspace.loop.id}/reviews?runId=${latestRun.id}`} className="rounded-md border border-amber-300 bg-amber-50 px-4 py-2 text-sm font-semibold">
              Review run
            </Link>
          )}
        </div>
      </SectionCard>
    </div>
  );
}
