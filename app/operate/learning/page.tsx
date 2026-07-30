import Link from "next/link";
import { EmptyOperatingState } from "@/components/operate/empty-operating-state";
import {
  formatCadence,
  formatOperatingDate
} from "@/components/operate/format";
import { OperateNav } from "@/components/operate/operate-nav";
import { OperatingModeNote } from "@/components/operate/operating-mode-note";
import { MetricCard } from "@/components/metric-card";
import { PageHeader } from "@/components/page-header";
import { SectionCard } from "@/components/section-card";
import { StatusPill } from "@/components/status-pill";
import { getOperatingViewData } from "@/lib/loopgraph-runtime/operating-view-data";

export default async function LearningPage() {
  const data = await getOperatingViewData();
  const observed = data.learning.outcomes.filter((outcome) => outcome.truthStatus === "observed").length;
  const incomplete = data.learning.outcomes.filter((outcome) => outcome.truthStatus === "incomplete").length;
  const failedJobs = data.learning.bindings.reduce((sum, binding) => sum + binding.failedJobs, 0);

  return (
    <>
      <PageHeader
        eyebrow="Operate"
        title="Learning evidence"
        description="Trace each loop from a concrete connector binding through scheduled measurement jobs to an observed outcome. Missing, stale, modeled, and verified evidence remain visibly different."
        action={
          <Link className="rounded-md border border-line bg-white px-4 py-2 text-sm font-semibold text-ink" href="/loops">
            Open loop definitions
          </Link>
        }
      />
      <OperateNav />
      <OperatingModeNote mode={data.mode} />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
        <MetricCard label="Metric bindings" value={data.learning.bindings.length} note="Connector-specific contracts" />
        <MetricCard label="Outcomes" value={data.learning.outcomes.length} note="Completed evaluations" />
        <MetricCard label="Observed" value={observed} note="Sufficient real evidence" />
        <MetricCard label="Incomplete" value={incomplete} note="Hermes needs more evidence" />
        <MetricCard label="Failed jobs" value={failedJobs} note={`${data.learning.deadLetterJobs} dead-letter`} />
      </div>

      <div className="mt-6">
        {data.learning.bindings.length === 0 && data.learning.outcomes.length === 0 ? (
          <EmptyOperatingState
            title="No learning evidence exists yet"
            description="A clean install does not show sample metrics. Bind a loop metric to a Hermes-managed connector, schedule a measurement window, and the evidence chain will appear here."
            command="loopgraph measurements bindings set --help"
            actionHref="/loops"
            actionLabel="Open your loops"
          />
        ) : (
          <div className="space-y-6">
            <SectionCard
              title="Measurement pipeline"
              description="Each row shows the exact source, collection state, and most recent evidence for one loop metric."
            >
              <div className="overflow-x-auto">
                <table className="min-w-[980px] w-full border-collapse text-left text-sm">
                  <thead>
                    <tr className="border-b border-line text-xs uppercase tracking-[0.12em] text-ink/45">
                      <th className="px-3 py-3 font-medium">Loop / metric</th>
                      <th className="px-3 py-3 font-medium">Binding</th>
                      <th className="px-3 py-3 font-medium">Collection</th>
                      <th className="px-3 py-3 font-medium">Latest evidence</th>
                      <th className="px-3 py-3 font-medium">State</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.learning.bindings.map((binding) => (
                      <tr className="border-b border-line/70 align-top" key={binding.id}>
                        <td className="px-3 py-4">
                          <div className="font-semibold text-ink">{binding.loopId}</div>
                          <div className="mt-1 text-xs text-ink/50">{binding.metricKey} · {binding.role}</div>
                        </td>
                        <td className="px-3 py-4">
                          <div className="font-medium text-ink/75">{binding.connectorInstanceId}</div>
                          <div className="mt-1 text-xs text-ink/50">{binding.capabilityKey}</div>
                        </td>
                        <td className="px-3 py-4 text-ink/65">
                          Every {formatCadence(binding.cadenceSeconds)}
                          <div className="mt-1 text-xs">{binding.completedJobs} complete · {binding.pendingJobs} pending · {binding.failedJobs} failed</div>
                        </td>
                        <td className="px-3 py-4">
                          {binding.latestValue !== undefined ? (
                            <>
                              <div className="font-semibold text-ink">{binding.latestValue} {binding.unit}</div>
                              <div className="mt-1 text-xs text-ink/50">{formatOperatingDate(binding.latestObservedAt)}</div>
                            </>
                          ) : (
                            <span className="text-ink/45">Waiting for first sample</span>
                          )}
                        </td>
                        <td className="px-3 py-4">
                          <StatusPill>{binding.latestQuality ?? "No sample"}</StatusPill>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </SectionCard>

            <div className="grid gap-4 xl:grid-cols-2">
              {data.learning.outcomes.map((outcome) => (
                <SectionCard
                  key={outcome.id}
                  title={`${outcome.loopId} · ${outcome.metricKey}`}
                  description={`Evaluated ${formatOperatingDate(outcome.evaluatedAt)}`}
                >
                  <div className="flex flex-wrap gap-2">
                    <StatusPill>{outcome.status}</StatusPill>
                    <StatusPill>{outcome.truthStatus}</StatusPill>
                    <StatusPill>{Math.round(outcome.confidence * 100)}% confidence</StatusPill>
                  </div>
                  <div className="mt-4 grid grid-cols-3 gap-3">
                    <EvidenceNumber label="Baseline" value={outcome.baseline ?? "—"} />
                    <EvidenceNumber label="Observed" value={outcome.observed ?? "—"} />
                    <EvidenceNumber
                      label="Change"
                      value={outcome.relativeDeltaPct === undefined ? "—" : `${outcome.relativeDeltaPct > 0 ? "+" : ""}${outcome.relativeDeltaPct.toFixed(1)}%`}
                    />
                  </div>
                  <p className="mt-4 text-sm text-ink/60">
                    Guardrails: {outcome.guardrailsPassed} of {outcome.guardrailCount} passed.
                  </p>
                  {outcome.missingReasons.length > 0 ? (
                    <ul className="mt-3 space-y-1 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm leading-5 text-amber-950">
                      {outcome.missingReasons.map((reason) => <li key={reason}>{reason}</li>)}
                    </ul>
                  ) : null}
                </SectionCard>
              ))}
            </div>
          </div>
        )}
      </div>

      {data.learning.reconciliation ? (
        <div className="mt-6">
          <SectionCard
            title={`Connector reconciliation · ${data.learning.reconciliation.status}`}
            description={`Checked ${formatOperatingDate(data.learning.reconciliation.checkedAt)}`}
          >
            {data.learning.reconciliation.issues.length > 0 ? (
              <div className="space-y-3">
                {data.learning.reconciliation.issues.map((issue, index) => (
                  <div className="rounded-md border border-line bg-paper p-4" key={`${issue.summary}:${index}`}>
                    <StatusPill>{issue.severity}</StatusPill>
                    <p className="mt-2 text-sm font-semibold text-ink">{issue.summary}</p>
                    <p className="mt-1 text-sm leading-6 text-ink/60">Repair: {issue.repairAction}</p>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-ink/60">All bound connector capabilities are healthy and current.</p>
            )}
          </SectionCard>
        </div>
      ) : null}
    </>
  );
}

function EvidenceNumber({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-md border border-line bg-paper px-3 py-3">
      <div className="text-xs uppercase tracking-[0.12em] text-ink/45">{label}</div>
      <div className="mt-1 text-lg font-semibold text-ink">{value}</div>
    </div>
  );
}
