import { LoopTabs } from "@/components/loop-tabs";
import { PageHeader } from "@/components/page-header";
import { titleCase } from "@/lib/loop-engineering-builder/demo-helpers";
import { getWorkspace } from "@/lib/loop-engineering-builder/workspace";

export default async function LoopLayout({
  children,
  params
}: {
  children: React.ReactNode;
  params: Promise<{ loopId: string }>;
}) {
  const { loopId } = await params;
  const workspace = await getWorkspace(loopId);

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
