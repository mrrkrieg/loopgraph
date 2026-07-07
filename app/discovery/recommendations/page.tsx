import { DiscoveryStepNav } from "@/components/discovery-step-nav";
import { PageHeader } from "@/components/page-header";
import { SectionCard } from "@/components/section-card";
import { StatusPill } from "@/components/status-pill";
import {
  acceptRecommendationAction,
  rejectRecommendationAction
} from "../actions";
import { getDiscoverySessionForView } from "../view-data";

export default async function RecommendationsPage() {
  const session = await getDiscoverySessionForView();
  return (
    <>
      <PageHeader eyebrow="Discovery" title="Recommendations" description="Recommendations remain drafts until accepted. Rejected recommendations never materialize into topology." />
      <DiscoveryStepNav activeHref="/discovery/recommendations" />
      <div className="grid gap-5 xl:grid-cols-2">
        {session.recommendedLoops.map((recommendation) => {
          const department = session.departmentProfiles.find((item) => item.id === recommendation.departmentId);
          const access = session.accessRequirements.filter((item) => item.loopRecommendationId === recommendation.id);
          const undefinedMetrics = session.undefinedMetrics.filter((item) => item.loopRecommendationId === recommendation.id);
          const human = session.humanRequirements.filter((item) => item.loopRecommendationId === recommendation.id);
          return (
            <SectionCard key={recommendation.id} title={recommendation.name} description={recommendation.whyRecommended}>
              <div className="space-y-4 text-sm">
                <div className="flex flex-wrap gap-2">
                  <StatusPill>{department?.name ?? recommendation.departmentId}</StatusPill>
                  <StatusPill>{recommendation.status}</StatusPill>
                  <StatusPill>{recommendation.readiness.level} · {recommendation.readiness.score}</StatusPill>
                  <StatusPill>{Math.round(recommendation.confidence * 100)}% confidence</StatusPill>
                </div>
                <div>
                  <div className="text-xs uppercase tracking-[0.14em] text-ink/45">Goal</div>
                  <div className="mt-1 font-medium text-ink">{recommendation.goal}</div>
                </div>
                <div className="grid gap-3 md:grid-cols-2">
                  <MiniList label="Blockers" values={recommendation.readiness.blockers} />
                  <MiniList label="Access" values={access.map((item) => `${item.integrationType}: ${item.status}`)} />
                  <MiniList label="Undefined metrics" values={undefinedMetrics.map((item) => item.label)} />
                  <MiniList label="Human input" values={human.map((item) => item.prompt)} />
                </div>
                <details className="rounded-md border border-line bg-paper p-3">
                  <summary className="cursor-pointer font-medium">Loop details</summary>
                  <div className="mt-3 grid gap-3">
                    <MiniList label="Trigger" values={[recommendation.trigger.description]} />
                    <MiniList label="Observed signals" values={recommendation.observes.map((item) => `${item.source}.${item.key}`)} />
                    <MiniList label="Allowed actions" values={recommendation.allowedActions.map((item) => item.label)} />
                    <MiniList label="Forbidden actions" values={recommendation.forbiddenActions} />
                    <MiniList label="Verifier" values={recommendation.verifierDraft.map((item) => item.description)} />
                  </div>
                </details>
                <div className="flex flex-wrap gap-2">
                  <form action={acceptRecommendationAction}>
                    <input type="hidden" name="recommendationId" value={recommendation.id} />
                    <button className="rounded-md bg-ink px-3 py-2 text-sm font-semibold text-white" type="submit">Accept</button>
                  </form>
                  <form action={rejectRecommendationAction}>
                    <input type="hidden" name="recommendationId" value={recommendation.id} />
                    <button className="rounded-md border border-line px-3 py-2 text-sm font-semibold text-ink/70 hover:border-ink hover:text-ink" type="submit">Reject</button>
                  </form>
                  <button className="rounded-md border border-line px-3 py-2 text-sm font-semibold text-ink/70" type="button">Edit</button>
                </div>
              </div>
            </SectionCard>
          );
        })}
      </div>
    </>
  );
}

function MiniList({ label, values }: { label: string; values: string[] }) {
  return (
    <div>
      <div className="text-xs uppercase tracking-[0.14em] text-ink/45">{label}</div>
      <ul className="mt-1 space-y-1 text-ink/65">
        {(values.length ? values : ["None"]).map((value) => <li key={value}>{value}</li>)}
      </ul>
    </div>
  );
}

