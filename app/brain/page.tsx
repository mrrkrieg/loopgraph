import { BrainPageShell } from "@/components/brain/brain-page-shell";
import { isHostedPreview } from "@/lib/hosted-preview";
import { getSemanticTopology } from "@/lib/loop-engineering-builder/workspace";

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

  return (
    <BrainPageShell
      includeCatalogLoops={includeCatalogLoops}
      previewMode={previewMode}
      topology={topology}
    />
  );
}

function firstParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}
