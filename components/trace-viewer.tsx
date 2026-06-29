import type { LoopRunTrace } from "@/lib/loopgraph-core/trace";
import { SectionCard } from "@/components/section-card";

export function TraceViewer({ trace }: { trace: LoopRunTrace }) {
  return (
    <div className="grid gap-5">
      <SectionCard title="Run metadata">
        <div className="grid gap-2 text-sm">
          <div><span className="font-semibold">Loop:</span> {trace.loopId}</div>
          <div><span className="font-semibold">Mode:</span> {trace.mode}</div>
          <div><span className="font-semibold">Idempotency:</span> {trace.idempotencyKey}</div>
          <div><span className="font-semibold">Context hash:</span> {trace.contextSnapshot.contentHash}</div>
        </div>
      </SectionCard>

      <SectionCard title="Prepared actions">
        <div className="space-y-3">
          {trace.preparedActions.map((action) => (
            <div key={action.id} className="rounded-md border border-line bg-paper p-3 text-sm">
              <div className="font-medium">{action.label} · {action.toolKey}</div>
              <div className="mt-1 text-xs text-ink/60">
                fingerprint={action.fingerprint} · customerFacing={String(action.customerFacing)} · requiresApproval={String(action.requiresApproval)}
              </div>
              <pre className="mt-2 overflow-auto rounded bg-white p-2 text-xs">{JSON.stringify(action.payload, null, 2)}</pre>
            </div>
          ))}
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
        <pre className="overflow-auto rounded-md bg-ink p-3 text-xs text-white/85">{JSON.stringify(trace.toolCalls, null, 2)}</pre>
      </SectionCard>
    </div>
  );
}
