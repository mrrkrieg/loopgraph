import { NextResponse } from "next/server";
import {
  generateDemoDailySummary,
  generateProjectDailySummary
} from "@/lib/loopgraph-runtime/discovery-engine";
import { isHostedPreview } from "@/lib/hosted-preview";
import { getActiveLoopgraphProjectRoot } from "@/lib/loopgraph-runtime/storage-resolver";

export async function GET() {
  const result = isHostedPreview()
    ? await generateDemoDailySummary()
    : await generateProjectDailySummary(getActiveLoopgraphProjectRoot());
  return NextResponse.json(result.summary);
}
