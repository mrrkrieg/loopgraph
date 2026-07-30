import { NextResponse } from "next/server";
import {
  getGraphChangeSet,
  listGraphChangeSets
} from "loopgraph/runtime";
import {
  getActiveLoopgraphProjectRoot,
  getLoopOpportunityStore
} from "../../../../lib/loopgraph-runtime/storage-resolver";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const changeSetId = url.searchParams.get("changeSetId") ?? undefined;
  const opportunityId = url.searchParams.get("opportunityId") ?? undefined;
  const projectRoot = getActiveLoopgraphProjectRoot();
  const store = getLoopOpportunityStore({ projectRoot });
  if (changeSetId) {
    const changeSet = await getGraphChangeSet(changeSetId, projectRoot, store);
    if (!changeSet) return NextResponse.json({ error: "Graph change set not found" }, { status: 404 });
    return NextResponse.json({ changeSet });
  }
  return NextResponse.json({
    changeSets: await listGraphChangeSets(projectRoot, opportunityId, store)
  });
}
