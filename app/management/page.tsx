import { MetricCard } from "@/components/metric-card";
import { PageHeader } from "@/components/page-header";
import { SectionCard } from "@/components/section-card";
import { StatusPill } from "@/components/status-pill";
import { getDemoWorkspace } from "@/lib/loop-engineering-builder/demo-data";

export default function ManagementPage() {
  const workspace = getDemoWorkspace();

  return (
    <>
      <PageHeader
        eyebrow="Company loop"
        title="Management"
        description="Roll up loop health, department status, bottlenecks, escalations, failures, improvements, decisions, and weekly summary."
      />
      <div className="grid gap-4 md:grid-cols-4">
        <MetricCard label="Loop health" value="Good" note="Manual V1 mode with complete spec" />
        <MetricCard label="Department status" value="Marketing" note="First loop implemented" />
        <MetricCard label="Open escalations" value={workspace.loop.openReviews} note="Human review required" />
        <MetricCard label="Recent failures" value="0" note="Simulated run completed" />
      </div>
      <div className="mt-6 grid gap-5 lg:grid-cols-2">
        <SectionCard title="Weekly management summary">
          <p className="text-sm leading-6 text-ink/70">{workspace.managementReview.summary}</p>
        </SectionCard>
        <SectionCard title="Bottlenecks">
          <div className="space-y-2">
            {workspace.managementReview.bottlenecks.map((item) => (
              <div key={item} className="rounded-md border border-line bg-paper px-3 py-2 text-sm">{item}</div>
            ))}
          </div>
        </SectionCard>
        <SectionCard title="Decisions needed">
          <div className="space-y-2">
            {workspace.managementReview.decisions.map((item) => (
              <div key={item} className="rounded-md border border-line bg-white px-3 py-2 text-sm">{item}</div>
            ))}
          </div>
        </SectionCard>
        <SectionCard title="Improvement items">
          <div className="space-y-2">
            {workspace.improvements.map((item) => (
              <div key={item.id} className="flex items-center justify-between gap-3 rounded-md border border-line bg-paper px-3 py-2 text-sm">
                <span>{item.title}</span>
                <StatusPill>{item.status}</StatusPill>
              </div>
            ))}
          </div>
        </SectionCard>
      </div>
    </>
  );
}
