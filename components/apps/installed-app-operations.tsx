import React from "react";
import { SectionCard } from "@/components/section-card";
import type { InstalledAppOperationsView } from "@/lib/app-platform/installed-app-operations";

export function InstalledAppActivityPanel({ operations }: { operations: InstalledAppOperationsView }) {
  return (
    <SectionCard title="Hermes activity for this App" description="Recent events are scoped to the runtime loops owned by this exact installation. Follow each signal through Hermes routing, agent work, approvals, failures, and returned outcome evidence.">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <OperationsMetric label="Incoming events" value={String(operations.summary.incomingEvents)} detail={`${operations.summary.totalRuns} routed runs`} />
        <OperationsMetric label="Waiting approval" value={String(operations.summary.waitingApproval)} detail={`${operations.summary.activeRuns} active runs`} tone={operations.summary.waitingApproval > 0 ? "attention" : "default"} />
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
function OutcomeFact({ label, value }: { label: string; value: string }) { return <div className="rounded-md bg-paper p-2"><div className="font-semibold">{value}</div><div className="mt-1 text-[0.62rem] font-semibold uppercase tracking-[0.1em] text-ink/40">{label}</div></div>; }
function formatMinutes(value: number) { const rounded = Math.round(value * 10) / 10; return `${rounded.toLocaleString()} min`; }
function formatActivityDate(value: string) { return new Date(value).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }); }
function runStatusTone(status: string) { if (["failed", "dead_letter"].includes(status)) return "border-red-200 bg-red-50 text-red-800"; if (status === "waiting_review") return "border-orange-200 bg-orange-50 text-orange-800"; if (status === "completed") return "border-emerald-200 bg-emerald-50 text-emerald-800"; return "border-blue-200 bg-blue-50 text-blue-800"; }
function truthStatusTone(status: string) { if (status === "observed") return "border-emerald-200 bg-emerald-50 text-emerald-800"; if (status === "modeled") return "border-blue-200 bg-blue-50 text-blue-800"; return "border-orange-200 bg-orange-50 text-orange-800"; }
