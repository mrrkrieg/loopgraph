import Link from "next/link";
import { PageHeader } from "@/components/page-header";
import { SectionCard } from "@/components/section-card";
import { getDemoWorkspace } from "@/lib/loop-engineering-builder/demo-data";
import { createLoopAction } from "./actions";

export default function NewLoopPage() {
  const workspace = getDemoWorkspace();
  const marketing = workspace.templates.find((template) => template.key === "marketing");

  return (
    <>
      <PageHeader
        eyebrow="Wizard"
        title="Create a loop"
        description="V1 starts with a department, a built-in template, a goal, department-specific questions, then a generated spec and implementation plan."
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
            <label className="block text-sm font-medium">
              Department
              <select name="department" className="mt-1 w-full rounded-md border border-line bg-white px-3 py-2" defaultValue="marketing">
                {workspace.templates.map((template) => (
                  <option key={template.key} value={template.key}>{template.name}</option>
                ))}
              </select>
            </label>
            <label className="block text-sm font-medium">
              Loop template
              <select name="template_id" className="mt-1 w-full rounded-md border border-line bg-white px-3 py-2" defaultValue="marketing-campaign_learning">
                {marketing?.commonLoops.map((template) => (
                  <option key={template.id} value={template.id}>{template.name}</option>
                ))}
              </select>
            </label>
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
