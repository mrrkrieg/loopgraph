import { PageHeader } from "@/components/page-header";
import { SectionCard } from "@/components/section-card";
import { StatusPill } from "@/components/status-pill";
import { consumeEscalationCase } from "@/lib/loopgraph-runtime/management-consumer";
import { getStorageAdapter } from "@/lib/loopgraph-runtime/storage-resolver";
import Link from "next/link";
import { resolveCaseAction } from "./actions";

export default async function CasePage({
  params,
  searchParams
}: {
  params: Promise<{ caseId: string }>;
  searchParams: Promise<{ error?: string; resolved?: string }>;
}) {
  const { caseId } = await params;
  const query = await searchParams;
  const storage = getStorageAdapter();
  const caseItem = await storage.getEscalationCase(caseId);

  if (!caseItem) {
    return (
      <>
        <PageHeader eyebrow="Escalation" title="Case not found" description="Run a simulated loop from the CLI or Design Studio to create cases." />
      </>
    );
  }

  const plan = consumeEscalationCase(caseItem);

  return (
    <>
      <PageHeader
        eyebrow="EscalationCase"
        title={caseItem.summary}
        description={`${caseItem.severity} · ${caseItem.status} · fixture/simulated`}
      />

      {query.error && (
        <div className="mb-4 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">{query.error}</div>
      )}
      {query.resolved === "1" && (
        <div className="mb-4 rounded-md border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-800">
          Case resolved. Outcome written back to source run trace.
        </div>
      )}

      <div className="mb-4 flex flex-wrap gap-2 text-sm">
        <StatusPill>{caseItem.status}</StatusPill>
        <StatusPill>{caseItem.severity}</StatusPill>
        {caseItem.sourceRunId && (
          <Link className="font-semibold underline" href={`/loops/${caseItem.sourceLoopId}/runs/${caseItem.sourceRunId}`}>
            Source run {caseItem.sourceRunId}
          </Link>
        )}
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        <SectionCard title="Evidence and routing">
          <div className="space-y-3 text-sm">
            <div><span className="font-semibold">Owner:</span> {caseItem.routing.primaryOwner.role}</div>
            <div><span className="font-semibold">Deadline:</span> {caseItem.routing.escalationDeadline}</div>
            <ul className="list-disc pl-5">
              {caseItem.evidence.map((item) => (
                <li key={item.id}>{item.excerpt}</li>
              ))}
            </ul>
          </div>
        </SectionCard>
        <SectionCard title="Management handoff">
          <pre className="overflow-auto rounded-md bg-ink p-3 text-xs text-white/85">{JSON.stringify(plan, null, 2)}</pre>
        </SectionCard>
      </div>

      {caseItem.status !== "resolved" && (
        <SectionCard title="Resolve case" description="Closes the case and writes outcome + improvement signal to the source run trace.">
          <form action={resolveCaseAction} className="space-y-3">
            <input name="case_id" type="hidden" value={caseItem.id} />
            <label className="block text-sm font-medium">
              Resolution summary
              <textarea
                className="mt-1 min-h-20 w-full rounded-md border border-line bg-white px-3 py-2"
                defaultValue="Incident mitigated."
                name="summary"
                required
              />
            </label>
            <button className="rounded-md bg-ink px-4 py-2 text-sm font-semibold text-white" type="submit">
              Resolve case
            </button>
          </form>
        </SectionCard>
      )}

      {caseItem.outcome && (
        <SectionCard title="Outcome">
          <pre className="overflow-auto rounded-md bg-paper p-3 text-xs">{JSON.stringify(caseItem.outcome, null, 2)}</pre>
        </SectionCard>
      )}
    </>
  );
}
