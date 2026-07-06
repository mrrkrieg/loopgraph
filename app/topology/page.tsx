import { TopologyWorkspace } from "@/components/topology-workspace";
import { getLoopGraph, getWorkspace } from "@/lib/loop-engineering-builder/workspace";
import { getStorageAdapter } from "@/lib/loopgraph-runtime/storage-resolver";
import { buildTopologyRuntimeSummary } from "@/lib/loopgraph-runtime/topology-runtime";

export default async function TopologyPage({
  searchParams
}: {
  searchParams: Promise<{ node?: string }>;
}) {
  const { node } = await searchParams;
  const loopId = node?.startsWith("loop:") ? node.replace("loop:", "") : undefined;
  const [graph, workspace] = await Promise.all([getLoopGraph(loopId), getWorkspace(loopId)]);
  const storage = getStorageAdapter();
  const [runs, cases] = await Promise.all([storage.listRuns(), storage.listCases()]);
  const runtime = buildTopologyRuntimeSummary({
    loops: workspace.loops,
    runs,
    cases
  });
  const isEmptyWorkspace =
    workspace.loops.length <= 1 && workspace.loops[0]?.id === "loop_unconfigured";

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <TopologyWorkspace
        graph={graph}
        isEmptyWorkspace={isEmptyWorkspace}
        loops={workspace.loops}
        runtime={runtime}
      />
    </div>
  );
}
