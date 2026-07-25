import { ManagementBrainPage } from "@/components/management/management-brain-page";
import { isHostedPreview } from "@/lib/hosted-preview";
import { routingOperationsQueryFromSearchParams } from "loopgraph/runtime";

type ManagementPageProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

export default async function ManagementPage({ searchParams }: ManagementPageProps) {
  const routingQuery = routingOperationsQueryFromSearchParams(await searchParams);
  return <ManagementBrainPage previewMode={isHostedPreview()} routingQuery={routingQuery} />;
}
