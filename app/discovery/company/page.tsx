import { DiscoveryStepNav } from "@/components/discovery-step-nav";
import { PageHeader } from "@/components/page-header";
import { SectionCard } from "@/components/section-card";
import { StatusPill } from "@/components/status-pill";
import { getDiscoverySessionForView } from "../view-data";

export default async function CompanyDiscoveryPage() {
  const session = await getDiscoverySessionForView();
  const company = session.companyProfile;

  return (
    <>
      <PageHeader eyebrow="Discovery" title="Company" description="Company context frames which loops are useful and which actions need human judgment." />
      <DiscoveryStepNav activeHref="/discovery/company" />
      <div className="grid gap-5 lg:grid-cols-2">
        <SectionCard title="Profile">
          <dl className="space-y-4 text-sm">
            <Field label="What does your company do?" value={company?.description} />
            <Field label="Who are your customers?" value={company?.customerType} />
            <Field label="Main goal this quarter" value={company?.primaryGoal} />
            <Field label="North-star metric" value={company?.northStarMetric} />
          </dl>
        </SectionCard>
        <SectionCard title="Operating boundaries">
          <div className="space-y-4 text-sm">
            <Pills label="Departments" values={company?.departments ?? []} />
            <Pills label="Tools and systems" values={company?.tools ?? []} />
            <Pills label="AI never does without approval" values={company?.aiNeverActions ?? []} />
            <Pills label="Leadership judgment" values={company?.leadershipJudgment ?? []} />
          </div>
        </SectionCard>
      </div>
    </>
  );
}

function Field({ label, value }: { label: string; value?: string }) {
  return (
    <div>
      <dt className="text-xs uppercase tracking-[0.14em] text-ink/45">{label}</dt>
      <dd className="mt-1 leading-6 text-ink">{value ?? "Missing"}</dd>
    </div>
  );
}

function Pills({ label, values }: { label: string; values: string[] }) {
  return (
    <div>
      <div className="text-xs uppercase tracking-[0.14em] text-ink/45">{label}</div>
      <div className="mt-2 flex flex-wrap gap-2">
        {values.map((value) => <StatusPill key={value}>{value}</StatusPill>)}
      </div>
    </div>
  );
}

