import { NextResponse } from "next/server";
import {
  loadDiscoverySession,
  materializeAcceptedLoops
} from "@/lib/loopgraph-runtime/discovery-engine";

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ sessionId: string }> }
) {
  const { sessionId } = await params;
  const session = await loadDiscoverySession(sessionId);
  if (!session) return NextResponse.json({ error: "Discovery session not found" }, { status: 404 });
  return NextResponse.json(await materializeAcceptedLoops(session));
}

