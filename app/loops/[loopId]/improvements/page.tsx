import Link from "next/link";
import { SectionCard } from "@/components/section-card";
import { StatusPill } from "@/components/status-pill";
import { formatDate } from "@/lib/loop-engineering-builder/demo-helpers";
import { getWorkspace } from "@/lib/loop-engineering-builder/workspace";

export default async function LoopImprovementsPage({
  params
}: {
  params: Promise<{ loopId: string }>;
}) {
  const { loopId } = await params;
  const workspace = await getWorkspace(loopId);

  return (
    <SectionCard title="Improvement items" description="Failures, rejected reviews, edited outputs, and repeated human corrections become system-change work.">
      <div className="overflow-hidden rounded-lg border border-line">
        <table className="w-full text-left text-sm">
          <thead className="bg-paper text-xs uppercase tracking-[0.14em] text-ink/50">
            <tr>
              <th className="px-4 py-3">Title</th>
              <th className="px-4 py-3">Failure mode</th>
              <th className="px-4 py-3">Recommendation</th>
              <th className="px-4 py-3">Source run</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3">Owner</th>
              <th className="px-4 py-3">Created</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {workspace.improvements.length === 0 ? (
              <tr>
                <td className="px-4 py-6 text-ink/60" colSpan={7}>
                  No improvement items yet. Reject a review or resolve a case to emit `improvement_signal` on the source trace.
                </td>
              </tr>
            ) : (
              workspace.improvements.map((item) => (
                <tr key={item.id}>
                  <td className="px-4 py-3 font-medium">{item.title}</td>
                  <td className="px-4 py-3">{item.failureMode}</td>
                  <td className="px-4 py-3">{item.recommendation}</td>
                  <td className="px-4 py-3">
                    {item.sourceRunId ? (
                      <Link href={`/loops/${loopId}/runs/${item.sourceRunId}`} className="text-ink/70 hover:text-ink">
                        {item.sourceRunId}
                      </Link>
                    ) : (
                      "—"
                    )}
                  </td>
                  <td className="px-4 py-3"><StatusPill>{item.status}</StatusPill></td>
                  <td className="px-4 py-3">{item.owner}</td>
                  <td className="px-4 py-3">{formatDate(item.createdAt)}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </SectionCard>
  );
}
