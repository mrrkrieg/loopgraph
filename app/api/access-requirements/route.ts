import { NextResponse } from "next/server";
import { buildDemoDiscoverySession, listAccessRequirements } from "@/lib/loopgraph-runtime/discovery-engine";

export async function GET() {
  const stored = await listAccessRequirements();
  const accessRequirements = stored.length > 0 ? stored : (await buildDemoDiscoverySession()).accessRequirements;
  return NextResponse.json(accessRequirements);
}

