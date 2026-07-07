import Link from "next/link";
import { PageHeader } from "@/components/page-header";
import { SectionCard } from "@/components/section-card";
import { StatusPill } from "@/components/status-pill";
import { loadDepartmentSkillPacks, validateDepartmentSkillPackReferences } from "@/lib/loopgraph-runtime/skill-pack-loader";

export default async function SkillsPage() {
  const packs = await loadDepartmentSkillPacks();
  return (
    <>
      <PageHeader eyebrow="Skill library" title="Department Skills" description="Skill packs define department questions, common goals, loop blueprints, integrations, metrics, human gates, and daily summary fields." />
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {packs.map((pack) => {
          const errors = validateDepartmentSkillPackReferences(pack);
          return (
            <SectionCard key={pack.id} title={pack.name} description={pack.purpose}>
              <div className="flex flex-wrap gap-2 text-sm">
                <StatusPill>{pack.loopBlueprints.length} loops</StatusPill>
                <StatusPill>{pack.defaultMetrics.length} metrics</StatusPill>
                <StatusPill>{errors.length ? `${errors.length} errors` : "valid"}</StatusPill>
              </div>
              <Link className="mt-4 inline-flex rounded-md bg-ink px-3 py-2 text-sm font-semibold text-white" href={`/skills/${pack.id}`}>
                Open skill
              </Link>
            </SectionCard>
          );
        })}
      </div>
    </>
  );
}

