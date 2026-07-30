import Link from "next/link";
import { EmptyOperatingState } from "@/components/operate/empty-operating-state";
import { formatOperatingDate } from "@/components/operate/format";
import { OperateNav } from "@/components/operate/operate-nav";
import { OperatingModeNote } from "@/components/operate/operating-mode-note";
import { MetricCard } from "@/components/metric-card";
import { PageHeader } from "@/components/page-header";
import { SectionCard } from "@/components/section-card";
import { StatusPill } from "@/components/status-pill";
import { getOperatingViewData } from "@/lib/loopgraph-runtime/operating-view-data";

export default async function OpportunitiesPage() {
  const data = await getOperatingViewData();
  const qualified = data.opportunities.filter((item) =>
    ["Qualified", "Design Requested", "Designing", "Proposal Ready"].includes(item.status)
  ).length;
  const ready = data.opportunities.filter((item) => item.status === "Proposal Ready").length;
  const averageScore = data.opportunities.length
    ? Math.round(data.opportunities.reduce((sum, item) => sum + item.score, 0) / data.opportunities.length)
    : 0;

  return (
    <>
      <PageHeader
        eyebrow="Operate"
        title="Loop opportunities"
        description="Hermes turns recurring business problems, route corrections, review friction, outcome regressions, and negative value into ranked candidates for new or improved loops."
        action={
          <Link className="rounded-md bg-ink px-4 py-2 text-sm font-semibold text-white" href="/discovery">
            Design with Hermes
          </Link>
        }
      />
      <OperateNav />
      <OperatingModeNote mode={data.mode} />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <MetricCard label="Detected" value={data.opportunities.length} note="Evidence-backed candidates" />
        <MetricCard label="Qualified" value={qualified} note="Above the configured threshold" />
        <MetricCard label="Ready for review" value={ready} note="A graph change is prepared" />
        <MetricCard label="Average score" value={averageScore || "—"} note="Recurrence, impact, evidence, risk" />
      </div>

      <div className="mt-6">
        {data.opportunities.length === 0 ? (
          <EmptyOperatingState
            title="Hermes has not detected a loop opportunity yet"
            description="This is the correct state for a clean install. Once Hermes receives business events, Loopgraph can scan repeated unhandled problems, corrections, failures, friction, and outcome evidence without adding preview records to your workspace."
            command="loopgraph opportunities scan"
          />
        ) : (
          <div className="grid gap-4 xl:grid-cols-2">
            {data.opportunities.map((item) => (
              <SectionCard
                key={item.id}
                title={item.title}
                description={`${item.department} · ${item.kind}`}
              >
                <div className="flex flex-wrap items-center gap-2">
                  <StatusPill>{item.status}</StatusPill>
                  <StatusPill>{item.highestSeverity} signal</StatusPill>
                  <span className="ml-auto text-3xl font-semibold tracking-tight text-ink">{item.score}</span>
                  <span className="text-xs uppercase tracking-[0.14em] text-ink/45">/ 100</span>
                </div>
                <p className="mt-4 text-sm leading-6 text-ink/70">{item.summary}</p>
                <div className="mt-4 rounded-md border border-line bg-paper p-4">
                  <div className="text-xs font-semibold uppercase tracking-[0.14em] text-ink/45">
                    Why Hermes ranked it
                  </div>
                  <ul className="mt-2 space-y-2 text-sm leading-5 text-ink/65">
                    {item.scoreReasons.map((reason) => (
                      <li className="flex gap-2" key={reason}>
                        <span aria-hidden="true" className="mt-1 text-signal">●</span>
                        <span>{reason}</span>
                      </li>
                    ))}
                  </ul>
                </div>
                <div className="mt-4 flex flex-wrap items-center justify-between gap-3 text-xs text-ink/50">
                  <span>{item.signalCount} supporting signals</span>
                  <span>Last seen {formatOperatingDate(item.lastObservedAt)}</span>
                </div>
                {item.graphChangeSetId ? (
                  <Link
                    className="mt-4 inline-flex text-sm font-semibold text-ink underline underline-offset-4"
                    href="/operate/changes"
                  >
                    Review the proposed graph change →
                  </Link>
                ) : (
                  <p className="mt-4 text-sm font-medium text-ink/55">
                    Next: Hermes gathers missing context before proposing a graph change.
                  </p>
                )}
              </SectionCard>
            ))}
          </div>
        )}
      </div>
    </>
  );
}
