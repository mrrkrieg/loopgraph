import { DiscoveryStepNav } from "@/components/discovery-step-nav";
import { PageHeader } from "@/components/page-header";
import { SectionCard } from "@/components/section-card";
import { StatusPill } from "@/components/status-pill";
import {
  getDiscoverySessionForView,
  getDiscoverySessionIdFromSearchParams,
  type DiscoverySearchParams
} from "../view-data";

export default async function HumanRequirementsPage({ searchParams }: { searchParams?: DiscoverySearchParams }) {
  const sessionId = await getDiscoverySessionIdFromSearchParams(searchParams);
  const session = await getDiscoverySessionForView(sessionId);
  return (
    <>
      <PageHeader eyebrow="Discovery" title="Human Input" description="Human requirements define owners, approval gates, review budgets, and rollout decisions before execution." />
      <DiscoveryStepNav activeHref="/discovery/human-requirements" sessionId={sessionId} />
      <div className="space-y-4">
        {session.humanRequirements.map((requirement) => {
          const recommendation = session.recommendedLoops.find((item) => item.id === requirement.loopRecommendationId);
          return (
            <SectionCard key={requirement.id} title={requirement.prompt} description={recommendation?.name}>
              <div className="flex flex-wrap gap-2 text-sm">
                <StatusPill>{requirement.ownerRole}</StatusPill>
                <StatusPill>{requirement.requirementType}</StatusPill>
                <StatusPill>{requirement.blocking ? "blocking" : "non-blocking"}</StatusPill>
                <StatusPill>{requirement.status}</StatusPill>
              </div>
              <p className="mt-3 text-sm leading-6 text-ink/65">{requirement.reason}</p>
            </SectionCard>
          );
        })}
      </div>
    </>
  );
}
