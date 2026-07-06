import { TopologyWorkspace } from "@/components/topology-workspace";
import { getSemanticTopology } from "@/lib/loop-engineering-builder/workspace";

export default async function TopologyPage({
  searchParams
}: {
  searchParams: Promise<{ node?: string }>;
}) {
  const { node } = await searchParams;
  const loopId = node?.startsWith("loop:") ? node.replace("loop:", "") : undefined;
  const topology = await getSemanticTopology(loopId);

  return <TopologyWorkspace topology={topology} />;
}
