import { notFound } from "next/navigation";
import { PageHeader } from "@/components/page-header";
import { SectionCard } from "@/components/section-card";
import { StatusPill } from "@/components/status-pill";
import { loadDepartmentSkillPack } from "@/lib/loopgraph-runtime/skill-pack-loader";

export default async function SkillPage({
  params
}: {
  params: Promise<{ skillId: string }>;
}) {
  const { skillId } = await params;
  const pack = await loadDepartmentSkillPack(skillId);
  if (!pack) notFound();

  return (
    <>
      <PageHeader eyebrow="Department skill" title={pack.name} description={pack.description} />
      <div className="grid gap-5 lg:grid-cols-2">
        <SectionCard title="Purpose" description={pack.purpose}>
          <List values={pack.commonGoals.map((goal) => `${goal.label} ${goal.description}`)} />
        </SectionCard>
        <SectionCard title="Discovery questions">
          <List values={pack.discoveryQuestions.map((question) => question.prompt)} />
        </SectionCard>
        <SectionCard title="Loop blueprints">
          <div className="space-y-3">
            {pack.loopBlueprints.map((blueprint) => (
              <div key={blueprint.id} className="rounded-md border border-line bg-paper px-3 py-2 text-sm">
                <div className="font-medium">{blueprint.name}</div>
                <div className="mt-1 text-ink/60">{blueprint.description}</div>
                <div className="mt-2 flex flex-wrap gap-2">
                  <StatusPill>{blueprint.defaultAutonomyLevel}</StatusPill>
                  <StatusPill>{blueprint.defaultRiskLevel}</StatusPill>
                </div>
              </div>
            ))}
          </div>
        </SectionCard>
        <SectionCard title="Integrations and metrics">
          <List values={[
            ...pack.requiredIntegrations.map((item) => `${item.integrationType}: ${item.reason}`),
            ...pack.defaultMetrics.map((metric) => `${metric.key}: ${metric.source}`)
          ]} />
        </SectionCard>
      </div>
    </>
  );
}

function List({ values }: { values: string[] }) {
  return (
    <ul className="space-y-2 text-sm leading-6 text-ink/70">
      {values.map((value) => <li key={value}>{value}</li>)}
    </ul>
  );
}

