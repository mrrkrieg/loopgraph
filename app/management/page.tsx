import { MetricCard } from "@/components/metric-card";
import { PageHeader } from "@/components/page-header";
import { SectionCard } from "@/components/section-card";
import { StatusPill } from "@/components/status-pill";
import { getWorkspace } from "@/lib/loop-engineering-builder/workspace";
import { loadLatestManagementRollup } from "@/lib/loopgraph-runtime/management-rollup";
import { getStorageAdapter } from "@/lib/loopgraph-runtime/storage-resolver";
import Link from "next/link";

export default async function ManagementPage() {
  const workspace = await getWorkspace();
  const storage = getStorageAdapter();
  const cases = await storage.listCases();
  const rollup = await loadLatestManagementRollup();

  return (
    <>
      <PageHeader
        eyebrow="Company loop"
        title="Management"
        description="Roll up loop health, department status, bottlenecks, escalations, failures, improvements, decisions, and weekly summary."
      />
      <div className="grid gap-4 md:grid-cols-4">
        <MetricCard label="Loop health" value="Good" note="Manual V1 mode with complete spec" />
        <MetricCard label="Department status" value={workspace.loops.length} note="Loops mapped" />
        <MetricCard label="Open escalations" value={cases.filter((item) => item.status === "open").length || workspace.loops.reduce((sum, loop) => sum + loop.openReviews, 0)} note="Cases and human review required" />
        <MetricCard label="Improvement items" value={workspace.improvements.length} note="From trace improvement_signal outputs" />
      </div>
      <div className="mt-6 grid gap-5 lg:grid-cols-2">
        <SectionCard title="Weekly management summary" description={rollup ? `Persisted rollup ${rollup.weekKey}` : "Run the management cron or simulate escalation cases to populate rollup data."}>
          <p className="text-sm leading-6 text-ink/70">{workspace.managementReview.summary}</p>
          {rollup && (
            <p className="mt-2 text-xs text-ink/50">Generated {rollup.generatedAt}</p>
          )}
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
            {workspace.improvements.length === 0 ? (
              <p className="text-sm text-ink/60">Reject a review or resolve a case via CLI to create improvement signals.</p>
            ) : (
              workspace.improvements.map((item) => (
                <div key={item.id} className="flex items-center justify-between gap-3 rounded-md border border-line bg-paper px-3 py-2 text-sm">
                  <div>
                    <div>{item.title}</div>
                    {item.sourceRunId && (
                      <Link href={`/loops/${item.loopId}/runs/${item.sourceRunId}`} className="text-xs text-ink/50 hover:text-ink">
                        Source run {item.sourceRunId}
                      </Link>
                    )}
                  </div>
                  <StatusPill>{item.status}</StatusPill>
                </div>
              ))
            )}
          </div>
        </SectionCard>
        <SectionCard title="Escalation cases" description="Persisted cases from CLI simulate runs in .loopgraph/cases/">
          {cases.length === 0 ? (
            <p className="text-sm text-ink/60">Run `npm run loopgraph -- simulate ...` to create typed escalation cases.</p>
          ) : (
            <div className="space-y-2">
              {cases.map((item) => (
                <Link key={item.id} href={`/cases/${item.id}`} className="flex items-center justify-between gap-3 rounded-md border border-line bg-white px-3 py-2 text-sm hover:bg-paper">
                  <span>{item.id}</span>
                  <div className="flex items-center gap-2">
                    <StatusPill>{item.severity}</StatusPill>
                    <StatusPill>{item.status}</StatusPill>
                  </div>
                </Link>
              ))}
            </div>
          )}
        </SectionCard>
        {rollup && rollup.plans.length > 0 && (
          <SectionCard title="Latest management plans" description="From persisted rollup in .loopgraph/management/latest.json">
            <div className="space-y-3">
              {rollup.plans.map((plan) => (
                <div key={plan.caseId} className="rounded-md border border-line bg-white p-3 text-sm">
                  <div className="font-medium">{plan.summary}</div>
                  <div className="mt-1 text-xs text-ink/50">{plan.severity} · <Link href={`/cases/${plan.caseId}`} className="hover:text-ink">{plan.caseId}</Link></div>
                  <pre className="mt-2 overflow-auto rounded bg-paper p-2 text-xs">{JSON.stringify(plan.plan, null, 2)}</pre>
                </div>
              ))}
            </div>
          </SectionCard>
        )}
      </div>
    </>
  );
}
