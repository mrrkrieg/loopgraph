import { ManagementBrainPage } from "@/components/management/management-brain-page";
import { routingOperationsQueryFromSearchParams } from "loopgraph/runtime";

type ManagementPageProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

export default async function ManagementPage({ searchParams }: ManagementPageProps) {
  const routingQuery = routingOperationsQueryFromSearchParams(await searchParams);
  return <ManagementBrainPage routingQuery={routingQuery} />;
}
