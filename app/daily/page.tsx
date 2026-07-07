import Link from "next/link";
import { MetricCard } from "@/components/metric-card";
import { PageHeader } from "@/components/page-header";
import { SectionCard } from "@/components/section-card";
import { StatusPill } from "@/components/status-pill";
import { getDailySummaryForView } from "../discovery/view-data";

export default async function DailyPage() {
  const { summary } = await getDailySummaryForView();
  return (
    <>
      <PageHeader
        eyebrow="Daily operating summary"
        title="Daily"
        description="Company and department loop state with blocked access, missing metrics, open reviews, hidden labor, and recommended next actions."
        action={<Link className="rounded-md bg-ink px-4 py-2 text-sm font-semibold text-white" href="/daily/undefined-metrics">Undefined metrics</Link>}
      />

      <div className="grid gap-4 md:grid-cols-3 xl:grid-cols-6">
        <MetricCard label="Company health" value={summary.companyHealth} note={summary.date} />
        <MetricCard label="Net saved" value={`${summary.netSavedMinutes}m`} note="Gross minus hidden labor" />
        <MetricCard label="Botsitting" value={`${summary.botsittingMinutes}m`} note="Operator babysitting time" />
        <MetricCard label="Open reviews" value={summary.openReviews.length} note="Human judgment needed" />
        <MetricCard label="Blocked loops" value={summary.loops.filter((loop) => loop.status === "missing_access" || loop.status === "blocked").length} note="Access or policy blockers" />
        <MetricCard label="Undefined metrics" value={summary.undefinedMetrics.length} note="Not yet measurable" />
      </div>

      <div className="mt-6 grid gap-5 lg:grid-cols-[0.8fr_1.2fr]">
        <SectionCard title="Department health">
          <div className="space-y-3">
            {summary.departments.map((department) => (
              <div key={department.departmentId} className="rounded-md border border-line bg-paper px-3 py-2 text-sm">
                <div className="flex items-center justify-between gap-3">
                  <span className="font-medium">{department.name}</span>
                  <StatusPill>{department.health}</StatusPill>
                </div>
                <div className="mt-1 text-ink/60">{department.summary}</div>
              </div>
            ))}
          </div>
        </SectionCard>
        <SectionCard title="Loop status">
          <div className="overflow-hidden rounded-md border border-line">
            <table className="w-full text-left text-sm">
              <thead className="bg-paper text-xs uppercase tracking-[0.14em] text-ink/50">
                <tr>
                  <th className="px-4 py-3">Loop</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3">Metric</th>
                  <th className="px-4 py-3">Next action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line bg-white">
                {summary.loops.map((loop) => (
                  <tr key={loop.loopId}>
                    <td className="px-4 py-3 font-medium">{loop.loopName}</td>
                    <td className="px-4 py-3"><StatusPill>{loop.status}</StatusPill></td>
                    <td className="px-4 py-3">{loop.mainMetric?.label ?? "None"}</td>
                    <td className="px-4 py-3">{loop.nextAction}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </SectionCard>
      </div>

      <div className="mt-6 grid gap-5 lg:grid-cols-2">
        <SectionCard title="Recommended actions">
          <div className="space-y-3">
            {summary.recommendedActions.map((action) => (
              <div key={action.id} className="rounded-md border border-line bg-paper px-3 py-2 text-sm">
                <div className="flex items-center gap-2"><StatusPill>{action.priority}</StatusPill><span className="font-medium">{action.label}</span></div>
                <div className="mt-1 text-ink/60">{action.reason}</div>
              </div>
            ))}
          </div>
        </SectionCard>
        <SectionCard title="Recent runs and escalations">
          <div className="space-y-3 text-sm text-ink/65">
            <div>Open reviews: {summary.openReviews.length}</div>
            <div>Escalations: {summary.escalations.length}</div>
            <div>Recent traces are shown when materialized loops start producing runs.</div>
          </div>
        </SectionCard>
      </div>
    </>
  );
}

