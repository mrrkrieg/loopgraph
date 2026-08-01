import Link from "next/link";
import { EmptyOperatingState } from "@/components/operate/empty-operating-state";
import {
  formatMinutes,
  formatOperatingDate
} from "@/components/operate/format";
import { OperateNav } from "@/components/operate/operate-nav";
import { OperatingModeNote } from "@/components/operate/operating-mode-note";
import { MetricCard } from "@/components/metric-card";
import { PageHeader } from "@/components/page-header";
import { SectionCard } from "@/components/section-card";
import { StatusPill } from "@/components/status-pill";
import { getOperatingViewData } from "@/lib/loopgraph-runtime/operating-view-data";

export default async function ValuePage() {
  const data = await getOperatingViewData();
  const value = data.value;

  return (
    <>
      <PageHeader
        eyebrow="Operate"
        title="Loop value ledger"
        description="Measure the ongoing return from each loop after review, rework, botsitting, escalation, and governance costs. Observed results are never silently mixed with modeled or incomplete claims."
        action={
          <Link className="rounded-md border border-line bg-white px-4 py-2 text-sm font-semibold text-ink" href="/daily">
            Open daily summary
          </Link>
        }
      />
      <OperateNav />
      <OperatingModeNote mode={data.mode} />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
        <MetricCard label="Observed net" value={formatMinutes(value.observedNetMinutes)} note="Verified savings after costs" />
        <MetricCard label="Observed overhead" value={formatMinutes(value.observedCostMinutes)} note="Human and governance time" />
        <MetricCard label="Modeled net" value={formatMinutes(value.modeledNetMinutes)} note="Estimate, shown separately" />
        <MetricCard label="Observed records" value={value.truthCounts.observed} note="Sufficient real evidence" />
        <MetricCard label="Incomplete" value={value.truthCounts.incomplete} note="Not counted as observed value" />
      </div>

      <div className="mt-6">
        {value.entries.length === 0 ? (
          <EmptyOperatingState
            title="No loop value has been observed yet"
            description="A clean install starts with no ROI claim. Once a loop has baseline and observed metric windows, Loopgraph can calculate gross savings, subtract hidden operating costs, and record the evidence-backed net result."
            command="loopgraph outcomes value derive --help"
            actionHref="/operate/learning"
            actionLabel="Inspect learning evidence"
          />
        ) : (
          <div className="grid gap-4 xl:grid-cols-2">
            {value.entries.map((entry) => {
              const hiddenCosts = Object.entries(entry.hiddenCosts)
                .filter(([, minutes]) => minutes > 0);
              return (
                <SectionCard
                  key={entry.id}
                  title={entry.loopId}
                  description={`Recorded ${formatOperatingDate(entry.recordedAt)}`}
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <StatusPill>{entry.truthStatus}</StatusPill>
                    {entry.truthStatus !== "observed" ? (
                      <span className="text-xs font-medium text-amber-800">
                        Excluded from observed totals
                      </span>
                    ) : null}
                  </div>
                  <div className="mt-4 grid grid-cols-3 gap-3">
                    <ValueNumber label="Gross saved" value={formatMinutes(entry.grossSavedMinutes)} />
                    <ValueNumber label="Operating cost" value={formatMinutes(entry.observedCostMinutes)} />
                    <ValueNumber label="Net saved" value={formatMinutes(entry.netSavedMinutes)} />
                  </div>
                  {entry.monetaryValue ? (
                    <div className="mt-3 rounded-md border border-line bg-paper px-3 py-3 text-sm">
                      <span className="text-ink/50">Net monetary value </span>
                      <span className="font-semibold text-ink">
                        {new Intl.NumberFormat("en", {
                          style: "currency",
                          currency: entry.monetaryValue.currency,
                          maximumFractionDigits: 0
                        }).format(entry.monetaryValue.netAmount)}
                      </span>
                    </div>
                  ) : null}
                  <div className="mt-4">
                    <div className="text-xs font-semibold uppercase tracking-[0.14em] text-ink/45">
                      Costs subtracted
                    </div>
                    <div className="mt-2 flex flex-wrap gap-2">
                      {hiddenCosts.length > 0
                        ? hiddenCosts.map(([label, minutes]) => (
                            <StatusPill key={label}>{label} · {formatMinutes(minutes)}</StatusPill>
                          ))
                        : <span className="text-sm text-ink/50">No operating cost recorded</span>}
                    </div>
                  </div>
                </SectionCard>
              );
            })}
          </div>
        )}
      </div>
    </>
  );
}

function ValueNumber({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-line bg-paper px-3 py-3">
      <div className="text-xs uppercase tracking-[0.12em] text-ink/45">{label}</div>
      <div className="mt-1 text-xl font-semibold text-ink">{value}</div>
    </div>
  );
}
