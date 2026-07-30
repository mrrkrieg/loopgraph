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

export default async function ControllerPage() {
  const data = await getOperatingViewData();
  const controller = data.controller;
  const decisions = controller.runs.reduce((sum, run) => sum + run.decisionCount, 0);
  const blockedDecisions = controller.runs.flatMap((run) => run.decisions).filter((decision) => !decision.passed).length;

  return (
    <>
      <PageHeader
        eyebrow="Operate"
        title="Hermes controller"
        description="See what woke Hermes, which evidence it considered, which bounded action it selected, and the policy receipts that allowed or stopped automation."
        action={
          <Link className="rounded-md border border-line bg-white px-4 py-2 text-sm font-semibold text-ink" href="/management">
            Routing operations
          </Link>
        }
      />
      <OperateNav />
      <OperatingModeNote mode={data.mode} />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
        <MetricCard label="Controller" value={controller.enabled ? "Enabled" : "Disabled"} note={`${controller.policySource} policy`} />
        <MetricCard label="Runs" value={controller.runs.length} note="Durable decision receipts" />
        <MetricCard label="Decisions" value={decisions} note="Across loaded runs" />
        <MetricCard label="Stopped by policy" value={blockedDecisions} note="Hermes abstained safely" />
        <MetricCard label="Pending triggers" value={controller.pendingTriggers} note={`${controller.failedTriggers} failed`} />
      </div>

      <div className="mt-6 grid gap-5 xl:grid-cols-[0.7fr_1.3fr]">
        <SectionCard
          title="Controller policy"
          description="The controller may design and rehearse automatically, but it cannot silently promote sensitive or unapproved work."
        >
          <dl className="space-y-3 text-sm">
            <PolicyRow label="Qualify opportunity" value={`${controller.qualifyThreshold} / 100`} />
            <PolicyRow label="Start Hermes design" value={`${controller.autoDesignThreshold} / 100`} />
            <PolicyRow label="Allow shadow materialization" value={`${controller.autoShadowThreshold} / 100`} />
            <PolicyRow label="Auto-start design" value={controller.autoStartDesign ? "On" : "Off"} />
            <PolicyRow label="Auto-evaluate outcomes" value={controller.autoEvaluateOutcomes ? "On" : "Off"} />
            <PolicyRow label="Auto-shadow" value={controller.autoShadowMaterialization ? "On" : "Off"} />
          </dl>
          <div className="mt-5">
            <div className="text-xs font-semibold uppercase tracking-[0.14em] text-ink/45">
              Never auto-shadow
            </div>
            <div className="mt-2 flex flex-wrap gap-2">
              {controller.blockedDepartments.map((department) => (
                <StatusPill key={department}>{department}</StatusPill>
              ))}
            </div>
          </div>
          <p className="mt-5 text-xs leading-5 text-ink/50">
            Last durable checkpoint: {formatOperatingDate(controller.lastCheckpointAt)}
          </p>
        </SectionCard>

        <div>
          {controller.runs.length === 0 ? (
            <EmptyOperatingState
              title="Hermes has not made a controller decision yet"
              description="The default policy is visible, but no runtime data is invented. A run appears after a schedule, routed event, review, measurement window, connector-health change, or management cycle triggers the controller."
              command="loopgraph controller run --trigger manual"
              actionHref="/operate/opportunities"
              actionLabel="Inspect opportunities"
            />
          ) : (
            <div className="space-y-4">
              {controller.runs.map((run) => (
                <SectionCard
                  key={run.id}
                  title={`${run.triggerType} · ${run.status}`}
                  description={`${run.triggerSource} · ${formatOperatingDate(run.startedAt)}`}
                >
                  <div className="space-y-3">
                    {run.decisions.length > 0 ? run.decisions.map((decision, index) => (
                      <div className="rounded-md border border-line bg-paper p-4" key={`${run.id}:${index}`}>
                        <div className="flex flex-wrap items-center gap-2">
                          <StatusPill>{decision.action}</StatusPill>
                          <StatusPill>{decision.passed ? "Policy passed" : "Hermes abstained"}</StatusPill>
                        </div>
                        <h3 className="mt-3 text-sm font-semibold text-ink">{decision.summary}</h3>
                        <p className="mt-1 text-sm leading-6 text-ink/65">{decision.reason}</p>
                        {decision.failedRules.length > 0 ? (
                          <ul className="mt-3 space-y-1 text-xs leading-5 text-red-800">
                            {decision.failedRules.map((rule) => <li key={rule}>Stopped: {rule}</li>)}
                          </ul>
                        ) : null}
                      </div>
                    )) : (
                      <p className="text-sm text-ink/55">The controller completed without a new action.</p>
                    )}
                    {run.errors.map((error) => (
                      <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-900" key={error}>
                        {error}
                      </div>
                    ))}
                  </div>
                </SectionCard>
              ))}
            </div>
          )}
        </div>
      </div>
    </>
  );
}

function PolicyRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-4 border-b border-line pb-3">
      <dt className="text-ink/60">{label}</dt>
      <dd className="font-semibold text-ink">{value}</dd>
    </div>
  );
}
