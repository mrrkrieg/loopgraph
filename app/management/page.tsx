import { MetricCard } from "@/components/metric-card";
import { PageHeader } from "@/components/page-header";
import { SectionCard } from "@/components/section-card";
import { StatusPill } from "@/components/status-pill";
import { getWorkspace } from "@/lib/loop-engineering-builder/workspace";
import { FileStorageAdapter } from "@/lib/loopgraph-sdk/storage";
import Link from "next/link";
import path from "node:path";

export default async function ManagementPage() {
  const workspace = await getWorkspace();
  const storage = new FileStorageAdapter(path.join(process.cwd(), ".loopgraph"));
  const cases = await storage.listCases();

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
      </div>
    </>
  );
}
