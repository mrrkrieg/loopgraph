import Link from "next/link";
import { PageHeader } from "@/components/page-header";
import { StatusPill } from "@/components/status-pill";
import { formatDate, titleCase } from "@/lib/loop-engineering-builder/demo-helpers";
import { getWorkspace } from "@/lib/loop-engineering-builder/workspace";
import { deleteLoopAction } from "./actions";

export default async function LoopsPage({
  searchParams
}: {
  searchParams?: Promise<{ preview?: string }>;
}) {
  const params = await searchParams;
  const workspace = await getWorkspace(params?.preview);

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
      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_430px]">
        <div className="overflow-hidden rounded-lg border border-line bg-white shadow-sm">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1180px] text-left text-sm">
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
                  <th className="px-4 py-3">Actions</th>
                </tr>
              </thead>
              <tbody>
                {workspace.loops.map((loop) => {
                  const isSelected = loop.id === workspace.loop.id;
                  const canRemove = loop.source !== "demo_catalog";

                  return (
                    <tr className={`border-t border-line ${isSelected ? "bg-signal/10" : ""}`} key={loop.id}>
                      <td className="px-4 py-3">
                        <Link
                          aria-current={isSelected ? "true" : undefined}
                          className="font-semibold hover:underline"
                          href={`/loops?preview=${loop.id}`}
                        >
                          {loop.name}
                        </Link>
                        <div className="mt-1 text-xs text-ink/45">{loop.targetMetric}</div>
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
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <Link
                            className="rounded-md border border-ink px-3 py-2 text-xs font-semibold hover:bg-ink hover:text-white"
                            href={`/loops/${loop.id}`}
                          >
                            Open
                          </Link>
                          <form action={deleteLoopAction}>
                            <input name="loop_id" type="hidden" value={loop.id} />
                            <button
                              className="rounded-md border border-risk px-3 py-2 text-xs font-semibold text-risk hover:bg-risk hover:text-white disabled:cursor-not-allowed disabled:border-line disabled:text-ink/35 disabled:hover:bg-transparent"
                              disabled={!canRemove}
                              title={canRemove ? "Remove this loop" : "Demo catalog loops cannot be removed"}
                              type="submit"
                            >
                              Remove
                            </button>
                          </form>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>

        <LogicPreview workspace={workspace} />
      </div>
    </>
  );
}

function LogicPreview({ workspace }: { workspace: Awaited<ReturnType<typeof getWorkspace>> }) {
  const { loop, spec } = workspace;
  const questionAnswers = workspace.questions.flatMap((group) =>
    group.questions.map((question) => ({
      ...question,
      group: group.section,
      answer: workspace.answers[question.questionKey] ?? ""
    }))
  );

  return (
    <aside className="border-t border-line pt-5 xl:sticky xl:top-5 xl:self-start xl:border-l xl:border-t-0 xl:pl-5 xl:pt-0">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase text-ink/45">Logic preview</p>
          <h2 className="mt-1 text-xl font-semibold">{loop.name}</h2>
        </div>
        <StatusPill>{titleCase(loop.status)}</StatusPill>
      </div>

      <p className="mt-3 text-sm leading-6 text-ink/70">{spec.goal}</p>

      <div className="mt-4 grid gap-3 text-sm sm:grid-cols-2 xl:grid-cols-1">
        <LogicFact label="Cadence" value={spec.cadence} />
        <LogicFact label="Human owner" value={spec.humanOwner} />
        <LogicFact label="Autonomy" value={titleCase(spec.autonomyLevel)} />
        <LogicFact label="Target metric" value={spec.targetMetric} />
      </div>

      <div className="mt-5">
        <h3 className="text-sm font-semibold">Routine</h3>
        <div className="mt-3 space-y-2">
          {spec.routine.slice(0, 5).map((step, index) => (
            <div className="flex gap-3 rounded-md border border-line bg-paper p-3 text-sm" key={`${step.stepName}-${index}`}>
              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-ink text-xs font-semibold text-white">
                {index + 1}
              </span>
              <div>
                <div className="font-medium">{step.stepName}</div>
                <div className="mt-1 text-xs text-ink/55">{step.actor} · {step.stepType}</div>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="mt-5">
        <h3 className="text-sm font-semibold">Questions and answers</h3>
        <div className="mt-3 max-h-[460px] space-y-2 overflow-auto pr-1">
          {questionAnswers.map((item) => (
            <div className="rounded-md border border-line p-3 text-sm" key={item.questionKey}>
              <div className="text-xs font-semibold uppercase text-ink/40">{item.group}</div>
              <div className="mt-1 font-medium">{item.question}</div>
              <div className="mt-2 leading-6 text-ink/65">{item.answer || "Not answered yet"}</div>
            </div>
          ))}
        </div>
      </div>

      <div className="mt-5 flex flex-wrap gap-2">
        <Link className="rounded-md bg-ink px-4 py-2 text-sm font-semibold text-white" href={`/loops/${loop.id}`}>
          Open loop
        </Link>
        <Link className="rounded-md border border-ink px-4 py-2 text-sm font-semibold" href={`/loops/${loop.id}/questions`}>
          Edit logic
        </Link>
      </div>
    </aside>
  );
}

function LogicFact({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-line bg-paper p-3">
      <div className="text-xs font-semibold uppercase text-ink/45">{label}</div>
      <div className="mt-1 font-medium">{value}</div>
    </div>
  );
}
