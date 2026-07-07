import { NextResponse } from "next/server";
import {
  generateAccessPlan,
  loadDiscoverySession,
  saveDiscoverySession
} from "@/lib/loopgraph-runtime/discovery-engine";

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ sessionId: string }> }
) {
  const { sessionId } = await params;
  const session = await loadDiscoverySession(sessionId);
  if (!session) return NextResponse.json({ error: "Discovery session not found" }, { status: 404 });
  const accessRequirements = await generateAccessPlan(session.recommendedLoops, process.cwd(), session.processInventory);
  const next = { ...session, accessRequirements, status: "access_mapping" as const, updatedAt: new Date().toISOString() };
  await saveDiscoverySession(next);
  return NextResponse.json(next);
}

