import { NextResponse } from "next/server";
import { buildDemoDiscoverySession, listMetricDefinitions } from "@/lib/loopgraph-runtime/discovery-engine";
import { isHostedPreview } from "@/lib/hosted-preview";

export async function GET() {
  const stored = await listMetricDefinitions();
  const metrics = stored.length > 0 || !isHostedPreview()
    ? stored
    : (await buildDemoDiscoverySession()).metricDefinitions;
  return NextResponse.json(metrics);
}
