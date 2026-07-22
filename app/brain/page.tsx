import { BrainPageShell } from "@/components/brain/brain-page-shell";
import { getSemanticTopology } from "@/lib/loop-engineering-builder/workspace";

type BrainPageProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

export default async function BrainPage({ searchParams }: BrainPageProps) {
  const params = await searchParams;
  const includeCatalogLoops = params?.catalog === "1" || params?.catalog === "true";
  const topology = await getSemanticTopology(undefined, {
    includeCatalogLoops,
    brainLabel: "Hermes Brain",
    hierarchyMode: "hermes_brain"
  });

  return <BrainPageShell includeCatalogLoops={includeCatalogLoops} topology={topology} />;
}
