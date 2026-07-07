import { PageHeader } from "@/components/page-header";
import { SectionCard } from "@/components/section-card";
import { StatusPill } from "@/components/status-pill";
import { getDiscoverySessionForView } from "../discovery/view-data";

export default async function AccessPlanPage() {
  const session = await getDiscoverySessionForView();
  const grouped = groupBy(session.accessRequirements, (item) => item.integrationType);

  return (
    <>
      <PageHeader eyebrow="Access planning" title="Access Plan" description="Required access is grouped by integration, loop, and blocking level. No external writes are executed here." />
      <div className="space-y-5">
        {Array.from(grouped.entries()).map(([integrationType, requirements]) => (
          <SectionCard key={integrationType} title={integrationType} description={`${requirements.length} requirement(s)`}>
            <div className="overflow-hidden rounded-md border border-line">
              <table className="w-full text-left text-sm">
                <thead className="bg-paper text-xs uppercase tracking-[0.14em] text-ink/50">
                  <tr>
                    <th className="px-4 py-3">Loop</th>
                    <th className="px-4 py-3">Variables</th>
                    <th className="px-4 py-3">Actions</th>
                    <th className="px-4 py-3">Access</th>
                    <th className="px-4 py-3">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line bg-white">
                  {requirements.map((requirement) => {
                    const recommendation = session.recommendedLoops.find((item) => item.id === requirement.loopRecommendationId);
                    return (
                      <tr key={requirement.id}>
                        <td className="px-4 py-3 font-medium">{recommendation?.name ?? requirement.loopId ?? "Unassigned"}</td>
                        <td className="px-4 py-3">{requirement.requiredVariables.join(", ")}</td>
                        <td className="px-4 py-3">{requirement.requiredActions.join(", ") || "read only"}</td>
                        <td className="px-4 py-3"><StatusPill>{requirement.accessLevel}</StatusPill></td>
                        <td className="px-4 py-3"><StatusPill>{requirement.status}</StatusPill></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </SectionCard>
        ))}
      </div>
    </>
  );
}

function groupBy<T>(items: T[], key: (item: T) => string) {
  const grouped = new Map<string, T[]>();
  for (const item of items) {
    const value = key(item);
    grouped.set(value, [...(grouped.get(value) ?? []), item]);
  }
  return grouped;
}

