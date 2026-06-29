import Link from "next/link";
import { SectionCard } from "@/components/section-card";
import { StatusPill } from "@/components/status-pill";
import { formatDate } from "@/lib/loop-engineering-builder/demo-helpers";
import { getStorageAdapter } from "@/lib/loopgraph-runtime/storage-resolver";
import { startLoopRunAction } from "./actions";

export default async function LoopRunsPage({
  params
}: {
  params: Promise<{ loopId: string }>;
}) {
  const { loopId } = await params;
  const storage = getStorageAdapter();
  const runs = await storage.listRuns();
  const traces = await Promise.all(
    runs.map(async (run) => ({
      index: run,
      trace: await storage.getRun(run.id)
    }))
  );

  return (
    <div className="grid gap-5">
      <SectionCard title="Simulated runs (fixture)" description="Runs use deterministic fixtures when available. Traces include context snapshots, policy decisions, and prepared actions.">
        <form action={startLoopRunAction}>
          <input name="loop_id" type="hidden" value={loopId} />
          <button className="rounded-md bg-ink px-4 py-2 text-sm font-semibold text-white" type="submit">
            Run loop
          </button>
        </form>
      </SectionCard>
      <SectionCard title="Run history" description="Persisted traces from .loopgraph/ (shared with CLI simulate).">
        <div className="overflow-hidden rounded-lg border border-line">
          <table className="w-full text-left text-sm">
            <thead className="bg-paper text-xs uppercase tracking-[0.14em] text-ink/50">
              <tr>
                <th className="px-4 py-3">Run ID</th>
                <th className="px-4 py-3">Loop</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Started</th>
                <th className="px-4 py-3">Review</th>
                <th className="px-4 py-3">Actions</th>
              </tr>
            </thead>
            <tbody>
              {traces.length === 0 && (
                <tr className="border-t border-line">
                  <td className="px-4 py-6 text-ink/60" colSpan={6}>
                    No persisted runs yet. Click Run loop or use `npm run loopgraph -- simulate ...`.
                  </td>
                </tr>
              )}
              {traces.map(({ index, trace }) => (
                <tr key={index.id} className="border-t border-line">
                  <td className="px-4 py-3 font-mono text-xs">{index.id}</td>
                  <td className="px-4 py-3">{trace?.loopId ?? index.loopId}</td>
                  <td className="px-4 py-3"><StatusPill>{index.status}</StatusPill></td>
                  <td className="px-4 py-3">{trace ? formatDate(trace.startedAt) : "-"}</td>
                  <td className="px-4 py-3">{index.status === "WAITING_FOR_REVIEW" ? "Required" : "No"}</td>
                  <td className="px-4 py-3">
                    <Link className="font-semibold underline" href={`/loops/${loopId}/runs/${index.id}`}>
                      View trace
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </SectionCard>
    </div>
  );
}
