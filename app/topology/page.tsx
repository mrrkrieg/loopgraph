import { TopologyWorkspace } from "@/components/topology-workspace";
import { getLoopGraph } from "@/lib/loop-engineering-builder/workspace";

export default async function TopologyPage({
  searchParams
}: {
  searchParams: Promise<{ node?: string }>;
}) {
  const { node } = await searchParams;
  const loopId = node?.startsWith("loop:") ? node.replace("loop:", "") : undefined;
  const graph = await getLoopGraph(loopId);

  return <TopologyWorkspace graph={graph} />;
}
