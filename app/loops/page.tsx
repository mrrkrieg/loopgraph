import Link from "next/link";
import { PageHeader } from "@/components/page-header";
import { StatusPill } from "@/components/status-pill";
import { formatDate, titleCase } from "@/lib/loop-engineering-builder/demo-helpers";
import { getWorkspace } from "@/lib/loop-engineering-builder/workspace";

export default async function LoopsPage() {
  const workspace = await getWorkspace();

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
            {workspace.loops.map((loop) => (
              <tr className="border-t border-line" key={loop.id}>
                <td className="px-4 py-3">
                  <Link className="font-semibold hover:underline" href={`/loops/${loop.id}`}>
                    {loop.name}
                  </Link>
                </td>
                <td className="px-4 py-3">{titleCase(loop.department)}</td>
                <td className="px-4 py-3">{titleCase(loop.loopType)}</td>
                <td className="px-4 py-3"><StatusPill>{titleCase(loop.status)}</StatusPill></td>
                <td className="px-4 py-3">{loop.owner}</td>
                <td className="px-4 py-3">{titleCase(loop.autonomyLevel)}</td>
                <td className="px-4 py-3">{loop.cadence}</td>
                <td className="px-4 py-3">{formatDate(loop.lastRunAt)}</td>
                <td className="px-4 py-3">{loop.openReviews}</td>
                <td className="px-4 py-3">{loop.improvementItems}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
