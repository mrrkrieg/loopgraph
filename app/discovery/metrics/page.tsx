import Link from "next/link";
import { DiscoveryStepNav } from "@/components/discovery-step-nav";
import { PageHeader } from "@/components/page-header";
import { SectionCard } from "@/components/section-card";
import { StatusPill } from "@/components/status-pill";
import { getDiscoverySessionForView } from "../view-data";

export default async function DiscoveryMetricsPage() {
  const session = await getDiscoverySessionForView();
  return (
    <>
      <PageHeader
        eyebrow="Discovery"
        title="Metrics"
        description="Metrics are planned per recommendation, and undefined metrics stay visible until the source, formula, baseline, or owner is resolved."
        action={<Link className="rounded-md bg-ink px-4 py-2 text-sm font-semibold text-white" href="/daily/undefined-metrics">Undefined metrics</Link>}
      />
      <DiscoveryStepNav activeHref="/discovery/metrics" />
      <div className="grid gap-4 xl:grid-cols-2">
        {session.metricDefinitions.map((metric) => {
          const undefinedMetric = session.undefinedMetrics.find((item) => item.metricKey === metric.key && item.loopRecommendationId === metric.loopRecommendationId);
          const recommendation = session.recommendedLoops.find((item) => item.id === metric.loopRecommendationId);
          return (
            <SectionCard key={metric.id} title={metric.label} description={recommendation?.name}>
              <div className="flex flex-wrap gap-2 text-sm">
                <StatusPill>{metric.source}</StatusPill>
                <StatusPill>{metric.type}</StatusPill>
                <StatusPill>{metric.baselineRequired ? "baseline required" : "no baseline required"}</StatusPill>
                {undefinedMetric ? <StatusPill>undefined: {undefinedMetric.reason}</StatusPill> : null}
              </div>
              <p className="mt-3 text-sm leading-6 text-ink/65">{metric.description}</p>
            </SectionCard>
          );
        })}
      </div>
    </>
  );
}

