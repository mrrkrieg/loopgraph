import Link from "next/link";
import { notFound } from "next/navigation";
import { formatOperatingDate } from "@/components/operate/format";
import { OperateNav } from "@/components/operate/operate-nav";
import { OperatingModeNote } from "@/components/operate/operating-mode-note";
import { PageHeader } from "@/components/page-header";
import { SectionCard } from "@/components/section-card";
import { StatusPill } from "@/components/status-pill";
import { getAgentOperationsTraceViewData } from "@/lib/loopgraph-runtime/agent-operations-view-data";

export const dynamic = "force-dynamic";

export default async function AgentActivityTracePage({
  params
}: {
  params: Promise<{ routeJobId: string }>;
}) {
  const routeJobId = decodeURIComponent((await params).routeJobId);
  const view = await getAgentOperationsTraceViewData(routeJobId);
  if (!view.data) notFound();
  const trace = view.data;
  const row = trace.activity;
  const selected = trace.routing.selectedRoutes.find((route) => route.loopId === row.loopId) ?? trace.routing.selectedRoutes[0];

  return (
    <>
      <div className="mb-4 text-sm text-ink/50">
        <Link className="hover:text-ink" href="/operate/activity">Hermes activity</Link> / {row.loopLabel} / {shortId(row.runId)}
      </div>
      <PageHeader
        eyebrow={`${row.department} · Governed execution trace`}
        title={row.loopLabel}
        description={row.problemSummary ?? `${row.eventType} was routed by Hermes into this department-owned loop.`}
        action={<StatusPill>{humanize(row.jobStatus)}</StatusPill>}
      />
      <OperateNav />
      <OperatingModeNote mode={view.mode} />

      <section className="rounded-lg border border-line bg-white p-4 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold">One business problem, end to end</h2>
            <p className="mt-1 max-w-3xl text-sm leading-6 text-ink/60">
              This is the bounded operational record for why Hermes routed the signal, which loop claimed it, what the assigned agent did, and what evidence returned.
            </p>
          </div>
          <div className="text-right text-xs text-ink/45">
            <div className="font-mono">{row.routeJobId}</div>
            <div className="mt-1">Updated {formatOperatingDate(row.updatedAt)}</div>
          </div>
        </div>
        <div className="mt-5 overflow-x-auto pb-2">
          <div className="grid min-w-[960px] grid-cols-[1fr_36px_1fr_36px_1fr_36px_1fr_36px_1fr] items-stretch gap-2">
            <TraceNode label="Incoming signal" title={row.source} detail={row.eventType} tone="blue" />
            <TraceArrow label="classify" />
            <TraceNode label="Company router" title="Hermes Brain" detail={humanize(trace.routing.action ?? "received")} tone="dark" />
            <TraceArrow label="route" />
            <TraceNode label={row.department} title={row.loopLabel} detail={`${Math.round((selected?.confidence ?? trace.routing.confidence ?? 0) * 100)}% route confidence`} tone="orange" />
            <TraceArrow label="execute" />
            <TraceNode label={row.agentName ?? "Hermes runtime"} title={`${row.completedTaskCount}/${row.taskCount} tasks`} detail={`${row.toolCallCount} tool calls · ${row.approvalCount} approvals`} tone="purple" />
            <TraceArrow label={row.observedOutcomeCount > 0 ? "learn" : "state"} />
            <TraceNode label={row.observedOutcomeCount > 0 ? "Evidence returned" : "Current state"} title={row.observedOutcomeCount > 0 ? `${row.observedOutcomeCount} observed outcomes` : humanize(row.jobStatus)} detail={row.latestSummary ?? formatOperatingDate(row.updatedAt)} tone={row.needsAttention ? "red" : "green"} />
          </div>
        </div>
      </section>

      <div className="mt-6 grid min-w-0 gap-6 xl:grid-cols-[minmax(0,1.45fr)_minmax(20rem,0.55fr)]">
        <div className="min-w-0 space-y-6">
          <SectionCard title="Why Hermes selected this loop" description="The reason is preserved separately from the model response so operators can inspect routing without reading raw provider payloads.">
            {trace.routing.selectedRoutes.length === 0 ? (
              <p className="text-sm text-ink/60">No route was committed. Hermes abstained or requested additional context.</p>
            ) : (
              <div className="space-y-3">
                {trace.routing.selectedRoutes.map((route) => (
                  <div className="rounded-lg border border-line p-4" key={`${route.loopId}:${route.role}`}>
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div><div className="font-semibold">{route.loopLabel}</div><div className="mt-1 text-xs text-ink/45">{humanize(route.role)} route · priority {route.priority}</div></div>
                      <span className="rounded-full bg-orange-50 px-3 py-1 text-xs font-semibold text-orange-800">{Math.round(route.confidence * 100)}% confidence</span>
                    </div>
                    <p className="mt-3 text-sm leading-6 text-ink/70">{route.reasonSummary}</p>
                    <p className="mt-2 text-xs text-ink/45">Supported by {route.evidenceRefCount} bounded evidence reference{route.evidenceRefCount === 1 ? "" : "s"}.</p>
                  </div>
                ))}
                {trace.routing.alternatives.length > 0 ? (
                  <details className="rounded-lg border border-line p-4">
                    <summary className="cursor-pointer text-sm font-semibold">Alternatives Hermes considered</summary>
                    <div className="mt-3 space-y-3">{trace.routing.alternatives.map((alternative) => <div key={alternative.loopId}><div className="flex items-center justify-between gap-3 text-sm"><span className="font-semibold">{alternative.loopLabel}</span><span>{Math.round(alternative.confidence * 100)}%</span></div><p className="mt-1 text-xs leading-5 text-ink/55">{alternative.reasonSummary}</p></div>)}</div>
                  </details>
                ) : null}
              </div>
            )}
          </SectionCard>

          <SectionCard title="Hermes execution timeline" description="Ordered assignment events show task, tool, approval, output, and outcome state. Sensitive tool inputs, outputs, artifact locations, and raw provider records are deliberately omitted.">
            {trace.execution.timeline.length === 0 ? (
              <p className="text-sm text-ink/60">Hermes has not submitted execution events for this assignment yet.</p>
            ) : (
              <ol className="relative ml-2 border-l border-line pl-6">
                {trace.execution.timeline.map((event) => (
                  <li className="relative pb-6 last:pb-0" key={event.id}>
                    <span className={`absolute -left-[1.92rem] top-1 h-3.5 w-3.5 rounded-full border-2 border-white ${event.error ? "bg-red-500" : event.outcome ? "bg-emerald-500" : event.approval ? "bg-amber-500" : "bg-violet-500"}`} />
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div><div className="text-sm font-semibold">{humanize(event.eventType)}</div><div className="mt-0.5 text-xs text-ink/45">Sequence {event.sequence}</div></div>
                      <time className="text-xs text-ink/45">{formatOperatingDate(event.occurredAt)}</time>
                    </div>
                    {event.summary ? <p className="mt-2 text-sm leading-6 text-ink/65">{event.summary}</p> : null}
                    <div className="mt-2 flex flex-wrap gap-2 text-xs">
                      {event.task ? <Fact>{event.task.label}{event.task.owner ? ` · ${event.task.owner}` : ""}</Fact> : null}
                      {event.tool ? <Fact>{event.tool.toolKey}</Fact> : null}
                      {event.approval ? <Fact>{humanize(event.approval.status)}{event.approval.requestedRole ? ` · ${event.approval.requestedRole}` : ""}</Fact> : null}
                      {event.output ? <Fact>{event.output.label} · {humanize(event.output.type)}</Fact> : null}
                      {event.outcome ? <Fact>{humanize(event.outcome.metricKey)} · {formatValue(event.outcome.value, event.outcome.unit)}</Fact> : null}
                      {event.error ? <Fact tone="danger">{event.error.code} · {event.error.retryable ? "retryable" : "terminal"}</Fact> : null}
                    </div>
                  </li>
                ))}
              </ol>
            )}
          </SectionCard>

          <SectionCard title="Routing and learning receipts" description="The correlation timeline joins intake, problem identity, Hermes decision, route commit, work state, outcomes, and corrections.">
            <div className="space-y-3">
              {trace.routing.timeline.map((entry) => (
                <div className="grid gap-2 rounded-md border border-line p-3 sm:grid-cols-[9rem_minmax(0,1fr)_7rem] sm:items-start" key={entry.id}>
                  <div className="text-xs font-semibold uppercase tracking-[0.1em] text-ink/45">{humanize(entry.stage)}</div>
                  <div><div className="text-sm font-semibold">{entry.label}</div><p className="mt-1 text-xs leading-5 text-ink/55">{entry.detail}</p></div>
                  <div className="text-xs text-ink/45 sm:text-right"><div>{humanize(entry.status)}</div><div className="mt-1">{formatOperatingDate(entry.at)}</div></div>
                </div>
              ))}
            </div>
          </SectionCard>
        </div>

        <aside className="min-w-0 space-y-4">
          <TraceSummary title="Work performed" items={[
            `${trace.execution.tasks.length} tasks`,
            `${trace.execution.toolCalls.length} bounded tool calls`,
            `${trace.execution.outputs.length} governed outputs`
          ]} />
          <TraceSummary title="Human control" items={trace.execution.approvals.length > 0 ? trace.execution.approvals.map((approval) => `${humanize(approval.status)} · ${humanize(approval.role)}`) : ["No approval event recorded"]} />
          <TraceSummary title="Outcome evidence" items={trace.execution.outcomes.length > 0 ? trace.execution.outcomes.map((outcome) => `${humanize(outcome.name)} · ${formatValue(outcome.value, outcome.unit)}${outcome.observed ? " · observed" : " · modeled"}`) : ["No observed outcome returned yet"]} />
          <TraceSummary title="Verification" items={trace.execution.verification.length > 0 ? trace.execution.verification.map((verification) => `${verification.passed ? "Passed" : "Failed"} · ${verification.summary}`) : ["No verification result recorded"]} />
          <section className="rounded-lg border border-line bg-paper/60 p-4 text-xs leading-5 text-ink/55">
            <div className="font-semibold text-ink">Safe operational projection</div>
            <p className="mt-2">This page does not expose OAuth material, raw company records, provider payloads, tool arguments, tool results, artifact references, evidence locations, or review comments.</p>
          </section>
        </aside>
      </div>
    </>
  );
}

function TraceNode({ label, title, detail, tone }: { label: string; title: string; detail: string; tone: "blue" | "dark" | "orange" | "purple" | "green" | "red" }) {
  const tones = { blue: "border-blue-200 bg-blue-50", dark: "border-ink bg-ink text-white", orange: "border-orange-300 bg-orange-50", purple: "border-violet-200 bg-violet-50", green: "border-emerald-200 bg-emerald-50", red: "border-red-200 bg-red-50" } as const;
  return <div className={`min-h-28 rounded-lg border p-3 ${tones[tone]}`}><div className={`text-[10px] font-semibold uppercase tracking-[0.13em] ${tone === "dark" ? "text-white/55" : "text-ink/40"}`}>{label}</div><div className="mt-2 text-sm font-semibold">{title}</div><div className={`mt-2 text-xs leading-5 ${tone === "dark" ? "text-white/65" : "text-ink/55"}`}>{detail}</div></div>;
}

function TraceArrow({ label }: { label: string }) {
  return <div className="flex flex-col items-center justify-center text-ink/35"><span className="text-[9px] uppercase tracking-wider">{label}</span><span aria-hidden="true" className="text-2xl">→</span></div>;
}

function Fact({ children, tone = "default" }: { children: React.ReactNode; tone?: "default" | "danger" }) {
  return <span className={`rounded-md px-2 py-1 ${tone === "danger" ? "bg-red-50 text-red-700" : "bg-paper text-ink/60"}`}>{children}</span>;
}

function TraceSummary({ title, items }: { title: string; items: string[] }) {
  return <section className="rounded-lg border border-line bg-white p-4 shadow-sm"><h2 className="text-sm font-semibold">{title}</h2><ul className="mt-3 space-y-2 text-sm leading-5 text-ink/60">{items.map((item, index) => <li className="flex gap-2" key={`${item}:${index}`}><span aria-hidden="true" className="text-signal">•</span><span>{item}</span></li>)}</ul></section>;
}

function formatValue(value: number, unit?: string) {
  return `${new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 }).format(value)}${unit ? ` ${unit}` : ""}`;
}

function humanize(value: string) {
  return value.replace(/[._-]+/g, " ").replace(/\b\w/g, (character) => character.toUpperCase());
}

function shortId(value: string) {
  return value.length > 18 ? `${value.slice(0, 10)}…${value.slice(-6)}` : value;
}
