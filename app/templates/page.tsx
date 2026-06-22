import { PageHeader } from "@/components/page-header";
import { SectionCard } from "@/components/section-card";
import { getDemoWorkspace } from "@/lib/loop-engineering-builder/demo-data";

export default function TemplatesPage() {
  const workspace = getDemoWorkspace();

  return (
    <>
      <PageHeader
        eyebrow="Built-ins"
        title="Templates"
        description="Department templates define common loops, questions, data sources, tools, metrics, verification defaults, escalation defaults, failure modes, and management review questions."
      />
      <div className="grid gap-5">
        {workspace.templates.map((template) => (
          <SectionCard key={template.key} title={template.name} description={template.description}>
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              {template.commonLoops.map((loop) => (
                <div key={loop.id} className="rounded-md border border-line bg-paper p-3">
                  <div className="font-semibold">{loop.name}</div>
                  <div className="mt-1 text-sm leading-6 text-ink/60">{loop.description}</div>
                </div>
              ))}
            </div>
          </SectionCard>
        ))}
      </div>
    </>
  );
}
