import React from "react";
import type {
  EventRoutingOperationsReadModel,
  EventRoutingOperationsRow
} from "loopgraph/runtime";
import { StatusPill } from "../status-pill";

const exampleRows = [
  {
    eventType: "campaign.performance_anomaly",
    example: "CAC rises while qualified conversion falls",
    routedTo: "Marketing / Ads",
    owner: "Growth lead",
    autonomy: "Shadow → recommend"
  },
  {
    eventType: "content.brief_approved",
    example: "Approved evidence and reviewer arrive from a content system",
    routedTo: "Marketing / Content Creation",
    owner: "Content lead",
    autonomy: "Draft for review"
  },
  {
    eventType: "page.conversion_drop",
    example: "Ambiguous landing-page signal with missing campaign mapping",
    routedTo: "Human choice or unhandled problem",
    owner: "Marketing operator",
    autonomy: "Ask before route"
  }
];

export function EventRoutingTable({
  model,
  showExamples = false
}: {
  model?: EventRoutingOperationsReadModel;
  showExamples?: boolean;
}) {
  const hasEvents = Boolean(model && model.rows.length > 0);

  return (
    <div className="space-y-4">
      {model ? <RoutingSummary model={model} /> : null}
      {model ? <RoutingFilters model={model} showExamples={showExamples} /> : null}
      {hasEvents && model ? <ActualRoutingTable rows={model.rows} /> : <RoutingEmptyState showExamples={showExamples} />}
      {model ? (
        <div className="grid gap-4 xl:grid-cols-3">
          <ProblemInbox model={model} />
          <RoutingCatalog model={model} />
          <WebhookHealth model={model} />
        </div>
      ) : null}
    </div>
  );
}

function RoutingSummary({ model }: { model: EventRoutingOperationsReadModel }) {
  const items = [
    ["Events", model.summary.eventCount],
    ["Problems", model.summary.problemCount],
    ["Unhandled", model.summary.unhandledProblemCount],
    ["Human choice", model.summary.pendingHumanChoiceCount],
    ["Jobs", model.summary.routeJobCount],
    ["Eval failures", model.summary.failedEvaluationCount]
  ];

  return (
    <div className="space-y-2">
      {activeFilterCount(model) > 0 ? (
        <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs leading-5 text-amber-800">
          Showing a filtered Hermes routing inbox with {activeFilterCount(model)} active filter(s).
        </div>
      ) : null}
      <div className="grid gap-2 sm:grid-cols-3 xl:grid-cols-6">
        {items.map(([label, value]) => (
          <div key={label} className="rounded-md border border-line bg-paper px-3 py-2">
            <div className="text-[11px] uppercase tracking-[0.14em] text-ink/45">{label}</div>
            <div className="mt-1 text-lg font-semibold">{value}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

function RoutingFilters({
  model,
  showExamples
}: {
  model: EventRoutingOperationsReadModel;
  showExamples: boolean;
}) {
  return (
    <form action="/management" className="rounded-lg border border-line bg-white p-3" method="get">
      <div className="grid gap-3 md:grid-cols-3 xl:grid-cols-6">
        <FilterText label="Event ID" name="eventId" value={model.filters.eventId} />
        <FilterText label="Source" name="source" value={model.filters.source} placeholder={showExamples ? "google_ads_detector" : "provider_source"} />
        <FilterText label="Event type" name="eventType" value={model.filters.eventType} placeholder={showExamples ? "campaign.performance_anomaly" : "provider.event_type"} />
        <FilterText label="Loop ID" name="loopId" value={model.filters.loopId} placeholder={showExamples ? "marketing_ads" : "loop_id"} />
        <FilterSelect
          label="Action"
          name="action"
          options={["received", "route", "append_evidence", "request_human", "unhandled", "defer", "ignore"]}
          value={model.filters.action}
        />
        <FilterSelect
          label="Problem status"
          name="problemStatus"
          options={["detected", "needs_human", "routed", "in_progress", "waiting", "resolved", "closed", "unhandled"]}
          value={model.filters.problemStatus}
        />
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-3 text-xs">
        <label className="inline-flex items-center gap-2 rounded border border-line bg-paper px-3 py-2">
          <input defaultChecked={Boolean(model.filters.needsAttention)} name="needsAttention" type="checkbox" />
          Needs attention
        </label>
        <label className="inline-flex items-center gap-2 rounded border border-line bg-paper px-3 py-2">
          <input defaultChecked={Boolean(model.filters.unhandledOnly)} name="unhandledOnly" type="checkbox" />
          Unhandled only
        </label>
        <button className="rounded bg-ink px-3 py-2 text-white" type="submit">Filter inbox</button>
        <a className="rounded border border-line px-3 py-2 text-ink/70 hover:text-ink" href="/management">Clear filters</a>
        <a
          className="rounded border border-line px-3 py-2 text-ink/70 hover:text-ink"
          href={`/api/management/routing${querySuffix(model)}`}
        >
          Open JSON
        </a>
      </div>
    </form>
  );
}

function FilterText({
  label,
  name,
  placeholder,
  value
}: {
  label: string;
  name: string;
  placeholder?: string;
  value?: string;
}) {
  return (
    <label className="block text-xs">
      <span className="font-medium text-ink/65">{label}</span>
      <input
        className="mt-1 w-full rounded border border-line bg-paper px-2 py-2"
        defaultValue={value ?? ""}
        name={name}
        placeholder={placeholder}
      />
    </label>
  );
}

function FilterSelect({
  label,
  name,
  options,
  value
}: {
  label: string;
  name: string;
  options: string[];
  value?: string;
}) {
  return (
    <label className="block text-xs">
      <span className="font-medium text-ink/65">{label}</span>
      <select className="mt-1 w-full rounded border border-line bg-paper px-2 py-2" defaultValue={value ?? ""} name={name}>
        <option value="">Any</option>
        {options.map((option) => <option key={option} value={option}>{option}</option>)}
      </select>
    </label>
  );
}

function ActualRoutingTable({ rows }: { rows: EventRoutingOperationsRow[] }) {
  return (
    <div className="overflow-hidden rounded-lg border border-line bg-white">
      <table className="w-full min-w-[1120px] text-left text-sm">
        <thead className="bg-paper text-xs uppercase tracking-[0.14em] text-ink/50">
          <tr>
            <th className="px-4 py-3">Source event</th>
            <th className="px-4 py-3">Business problem</th>
            <th className="px-4 py-3">Selected loop</th>
            <th className="px-4 py-3">Confidence</th>
            <th className="px-4 py-3">Validation</th>
            <th className="px-4 py-3">Run / queue</th>
            <th className="px-4 py-3">Owner</th>
            <th className="px-4 py-3">Quality</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {rows.map((row) => (
            <tr key={row.id} className={row.needsCorrection || row.needsHumanChoice ? "bg-amber-50/60" : undefined}>
              <td className="px-4 py-3 align-top">
                <div className="font-semibold">{row.eventType}</div>
                <div className="mt-1 text-xs text-ink/55">{row.source} · {row.subject}</div>
                <div className="mt-1 max-w-[220px] truncate text-[11px] text-ink/40">{row.eventId}</div>
              </td>
              <td className="px-4 py-3 align-top">
                <div className="font-medium">{row.problemType ?? "Awaiting decision"}</div>
                <div className="mt-1 max-w-[260px] text-xs leading-5 text-ink/60">
                  {row.problemSummary ?? row.timeline.join(" → ")}
                </div>
                {row.problemStatus ? <div className="mt-2"><StatusPill>{row.problemStatus}</StatusPill></div> : null}
                {row.outcome ? (
                  <div className="mt-2 rounded border border-emerald-200 bg-emerald-50 px-2 py-1 text-xs leading-5 text-emerald-800">
                    Outcome: {row.outcome.summary}
                  </div>
                ) : null}
              </td>
              <td className="px-4 py-3 align-top">
                <div className="font-medium">{row.selectedLoopLabels.join(", ") || "None"}</div>
                {row.alternativeLoopIds.length > 0 ? (
                  <div className="mt-1 text-xs text-ink/50">Alternatives: {row.alternativeLoopIds.join(", ")}</div>
                ) : null}
              </td>
              <td className="px-4 py-3 align-top">{formatConfidence(row.confidence)}</td>
              <td className="px-4 py-3 align-top">
                <StatusPill>{row.validationState}</StatusPill>
                {row.validationErrors.length > 0 ? (
                  <ul className="mt-2 list-disc space-y-1 pl-4 text-xs leading-5 text-red-700">
                    {row.validationErrors.slice(0, 2).map((error) => <li key={error}>{error}</li>)}
                  </ul>
                ) : null}
              </td>
              <td className="px-4 py-3 align-top">
                {row.queueStatus ? <StatusPill>{row.queueStatus}</StatusPill> : <span className="text-ink/45">No run</span>}
                {row.runId ? <div className="mt-1 max-w-[160px] truncate text-xs text-ink/45">{row.runId}</div> : null}
              </td>
              <td className="px-4 py-3 align-top">{row.owner}</td>
              <td className="px-4 py-3 align-top">
                <div className="space-y-1 text-xs text-ink/60">
                  {row.latencyMs !== undefined ? <div>{row.latencyMs}ms decision</div> : null}
                  {row.evaluation.count > 0 ? (
                    <div>{row.evaluation.passedCount}/{row.evaluation.count} evals passed</div>
                  ) : (
                    <div>No eval yet</div>
                  )}
                  {row.corrections.length > 0 ? <div>{row.corrections.length} correction(s)</div> : null}
                  {row.needsHumanChoice ? <div className="font-medium text-amber-700">Needs human route choice</div> : null}
                  {row.needsCorrection ? <div className="font-medium text-red-700">Failed expected route</div> : null}
                </div>
                <RoutingDecisionDetails row={row} />
                {row.needsHumanChoice || row.needsCorrection ? <HumanChoiceForm row={row} /> : null}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function RoutingDecisionDetails({ row }: { row: EventRoutingOperationsRow }) {
  return (
    <details className="mt-3 rounded-md border border-line bg-paper p-2 text-xs">
      <summary className="cursor-pointer font-medium text-ink/70">Decision detail</summary>
      <div className="mt-2 space-y-3">
        <div>
          <div className="font-medium text-ink/70">Hermes selected routes</div>
          {row.decisionDetail.selectedRoutes.length === 0 ? (
            <p className="mt-1 text-ink/50">No selected loop was committed for this event.</p>
          ) : row.decisionDetail.selectedRoutes.map((route) => (
            <div key={`${route.loopId}:${route.role}`} className="mt-1 rounded border border-line bg-white p-2">
              <div className="flex items-center justify-between gap-2">
                <span>{route.loopLabel} · {route.role}</span>
                <span>{formatConfidence(route.confidence)}</span>
              </div>
              <p className="mt-1 leading-5 text-ink/60">{route.reasonSummary}</p>
            </div>
          ))}
        </div>

        {row.decisionDetail.alternatives.length > 0 ? (
          <div>
            <div className="font-medium text-ink/70">Alternatives Hermes considered</div>
            <div className="mt-1 space-y-1">
              {row.decisionDetail.alternatives.map((alternative) => (
                <div key={alternative.loopId} className="rounded border border-line bg-white p-2">
                  <div>{alternative.loopLabel} · {formatConfidence(alternative.confidence)}</div>
                  <p className="mt-1 leading-5 text-ink/60">{alternative.reasonSummary}</p>
                </div>
              ))}
            </div>
          </div>
        ) : null}

        {row.decisionDetail.routeCommits.length > 0 || row.decisionDetail.routeJobs.length > 0 ? (
          <div>
            <div className="font-medium text-ink/70">Loopgraph validation and queue</div>
            <div className="mt-1 space-y-1 text-ink/60">
              {row.decisionDetail.routeCommits.map((commit) => (
                <div key={commit.id}>
                  {commit.loopLabel} commit {commit.status}{commit.runId ? ` · ${commit.runId}` : ""}
                </div>
              ))}
              {row.decisionDetail.routeJobs.map((job) => (
                <div key={job.id}>
                  Job {job.status} · {job.runId} · attempt {job.attemptCount}/{job.maxAttempts}
                </div>
              ))}
            </div>
          </div>
        ) : null}

        {row.decisionDetail.modelMetadata.length > 0 ? (
          <div>
            <div className="font-medium text-ink/70">Hermes metadata</div>
            <div className="mt-1 flex flex-wrap gap-1">
              {row.decisionDetail.modelMetadata.map((item) => (
                <span key={item.key} className="rounded border border-line bg-white px-2 py-1">
                  {item.key}: {item.value}
                </span>
              ))}
            </div>
          </div>
        ) : null}

        {row.outcome ? (
          <div className="rounded border border-emerald-200 bg-emerald-50 p-2 text-emerald-900">
            <div className="font-medium">Verified outcome</div>
            <p className="mt-1 leading-5">{row.outcome.summary}</p>
            <div className="mt-1 text-emerald-800/80">
              {row.outcome.outcomeRef}
              {row.outcome.businessResult ? ` · ${row.outcome.businessResult}` : ""}
              {row.outcome.followUpRequired !== undefined ? ` · follow-up ${row.outcome.followUpRequired ? "required" : "not required"}` : ""}
            </div>
          </div>
        ) : null}

        <div>
          <div className="font-medium text-ink/70">Correlation timeline</div>
          <ol className="mt-1 space-y-1">
            {row.correlationTimeline.map((entry) => (
              <li key={`${entry.stage}:${entry.id}`} className="rounded border border-line bg-white p-2">
                <div className="flex items-center justify-between gap-2">
                  <span>{entry.label}</span>
                  <span className="text-ink/40">{entry.status}</span>
                </div>
                <p className="mt-1 leading-5 text-ink/60">{entry.detail}</p>
                <div className="mt-1 font-mono text-[10px] text-ink/40">{entry.at}</div>
              </li>
            ))}
          </ol>
        </div>
      </div>
    </details>
  );
}

function HumanChoiceForm({ row }: { row: EventRoutingOperationsRow }) {
  const suggestedLoopIds = row.selectedLoopIds.length > 0
    ? row.selectedLoopIds.join(",")
    : row.alternativeLoopIds[0] ?? "";

  return (
    <form
      action="/api/management/routing/human-choice"
      className="mt-3 space-y-2 rounded-md border border-amber-200 bg-white p-2 text-xs"
      method="post"
    >
      <input name="eventId" type="hidden" value={row.eventId} />
      {row.routeAttemptId ? <input name="routeAttemptId" type="hidden" value={row.routeAttemptId} /> : null}
      {row.problemId ? <input name="problemId" type="hidden" value={row.problemId} /> : null}
      <label className="block">
        <span className="font-medium text-ink/70">Human route choice</span>
        <select className="mt-1 w-full rounded border border-line bg-paper px-2 py-1" name="action" defaultValue="route">
          <option value="route">Route</option>
          <option value="unhandled">Mark unhandled</option>
          <option value="defer">Defer</option>
          <option value="ignore">Ignore</option>
        </select>
      </label>
      <label className="block">
        <span className="text-ink/60">Loop IDs for route</span>
        <input
          className="mt-1 w-full rounded border border-line bg-paper px-2 py-1"
          defaultValue={suggestedLoopIds}
          name="selectedLoopIds"
          placeholder="marketing_ads"
        />
      </label>
      <label className="block">
        <span className="text-ink/60">Reason</span>
        <input
          className="mt-1 w-full rounded border border-line bg-paper px-2 py-1"
          defaultValue="Human reviewed the event and selected the correct route."
          name="reason"
        />
      </label>
      <label className="block">
        <span className="text-ink/60">Corrected by</span>
        <input
          className="mt-1 w-full rounded border border-line bg-paper px-2 py-1"
          defaultValue={row.owner === "Unassigned" ? "browser-operator" : row.owner}
          name="correctedBy"
        />
      </label>
      <button className="rounded bg-ink px-3 py-1.5 text-white" type="submit">Submit correction</button>
    </form>
  );
}

function RoutingEmptyState({ showExamples }: { showExamples: boolean }) {
  return (
    <div className="rounded-lg border border-dashed border-line bg-paper p-4">
      <div className="text-sm font-semibold">No Hermes routing events received yet</div>
      <p className="mt-1 text-sm leading-6 text-ink/60">
        Once provider webhooks terminate at Hermes and the router skill submits decisions, this table will show real event receipts,
        business problems, selected loops, validation state, queue/run status, and correction history.
        {showExamples ? " The examples below are illustrative only." : " To start, say `start Loopgraph` in Hermes or open guided Discovery."}
      </p>
      {showExamples ? (
        <div className="mt-4 overflow-hidden rounded-md border border-line bg-white">
        <table className="w-full min-w-[860px] text-left text-sm">
          <thead className="bg-paper text-xs uppercase tracking-[0.14em] text-ink/50">
            <tr>
              <th className="px-4 py-3">Example Event</th>
              <th className="px-4 py-3">Signal</th>
              <th className="px-4 py-3">Expected Route</th>
              <th className="px-4 py-3">Human Owner</th>
              <th className="px-4 py-3">Rollout</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {exampleRows.map((row) => (
              <tr key={row.eventType}>
                <td className="px-4 py-3 font-semibold">{row.eventType}</td>
                <td className="px-4 py-3 text-ink/65">{row.example}</td>
                <td className="px-4 py-3">{row.routedTo}</td>
                <td className="px-4 py-3">{row.owner}</td>
                <td className="px-4 py-3">{row.autonomy}</td>
              </tr>
            ))}
          </tbody>
        </table>
        </div>
      ) : null}
    </div>
  );
}

function ProblemInbox({ model }: { model: EventRoutingOperationsReadModel }) {
  return (
    <div className="rounded-lg border border-line bg-white p-4">
      <div className="font-semibold">Problem inbox</div>
      <p className="mt-1 text-xs leading-5 text-ink/55">Grouped by durable business problem, not by duplicate webhook deliveries.</p>
      <div className="mt-3 space-y-2">
        {model.problemInbox.length === 0 ? (
          <p className="text-sm text-ink/55">No business problems have been opened by Hermes yet.</p>
        ) : model.problemInbox.slice(0, 5).map((problem) => (
          <div key={problem.problemId} className="rounded-md border border-line bg-paper p-3 text-sm">
            <div className="flex items-center justify-between gap-3">
              <span className="font-medium">{problem.problemType}</span>
              <StatusPill>{problem.status}</StatusPill>
            </div>
            <div className="mt-1 text-xs leading-5 text-ink/60">{problem.summary}</div>
            <div className="mt-2 text-[11px] text-ink/45">
              {problem.evidenceEventCount} evidence event(s) · {problem.routeCommitCount} route(s) · owner {problem.owner}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function RoutingCatalog({ model }: { model: EventRoutingOperationsReadModel }) {
  return (
    <div className="rounded-lg border border-line bg-white p-4">
      <div className="font-semibold">Routing catalog</div>
      <p className="mt-1 text-xs leading-5 text-ink/55">Active LoopSpecs Hermes may choose after deterministic eligibility.</p>
      <div className="mt-3 space-y-2">
        {model.routingCatalog.length === 0 ? (
          <p className="text-sm text-ink/55">No materialized routing cards yet.</p>
        ) : model.routingCatalog.slice(0, 5).map((item) => (
          <div key={item.loopId} className="rounded-md border border-line bg-paper p-3 text-sm">
            <div className="flex items-center justify-between gap-3">
              <span className="font-medium">{item.loopName}</span>
              <StatusPill>{item.activationMode}</StatusPill>
            </div>
            <div className="mt-1 text-xs text-ink/55">{item.department ?? "custom"} · {item.currentReadiness}</div>
            <div className="mt-2 text-[11px] leading-5 text-ink/45">
              {item.acceptedEvents.slice(0, 2).join(", ")}
            </div>
            <div className="mt-2 text-[11px] leading-5 text-ink/55">
              confidence ≥ {Math.round(item.minimumConfidence * 100)}% · ambiguity {item.ambiguityPolicy.replace(/_/g, " ")} · fan-out {item.fanoutPolicy.mode.replace(/_/g, " ")}
            </div>
            <div className="mt-1 text-[11px] leading-5 text-ink/45">
              repeats: {item.concurrency.strategy.replace(/_/g, " ")}
              {item.cooldown.dedupeWindowSeconds > 0 ? ` · dedupe ${Math.round(item.cooldown.dedupeWindowSeconds / 60)}m` : ""}
              {item.lifecycleEvents.length > 0 ? ` · callbacks ${item.lifecycleEvents.slice(0, 2).join(", ")}` : ""}
            </div>
            {item.examples.shouldNotRoute.length > 0 || item.explicitNonGoals.length > 0 ? (
              <div className="mt-1 text-[11px] leading-5 text-ink/45">
                Do not route: {[...item.examples.shouldNotRoute, ...item.explicitNonGoals].slice(0, 2).join("; ")}
              </div>
            ) : null}
          </div>
        ))}
      </div>
    </div>
  );
}

function WebhookHealth({ model }: { model: EventRoutingOperationsReadModel }) {
  return (
    <div className="rounded-lg border border-line bg-white p-4">
      <div className="font-semibold">Hermes webhook routes</div>
      <p className="mt-1 text-xs leading-5 text-ink/55">Non-secret route plan derived from materialized routing contracts.</p>
      <div className="mt-3 space-y-2">
        {model.webhookHealth.routes.length === 0 ? (
          <p className="text-sm text-ink/55">No Hermes route families are required yet.</p>
        ) : model.webhookHealth.routes.slice(0, 5).map((route) => (
          <div key={route.routeName} className="rounded-md border border-line bg-paper p-3 text-sm">
            <div className="font-medium">{route.routeName}</div>
            <div className="mt-1 text-xs text-ink/55">{route.sourcePattern} · deliver {route.deliveryMode}</div>
            <div className="mt-2 text-[11px] leading-5 text-ink/45">{route.eventTypePatterns.join(", ")}</div>
          </div>
        ))}
        {model.webhookHealth.warnings.slice(0, 3).map((warning) => (
          <div key={warning} className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs leading-5 text-amber-800">
            {warning}
          </div>
        ))}
      </div>
    </div>
  );
}

function formatConfidence(value?: number): string {
  if (value === undefined) return "—";
  return `${Math.round(value * 100)}%`;
}

function activeFilterCount(model: EventRoutingOperationsReadModel): number {
  return Object.values(model.filters).filter((value) => value !== undefined && value !== false && value !== "").length;
}

function querySuffix(model: EventRoutingOperationsReadModel): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(model.filters)) {
    if (value !== undefined && value !== false && value !== "") {
      params.set(key, String(value));
    }
  }
  const text = params.toString();
  return text ? `?${text}` : "";
}
