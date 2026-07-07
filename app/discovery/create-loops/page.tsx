import Link from "next/link";
import { DiscoveryStepNav } from "@/components/discovery-step-nav";
import { PageHeader } from "@/components/page-header";
import { SectionCard } from "@/components/section-card";
import { StatusPill } from "@/components/status-pill";
import { materializeAcceptedRecommendationsAction } from "../actions";
import { getDiscoverySessionForView } from "../view-data";

export default async function CreateLoopsPage() {
  const session = await getDiscoverySessionForView();
  const accepted = session.recommendedLoops.filter((item) => item.status === "accepted" || item.status === "materialized");
  return (
    <>
      <PageHeader
        eyebrow="Discovery"
        title="Create Loops"
        description="Only accepted recommendations materialize into validated LoopSpecs and become visible in topology."
        action={
          <form action={materializeAcceptedRecommendationsAction}>
            <button className="rounded-md bg-ink px-4 py-2 text-sm font-semibold text-white" type="submit">
              Materialize accepted
            </button>
          </form>
        }
      />
      <DiscoveryStepNav activeHref="/discovery/create-loops" />
      <div className="grid gap-5 lg:grid-cols-[0.8fr_1.2fr]">
        <SectionCard title="Materialization status" description={`${accepted.length} accepted recommendation(s)`}>
          <div className="space-y-3 text-sm">
            <div>Created LoopSpecs: {session.createdLoopIds.length}</div>
            <div className="flex flex-wrap gap-2">
              {session.createdLoopIds.map((loopId) => <StatusPill key={loopId}>{loopId}</StatusPill>)}
            </div>
            <Link className="inline-flex rounded-md border border-line px-3 py-2 text-sm font-semibold text-ink/70 hover:border-ink hover:text-ink" href="/topology">
              View topology
            </Link>
          </div>
        </SectionCard>
        <SectionCard title="Accepted recommendations">
          <div className="space-y-3">
            {accepted.length === 0 ? (
              <div className="text-sm text-ink/60">No accepted recommendations yet.</div>
            ) : accepted.map((recommendation) => (
              <div key={recommendation.id} className="rounded-md border border-line bg-paper px-3 py-2 text-sm">
                <div className="font-medium">{recommendation.name}</div>
                <div className="mt-1 text-ink/60">{recommendation.status} · {recommendation.readiness.level} · {recommendation.readiness.blockers.join(", ") || "ready for validation"}</div>
              </div>
            ))}
          </div>
        </SectionCard>
      </div>
    </>
  );
}

