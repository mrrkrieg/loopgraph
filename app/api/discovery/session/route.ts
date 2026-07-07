import { NextResponse } from "next/server";
import {
  listDiscoverySessions,
  runDiscoveryPipeline,
  saveDiscoverySession,
  startDiscoverySession
} from "@/lib/loopgraph-runtime/discovery-engine";

export async function GET() {
  return NextResponse.json(await listDiscoverySessions());
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const session = await startDiscoverySession(body);
  const next = body.recommend ? await runDiscoveryPipeline(session) : session;
  if (body.recommend) await saveDiscoverySession(next);
  return NextResponse.json(next, { status: 201 });
}

