import { PageHeader } from "@/components/page-header";
import { SectionCard } from "@/components/section-card";
import { FileStorageAdapter } from "@/lib/loopgraph-sdk/storage";
import { consumeEscalationCase } from "@/lib/loopgraph-runtime/management-consumer";
import path from "node:path";

export default async function CasePage({ params }: { params: Promise<{ caseId: string }> }) {
  const { caseId } = await params;
  const storage = new FileStorageAdapter(path.join(process.cwd(), ".loopgraph"));
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
      <PageHeader eyebrow="EscalationCase" title={caseItem.summary} description={`${caseItem.severity} · ${caseItem.status} · fixture/simulated`} />
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
    </>
  );
}
