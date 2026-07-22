import Link from "next/link";
import { DiscoveryStepNav } from "@/components/discovery-step-nav";
import { PageHeader } from "@/components/page-header";
import { SectionCard } from "@/components/section-card";
import { StatusPill } from "@/components/status-pill";
import {
  getDiscoverySessionForView,
  getDiscoverySessionIdFromSearchParams,
  type DiscoverySearchParams
} from "../view-data";

export default async function DiscoveryAccessPage({ searchParams }: { searchParams?: DiscoverySearchParams }) {
  const sessionId = await getDiscoverySessionIdFromSearchParams(searchParams);
  const session = await getDiscoverySessionForView(sessionId);
  return (
    <>
      <PageHeader
        eyebrow="Discovery"
        title="Access"
        description="Access requirements are planned before execution and can be connected, waived, or handled with manual fallback."
        action={<Link className="rounded-md bg-ink px-4 py-2 text-sm font-semibold text-white" href="/access-plan">Open access plan</Link>}
      />
      <DiscoveryStepNav activeHref="/discovery/access" sessionId={sessionId} />
      <div className="grid gap-4 lg:grid-cols-2">
        {session.accessRequirements.slice(0, 10).map((access) => (
          <SectionCard key={access.id} title={access.integrationType} description={access.reason}>
            <div className="flex flex-wrap gap-2 text-sm">
              <StatusPill>{access.accessLevel}</StatusPill>
              <StatusPill>{access.blockingLevel}</StatusPill>
              <StatusPill>{access.status}</StatusPill>
            </div>
            <div className="mt-3 text-sm text-ink/65">{access.requiredVariables.join(", ")}</div>
          </SectionCard>
        ))}
      </div>
    </>
  );
}
