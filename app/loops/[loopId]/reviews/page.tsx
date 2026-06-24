import { SectionCard } from "@/components/section-card";
import { StatusPill } from "@/components/status-pill";
import { getWorkspace } from "@/lib/loop-engineering-builder/workspace";
import { submitHumanReviewAction } from "./actions";

export default async function LoopReviewsPage({
  params
}: {
  params: Promise<{ loopId: string }>;
}) {
  const { loopId } = await params;
  const workspace = await getWorkspace(loopId);
  const review = workspace.runBundle.review;

  return (
    <SectionCard title="Human reviews" description="Approvals, edits, rejections, escalations, and reviewer notes are tracked as part of loop cost and quality.">
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
          <div className="mt-4 grid gap-3 sm:grid-cols-4">
            {[
              ["approved", "Approve"],
              ["rejected", "Reject"],
              ["edited", "Edit"],
              ["escalated", "Escalate"]
            ].map(([value, action]) => (
              <button key={value} className="rounded-md border border-ink px-3 py-2 text-sm font-semibold" name="decision" type="submit" value={value}>
                {action}
              </button>
            ))}
          </div>
          <div className="mt-4 grid gap-3 sm:grid-cols-3">
            {[
              ["review_minutes", "Review minutes", 48],
              ["rework_minutes", "Rework minutes", 34],
              ["botsitting_minutes", "Botsitting minutes", 22],
              ["escalation_minutes", "Escalation minutes", 18],
              ["governance_minutes", "Governance minutes", 12],
              ["relationship_minutes", "Relationship minutes", 96]
            ].map(([name, label, value]) => (
              <label className="block text-xs font-semibold uppercase tracking-[0.12em] text-ink/45" key={name}>
                {label}
                <input className="mt-1 w-full rounded-md border border-line bg-white px-3 py-2 text-sm normal-case tracking-normal text-ink" name={String(name)} type="number" defaultValue={Number(value)} />
              </label>
            ))}
          </div>
          <label className="mt-4 block text-sm font-medium">
            Reviewer notes
            <textarea name="reviewer_notes" className="mt-1 min-h-24 w-full rounded-md border border-line bg-white px-3 py-2" defaultValue="Require spend cap and downstream quality check before scaling." />
          </label>
        </form>
      ) : (
        <div className="text-sm text-ink/60">No human reviews required.</div>
      )}
    </SectionCard>
  );
}
