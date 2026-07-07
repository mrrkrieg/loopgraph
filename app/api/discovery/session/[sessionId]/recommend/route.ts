import { NextResponse } from "next/server";
import {
  loadDiscoverySession,
  runDiscoveryPipeline,
  saveDiscoverySession
} from "@/lib/loopgraph-runtime/discovery-engine";

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ sessionId: string }> }
) {
  const { sessionId } = await params;
  const session = await loadDiscoverySession(sessionId);
  if (!session) return NextResponse.json({ error: "Discovery session not found" }, { status: 404 });
  const next = await runDiscoveryPipeline(session);
  await saveDiscoverySession(next);
  return NextResponse.json(next);
}

