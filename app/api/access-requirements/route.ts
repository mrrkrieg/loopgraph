import { NextResponse } from "next/server";
import { buildDemoDiscoverySession, listAccessRequirements } from "@/lib/loopgraph-runtime/discovery-engine";
import { isHostedPreview } from "@/lib/hosted-preview";

export async function GET() {
  const stored = await listAccessRequirements();
  const accessRequirements = stored.length > 0 || !isHostedPreview()
    ? stored
    : (await buildDemoDiscoverySession()).accessRequirements;
  return NextResponse.json(accessRequirements);
}
