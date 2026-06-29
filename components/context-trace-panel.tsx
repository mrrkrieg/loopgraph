import { getStorageAdapter } from "@/lib/loopgraph-runtime/storage-resolver";

export async function ContextTracePanel({ runId }: { runId: string }) {
  const storage = getStorageAdapter();
  const trace = await storage.getRun(runId);
  if (!trace) {
    return <div className="text-sm text-ink/60">Run a loop to generate a persisted trace, or use the CLI simulate command.</div>;
  }

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <div>
        <div className="text-xs font-semibold uppercase tracking-[0.12em] text-ink/45">Context entries</div>
        <div className="mt-2 mb-3 text-xs text-ink/60">
          Snapshot {trace.contextSnapshot.id} · hash={trace.contextSnapshot.contentHash} · tokens≈{trace.contextSnapshot.tokenEstimate}
        </div>
        <div className="space-y-2">
          {trace.contextSnapshot.entries.map((entry) => (
            <div key={entry.sourceId} className="rounded-md border border-line bg-paper p-3 text-sm">
              <div className="flex items-center justify-between gap-2">
                <div className="font-medium">{entry.title}</div>
                <span className="text-xs text-ink/50">p{entry.precedence}</span>
              </div>
              <div className="mt-1 text-xs text-ink/60">
                sourceType={entry.sourceType} · sensitivity={entry.sensitivity} · freshness={entry.freshness}
              </div>
              <div className="mt-1 text-xs text-ink/60">
                trusted={String(entry.trusted)} · redactionApplied={String(entry.redactionApplied)} · hash={entry.contentHash}
              </div>
              <pre className="mt-2 max-h-40 overflow-auto rounded bg-white p-2 text-xs">{JSON.stringify(entry.value, null, 2)}</pre>
            </div>
          ))}
        </div>
      </div>
      <pre className="overflow-auto rounded-md bg-ink p-3 text-xs text-white/85">{JSON.stringify({
        status: trace.status,
        policyDecisions: trace.policyDecisions,
        verificationResults: trace.verificationResults,
        preparedActions: trace.preparedActions,
        escalationCases: trace.escalationCases,
        humanReviews: trace.humanReviews
      }, null, 2)}</pre>
    </div>
  );
}
