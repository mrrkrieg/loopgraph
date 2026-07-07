import { NextResponse } from "next/server";
import { buildDemoDiscoverySession, listUndefinedMetrics } from "@/lib/loopgraph-runtime/discovery-engine";

export async function GET() {
  const stored = await listUndefinedMetrics();
  const metrics = stored.length > 0 ? stored : (await buildDemoDiscoverySession()).undefinedMetrics;
  return NextResponse.json(metrics);
}

