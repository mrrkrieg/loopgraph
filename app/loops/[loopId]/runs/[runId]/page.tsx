import Link from "next/link";
import { StatusPill } from "@/components/status-pill";
import { ContextTracePanel } from "@/components/context-trace-panel";
import { TraceModeBadge } from "@/components/trace-mode-badge";
import { TraceViewer } from "@/components/trace-viewer";
import { getStorageAdapter } from "@/lib/loopgraph-runtime/storage-resolver";

export default async function LoopRunDetailPage({
  params
}: {
  params: Promise<{ loopId: string; runId: string }>;
}) {
  const { loopId, runId } = await params;
  const storage = getStorageAdapter();
  const trace = await storage.getRun(runId);

  if (!trace) {
    return <div className="text-sm text-ink/60">Trace not found for run {runId}.</div>;
  }

  return (
    <div className="grid gap-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="text-xs uppercase tracking-[0.12em] text-ink/45">Run trace</div>
          <h2 className="text-xl font-semibold">{trace.id}</h2>
        </div>
        <div className="flex items-center gap-2">
          <StatusPill>{trace.status}</StatusPill>
          {trace.status === "WAITING_FOR_REVIEW" && (
            <Link className="rounded-md border border-ink px-3 py-2 text-sm font-semibold" href={`/loops/${loopId}/reviews?runId=${runId}`}>
              Review run
            </Link>
          )}
          <Link className="rounded-md border border-line px-3 py-2 text-sm" href={`/loops/${loopId}/runs`}>
            Back to runs
          </Link>
        </div>
      </div>

      <TraceModeBadge trace={trace} />

      <ContextTracePanel runId={runId} />
      <TraceViewer trace={trace} />
    </div>
  );
}
