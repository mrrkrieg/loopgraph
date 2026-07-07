import { NextResponse } from "next/server";
import { answerDiscoveryQuestion } from "@/lib/loopgraph-runtime/discovery-engine";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ sessionId: string }> }
) {
  const { sessionId } = await params;
  const body = await request.json();
  const session = await answerDiscoveryQuestion(sessionId, body);
  return NextResponse.json(session);
}

