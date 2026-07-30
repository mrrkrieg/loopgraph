import Link from "next/link";
import { SectionCard } from "@/components/section-card";
import { StatusPill } from "@/components/status-pill";
import { TraceModeBadge } from "@/components/trace-mode-badge";
import { filterRunsForLoop } from "@/lib/loopgraph-runtime/run-filters";
import { getCumulativeApprovedFingerprints } from "@/lib/loopgraph-runtime/review-service";
import { getStorageAdapter } from "@/lib/loopgraph-runtime/storage-resolver";
import { submitHumanReviewAction } from "./actions";

export default async function LoopReviewsPage({
  params,
  searchParams
}: {
  params: Promise<{ loopId: string }>;
  searchParams: Promise<{ runId?: string; error?: string; success?: string }>;
}) {
  const { loopId } = await params;
  const query = await searchParams;
  const storage = getStorageAdapter();
  const allRuns = await storage.listRuns();
  const runs = filterRunsForLoop(allRuns, loopId);
  const selectedRunId = query.runId ?? runs.find((run) => run.status === "WAITING_FOR_REVIEW")?.id ?? runs[0]?.id;
  const trace = selectedRunId ? await storage.getRun(selectedRunId) : null;
  const preparedActions = trace?.preparedActions ?? [];
  const internalActions = preparedActions.filter((action) => !action.customerFacing);
  const customerActions = preparedActions.filter((action) => action.customerFacing);
  const reviewRequired = trace?.status === "WAITING_FOR_REVIEW";
  const cumulativeApproved = trace ? getCumulativeApprovedFingerprints(trace) : [];
  const pendingCustomer =
    reviewRequired &&
    customerActions.some((action) => action.requiresApproval && !cumulativeApproved.includes(action.fingerprint));

  return (
    <SectionCard title="Human reviews" description="Approve exact prepared actions with fingerprints. Customer-facing actions require separate approval. Simulated / fixture mode.">
      {query.error && (
        <div className="mb-4 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">{query.error}</div>
      )}
      {query.success === "approved" && (
        <div className="mb-4 rounded-md border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-800">
          Review recorded{trace?.status === "COMPLETED" ? " — run completed." : trace?.status === "WAITING_FOR_REVIEW" ? " — additional approval still required." : "."}
        </div>
      )}

      {trace && <div className="mb-4"><TraceModeBadge trace={trace} /></div>}

      {runs.length > 0 && (
        <div className="mb-4 flex flex-wrap gap-2">
          {runs.map((run) => (
            <a
              key={run.id}
              href={`/loops/${loopId}/reviews?runId=${run.id}`}
              className={`rounded-md border px-3 py-1 text-xs ${run.id === selectedRunId ? "border-ink bg-ink text-white" : "border-line bg-paper"}`}
            >
              {run.id.slice(0, 18)}… · {run.status}
            </a>
          ))}
        </div>
      )}

      {trace && trace.humanReviews.length > 0 && (
        <div className="mb-4 rounded-md border border-line bg-paper p-3 text-sm">
          <div className="text-xs font-semibold uppercase tracking-[0.12em] text-ink/45">Prior reviews</div>
          <ul className="mt-2 space-y-1">
            {trace.humanReviews.map((review) => (
              <li key={review.id}>
                {review.status} · {review.role} · approved=[{review.approvedFingerprints.join(", ")}]
                {review.decidedAt ? ` · ${review.decidedAt}` : ""}
              </li>
            ))}
          </ul>
        </div>
      )}

      {pendingCustomer && (
        <div className="mb-4 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          Internal actions approved. Customer-facing approval still required — select customer fingerprints below.
        </div>
      )}

      {trace?.escalationCases[0] && (
        <div className="mb-4 text-sm">
          Escalation case:{" "}
          <Link className="font-semibold underline" href={`/cases/${trace.escalationCases[0]}`}>
            {trace.escalationCases[0]}
          </Link>
        </div>
      )}

      {reviewRequired && trace ? (
        <form action={submitHumanReviewAction} className="rounded-lg border border-line bg-paper p-4">
          <input name="loop_id" type="hidden" value={loopId} />
          <input name="run_id" type="hidden" value={trace.id} />
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <div className="font-semibold">Review required for run {trace.id}</div>
              <div className="mt-1 text-sm text-ink/60">{trace.preparedActions.length} prepared actions · contextHash={trace.contextSnapshot.contentHash}</div>
            </div>
            <StatusPill>{trace.status}</StatusPill>
          </div>

          {internalActions.length > 0 && (
            <div className="mt-4 space-y-3">
              <div className="text-xs font-semibold uppercase tracking-[0.12em] text-ink/45">Internal actions</div>
              {internalActions.map((action) => {
                const alreadyApproved = cumulativeApproved.includes(action.fingerprint);
                return (
                  <label key={action.id} className={`block rounded-md border p-3 text-sm ${alreadyApproved ? "border-green-200 bg-green-50 opacity-75" : "border-line bg-white"}`}>
                    <div className="flex items-start gap-3">
                      <input
                        className="mt-1"
                        defaultChecked={alreadyApproved || action.requiresApproval}
                        disabled={alreadyApproved}
                        name="approved_fingerprints"
                        type="checkbox"
                        value={action.fingerprint}
                      />
                      <div className="flex-1">
                        <div className="font-medium">
                          {action.label} · {action.toolKey}
                          {alreadyApproved && <span className="ml-2 text-xs text-green-700">(approved)</span>}
                        </div>
                        <div className="mt-1 text-xs text-ink/60">fingerprint={action.fingerprint}</div>
                        <pre className="mt-2 overflow-auto rounded bg-paper p-2 text-xs">{JSON.stringify(action.payload, null, 2)}</pre>
                      </div>
                    </div>
                  </label>
                );
              })}
            </div>
          )}

          {customerActions.length > 0 && (
            <div className="mt-4 space-y-3">
              <div className="text-xs font-semibold uppercase tracking-[0.12em] text-ink/45">Customer-facing actions</div>
              {customerActions.map((action) => {
                const alreadyApproved = cumulativeApproved.includes(action.fingerprint);
                return (
                  <label key={action.id} className={`block rounded-md border p-3 text-sm ${alreadyApproved ? "border-green-200 bg-green-50 opacity-75" : "border-amber-200 bg-amber-50"}`}>
                    <div className="flex items-start gap-3">
                      <input
                        className="mt-1"
                        defaultChecked={alreadyApproved}
                        disabled={alreadyApproved}
                        name="approved_fingerprints"
                        type="checkbox"
                        value={action.fingerprint}
                      />
                      <div className="flex-1">
                        <div className="font-medium">
                          {action.label} · {action.toolKey}
                          {alreadyApproved && <span className="ml-2 text-xs text-green-700">(approved)</span>}
                        </div>
                        <div className="mt-1 text-xs text-ink/60">fingerprint={action.fingerprint}</div>
                        <pre className="mt-2 overflow-auto rounded bg-white p-2 text-xs">{JSON.stringify(action.payload, null, 2)}</pre>
                      </div>
                    </div>
                  </label>
                );
              })}
            </div>
          )}

          <label className="mt-4 block text-sm font-medium">
            Reviewer identity
            <input
              name="reviewer_id"
              required
              autoComplete="username"
              className="mt-1 w-full rounded-md border border-line bg-white px-3 py-2"
              placeholder="Your name or operator ID"
            />
          </label>

          <label className="mt-4 block text-sm font-medium">
            Reviewer role
            <select name="reviewer_role" className="mt-1 w-full rounded-md border border-line bg-white px-3 py-2" defaultValue="approver">
              {["approver", "reviewer", "owner", "teacher", "executor", "accountability_holder"].map((role) => (
                <option key={role} value={role}>{role}</option>
              ))}
            </select>
          </label>

          <div className="mt-4 grid gap-3 sm:grid-cols-4">
            {[
              ["approved", "Approve selected"],
              ["rejected", "Reject"],
              ["edited", "Request changes"],
              ["escalated", "Request evidence"]
            ].map(([value, label]) => (
              <button key={value} className="rounded-md border border-ink px-3 py-2 text-sm font-semibold" name="decision" type="submit" value={value}>
                {label}
              </button>
            ))}
          </div>

          <div className="mt-4 grid gap-3 sm:grid-cols-3">
            {[
              ["review_minutes", "Review minutes (observed)"],
              ["rework_minutes", "Rework minutes (observed)"],
              ["botsitting_minutes", "Botsitting minutes (observed)"],
              ["escalation_minutes", "Escalation minutes (observed)"],
              ["governance_minutes", "Governance minutes (observed)"]
            ].map(([name, label]) => (
              <label className="block text-xs font-semibold uppercase tracking-[0.12em] text-ink/45" key={name}>
                {label}
                <input className="mt-1 w-full rounded-md border border-line bg-white px-3 py-2 text-sm normal-case tracking-normal text-ink" name={String(name)} type="number" defaultValue={0} />
              </label>
            ))}
          </div>

          <label className="mt-4 block text-sm font-medium">
            Reviewer notes
            <textarea name="reviewer_notes" className="mt-1 min-h-24 w-full rounded-md border border-line bg-white px-3 py-2" defaultValue="Review exact prepared action payloads only." />
          </label>
          <label className="mt-4 block text-sm font-medium">
            Teacher feedback
            <textarea name="teacher_feedback" className="mt-1 min-h-20 w-full rounded-md border border-line bg-white px-3 py-2" placeholder="Correction guidance for future template/policy changes" />
          </label>
        </form>
      ) : trace ? (
        <div className="text-sm text-ink/60">Run {trace.id} is {trace.status}. No review required.</div>
      ) : (
        <div className="text-sm text-ink/60">No runs found. Simulate a loop from the CLI or Runs tab first.</div>
      )}
    </SectionCard>
  );
}
