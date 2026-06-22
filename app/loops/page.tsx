import Link from "next/link";
import { PageHeader } from "@/components/page-header";
import { StatusPill } from "@/components/status-pill";
import { getDemoWorkspace } from "@/lib/loop-engineering-builder/demo-data";
import { formatDate, titleCase } from "@/lib/loop-engineering-builder/demo-helpers";

export default function LoopsPage() {
  const workspace = getDemoWorkspace();

  return (
    <>
      <PageHeader
        eyebrow="Loop inventory"
        title="Loops"
        description="Track loop status, ownership, autonomy, cadence, runs, open reviews, and improvement items."
        action={
          <Link className="rounded-md bg-ink px-4 py-2 text-sm font-semibold text-white" href="/loops/new">
            New loop
          </Link>
        }
      />
      <div className="overflow-hidden rounded-lg border border-line bg-white shadow-sm">
        <table className="w-full text-left text-sm">
          <thead className="bg-paper text-xs uppercase tracking-[0.14em] text-ink/50">
            <tr>
              <th className="px-4 py-3">Name</th>
              <th className="px-4 py-3">Department</th>
              <th className="px-4 py-3">Loop type</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3">Owner</th>
              <th className="px-4 py-3">Autonomy</th>
              <th className="px-4 py-3">Cadence</th>
              <th className="px-4 py-3">Last run</th>
              <th className="px-4 py-3">Open reviews</th>
              <th className="px-4 py-3">Improvements</th>
            </tr>
          </thead>
          <tbody>
            <tr className="border-t border-line">
              <td className="px-4 py-3">
                <Link className="font-semibold hover:underline" href={`/loops/${workspace.loop.id}`}>
                  {workspace.loop.name}
                </Link>
              </td>
              <td className="px-4 py-3">{titleCase(workspace.loop.department)}</td>
              <td className="px-4 py-3">{titleCase(workspace.loop.loopType)}</td>
              <td className="px-4 py-3"><StatusPill>{titleCase(workspace.loop.status)}</StatusPill></td>
              <td className="px-4 py-3">{workspace.loop.owner}</td>
              <td className="px-4 py-3">{titleCase(workspace.loop.autonomyLevel)}</td>
              <td className="px-4 py-3">{workspace.loop.cadence}</td>
              <td className="px-4 py-3">{formatDate(workspace.loop.lastRunAt)}</td>
              <td className="px-4 py-3">{workspace.loop.openReviews}</td>
              <td className="px-4 py-3">{workspace.loop.improvementItems}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </>
  );
}
