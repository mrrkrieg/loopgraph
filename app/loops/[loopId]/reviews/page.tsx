import { SectionCard } from "@/components/section-card";
import { StatusPill } from "@/components/status-pill";
import { getDemoWorkspace } from "@/lib/loop-engineering-builder/demo-data";

export default function LoopReviewsPage() {
  const workspace = getDemoWorkspace();
  const review = workspace.runBundle.review;

  return (
    <SectionCard title="Human reviews" description="Approvals, edits, rejections, escalations, and reviewer notes are tracked as part of loop cost and quality.">
      {review ? (
        <div className="rounded-lg border border-line bg-paper p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <div className="font-semibold">{review.reason}</div>
              <div className="mt-1 text-sm text-ink/60">{review.recommendation}</div>
            </div>
            <StatusPill>{review.status}</StatusPill>
          </div>
          <div className="mt-4 grid gap-3 sm:grid-cols-4">
            {["Approve", "Reject", "Edit", "Escalate"].map((action) => (
              <button key={action} className="rounded-md border border-ink px-3 py-2 text-sm font-semibold" type="button">
                {action}
              </button>
            ))}
          </div>
          <label className="mt-4 block text-sm font-medium">
            Reviewer notes
            <textarea className="mt-1 min-h-24 w-full rounded-md border border-line bg-white px-3 py-2" defaultValue="Require spend cap and downstream quality check before scaling." />
          </label>
        </div>
      ) : (
        <div className="text-sm text-ink/60">No human reviews required.</div>
      )}
    </SectionCard>
  );
}
