import Link from "next/link";
import { DiscoveryStepNav } from "@/components/discovery-step-nav";
import { MetricCard } from "@/components/metric-card";
import { PageHeader } from "@/components/page-header";
import { SectionCard } from "@/components/section-card";
import { StatusPill } from "@/components/status-pill";
import { discoverySteps, getDiscoverySessionForView } from "./view-data";

export default async function DiscoveryPage() {
  const session = await getDiscoverySessionForView();
  const answeredSteps = [
    session.companyProfile ? "Company" : undefined,
    session.departmentProfiles.length ? "Departments" : undefined,
    session.processInventory.length ? "Processes" : undefined,
    session.departmentGoals.length ? "Goals" : undefined,
    session.accessRequirements.length ? "Access" : undefined,
    session.recommendedLoops.length ? "Recommendations" : undefined,
    session.humanRequirements.length ? "Human Input" : undefined,
    session.metricDefinitions.length ? "Metrics" : undefined
  ].filter(Boolean).length;

  return (
    <>
      <PageHeader
        eyebrow="Business discovery"
        title="Discovery"
        description="Tell Loopgraph about the company, departments, processes, access, metrics, and human gates before creating active loops."
        action={
          <Link className="rounded-md bg-ink px-4 py-2 text-sm font-semibold text-white" href="/discovery/recommendations">
            Review recommendations
          </Link>
        }
      />
      <DiscoveryStepNav activeHref="/discovery" />

      <div className="grid gap-4 md:grid-cols-4">
        <MetricCard label="Progress" value={`${Math.round((answeredSteps / discoverySteps.length) * 100)}%`} note={`${answeredSteps} of ${discoverySteps.length} steps have data`} />
        <MetricCard label="Departments" value={session.departmentProfiles.length} note="Inferred from company context" />
        <MetricCard label="Recommendations" value={session.recommendedLoops.length} note="Draft until accepted" />
        <MetricCard label="Undefined metrics" value={session.undefinedMetrics.length} note="Measurement work before trust" />
      </div>

      <div className="mt-6 grid gap-5 lg:grid-cols-[0.8fr_1.2fr]">
        <SectionCard title="Current answers" description={session.companyProfile?.name ?? "Demo discovery profile"}>
          <dl className="grid gap-3 text-sm">
            <div>
              <dt className="text-xs uppercase tracking-[0.14em] text-ink/45">Company</dt>
              <dd className="mt-1 font-medium text-ink">{session.companyProfile?.description}</dd>
            </div>
            <div>
              <dt className="text-xs uppercase tracking-[0.14em] text-ink/45">Goal</dt>
              <dd className="mt-1 font-medium text-ink">{session.companyProfile?.primaryGoal}</dd>
            </div>
            <div>
              <dt className="text-xs uppercase tracking-[0.14em] text-ink/45">Tools</dt>
              <dd className="mt-2 flex flex-wrap gap-2">
                {session.companyProfile?.tools.map((tool) => <StatusPill key={tool}>{tool}</StatusPill>)}
              </dd>
            </div>
          </dl>
        </SectionCard>

        <SectionCard title="Next suggested question">
          <div className="text-sm leading-6 text-ink/70">
            Who should own each accepted loop, and who approves risky or customer-facing outputs before execution?
          </div>
          <div className="mt-4 flex flex-wrap gap-2">
            {discoverySteps.map((step) => (
              <Link key={step.href} href={step.href} className="rounded-md border border-line bg-white px-3 py-2 text-sm font-medium text-ink/70 hover:border-ink hover:text-ink">
                {step.label}
              </Link>
            ))}
          </div>
        </SectionCard>
      </div>
    </>
  );
}

