import { DiscoveryStepNav } from "@/components/discovery-step-nav";
import { PageHeader } from "@/components/page-header";
import { SectionCard } from "@/components/section-card";
import { getDiscoverySessionForView } from "../view-data";

export default async function GoalDiscoveryPage() {
  const session = await getDiscoverySessionForView();
  return (
    <>
      <PageHeader eyebrow="Discovery" title="Goals" description="Goals keep recommendations tied to measurable business outcomes." />
      <DiscoveryStepNav activeHref="/discovery/goals" />
      <div className="grid gap-4 lg:grid-cols-2">
        {session.departmentGoals.map((goal) => {
          const department = session.departmentProfiles.find((item) => item.id === goal.departmentId);
          const mapped = session.processGoalMappings.filter((mapping) => mapping.goalId === goal.id);
          return (
            <SectionCard key={goal.id} title={department?.name ?? goal.departmentId} description={goal.label}>
              <div className="space-y-2 text-sm">
                {mapped.map((mapping) => {
                  const process = session.processInventory.find((item) => item.id === mapping.processId);
                  return <div key={mapping.id} className="rounded-md border border-line bg-paper px-3 py-2">{process?.name} · {Math.round(mapping.confidence * 100)}% match</div>;
                })}
              </div>
            </SectionCard>
          );
        })}
      </div>
    </>
  );
}

