import Link from "next/link";
import type { LoopRunTrace } from "@/lib/loopgraph-core/trace";
import { SectionCard } from "@/components/section-card";
import { StatusPill } from "@/components/status-pill";
import { TraceModeBadge } from "@/components/trace-mode-badge";
import { getCumulativeApprovedFingerprints } from "@/lib/loopgraph-runtime/review-service";

function actionApprovalState(trace: LoopRunTrace, fingerprint: string) {
  const cumulative = getCumulativeApprovedFingerprints(trace);
  if (cumulative.includes(fingerprint)) {
    const toolCall = trace.toolCalls.find((call) => {
      const prepared = trace.preparedActions.find((action) => action.fingerprint === fingerprint);
      return prepared && call.toolKey === prepared.toolKey;
    });
    if (toolCall?.status === "mock_committed") return "mock_committed";
    if (toolCall?.status === "completed") return "committed";
    return "approved";
  }
  return trace.status === "WAITING_FOR_REVIEW" ? "pending" : "not_approved";
}

export function TraceViewer({ trace }: { trace: LoopRunTrace }) {
  return (
    <div className="grid gap-5">
      <TraceModeBadge trace={trace} />

      <SectionCard title="Run metadata">
        <div className="grid gap-2 text-sm">
          <div><span className="font-semibold">Loop:</span> {trace.loopId}</div>
          <div><span className="font-semibold">Status:</span> {trace.status}</div>
          <div><span className="font-semibold">Idempotency:</span> {trace.idempotencyKey}</div>
          <div><span className="font-semibold">Context hash:</span> {trace.contextSnapshot.contentHash}</div>
          {trace.escalationCases[0] && (
            <div>
              <span className="font-semibold">Escalation case:</span>{" "}
              <Link className="underline" href={`/cases/${trace.escalationCases[0]}`}>{trace.escalationCases[0]}</Link>
            </div>
          )}
        </div>
      </SectionCard>

      <SectionCard title="Prepared actions">
        <div className="space-y-3">
          {trace.preparedActions.map((action) => {
            const state = actionApprovalState(trace, action.fingerprint);
            return (
              <div key={action.id} className="rounded-md border border-line bg-paper p-3 text-sm">
                <div className="flex flex-wrap items-center gap-2">
                  <div className="font-medium">{action.label} · {action.toolKey}</div>
                  <StatusPill>{state}</StatusPill>
                </div>
                <div className="mt-1 text-xs text-ink/60">
                  fingerprint={action.fingerprint} · customerFacing={String(action.customerFacing)} · requiresApproval={String(action.requiresApproval)}
                </div>
                <pre className="mt-2 overflow-auto rounded bg-white p-2 text-xs">{JSON.stringify(action.payload, null, 2)}</pre>
              </div>
            );
          })}
        </div>
      </SectionCard>

      <SectionCard title="Policy and verification">
        <div className="grid gap-4 lg:grid-cols-2">
          <pre className="overflow-auto rounded-md bg-ink p-3 text-xs text-white/85">{JSON.stringify(trace.policyDecisions, null, 2)}</pre>
          <pre className="overflow-auto rounded-md bg-ink p-3 text-xs text-white/85">{JSON.stringify(trace.verificationResults, null, 2)}</pre>
        </div>
      </SectionCard>

      <SectionCard title="Reviews and escalation">
        <div className="grid gap-4 lg:grid-cols-2">
          <pre className="overflow-auto rounded-md bg-ink p-3 text-xs text-white/85">{JSON.stringify(trace.humanReviews, null, 2)}</pre>
          <pre className="overflow-auto rounded-md bg-ink p-3 text-xs text-white/85">{JSON.stringify(trace.escalationCases, null, 2)}</pre>
        </div>
      </SectionCard>

      <SectionCard title="Tool calls">
        <div className="space-y-2">
          {trace.toolCalls.map((call) => (
            <div key={call.id} className="rounded-md border border-line bg-paper p-2 text-xs">
              <span className="font-semibold">{call.toolKey}</span> · status={call.status}
              {call.status === "mock_committed" && " (simulated commit — no live write)"}
            </div>
          ))}
        </div>
      </SectionCard>
    </div>
  );
}
