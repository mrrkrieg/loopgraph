import { PageHeader } from "@/components/page-header";
import { TemplateLibrary } from "@/components/template-library";
import { getWorkspace } from "@/lib/loop-engineering-builder/workspace";

export default async function TemplatesPage() {
  const workspace = await getWorkspace();

  return (
    <>
      <PageHeader
        eyebrow="Built-ins"
        title="Template catalog"
        description="Explore department loops, maturity levels, sources, owners, metrics, and starter specs. Runnable templates include fixtures; stubs create valid LoopSpecs for CLI and canvas exploration."
      />
      <TemplateLibrary departments={workspace.templates} />
    </>
  );
}
