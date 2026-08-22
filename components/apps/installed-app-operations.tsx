import React from "react";
import Link from "next/link";
import { InstalledAppTopologyGraph } from "@/components/apps/installed-app-topology-graph";
import { SectionCard } from "@/components/section-card";
import type { InstalledAppOperationsView } from "@/lib/app-platform/installed-app-operations";
import { approveInstalledAppOperationAction } from "@/app/apps/actions";

export function InstalledAppTopologyPanel({ operations }: { operations: InstalledAppOperationsView }) {
  return (
    <SectionCard title="App operating topology" description="The installed contract and its recent evidence in one bounded graph: event sources feed Hermes Brain, Hermes routes through the accountable department and Installed App into owned loops, agents execute runs, approvals gate work, and durable outcomes return as learning evidence.">
      <div className="mb-4 flex flex-wrap gap-2 text-xs text-ink/55">
        <TopologyLegend label="Event source" tone="source" />
        <TopologyLegend label="Hermes Brain" tone="brain" />
        <TopologyLegend label="Department / App" tone="structure" />
        <TopologyLegend label="Owned loop" tone="department" />
        <TopologyLegend label="Agent / work" tone="work" />
        <TopologyLegend label="Approval" tone="approval" />
        <TopologyLegend label="Outcome" tone="outcome" />
      </div>
      <div className="overflow-hidden rounded-lg border border-line bg-white">
        <InstalledAppTopologyGraph graph={operations.topology} />
      </div>
      <p className="mt-3 text-xs leading-5 text-ink/50">This is not a Marketplace sample or a company-wide graph. It contains the exact loops owned by this installation plus the latest App-scoped runtime evidence. Select or move nodes to inspect the relationship, then use the activity rows below to open a durable trace.</p>
    </SectionCard>
  );
}

export function InstalledAppActivityPanel({ operations }: { operations: InstalledAppOperationsView }) {
  return (
    <SectionCard title="Hermes activity for this App" description="Recent events are scoped to the runtime loops owned by this exact installation. Follow each signal through Hermes routing, agent work, approvals, failures, and returned outcome evidence.">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <OperationsMetric label="Incoming events" value={String(operations.summary.incomingEvents)} detail={`${operations.summary.totalRuns} routed runs`} />
        <OperationsMetric label="Waiting approval" value={String(operations.summary.waitingApproval)} detail={`${operations.summary.activeRuns} active runs`} tone={operations.summary.waitingApproval > 0 ? "attention" : "default"} />
        <OperationsMetric label="Prepared actions" value={String(operations.summary.preparedActions)} detail={`${operations.summary.actionsAwaitingApproval} require approval`} tone={operations.summary.actionsAwaitingApproval > 0 ? "attention" : "default"} />
        <OperationsMetric label="Failed runs" value={String(operations.summary.failedRuns)} detail={`${operations.summary.completedRuns} completed`} tone={operations.summary.failedRuns > 0 ? "danger" : "default"} />
        <OperationsMetric label="Observed outcomes" value={String(operations.summary.observedOutcomes)} detail="Durable measurement records" />
        <OperationsMetric label="Labeled accuracy" value={operations.summary.routingAccuracy === undefined ? "Not measured" : `${Math.round(operations.summary.routingAccuracy * 100)}%`} detail={`${operations.summary.reviewedDecisions} reviewed decisions`} />
        <OperationsMetric label="Review burden" value={formatMinutes(operations.summary.reviewMinutes)} detail="Latest historical review set" />
        <OperationsMetric label="Observed net time" value={formatMinutes(operations.summary.observedNetMinutes)} detail={`${formatMinutes(operations.summary.observedCostMinutes)} observed cost`} />
        <OperationsMetric label="Last activity" value={operations.summary.lastActivityAt ? formatActivityDate(operations.summary.lastActivityAt) : "No activity"} detail="Latest App-owned run update" />
      </div>

      {operations.activity.length > 0 ? (
        <div className="mt-5 space-y-3">
          {operations.activity.slice(0, 10).map((row) => (
            <div className="rounded-lg border border-line p-4" key={row.id}>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-xs font-semibold uppercase tracking-[0.12em] text-ink/40">{row.source} · {row.eventType}</div>
                  <div className="mt-2 font-semibold">Hermes Brain → {row.loopLabel}</div>
                  <p className="mt-1 text-sm leading-6 text-ink/60">{row.problemSummary ?? row.latestSummary ?? "Hermes routed this event under the installed App contract."}</p>
                </div>
                <div className={`rounded-full border px-2.5 py-1 text-xs font-semibold capitalize ${runStatusTone(row.jobStatus)}`}>{row.jobStatus.replace(/_/g, " ")}</div>
              </div>
              <div className="mt-3 flex flex-wrap gap-x-4 gap-y-2 text-xs text-ink/50">
                <span>{row.completedTaskCount}/{row.taskCount} tasks</span>
                <span>{row.toolCallCount} tool calls</span>
                <span>{row.approvalCount} approvals</span>
                <span>{row.observedOutcomeCount} outcome signals</span>
                <span>{formatActivityDate(row.updatedAt)}</span>
              </div>
              <div className="mt-3 flex flex-wrap gap-3 text-xs font-semibold">
                {row.traceStatus ? <Link className="text-ink underline decoration-ink/25 underline-offset-4 hover:decoration-ink" href={`/loops/${encodeURIComponent(row.loopId)}/runs/${encodeURIComponent(row.runId)}`}>Open run trace →</Link> : <span className="text-ink/40">Trace pending</span>}
                {row.jobStatus === "waiting_review" ? <Link className="text-orange-800 underline decoration-orange-300 underline-offset-4 hover:decoration-orange-800" href={`/loops/${encodeURIComponent(row.loopId)}/reviews?runId=${encodeURIComponent(row.runId)}`}>Review decision →</Link> : null}
              </div>
            </div>
          ))}
          {operations.activity.length > 10 ? <p className="text-xs text-ink/45">Showing the 10 most recent of {operations.activity.length} App-owned runs.</p> : null}
        </div>
      ) : (
        <div className="mt-5 rounded-lg border border-dashed border-line bg-paper p-5">
          <div className="font-semibold">No events have reached this App yet</div>
          <p className="mt-2 text-sm leading-6 text-ink/60">Hermes activity appears here only after an incoming company event is routed to one of this installation’s loops. Marketplace samples and activity from other Apps are never mixed into this view.</p>
        </div>
      )}
    </SectionCard>
  );
}

export function InstalledAppActionsPanel({ operations, canApproveActions = false }: { operations: InstalledAppOperationsView; canApproveActions?: boolean }) {
  return (
    <SectionCard title="Governed provider actions" description="Every provider write prepared by this App is bound to one pinned artifact, loop version, Hermes route, agent assignment, logical capability, and Connector Broker receipt. This view never stores or displays canonical provider input.">
      {operations.actions.length > 0 ? (
        <div className="space-y-3">
          {operations.actions.slice(0, 10).map((action) => (
            <div className="rounded-lg border border-line p-4" key={action.id}>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-xs font-semibold uppercase tracking-[0.12em] text-ink/40">{action.providerBinding.providerId} · {action.riskClass} risk</div>
                  <div className="mt-2 font-semibold">{action.providerBinding.operation}</div>
                  <p className="mt-1 text-sm leading-6 text-ink/60">Hermes prepared this action through <span className="font-mono text-xs">{action.capability}</span>. The provider write has not run while its status is prepared.</p>
                </div>
                <span className={`rounded-full border px-2.5 py-1 text-xs font-semibold capitalize ${actionStatusTone(action.effectiveStatus)}`}>{action.effectiveStatus.replace(/_/g, " ")}</span>
              </div>
              <div className="mt-3 grid gap-2 text-xs text-ink/50 sm:grid-cols-2 xl:grid-cols-4">
                <span>Loop: <span className="font-mono">{action.loopId}</span></span>
                <span>Route: <span className="font-mono">{action.routeJobId}</span></span>
                <span>{action.approvalRequired ? "Human approval required" : "No human approval required"}</span>
                <span>Expires {formatActivityDate(action.expiresAt)}</span>
              </div>
              <details className="mt-3 text-xs text-ink/45">
                <summary className="cursor-pointer font-semibold">Ownership proof</summary>
                <div className="mt-2 grid gap-1 font-mono">
                  <span>Action {action.id}</span>
                  <span>Agent {action.agentInstanceId}</span>
                  <span>Artifact {action.artifactDigest}</span>
                  <span>LoopSpec {action.loopVersionHash}</span>
                  <span>Receipt {action.brokerPrepareReceiptId}</span>
                </div>
              </details>
              {action.effectiveStatus === "prepared" && action.approvalRequired && canApproveActions ? (
                <form action={approveInstalledAppOperationAction} className="mt-4 rounded-md border border-orange-200 bg-orange-50 p-3">
                  <input name="installationId" type="hidden" value={action.installationId} />
                  <input name="actionId" type="hidden" value={action.id} />
                  <label className="block text-xs font-semibold text-orange-950" htmlFor={`approval-reason-${action.id}`}>Approval reason</label>
                  <textarea className="mt-2 min-h-20 w-full rounded-md border border-orange-200 bg-white px-3 py-2 text-sm" id={`approval-reason-${action.id}`} maxLength={1000} minLength={3} name="reason" placeholder="Why is this exact provider action safe and necessary?" required />
                  <div className="mt-2 flex flex-wrap items-center justify-between gap-3">
                    <p className="text-xs leading-5 text-orange-900">Requires step-up authentication. The provider write is still not executed by this approval.</p>
                    <button className="rounded-md bg-ink px-3 py-2 text-xs font-semibold text-white hover:bg-ink/85" type="submit">Approve exact action</button>
                  </div>
                </form>
              ) : null}
              {action.effectiveStatus === "approved" ? (
                <div className="mt-4 rounded-md border border-emerald-200 bg-emerald-50 p-3 text-xs leading-5 text-emerald-900">
                  Approval is bound to this exact action fingerprint and expires {formatActivityDate(action.lifecycleEvents.find((event) => event.eventType === "approval_granted")?.approval?.expiresAt ?? action.expiresAt)}. Only the assigned Hermes route may request the later commit.
                </div>
              ) : null}
            </div>
          ))}
          {operations.actions.length > 10 ? <p className="text-xs text-ink/45">Showing the 10 most recent of {operations.actions.length} App-owned actions.</p> : null}
        </div>
      ) : (
        <div className="rounded-lg border border-dashed border-line bg-paper p-5">
          <div className="font-semibold">No provider actions have been prepared</div>
          <p className="mt-2 text-sm leading-6 text-ink/60">Read operations and Loopgraph-internal reads do not appear here. A record is created only after Connector Broker prepares a bounded provider action for this exact installation.</p>
        </div>
      )}
    </SectionCard>
  );
}

export function InstalledAppOutcomesPanel({ operations }: { operations: InstalledAppOperationsView }) {
  return (
    <SectionCard title="Observed outcomes and value" description="Only durable App-owned measurement and value-ledger records appear here. Modeled or incomplete evidence stays visibly separate from observed results.">
      {operations.outcomes.length > 0 ? (
        <div className="grid gap-3 sm:grid-cols-2">
          {operations.outcomes.slice(0, 8).map((outcome) => (
            <div className="rounded-md border border-line p-4" key={outcome.id}>
              <div className="flex items-start justify-between gap-3">
                <div><div className="font-mono text-xs text-ink/45">{outcome.metricKey}</div><div className="mt-2 font-semibold capitalize">{outcome.status}</div></div>
                <span className={`rounded-full border px-2.5 py-1 text-xs font-semibold ${truthStatusTone(outcome.truthStatus)}`}>{outcome.truthStatus}</span>
              </div>
              <div className="mt-4 grid grid-cols-3 gap-2 text-xs">
                <OutcomeFact label="Change" value={outcome.relativeDeltaPct === undefined ? "—" : `${outcome.relativeDeltaPct >= 0 ? "+" : ""}${outcome.relativeDeltaPct.toFixed(1)}%`} />
                <OutcomeFact label="Confidence" value={`${Math.round(outcome.confidence * 100)}%`} />
                <OutcomeFact label="Guardrails" value={`${outcome.guardrailsPassed}/${outcome.guardrailCount}`} />
              </div>
              {outcome.missingReasons.length > 0 ? <p className="mt-3 text-xs leading-5 text-orange-800">Missing: {outcome.missingReasons.join(" · ")}</p> : null}
            </div>
          ))}
        </div>
      ) : (
        <p className="text-sm leading-6 text-ink/60">No observed outcome has been evaluated for this App yet. Connect the declared metric bindings and let the measurement window complete before treating activity as business value.</p>
      )}

      {operations.valueEntries.length > 0 ? (
        <div className="mt-5 overflow-x-auto">
          <table className="w-full min-w-[40rem] text-left text-sm">
            <thead className="text-xs uppercase tracking-[0.1em] text-ink/40"><tr><th className="pb-3">Recorded</th><th className="pb-3">Loop</th><th className="pb-3">Truth</th><th className="pb-3">Gross time</th><th className="pb-3">Observed cost</th><th className="pb-3">Net time</th></tr></thead>
            <tbody className="divide-y divide-line">{operations.valueEntries.slice(0, 8).map((entry) => <tr key={entry.id}><td className="py-3 text-xs text-ink/55">{formatActivityDate(entry.recordedAt)}</td><td className="py-3 font-mono text-xs">{entry.loopId}</td><td className="py-3 capitalize">{entry.truthStatus}</td><td className="py-3">{formatMinutes(entry.grossSavedMinutes)}</td><td className="py-3">{formatMinutes(entry.observedCostMinutes)}</td><td className="py-3 font-semibold">{formatMinutes(entry.netSavedMinutes)}</td></tr>)}</tbody>
          </table>
        </div>
      ) : null}
    </SectionCard>
  );
}

function OperationsMetric({ label, value, detail, tone = "default" }: { label: string; value: string; detail: string; tone?: "default" | "attention" | "danger" }) { return <div className={`rounded-md border p-3 ${tone === "danger" ? "border-red-200 bg-red-50" : tone === "attention" ? "border-orange-200 bg-orange-50" : "border-line bg-paper"}`}><div className="text-xs font-semibold uppercase tracking-[0.1em] text-ink/40">{label}</div><div className="mt-2 text-lg font-semibold">{value}</div><div className="mt-1 text-xs text-ink/50">{detail}</div></div>; }
function TopologyLegend({ label, tone }: { label: string; tone: "source" | "brain" | "structure" | "department" | "work" | "approval" | "outcome" }) { const toneClass = { source: "bg-stone-500", brain: "bg-ink", structure: "bg-stone-600", department: "bg-gradient-to-br from-orange-500 via-blue-500 to-emerald-500", work: "bg-gradient-to-br from-amber-600 to-orange-500", approval: "bg-teal-700", outcome: "bg-emerald-600" }[tone]; return <span className="inline-flex items-center gap-1.5 rounded-full border border-line px-2.5 py-1"><span className={`h-2 w-2 rounded-full ${toneClass}`} />{label}</span>; }
function OutcomeFact({ label, value }: { label: string; value: string }) { return <div className="rounded-md bg-paper p-2"><div className="font-semibold">{value}</div><div className="mt-1 text-[0.62rem] font-semibold uppercase tracking-[0.1em] text-ink/40">{label}</div></div>; }
function formatMinutes(value: number) { const rounded = Math.round(value * 10) / 10; return `${rounded.toLocaleString()} min`; }
function formatActivityDate(value: string) { return new Date(value).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }); }
function runStatusTone(status: string) { if (["failed", "dead_letter"].includes(status)) return "border-red-200 bg-red-50 text-red-800"; if (status === "waiting_review") return "border-orange-200 bg-orange-50 text-orange-800"; if (status === "completed") return "border-emerald-200 bg-emerald-50 text-emerald-800"; return "border-blue-200 bg-blue-50 text-blue-800"; }
function actionStatusTone(status: string) { if (["failed", "denied", "revoked", "expired"].includes(status)) return "border-red-200 bg-red-50 text-red-800"; if (["prepared", "approved", "committing"].includes(status)) return "border-orange-200 bg-orange-50 text-orange-800"; if (status === "committed") return "border-emerald-200 bg-emerald-50 text-emerald-800"; return "border-line bg-paper text-ink/70"; }
function truthStatusTone(status: string) { if (status === "observed") return "border-emerald-200 bg-emerald-50 text-emerald-800"; if (status === "modeled") return "border-blue-200 bg-blue-50 text-blue-800"; return "border-orange-200 bg-orange-50 text-orange-800"; }
