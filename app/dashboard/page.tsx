import Link from "next/link";
import { MetricCard } from "@/components/metric-card";
import { PageHeader } from "@/components/page-header";
import { SectionCard } from "@/components/section-card";
import { StatusPill } from "@/components/status-pill";
import { getDemoWorkspace } from "@/lib/loop-engineering-builder/demo-data";
import { formatDate } from "@/lib/loop-engineering-builder/demo-helpers";

export default function DashboardPage() {
  const workspace = getDemoWorkspace();

  return (
    <>
      <PageHeader
        eyebrow="Operating loops"
        title="Dashboard"
        description="Company-level view of loop health, human reviews, traces, metrics, and improvement work."
        action={
          <Link className="rounded-md bg-ink px-4 py-2 text-sm font-semibold text-white" href="/loops/new">
            New loop
          </Link>
        }
      />

      <div className="grid gap-4 md:grid-cols-3 xl:grid-cols-6">
        <MetricCard label="Total loops" value="1" note="Starter workspace" />
        <MetricCard label="Active loops" value="0" note="Manual V1 mode" />
        <MetricCard label="Need answers" value={workspace.progress.missing} note={`${workspace.progress.percent}% complete`} />
        <MetricCard label="Human reviews" value={workspace.loop.openReviews} note="Pending judgment" />
        <MetricCard label="Open improvements" value={workspace.improvements.length} note="From traces" />
        <MetricCard label="Decisions needed" value="2" note="Weekly rollup" />
      </div>

      <div className="mt-6 grid gap-5 lg:grid-cols-[1.25fr_0.75fr]">
        <SectionCard title="Recent loop runs" description="Manual run simulation with step traces and verification output.">
          <div className="overflow-hidden rounded-lg border border-line">
            <table className="w-full text-left text-sm">
              <thead className="bg-paper text-xs uppercase tracking-[0.14em] text-ink/50">
                <tr>
                  <th className="px-4 py-3">Loop</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3">Trigger</th>
                  <th className="px-4 py-3">Completed</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line bg-white">
                <tr>
                  <td className="px-4 py-3">
                    <Link href={`/loops/${workspace.loop.id}/runs`} className="font-medium text-ink hover:underline">
                      {workspace.loop.name}
                    </Link>
                  </td>
                  <td className="px-4 py-3"><StatusPill>{workspace.runBundle.run.status}</StatusPill></td>
                  <td className="px-4 py-3">{workspace.runBundle.run.triggerType}</td>
                  <td className="px-4 py-3">{formatDate(workspace.runBundle.run.completedAt)}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </SectionCard>

        <SectionCard title="Management decisions needed" description="Rollup from active loops, reviews, metrics, and improvements.">
          <div className="space-y-3 text-sm">
            {workspace.managementReview.decisions.map((decision) => (
              <div key={decision} className="rounded-md border border-line bg-paper px-3 py-2">
                {decision}
              </div>
            ))}
          </div>
        </SectionCard>
      </div>
    </>
  );
}
