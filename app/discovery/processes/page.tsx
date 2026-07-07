import { DiscoveryStepNav } from "@/components/discovery-step-nav";
import { PageHeader } from "@/components/page-header";
import { SectionCard } from "@/components/section-card";
import { StatusPill } from "@/components/status-pill";
import { getDiscoverySessionForView } from "../view-data";

export default async function ProcessDiscoveryPage() {
  const session = await getDiscoverySessionForView();
  return (
    <>
      <PageHeader eyebrow="Discovery" title="Processes" description="Recurring processes are the raw material for loop recommendations." />
      <DiscoveryStepNav activeHref="/discovery/processes" />
      <div className="space-y-4">
        {session.processInventory.map((process) => {
          const department = session.departmentProfiles.find((item) => item.id === process.departmentId);
          return (
            <SectionCard key={process.id} title={process.name} description={department?.name}>
              <div className="grid gap-4 text-sm md:grid-cols-4">
                <div><span className="font-medium">Recurrence:</span> {process.recurrence}</div>
                <div><span className="font-medium">Risk:</span> {process.riskLevel}</div>
                <div><span className="font-medium">Mode:</span> {process.candidateAutomationMode}</div>
                <div><span className="font-medium">Volume:</span> {process.volumeEstimate ?? "unknown"}</div>
              </div>
              <p className="mt-3 text-sm leading-6 text-ink/65">{process.description}</p>
              <div className="mt-3 flex flex-wrap gap-2">
                {process.painPoints.map((pain) => <StatusPill key={pain}>{pain}</StatusPill>)}
              </div>
            </SectionCard>
          );
        })}
      </div>
    </>
  );
}

