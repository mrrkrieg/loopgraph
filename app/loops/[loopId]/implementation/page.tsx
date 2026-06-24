import Link from "next/link";
import { CopyBlock } from "@/components/copy-block";
import { SectionCard } from "@/components/section-card";
import { getWorkspace } from "@/lib/loop-engineering-builder/workspace";

export default async function LoopImplementationPage({
  params
}: {
  params: Promise<{ loopId: string }>;
}) {
  const { loopId } = await params;
  const workspace = await getWorkspace(loopId);

  return (
    <SectionCard
      title="Generated implementation artifacts"
      description="Each artifact is copyable and designed to become a concrete implementation task."
    >
      <div className="mb-4 flex flex-wrap gap-3">
        <Link
          className="rounded-md border border-ink px-3 py-2 text-sm font-semibold"
          href={`/api/loops/${loopId}/artifacts`}
        >
          Open implementation pack JSON
        </Link>
        <Link
          className="rounded-md border border-line px-3 py-2 text-sm font-semibold"
          href={`/api/loops/${loopId}/graph`}
        >
          Open graph JSON
        </Link>
      </div>
      <div className="grid gap-4">
        {workspace.artifacts.map((artifact) => (
          <CopyBlock key={artifact.artifactType} title={artifact.title} content={artifact.content} />
        ))}
      </div>
    </SectionCard>
  );
}
