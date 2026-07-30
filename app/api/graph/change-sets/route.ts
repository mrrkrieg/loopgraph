import { NextResponse } from "next/server";
import {
  getGraphChangeSet,
  listGraphChangeSets
} from "loopgraph/runtime";
import { getActiveLoopgraphProjectRoot } from "../../../../lib/loopgraph-runtime/storage-resolver";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const changeSetId = url.searchParams.get("changeSetId") ?? undefined;
  const opportunityId = url.searchParams.get("opportunityId") ?? undefined;
  const projectRoot = getActiveLoopgraphProjectRoot();
  if (changeSetId) {
    const changeSet = await getGraphChangeSet(changeSetId, projectRoot);
    if (!changeSet) return NextResponse.json({ error: "Graph change set not found" }, { status: 404 });
    return NextResponse.json({ changeSet });
  }
  return NextResponse.json({
    changeSets: await listGraphChangeSets(projectRoot, opportunityId)
  });
}
