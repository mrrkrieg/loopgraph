import { NextResponse } from "next/server";
import { getDiscoverySession } from "loopgraph/runtime";
import {
  getActiveLoopgraphProjectRoot,
  getDiscoveryDesignStore
} from "../../../../../lib/loopgraph-runtime/storage-resolver";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ sessionId: string }> }
) {
  const { sessionId } = await params;
  const session = await getDiscoverySession(
    sessionId,
    getActiveLoopgraphProjectRoot(),
    getDiscoveryDesignStore()
  );
  return session
    ? NextResponse.json(session)
    : NextResponse.json({ error: "Discovery session not found" }, { status: 404 });
}
