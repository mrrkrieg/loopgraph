import { CopyBlock } from "@/components/copy-block";
import { SectionCard } from "@/components/section-card";
import { getDemoWorkspace } from "@/lib/loop-engineering-builder/demo-data";

export default function LoopImplementationPage() {
  const workspace = getDemoWorkspace();

  return (
    <SectionCard
      title="Generated implementation artifacts"
      description="Each artifact is copyable and designed to become a concrete implementation task."
    >
      <div className="grid gap-4">
        {workspace.artifacts.map((artifact) => (
          <CopyBlock key={artifact.artifactType} title={artifact.title} content={artifact.content} />
        ))}
      </div>
    </SectionCard>
  );
}
