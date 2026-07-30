import { NextResponse } from "next/server";
import { buildDemoDiscoverySession, listUndefinedMetrics } from "@/lib/loopgraph-runtime/discovery-engine";
import { isHostedPreview } from "@/lib/hosted-preview";

export async function GET() {
  const stored = await listUndefinedMetrics();
  const metrics = stored.length > 0 || !isHostedPreview()
    ? stored
    : (await buildDemoDiscoverySession()).undefinedMetrics;
  return NextResponse.json(metrics);
}
