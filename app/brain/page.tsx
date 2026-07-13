import { BrainPageShell } from "@/components/brain/brain-page-shell";
import { getSemanticTopology } from "@/lib/loop-engineering-builder/workspace";

export default async function BrainPage() {
  const topology = await getSemanticTopology(undefined, {
    includeCatalogLoops: true
  });

  return <BrainPageShell topology={topology} />;
}
