import { SectionCard } from "@/components/section-card";
import { StatusPill } from "@/components/status-pill";
import { getWorkspace } from "@/lib/loop-engineering-builder/workspace";
import { getPersistedTrace } from "@/lib/loop-engineering-builder/runtime-bridge";
import { submitHumanReviewAction } from "./actions";

export default async function LoopReviewsPage({
  params
}: {
  params: Promise<{ loopId: string }>;
}) {
  const { loopId } = await params;
  const workspace = await getWorkspace(loopId);
  const review = workspace.runBundle.review;
  const trace = review ? await getPersistedTrace(workspace.runBundle.run.id) : null;
  const preparedActions = trace?.preparedActions ?? [];

  return (
    <SectionCard title="Human reviews" description="Approve exact prepared actions with fingerprints. Customer-facing actions require separate approval. Simulated / fixture mode.">
      {review ? (
        <form action={submitHumanReviewAction} className="rounded-lg border border-line bg-paper p-4">
          <input name="loop_id" type="hidden" value={loopId} />
          <input name="review_id" type="hidden" value={review.id} />
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <div className="font-semibold">{review.reason}</div>
              <div className="mt-1 text-sm text-ink/60">{review.recommendation}</div>
            </div>
            <StatusPill>{review.status}</StatusPill>
          </div>

          {preparedActions.length > 0 && (
            <div className="mt-4 space-y-3">
              <div className="text-xs font-semibold uppercase tracking-[0.12em] text-ink/45">Prepared actions</div>
              {preparedActions.map((action) => (
                <div key={action.id} className="rounded-md border border-line bg-white p-3 text-sm">
                  <div className="font-medium">{action.label} · {action.toolKey}</div>
                  <div className="mt-1 text-xs text-ink/60">fingerprint={action.fingerprint}</div>
                  <div className="mt-1 text-xs text-ink/60">customerFacing={String(action.customerFacing)} · requiresApproval={String(action.requiresApproval)}</div>
                  <pre className="mt-2 overflow-auto rounded bg-paper p-2 text-xs">{JSON.stringify(action.payload, null, 2)}</pre>
                </div>
              ))}
            </div>
          )}

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
              ["approved", "Approve"],
              ["rejected", "Reject"],
              ["edited", "Request changes"],
              ["escalated", "Escalate"]
            ].map(([value, action]) => (
              <button key={value} className="rounded-md border border-ink px-3 py-2 text-sm font-semibold" name="decision" type="submit" value={value}>
                {action}
              </button>
            ))}
          </div>
          <div className="mt-4 grid gap-3 sm:grid-cols-3">
            {[
              ["review_minutes", "Review minutes (observed)", 48],
              ["rework_minutes", "Rework minutes (observed)", 34],
              ["botsitting_minutes", "Botsitting minutes (observed)", 22],
              ["escalation_minutes", "Escalation minutes (observed)", 18],
              ["governance_minutes", "Governance minutes (observed)", 12],
              ["relationship_minutes", "Relationship minutes (observed)", 96]
            ].map(([name, label, value]) => (
              <label className="block text-xs font-semibold uppercase tracking-[0.12em] text-ink/45" key={name}>
                {label}
                <input className="mt-1 w-full rounded-md border border-line bg-white px-3 py-2 text-sm normal-case tracking-normal text-ink" name={String(name)} type="number" defaultValue={Number(value)} />
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
      ) : (
        <div className="text-sm text-ink/60">No human reviews required.</div>
      )}
    </SectionCard>
  );
}
