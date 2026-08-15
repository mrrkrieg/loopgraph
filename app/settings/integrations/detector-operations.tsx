"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import type {
  ProviderDetectorControlAction,
  ProviderDetectorScheduleAdminView
} from "@/lib/connector-broker/admin";

export function DetectorOperations({
  initialDetectors
}: {
  initialDetectors: ProviderDetectorScheduleAdminView[];
}) {
  const [detectors, setDetectors] = useState(initialDetectors);
  const [message, setMessage] = useState<string>();
  const [pending, startTransition] = useTransition();
  const summary = summarizeDetectorOperations(detectors);

  function reload() {
    startTransition(async () => {
      setMessage(undefined);
      const response = await fetch("/api/integrations/detectors", { cache: "no-store" });
      const body = await response.json() as { detectors?: ProviderDetectorScheduleAdminView[]; error?: string };
      if (!response.ok) {
        setMessage(body.error ?? "Detector operations could not be refreshed.");
        return;
      }
      setDetectors(body.detectors ?? []);
      setMessage("Detector schedules and recent runs are up to date.");
    });
  }

  function control(detector: ProviderDetectorScheduleAdminView, action: ProviderDetectorControlAction) {
    const reason = window.prompt(controlPrompt(action), defaultControlReason(action))?.trim();
    if (!reason) return;
    startTransition(async () => {
      setMessage(undefined);
      const response = await fetch(`/api/integrations/detectors/${encodeURIComponent(detector.id)}/control`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action, reason })
      });
      const body = await response.json() as {
        error?: string;
        result?: string;
        schedule?: ProviderDetectorScheduleAdminView;
      };
      if (!response.ok || !body.schedule) {
        setMessage(body.error ?? "Detector control failed.");
        return;
      }
      setDetectors((current) => current.map((item) => item.id === detector.id ? body.schedule! : item));
      setMessage(controlSuccess(body.result ?? action, body.schedule));
    });
  }

  return (
    <section className="rounded-lg border border-line bg-white p-5 shadow-sm">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-base font-semibold">Scheduled evidence detectors</h2>
            {summary.needsAttention > 0 ? (
              <span className="rounded-full bg-red-50 px-2.5 py-1 text-xs font-semibold text-red-700">{summary.needsAttention} need attention</span>
            ) : detectors.length > 0 ? (
              <span className="rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-800">Operating normally</span>
            ) : null}
          </div>
          <p className="mt-1 max-w-3xl text-sm leading-6 text-ink/60">
            BigQuery and Snowflake detectors run fixed, read-only evidence queries. Material results enter Hermes as signed company events; raw warehouse rows never appear here.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button className="rounded-md border border-line px-3 py-2 text-xs font-semibold hover:border-ink disabled:opacity-45" disabled={pending} onClick={reload}>Refresh</button>
          <Link className="w-fit rounded-md border border-line px-3 py-2 text-xs font-semibold hover:border-ink" href="/operate/activity">
            Open Hermes activity
          </Link>
        </div>
      </div>

      {message ? <p className="mt-4 rounded-md border border-line bg-paper px-3 py-2 text-sm" role="status">{message}</p> : null}

      {detectors.length === 0 ? (
        <div className="mt-5 rounded-md border border-dashed border-line p-7 text-center">
          <p className="text-sm font-semibold text-ink">No evidence detectors are configured</p>
          <p className="mx-auto mt-2 max-w-2xl text-sm leading-6 text-ink/55">
            Connect BigQuery or Snowflake above, grant <code className="rounded bg-paper px-1.5 py-0.5 text-xs">provider.events.emit</code>, then activate provider intake. The scheduler will create only this organization&apos;s detectors; refresh after its next cycle.
          </p>
        </div>
      ) : (
        <>
          <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <SummaryCard label="Active" value={summary.active} detail={`${detectors.length} configured`} />
            <SummaryCard label="Running" value={summary.running} detail={`${summary.retrying} retrying`} />
            <SummaryCard label="Needs attention" value={summary.needsAttention} detail="Paused, blocked, or failed" tone={summary.needsAttention > 0 ? "danger" : "default"} />
            <SummaryCard label="Recent events" value={summary.recentEvents} detail="Last five runs per detector" />
          </div>

          <div className="mt-5 space-y-3">
            {detectors.map((detector) => {
              const state = detectorState(detector);
              const latest = detector.recentRuns[0];
              return (
                <article className="rounded-lg border border-line p-4" key={detector.id}>
                  <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <h3 className="font-semibold">{humanize(detector.detectorKey)}</h3>
                        <span className="rounded-full border border-line px-2 py-0.5 text-xs">{humanize(detector.providerId)}</span>
                        <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${state.className}`}>{state.label}</span>
                        <span className="rounded-full border border-line px-2 py-0.5 text-xs">{detector.environment}</span>
                      </div>
                      <p className="mt-2 text-sm text-ink/60">
                        {detector.installationDisplayName} · <span className="font-mono text-xs">{detector.eventType}</span>
                      </p>
                      <dl className="mt-4 grid gap-3 text-xs sm:grid-cols-2 lg:grid-cols-4">
                        <DetectorDatum label="Next eligible run" value={nextEligibleRun(detector)} />
                        <DetectorDatum label="Last completed" value={formatDate(detector.lastCompletedAt)} />
                        <DetectorDatum label="Checkpoint" value={formatDate(detector.checkpointAt)} />
                        <DetectorDatum label="Evidence window" value={`${detector.windowMinutes}m · ${detector.overlapMinutes}m overlap`} />
                      </dl>
                      {detector.lastErrorCode ? (
                        <p className="mt-3 rounded-md bg-red-50 px-3 py-2 font-mono text-xs text-red-700">{detector.lastErrorCode}</p>
                      ) : null}
                    </div>

                    <div className="flex flex-wrap gap-2 xl:max-w-[360px] xl:justify-end">
                      <Link
                        className="rounded-md border border-line px-3 py-2 text-xs font-semibold hover:border-ink"
                        href={`/operate/activity?source=${encodeURIComponent(detector.providerId)}`}
                      >
                        View Hermes events
                      </Link>
                      {detector.status === "active" ? (
                        <button className="rounded-md border border-line px-3 py-2 text-xs font-semibold hover:border-ink disabled:opacity-45" disabled={pending} onClick={() => control(detector, "pause")}>Pause</button>
                      ) : null}
                      {detector.status === "paused" && detector.runState !== "dead_letter" ? (
                        <button className="rounded-md border border-line px-3 py-2 text-xs font-semibold hover:border-ink disabled:opacity-45" disabled={pending || detector.blockedByKillSwitch} onClick={() => control(detector, "resume")}>Resume</button>
                      ) : null}
                      {detector.status === "active" && detector.runState === "idle" ? (
                        <button className="rounded-md bg-ink px-3 py-2 text-xs font-semibold text-white disabled:opacity-45" disabled={pending || detector.blockedByKillSwitch} onClick={() => control(detector, "run_now")}>Run now</button>
                      ) : null}
                      {detector.runState === "dead_letter" ? (
                        <button className="rounded-md border border-red-200 px-3 py-2 text-xs font-semibold text-red-700 hover:border-red-500 disabled:opacity-45" disabled={pending || detector.blockedByKillSwitch} onClick={() => control(detector, "retry_now")}>Retry failed window</button>
                      ) : null}
                    </div>
                  </div>

                  <details className="mt-4 border-t border-line pt-3">
                    <summary className="cursor-pointer text-xs font-semibold text-ink/65">
                      Recent run history {latest ? `· latest ${humanize(latest.status)}` : "· no runs yet"}
                    </summary>
                    {detector.recentRuns.length === 0 ? (
                      <p className="mt-3 text-xs text-ink/50">This detector has not completed its first evidence window.</p>
                    ) : (
                      <div className="mt-3 overflow-x-auto">
                        <table className="min-w-[720px] w-full border-collapse text-left text-xs">
                          <thead><tr className="border-b border-line uppercase tracking-[0.1em] text-ink/40"><th className="px-2 py-2">Outcome</th><th className="px-2 py-2">Events</th><th className="px-2 py-2">Attempt</th><th className="px-2 py-2">Window</th><th className="px-2 py-2">Completed</th></tr></thead>
                          <tbody>{detector.recentRuns.map((run) => (
                            <tr className="border-b border-line/70" key={run.id}>
                              <td className="px-2 py-2 font-semibold">{humanize(run.status)}{run.errorCode ? <span className="ml-2 font-mono font-normal text-red-600">{run.errorCode}</span> : null}</td>
                              <td className="px-2 py-2">{run.emittedEventCount}</td>
                              <td className="px-2 py-2">{run.attemptCount}</td>
                              <td className="px-2 py-2">{formatShortDate(run.windowStart)} → {formatShortDate(run.windowEnd)}</td>
                              <td className="px-2 py-2">{formatDate(run.completedAt)}</td>
                            </tr>
                          ))}</tbody>
                        </table>
                      </div>
                    )}
                  </details>
                </article>
              );
            })}
          </div>
        </>
      )}
    </section>
  );
}

export function summarizeDetectorOperations(detectors: ProviderDetectorScheduleAdminView[]) {
  return {
    active: detectors.filter((item) => item.status === "active" && !item.blockedByKillSwitch).length,
    running: detectors.filter((item) => item.runState === "leased").length,
    retrying: detectors.filter((item) => item.runState === "retry").length,
    needsAttention: detectors.filter((item) => item.status !== "active" || item.blockedByKillSwitch || item.runState === "dead_letter").length,
    recentEvents: detectors.reduce((total, item) => total + item.recentRuns.reduce((sum, run) => sum + run.emittedEventCount, 0), 0)
  };
}

function SummaryCard({ label, value, detail, tone = "default" }: { label: string; value: number; detail: string; tone?: "default" | "danger" }) {
  return <div className={`rounded-md border p-3 ${tone === "danger" ? "border-red-100 bg-red-50/40" : "border-line bg-paper/60"}`}><div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-ink/40">{label}</div><div className="mt-1 text-2xl font-semibold">{value}</div><div className="mt-1 text-xs text-ink/50">{detail}</div></div>;
}

function DetectorDatum({ label, value }: { label: string; value: string }) {
  return <div><dt className="font-semibold text-ink/70">{label}</dt><dd className="mt-1 text-ink/55">{value}</dd></div>;
}

function detectorState(detector: ProviderDetectorScheduleAdminView) {
  if (detector.blockedByKillSwitch) return { label: "Kill switch blocked", className: "bg-red-50 text-red-700" };
  if (detector.status === "disabled") return { label: "Connector disabled", className: "bg-slate-100 text-slate-600" };
  if (detector.runState === "dead_letter") return { label: "Needs retry", className: "bg-red-50 text-red-700" };
  if (detector.status === "paused") return { label: "Paused", className: "bg-amber-50 text-amber-800" };
  if (detector.runState === "leased") return { label: "Running", className: "bg-blue-50 text-blue-700" };
  if (detector.runState === "retry") return { label: "Retry scheduled", className: "bg-amber-50 text-amber-800" };
  return { label: "Active", className: "bg-emerald-50 text-emerald-800" };
}

function nextEligibleRun(detector: ProviderDetectorScheduleAdminView) {
  if (detector.status === "disabled") return "Reconnect provider";
  if (detector.blockedByKillSwitch) return "Blocked by policy";
  if (detector.status === "paused") return detector.runState === "dead_letter" ? "Manual retry required" : "Paused";
  if (detector.runState === "leased") return `Lease until ${formatDate(detector.leaseUntil)}`;
  return formatDate(detector.runState === "retry" ? detector.availableAt : detector.nextRunAt);
}

function controlPrompt(action: ProviderDetectorControlAction) {
  return action === "pause" ? "Why are you pausing this detector?"
    : action === "resume" ? "Why is this detector safe to resume?"
      : action === "retry_now" ? "Why should the failed evidence window be retried?"
        : "Why are you scheduling this detector now?";
}

function defaultControlReason(action: ProviderDetectorControlAction) {
  return action === "pause" ? "Pause while detector evidence is reviewed"
    : action === "resume" ? "Detector evidence and provider access were reviewed"
      : action === "retry_now" ? "Retry the preserved evidence window after remediation"
        : "Run an operator-requested evidence check";
}

function controlSuccess(result: string, detector: ProviderDetectorScheduleAdminView) {
  const action = result === "paused" ? "paused"
    : result === "active" ? "resumed"
      : result === "retry_scheduled" ? "scheduled for an exact-window retry"
        : "scheduled to run";
  return `${humanize(detector.detectorKey)} was ${action}. The control decision was added to the tenant audit chain.`;
}

function formatDate(value?: string) {
  return value ? new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(value)) : "Not recorded";
}

function formatShortDate(value: string) {
  return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(new Date(value));
}

function humanize(value: string) {
  return value.replace(/[._-]+/g, " ").replace(/\b\w/g, (character) => character.toUpperCase());
}
