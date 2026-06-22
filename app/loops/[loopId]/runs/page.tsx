import { SectionCard } from "@/components/section-card";
import { StatusPill } from "@/components/status-pill";
import { getDemoWorkspace } from "@/lib/loop-engineering-builder/demo-data";
import { formatDate } from "@/lib/loop-engineering-builder/demo-helpers";

export default function LoopRunsPage() {
  const workspace = getDemoWorkspace();
  const { run, steps } = workspace.runBundle;

  return (
    <div className="grid gap-5">
      <SectionCard title="Manual run V1" description="The starter simulates execution, records step traces, verifies output, and creates human review when escalation rules match.">
        <form action={`/api/loops/${workspace.loop.id}/run`} method="post">
          <button className="rounded-md bg-ink px-4 py-2 text-sm font-semibold text-white" type="submit">
            Run loop
          </button>
        </form>
      </SectionCard>
      <SectionCard title="Runs">
        <div className="overflow-hidden rounded-lg border border-line">
          <table className="w-full text-left text-sm">
            <thead className="bg-paper text-xs uppercase tracking-[0.14em] text-ink/50">
              <tr>
                <th className="px-4 py-3">Run ID</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Trigger</th>
                <th className="px-4 py-3">Started</th>
                <th className="px-4 py-3">Completed</th>
                <th className="px-4 py-3">Escalation</th>
                <th className="px-4 py-3">Review</th>
                <th className="px-4 py-3">Error</th>
              </tr>
            </thead>
            <tbody>
              <tr className="border-t border-line">
                <td className="px-4 py-3">{run.id}</td>
                <td className="px-4 py-3"><StatusPill>{run.status}</StatusPill></td>
                <td className="px-4 py-3">{run.triggerType}</td>
                <td className="px-4 py-3">{formatDate(run.startedAt)}</td>
                <td className="px-4 py-3">{formatDate(run.completedAt)}</td>
                <td className="px-4 py-3">{run.escalationRequired ? "Yes" : "No"}</td>
                <td className="px-4 py-3">{run.humanReviewRequired ? "Yes" : "No"}</td>
                <td className="px-4 py-3">{run.error ?? "-"}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </SectionCard>
      <SectionCard title="Run detail">
        <div className="grid gap-4 lg:grid-cols-3">
          <pre className="overflow-auto rounded-md bg-ink p-3 text-xs text-white/85">{JSON.stringify(run.inputSnapshot, null, 2)}</pre>
          <pre className="overflow-auto rounded-md bg-ink p-3 text-xs text-white/85">{JSON.stringify(run.outputSnapshot, null, 2)}</pre>
          <pre className="overflow-auto rounded-md bg-ink p-3 text-xs text-white/85">{JSON.stringify(run.verificationResult, null, 2)}</pre>
        </div>
        <div className="mt-4 grid gap-3">
          {steps.map((step) => (
            <div key={step.id} className="rounded-md border border-line bg-paper p-3">
              <div className="font-medium">{step.stepName}</div>
              <div className="mt-1 text-sm text-ink/60">{step.stepType} · {step.status}</div>
            </div>
          ))}
        </div>
      </SectionCard>
    </div>
  );
}
