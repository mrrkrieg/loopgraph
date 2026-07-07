import { NextResponse } from "next/server";
import { loadDiscoverySession } from "@/lib/loopgraph-runtime/discovery-engine";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ sessionId: string }> }
) {
  const { sessionId } = await params;
  const session = await loadDiscoverySession(sessionId);
  return session
    ? NextResponse.json(session)
    : NextResponse.json({ error: "Discovery session not found" }, { status: 404 });
}

