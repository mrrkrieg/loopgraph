import Link from "next/link";
import { notFound } from "next/navigation";
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
    const presetId = query?.preset ?? "";
    if (!presetId) notFound();
    data = await getAppInstallPlanViewData(decodedAppId, presetId);
  } catch (error) {
    if (error instanceof Error && /not found|unknown preset/i.test(error.message)) notFound();
    throw error;
  }
  const preset = data.detail.manifest.presets.find((candidate) => candidate.id === data.plan.presetId);
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
        initialPlan={data.plan}
        initialImpact={data.impact}
        initialJourney={appOnboardingProgressForView(data.journey)}
        initialQuestionKeys={data.journey.questions.map((question) => question.key)}
        mappingPlan={data.mappingPlan}
      />
    </>
  );
}
