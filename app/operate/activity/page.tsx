import Link from "next/link";
import { EmptyOperatingState } from "@/components/operate/empty-operating-state";
import { formatOperatingDate } from "@/components/operate/format";
import { OperateNav } from "@/components/operate/operate-nav";
import { OperationsAutoRefresh } from "@/components/operate/operations-auto-refresh";
import { OperatingModeNote } from "@/components/operate/operating-mode-note";
import { MetricCard } from "@/components/metric-card";
import { PageHeader } from "@/components/page-header";
import { SectionCard } from "@/components/section-card";
import { StatusPill } from "@/components/status-pill";
import { getAgentOperationsViewData } from "@/lib/loopgraph-runtime/agent-operations-view-data";

type ActivitySearchParams = {
  source?: string;
  department?: string;
  status?: string;
  agent?: string;
  attention?: string;
};

export default async function AgentActivityPage({
  searchParams
}: {
  searchParams: Promise<ActivitySearchParams>;
}) {
  const params = await searchParams;
  const view = await getAgentOperationsViewData({
    source: clean(params.source),
    department: clean(params.department),
    status: clean(params.status),
    agentInstanceId: clean(params.agent),
    needsAttention: params.attention === "1" ? true : undefined
  });
  const { data } = view;
  const departments = [...new Set(data.activity.map((row) => row.department))].sort();

  return (
    <>
      <OperationsAutoRefresh />
      <PageHeader
        eyebrow="Enterprise operations"
        title="Hermes agent activity"
        description="See each business signal enter Hermes, the problem it identified, the department loop it selected, the agent work performed, and the outcome returned as evidence. Live execution stays in Hermes; Loopgraph is the governed operational record."
        action={
          <Link className="rounded-md bg-ink px-4 py-2 text-sm font-semibold text-white" href="/discovery">
            Design a loop with Hermes
          </Link>
        }
      />
      <OperateNav />
      <OperatingModeNote mode={view.mode} />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard label="Incoming events" value={data.summary.incomingEvents} note="Normalized company signals" />
        <MetricCard label="Healthy Hermes agents" value={`${data.summary.healthyAgents}/${data.summary.registeredAgents}`} note="Heartbeat and capability ready" />
        <MetricCard label="Active runs" value={data.summary.activeRuns} note={`${data.summary.dispatchedRuns} accepted assignments`} />
        <MetricCard label="Waiting approval" value={data.summary.waitingApproval} note="Human judgment required" />
        <MetricCard label="Completed runs" value={data.summary.completedRuns} note="Durable execution traces" />
        <MetricCard label="Observed outcomes" value={data.summary.observedOutcomes} note="Evidence returned to Hermes" />
        <MetricCard label="Failed runs" value={data.summary.failedRuns} note="No hidden failure state" />
        <MetricCard label="Departments active" value={departments.length} note="Loops currently represented" />
      </div>

      <section className="mt-6 rounded-lg border border-line bg-white p-4 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold text-ink">Execution topology</h2>
            <p className="mt-1 max-w-3xl text-sm leading-6 text-ink/60">
              Every line is one traceable routing contract: signal → Hermes Brain → department-owned loop → Hermes agent work → evidence.
            </p>
          </div>
          <span className="rounded-full border border-line px-3 py-1 text-xs font-semibold text-ink/55">Refreshes every 10s</span>
        </div>

        {data.activity.length === 0 ? (
          <div className="mt-5">
            <EmptyOperatingState
              title="No company activity has arrived yet"
              description="A clean local install intentionally contains no preview companies, departments, or loops. In Hermes, say “Start Loopgraph setup.” Hermes will show departments, ask the minimum business questions, create the first LoopSpec in shadow mode, and register itself before live work can be dispatched."
              command="loopgraph hermes install && loopgraph init"
            />
          </div>
        ) : (
          <div className="mt-5 max-h-[760px] overflow-auto rounded-lg border border-line bg-paper/50">
            <div className="min-w-[1180px] space-y-3 p-4">
              <div className="grid grid-cols-[190px_36px_170px_36px_235px_36px_230px_36px_180px] items-center gap-2 px-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-ink/40">
                <span>Incoming signal</span><span />
                <span>Router</span><span />
                <span>Department loop</span><span />
                <span>Hermes execution</span><span />
                <span>Evidence / state</span>
              </div>
              {data.activity.map((row, index) => (
                <div className="grid grid-cols-[190px_36px_170px_36px_235px_36px_230px_36px_180px] items-stretch gap-2" key={row.id}>
                  <FlowCard eyebrow={`Data point ${index + 1}`} title={row.source} detail={row.eventType} tone="blue" />
                  <FlowArrow label="event" />
                  <FlowCard eyebrow="Company router" title="Hermes Brain" detail={row.problemSummary ?? "Classified business problem"} tone="dark" />
                  <FlowArrow label="route" />
                  <FlowCard eyebrow={row.department} title={row.loopLabel} detail={`Loop · ${humanize(row.jobStatus)}`} tone="orange" />
                  <FlowArrow label="run" />
                  <FlowCard
                    eyebrow={row.agentName ?? "Awaiting agent"}
                    title={row.taskCount > 0 ? `${row.completedTaskCount}/${row.taskCount} tasks complete` : humanize(row.latestEventType ?? row.jobStatus)}
                    detail={`${row.toolCallCount} tool calls · ${row.approvalCount} approvals`}
                    tone="purple"
                  />
                  <FlowArrow label={row.observedOutcomeCount > 0 ? "learn" : "state"} />
                  <FlowCard
                    eyebrow={row.observedOutcomeCount > 0 ? "Outcome evidence" : "Current state"}
                    title={row.observedOutcomeCount > 0 ? `${row.observedOutcomeCount} observed` : humanize(row.jobStatus)}
                    detail={row.latestSummary ?? formatOperatingDate(row.updatedAt)}
                    href={`/operate/activity/${encodeURIComponent(row.routeJobId)}`}
                    tone={row.needsAttention ? "red" : "green"}
                  />
                </div>
              ))}
            </div>
          </div>
        )}
      </section>

      <div className="mt-6 grid min-w-0 gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
        <SectionCard className="min-w-0" title="Hermes runtimes" description="Only healthy, capability-matching agents receive live assignments.">
          {data.agents.length === 0 ? (
            <p className="text-sm leading-6 text-ink/60">No Hermes agent has registered in this workspace.</p>
          ) : (
            <div className="space-y-3">
              {data.agents.map((agent) => (
                <div className="rounded-md border border-line p-3" key={agent.id}>
                  <div className="flex items-center gap-2">
                    <span className={`h-2.5 w-2.5 rounded-full ${agent.healthy ? "bg-emerald-500" : "bg-red-500"}`} />
                    <span className="font-semibold text-ink">{agent.name}</span>
                    <StatusPill>{agent.status}</StatusPill>
                  </div>
                  <p className="mt-2 text-xs text-ink/55">{agent.environment} · {agent.runtimeVersion} · heartbeat {agent.secondsSinceHeartbeat}s ago</p>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {agent.capabilities.slice(0, 6).map((capability) => (
                      <span className="rounded bg-paper px-2 py-1 text-[11px] text-ink/60" key={capability}>{capability}</span>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </SectionCard>

        <SectionCard className="min-w-0" title="Activity ledger" description="Filter the durable event → problem → loop → run record without changing execution state.">
          <form className="grid gap-3 rounded-md border border-line bg-paper p-3 sm:grid-cols-2 lg:grid-cols-5" method="get">
            <FilterInput label="Source" name="source" value={params.source} placeholder="Salesforce" />
            <FilterSelect label="Department" name="department" value={params.department} options={departments} />
            <FilterSelect label="Status" name="status" value={params.status} options={["dispatched", "running", "waiting_review", "completed", "failed", "dead_letter"]} />
            <FilterSelect label="Agent" name="agent" value={params.agent} options={data.agents.map((agent) => agent.id)} />
            <div className="flex items-end gap-2">
              <label className="flex min-h-10 flex-1 items-center gap-2 rounded-md border border-line bg-white px-3 text-xs font-medium text-ink/65">
                <input defaultChecked={params.attention === "1"} name="attention" type="checkbox" value="1" />
                Needs attention
              </label>
              <button className="min-h-10 rounded-md bg-ink px-3 text-xs font-semibold text-white" type="submit">Filter</button>
            </div>
          </form>

          <div className="mt-4 overflow-x-auto">
            <table className="min-w-[1000px] w-full border-collapse text-left text-sm">
              <thead>
                <tr className="border-b border-line text-xs uppercase tracking-[0.12em] text-ink/40">
                  <th className="px-2 py-3">Signal</th>
                  <th className="px-2 py-3">Problem / loop</th>
                  <th className="px-2 py-3">Agent</th>
                  <th className="px-2 py-3">Work</th>
                  <th className="px-2 py-3">Status</th>
                  <th className="px-2 py-3">Updated</th>
                  <th className="px-2 py-3">Trace</th>
                </tr>
              </thead>
              <tbody>
                {data.activity.map((row) => (
                  <tr className="border-b border-line/80 align-top" key={`ledger-${row.id}`}>
                    <td className="px-2 py-3"><strong className="block text-ink">{row.source}</strong><span className="text-xs text-ink/50">{row.eventType}</span></td>
                    <td className="px-2 py-3"><strong className="block text-ink">{row.loopLabel}</strong><span className="text-xs text-ink/50">{row.department} · {row.problemId ?? "No problem"}</span></td>
                    <td className="px-2 py-3"><span className="text-ink">{row.agentName ?? "Not assigned"}</span><span className="block text-xs text-ink/45">{row.executionRuntime}</span></td>
                    <td className="px-2 py-3 text-ink/65">{row.completedTaskCount}/{row.taskCount} tasks · {row.toolCallCount} tools · {row.outputCount} outputs</td>
                    <td className="px-2 py-3"><StatusPill>{humanize(row.jobStatus)}</StatusPill></td>
                    <td className="px-2 py-3 text-xs text-ink/50">{formatOperatingDate(row.updatedAt)}</td>
                    <td className="px-2 py-3"><Link className="text-xs font-semibold text-signal hover:underline" href={`/operate/activity/${encodeURIComponent(row.routeJobId)}`}>Open trace</Link></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </SectionCard>
      </div>
    </>
  );
}

function FlowCard({ eyebrow, title, detail, tone, href }: { eyebrow: string; title: string; detail: string; tone: "blue" | "dark" | "orange" | "purple" | "green" | "red"; href?: string }) {
  const tones = {
    blue: "border-blue-200 bg-blue-50",
    dark: "border-ink bg-ink text-white",
    orange: "border-orange-300 bg-orange-50",
    purple: "border-violet-200 bg-violet-50",
    green: "border-emerald-200 bg-emerald-50",
    red: "border-red-200 bg-red-50"
  } as const;
  const content = (
    <div className={`min-h-28 rounded-lg border p-3 shadow-sm ${tones[tone]}`}>
      <div className={`text-[10px] font-semibold uppercase tracking-[0.13em] ${tone === "dark" ? "text-white/55" : "text-ink/40"}`}>{eyebrow}</div>
      <div className="mt-1.5 text-sm font-semibold leading-5">{title}</div>
      <div className={`mt-2 line-clamp-3 text-xs leading-4 ${tone === "dark" ? "text-white/65" : "text-ink/55"}`}>{detail}</div>
      {href ? <div className="mt-2 text-[11px] font-semibold">Open trace →</div> : null}
    </div>
  );
  return href ? <Link className="rounded-lg focus:outline-none focus:ring-2 focus:ring-signal" href={href}>{content}</Link> : content;
}

function FlowArrow({ label }: { label: string }) {
  return (
    <div className="flex flex-col items-center justify-center text-ink/35" aria-label={label}>
      <span className="text-[9px] uppercase tracking-wider">{label}</span>
      <span className="text-2xl leading-none" aria-hidden="true">→</span>
    </div>
  );
}

function FilterInput({ label, name, value, placeholder }: { label: string; name: string; value?: string; placeholder: string }) {
  return <label className="text-xs font-semibold text-ink/55">{label}<input className="mt-1 block min-h-10 w-full rounded-md border border-line bg-white px-3 text-sm font-normal text-ink" defaultValue={value} name={name} placeholder={placeholder} /></label>;
}

function FilterSelect({ label, name, value, options }: { label: string; name: string; value?: string; options: string[] }) {
  return <label className="text-xs font-semibold text-ink/55">{label}<select className="mt-1 block min-h-10 w-full rounded-md border border-line bg-white px-3 text-sm font-normal text-ink" defaultValue={value ?? ""} name={name}><option value="">All</option>{options.map((option) => <option key={option} value={option}>{humanize(option)}</option>)}</select></label>;
}

function clean(value?: string): string | undefined {
  return value?.trim() || undefined;
}

function humanize(value: string): string {
  return value.replace(/[._-]+/g, " ").replace(/\b\w/g, (character) => character.toUpperCase());
}
