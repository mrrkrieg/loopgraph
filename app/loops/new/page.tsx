import Link from "next/link";
import { PageHeader } from "@/components/page-header";
import { SectionCard } from "@/components/section-card";
import { TemplatePicker } from "@/components/template-picker";
import { getWorkspace } from "@/lib/loop-engineering-builder/workspace";
import { getTemplateById } from "@/lib/loop-engineering-builder/templates";
import { createLoopAction } from "./actions";

export default async function NewLoopPage({
  searchParams
}: {
  searchParams?: Promise<{ template?: string }>;
}) {
  const params = await searchParams;
  const workspace = await getWorkspace();
  const templateOptions = workspace.templates.flatMap((department) =>
    department.commonLoops.map((loop) => ({
      id: loop.id,
      name: loop.name,
      department: department.key,
      description: loop.description,
      runtimeLevel: loop.runtimeLevel,
      primaryMetric: loop.primaryMetric,
      dataSources: loop.requiredDataSources ?? department.commonDataSources,
      owners: loop.defaultOwners ?? ["Loop owner"]
    }))
  );
  const selectedTemplate = getTemplateById(params?.template ?? "") ?? getTemplateById("marketing-campaign_learning");
  const defaultDepartment = selectedTemplate?.department ?? "marketing";
  const defaultTemplateId = selectedTemplate?.id ?? "marketing-campaign_learning";

  return (
    <>
      <PageHeader
        eyebrow="Design Studio"
        title="Create a loop"
        description="Optional blueprint builder: department, template, goal, questions, then a generated LoopSpec and implementation plan. Code-first loops live in examples/ and validate via the CLI."
      />
      <div className="grid gap-5 lg:grid-cols-[0.9fr_1.1fr]">
        <SectionCard title="Loop setup">
          <form action={createLoopAction} className="space-y-4">
            <label className="block text-sm font-medium">
              Organization
              <input name="organization_name" className="mt-1 w-full rounded-md border border-line bg-white px-3 py-2" defaultValue={workspace.organization.name} />
            </label>
            <label className="block text-sm font-medium">
              Loop name
              <input name="loop_name" className="mt-1 w-full rounded-md border border-line bg-white px-3 py-2" defaultValue={workspace.loop.name} />
            </label>
            <TemplatePicker
              templates={templateOptions}
              defaultDepartment={defaultDepartment}
              defaultTemplateId={defaultTemplateId}
            />
            <label className="block text-sm font-medium">
              Goal
              <textarea
                name="goal"
                className="mt-1 min-h-28 w-full rounded-md border border-line bg-white px-3 py-2"
                defaultValue={workspace.loop.goal}
              />
            </label>
            <button className="inline-flex rounded-md bg-ink px-4 py-2 text-sm font-semibold text-white" type="submit">
              Create loop and answer questions
            </button>
            <Link className="ml-3 inline-flex rounded-md border border-ink px-4 py-2 text-sm font-semibold" href={`/loops/${workspace.loop.id}/questions`}>
              Open demo loop
            </Link>
          </form>
        </SectionCard>

        <SectionCard title="Generation flow" description="The starter proves the full loop-building journey before external integrations are connected.">
          <div className="grid gap-3 text-sm">
            {[
              "Select department",
              "Select loop template",
              "Define goal",
              "Answer requirements questions",
              "Generate Loop Spec",
              "Generate implementation artifacts",
              "Run loop manually",
              "Review traces, escalations, and improvements"
            ].map((step, index) => (
              <div key={step} className="flex items-center gap-3 rounded-md border border-line bg-paper px-3 py-2">
                <span className="flex h-7 w-7 items-center justify-center rounded-full bg-ink text-xs font-semibold text-white">
                  {index + 1}
                </span>
                <span>{step}</span>
              </div>
            ))}
          </div>
        </SectionCard>
      </div>
    </>
  );
}
