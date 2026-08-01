import { BrainPageShell } from "@/components/brain/brain-page-shell";
import { isHostedPreview } from "@/lib/hosted-preview";
import { getSemanticTopology } from "@/lib/loop-engineering-builder/workspace";
import { FileGraphAuthoringStore, getLoopgraphRoot } from "loopgraph/runtime";
import { getActiveLoopgraphProjectRoot } from "@/lib/loopgraph-runtime/storage-resolver";
import { contentHash } from "loopgraph/core";

type BrainPageProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

export default async function BrainPage({ searchParams }: BrainPageProps) {
  const params = await searchParams;
  const catalogParam = firstParam(params?.catalog);
  const catalogExplicitlyShown = catalogParam === "1" || catalogParam === "true";
  const catalogExplicitlyHidden = catalogParam === "0" || catalogParam === "false";
  const hostedPreview = isHostedPreview();
  const previewMode = hostedPreview && !catalogExplicitlyHidden;
  const includeCatalogLoops = catalogExplicitlyShown || previewMode;
  const topology = await getSemanticTopology(undefined, {
    includeCatalogLoops,
    brainLabel: "Hermes Brain",
    hierarchyMode: "hermes_brain"
  });
  const layout = await new FileGraphAuthoringStore(
    getLoopgraphRoot(getActiveLoopgraphProjectRoot())
  ).getLayout();

  return (
    <BrainPageShell
      includeCatalogLoops={includeCatalogLoops}
      initialLayout={layout}
      previewMode={previewMode}
      topology={topology}
      topologyHash={contentHash({ nodes: topology.nodes, edges: topology.edges })}
    />
  );
}

function firstParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}
