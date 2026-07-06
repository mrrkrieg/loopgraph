import type { LoopRunTrace } from "@/lib/loopgraph-core/trace";
import { describeTraceMode } from "@/lib/loopgraph-runtime/run-filters";

export function TraceModeBadge({ trace }: { trace: LoopRunTrace }) {
  const info = describeTraceMode(trace);
  const styles =
    info.variant === "execute"
      ? "border-red-200 bg-red-50 text-red-900"
      : "border-amber-200 bg-amber-50 text-amber-900";

  return (
    <div className={`rounded-md border px-3 py-2 text-sm ${styles}`}>
      <span className="font-semibold">Mode:</span> {info.mode} ·{" "}
      <span className="font-semibold">Source:</span> {info.source} ·{" "}
      <span className="font-semibold">Writes:</span> {info.writes}
    </div>
  );
}
