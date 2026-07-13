import React from "react";
import Link from "next/link";
import { PageHeader } from "../page-header";
import { SectionCard } from "../section-card";
import { StatusPill } from "../status-pill";
import type { DailySummary } from "@/lib/loopgraph-core/daily-summary";
import { DailyLoopCard } from "./daily-loop-card";
import { DailyMetricCard } from "./daily-metric-card";
import { UndefinedMetricsList } from "./undefined-metrics-list";

export function DailySummaryPage({ summary }: { summary: DailySummary }) {
  const blockedLoops = summary.loops.filter((loop) => loop.status === "missing_access" || loop.status === "blocked").length;
  const needsAttention = summary.loops.filter((loop) => loop.status !== "healthy").slice(0, 6);

  return (
    <>
      <PageHeader
        title="Daily"
        description="Operating summary for what ran, what is blocked, what needs review, and which metrics are still undefined."
        action={<Link className="rounded-md bg-ink px-4 py-2 text-sm font-semibold text-white" href="/daily/undefined-metrics">Undefined metrics</Link>}
      />

      <div className="grid gap-4 md:grid-cols-3 xl:grid-cols-7">
        <DailyMetricCard label="Company Health" value={`${summary.companyHealth}%`} note={summary.date} />
        <DailyMetricCard label="Loops Ran" value={summary.loops.length} note="Tracked loops" />
        <DailyMetricCard label="Open Reviews" value={summary.openReviews.length} note="Human judgment" />
        <DailyMetricCard label="Blocked Loops" value={blockedLoops} note="Access or policy" />
        <DailyMetricCard label="Undefined Metrics" value={summary.undefinedMetrics.length} note="Measurement work" />
        <DailyMetricCard label="Net Saved" value={`${summary.netSavedMinutes}m`} note="After overhead" />
        <DailyMetricCard label="Botsitting" value={`${summary.botsittingMinutes}m`} note="Operator time" />
      </div>

      <div className="mt-6 grid gap-5 lg:grid-cols-[0.9fr_1.1fr]">
        <SectionCard title="Needs Attention">
          <div className="grid gap-3">
            {needsAttention.length > 0 ? (
              needsAttention.map((loop) => (
                <DailyLoopCard
                  key={loop.loopId}
                  loopName={loop.loopName}
                  metric={loop.mainMetric?.label}
                  nextAction={loop.nextAction ?? loop.summary}
                  status={loop.status}
                />
              ))
            ) : (
              <div className="rounded-md border border-line bg-paper p-4 text-sm text-ink/60">No loops need attention today.</div>
            )}
          </div>
        </SectionCard>

        <SectionCard title="Department Rollups">
          <div className="space-y-3">
            {summary.departments.map((department) => (
              <div key={department.departmentId} className="rounded-md border border-line bg-paper px-3 py-2 text-sm">
                <div className="flex items-center justify-between gap-3">
                  <span className="font-medium">{department.name}</span>
                  <StatusPill>{department.health}%</StatusPill>
                </div>
                <div className="mt-1 text-ink/60">{department.summary}</div>
              </div>
            ))}
          </div>
        </SectionCard>
      </div>

      <div className="mt-6 grid gap-5 xl:grid-cols-3">
        <SectionCard title="Loop Summaries">
          <div className="space-y-3">
            {summary.loops.slice(0, 6).map((loop) => (
              <DailyLoopCard
                key={loop.loopId}
                loopName={loop.loopName}
                metric={loop.mainMetric?.label}
                nextAction={loop.nextAction ?? loop.summary}
                status={loop.status}
              />
            ))}
          </div>
        </SectionCard>

        <SectionCard title="Undefined Metrics">
          <UndefinedMetricsList metrics={summary.undefinedMetrics.slice(0, 5)} />
        </SectionCard>

        <SectionCard title="Recommended Next Actions">
          <div className="space-y-3">
            {summary.recommendedActions.map((action) => (
              <div key={action.id} className="rounded-md border border-line bg-paper p-4 text-sm">
                <div className="flex items-center gap-2">
                  <StatusPill>{action.priority}</StatusPill>
                  <span className="font-semibold">{action.label}</span>
                </div>
                <div className="mt-2 leading-6 text-ink/65">{action.reason}</div>
              </div>
            ))}
          </div>
        </SectionCard>
      </div>

      <div className="mt-6 grid gap-5 lg:grid-cols-2">
        <SectionCard title="Open Reviews">
          <div className="text-sm leading-6 text-ink/65">{summary.openReviews.length} reviews are waiting for human approval.</div>
        </SectionCard>
        <SectionCard title="Recent Runs">
          <div className="space-y-2 text-sm text-ink/65">
            {summary.loops.slice(0, 5).map((loop) => (
              <div className="flex items-center justify-between gap-3 rounded-md border border-line bg-paper px-3 py-2" key={loop.loopId}>
                <span>{loop.loopName}</span>
                <span>{loop.lastRunAt ?? "No run"}</span>
              </div>
            ))}
          </div>
        </SectionCard>
      </div>
    </>
  );
}
