import { getPersistedTrace } from "@/lib/loop-engineering-builder/runtime-bridge";

export async function ContextTracePanel({ runId }: { runId: string }) {
  const trace = await getPersistedTrace(runId);
  if (!trace) {
    return <div className="text-sm text-ink/60">Run a loop to generate a persisted trace, or use the CLI simulate command.</div>;
  }

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <div>
        <div className="text-xs font-semibold uppercase tracking-[0.12em] text-ink/45">Context entries</div>
        <div className="mt-2 space-y-2">
          {trace.contextSnapshot.entries.map((entry) => (
            <div key={entry.sourceId} className="rounded-md border border-line bg-paper p-3 text-sm">
              <div className="font-medium">{entry.title}</div>
              <div className="text-xs text-ink/60">trusted={String(entry.trusted)} · hash={entry.contentHash}</div>
            </div>
          ))}
        </div>
      </div>
      <pre className="overflow-auto rounded-md bg-ink p-3 text-xs text-white/85">{JSON.stringify({
        status: trace.status,
        policyDecisions: trace.policyDecisions,
        verificationResults: trace.verificationResults,
        preparedActions: trace.preparedActions,
        escalationCases: trace.escalationCases
      }, null, 2)}</pre>
    </div>
  );
}
