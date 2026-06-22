import { SectionCard } from "@/components/section-card";
import { StatusPill } from "@/components/status-pill";
import { getDemoWorkspace } from "@/lib/loop-engineering-builder/demo-data";
import { formatDate } from "@/lib/loop-engineering-builder/demo-helpers";

export default function LoopImprovementsPage() {
  const workspace = getDemoWorkspace();

  return (
    <SectionCard title="Improvement items" description="Failures, rejected reviews, edited outputs, and repeated human corrections become system-change work.">
      <div className="overflow-hidden rounded-lg border border-line">
        <table className="w-full text-left text-sm">
          <thead className="bg-paper text-xs uppercase tracking-[0.14em] text-ink/50">
            <tr>
              <th className="px-4 py-3">Title</th>
              <th className="px-4 py-3">Failure mode</th>
              <th className="px-4 py-3">Recommendation</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3">Owner</th>
              <th className="px-4 py-3">Created</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {workspace.improvements.map((item) => (
              <tr key={item.id}>
                <td className="px-4 py-3 font-medium">{item.title}</td>
                <td className="px-4 py-3">{item.failureMode}</td>
                <td className="px-4 py-3">{item.recommendation}</td>
                <td className="px-4 py-3"><StatusPill>{item.status}</StatusPill></td>
                <td className="px-4 py-3">{item.owner}</td>
                <td className="px-4 py-3">{formatDate(item.createdAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </SectionCard>
  );
}
