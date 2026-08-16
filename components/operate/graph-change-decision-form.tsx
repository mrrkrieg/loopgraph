"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import {
  decideGraphChangeAction,
  initialGraphChangeDecisionState
} from "@/app/operate/changes/actions";

export function GraphChangeDecisionForm({
  canApprove,
  changeSetId,
  blockedReason
}: {
  canApprove: boolean;
  changeSetId: string;
  blockedReason?: string;
}) {
  const [state, action] = useActionState(
    decideGraphChangeAction,
    initialGraphChangeDecisionState
  );
  return (
    <form action={action} className="mt-5 rounded-md border border-line bg-white p-4">
      <input name="changeSetId" type="hidden" value={changeSetId} />
      <div className="text-xs font-semibold uppercase tracking-[0.14em] text-ink/45">
        Accountable decision
      </div>
      <p className="mt-2 text-sm leading-6 text-ink/65">
        Approval binds every operation to the completed Hermes design run and exact validated proposal IDs. It does not apply the change.
      </p>
      <label className="mt-3 block">
        <span className="text-xs font-semibold text-ink/60">Decision reason</span>
        <textarea
          className="mt-1 min-h-24 w-full rounded-md border border-line bg-paper px-3 py-2 text-sm outline-none focus:border-ink"
          maxLength={2000}
          name="reason"
          placeholder="What evidence, risk, and expected outcome support this decision?"
          required
        />
      </label>
      {!canApprove && blockedReason ? (
        <p className="mt-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs leading-5 text-amber-950">
          Approval blocked: {blockedReason}
        </p>
      ) : null}
      <DecisionButtons canApprove={canApprove} />
      {state.message ? (
        <p
          aria-live="polite"
          className={`mt-3 rounded-md px-3 py-2 text-sm ${
            state.status === "success"
              ? "border border-emerald-200 bg-emerald-50 text-emerald-950"
              : "border border-red-200 bg-red-50 text-red-950"
          }`}
        >
          {state.message}
        </p>
      ) : null}
    </form>
  );
}

function DecisionButtons({ canApprove }: { canApprove: boolean }) {
  const { pending } = useFormStatus();
  return (
    <div className="mt-3 flex flex-wrap gap-2">
      <button
        className="rounded-md bg-ink px-4 py-2 text-sm font-semibold text-white disabled:opacity-40"
        disabled={!canApprove || pending}
        name="decision"
        type="submit"
        value="approved"
      >
        {pending ? "Recording decision…" : "Approve exact change set"}
      </button>
      <button
        className="rounded-md border border-red-300 bg-white px-4 py-2 text-sm font-semibold text-red-800 disabled:opacity-40"
        disabled={pending}
        name="decision"
        type="submit"
        value="rejected"
      >
        Reject without applying
      </button>
    </div>
  );
}
