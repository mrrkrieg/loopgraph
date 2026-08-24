import React from "react";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { InstallWizard } from "@/components/apps/install-wizard";
import { PageHeader } from "@/components/page-header";
import { getAppInstallPlanViewData } from "@/lib/app-platform/read-model";
import { appOnboardingProgressForView } from "@/lib/app-platform/install-wizard";

export const dynamic = "force-dynamic";

export default async function AppInstallPlanPage({
  params,
  searchParams
}: {
  params: Promise<{ appId: string }>;
  searchParams?: Promise<{ preset?: string }>;
}) {
  const [{ appId }, query] = await Promise.all([params, searchParams]);
  const decodedAppId = decodeURIComponent(appId);
  let data;
  try {
    data = await getAppInstallPlanViewData(decodedAppId, query?.preset);
  } catch (error) {
    if (error instanceof Error && /not found|unknown preset/i.test(error.message)) notFound();
    throw error;
  }
  if (data.journey.installationId) redirect(`/apps/${encodeURIComponent(data.journey.installationId)}`);
  if (!data.plan || !data.impact || !data.mappingPlan) {
    return (
      <>
        <div className="mb-4 text-sm text-ink/50"><Link href={`/marketplace/${encodeURIComponent(data.detail.app.id)}`} className="hover:text-ink">{data.detail.app.name}</Link> / choose stack</div>
        <PageHeader
          eyebrow="Step 1 · choose stack"
          title={`How should ${data.detail.app.name} connect?`}
          description="Choose the provider stack your company already uses. This creates only a read-only preview; no connection, App asset, permission, or provider write is changed."
        />
        <section className="grid gap-4 md:grid-cols-2" id="choose-stack">
          {data.detail.manifest.presets.map((preset) => (
            <Link className="rounded-xl border border-line bg-white p-5 shadow-sm transition hover:border-ink hover:shadow" href={`/marketplace/${encodeURIComponent(data.detail.app.id)}/install?preset=${encodeURIComponent(preset.id)}`} key={preset.id}>
              <div className="text-xs font-semibold uppercase tracking-[0.14em] text-signal">Provider stack</div>
              <h2 className="mt-2 text-lg font-semibold">{preset.name}</h2>
              <p className="mt-2 text-sm leading-6 text-ink/60">{preset.description}</p>
              <div className="mt-4 text-sm font-semibold">Preview this stack →</div>
            </Link>
          ))}
        </section>
        <p className="mt-5 text-xs leading-5 text-ink/50">Hermes and this page use the same App onboarding service. If Hermes has already saved a stack, opening this App-only URL resumes it automatically instead of showing this choice again.</p>
      </>
    );
  }
  const plan = data.plan;
  const impact = data.impact;
  const mappingPlan = data.mappingPlan;
  const preset = data.detail.manifest.presets.find((candidate) => candidate.id === plan.presetId);
  if (!preset) notFound();

  return (
    <>
      <div className="mb-4 text-sm text-ink/50"><Link href={`/marketplace/${encodeURIComponent(data.detail.app.id)}`} className="hover:text-ink">{data.detail.app.name}</Link> / install plan</div>
      <PageHeader
        eyebrow="Read-only installation plan"
        title={`Connect and configure ${data.detail.app.name}`}
        description="This exact, content-bound plan shows what Loopgraph would add, reuse, request, and test. Reviewing it does not install the app or enable provider writes."
      />

      <InstallWizard
        app={{
          id: data.detail.app.id,
          name: data.detail.app.name,
          summary: data.detail.app.summary,
          department: data.detail.app.department,
          preset,
          modules: data.detail.manifest.modules,
          questions: data.detail.setupQuestions
        }}
        initialPlan={plan}
        initialImpact={impact}
        initialJourney={appOnboardingProgressForView(data.journey)}
        initialQuestionKeys={data.journey.questions.map((question) => question.key)}
        mappingPlan={mappingPlan}
      />
    </>
  );
}
