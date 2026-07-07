import { DiscoveryStepNav } from "@/components/discovery-step-nav";
import { PageHeader } from "@/components/page-header";
import { SectionCard } from "@/components/section-card";
import { StatusPill } from "@/components/status-pill";
import { getDiscoverySessionForView } from "../view-data";

export default async function DepartmentDiscoveryPage() {
  const session = await getDiscoverySessionForView();
  return (
    <>
      <PageHeader eyebrow="Discovery" title="Departments" description="Department profiles come from the company context and skill packs." />
      <DiscoveryStepNav activeHref="/discovery/departments" />
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {session.departmentProfiles.map((department) => (
          <SectionCard key={department.id} title={department.name} description={department.goal}>
            <div className="space-y-3 text-sm">
              <div><span className="font-medium">Owner:</span> {department.ownerRole}</div>
              <div className="flex flex-wrap gap-2">
                {department.tools.map((tool) => <StatusPill key={tool}>{tool}</StatusPill>)}
              </div>
              <div className="text-ink/60">{department.painPoints.length ? department.painPoints.join(", ") : "No department-specific pain captured yet."}</div>
            </div>
          </SectionCard>
        ))}
      </div>
    </>
  );
}

