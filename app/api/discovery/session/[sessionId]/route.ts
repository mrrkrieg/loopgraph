import { NextResponse } from "next/server";
import { getDiscoverySession } from "loopgraph/runtime";
import { getActiveLoopgraphProjectRoot } from "../../../../../lib/loopgraph-runtime/storage-resolver";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ sessionId: string }> }
) {
  const { sessionId } = await params;
  const session = await getDiscoverySession(sessionId, getActiveLoopgraphProjectRoot());
  return session
    ? NextResponse.json(session)
    : NextResponse.json({ error: "Discovery session not found" }, { status: 404 });
}
