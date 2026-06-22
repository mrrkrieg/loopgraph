import { LoopTabs } from "@/components/loop-tabs";
import { PageHeader } from "@/components/page-header";
import { getDemoWorkspace } from "@/lib/loop-engineering-builder/demo-data";
import { titleCase } from "@/lib/loop-engineering-builder/demo-helpers";

export default async function LoopLayout({
  children,
  params
}: {
  children: React.ReactNode;
  params: Promise<{ loopId: string }>;
}) {
  const { loopId } = await params;
  const workspace = getDemoWorkspace();

  return (
    <>
      <PageHeader
        eyebrow={`${titleCase(workspace.loop.department)} loop`}
        title={workspace.loop.name}
        description={workspace.loop.goal}
      />
      <LoopTabs loopId={loopId} />
      {children}
    </>
  );
}
