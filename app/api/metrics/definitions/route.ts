import { NextResponse } from "next/server";
import { buildDemoDiscoverySession, listMetricDefinitions } from "@/lib/loopgraph-runtime/discovery-engine";

export async function GET() {
  const stored = await listMetricDefinitions();
  const metrics = stored.length > 0 ? stored : (await buildDemoDiscoverySession()).metricDefinitions;
  return NextResponse.json(metrics);
}

