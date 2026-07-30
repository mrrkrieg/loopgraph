import { NextResponse } from "next/server";
import {
  generateDemoDailySummary,
  generateProjectDailySummary,
  saveDailySummary
} from "@/lib/loopgraph-runtime/discovery-engine";
import { isHostedPreview } from "@/lib/hosted-preview";
import { getActiveLoopgraphProjectRoot } from "@/lib/loopgraph-runtime/storage-resolver";

export async function POST() {
  const projectRoot = getActiveLoopgraphProjectRoot();
  const { summary } = isHostedPreview()
    ? await generateDemoDailySummary()
    : await generateProjectDailySummary(projectRoot);
  if (!isHostedPreview()) await saveDailySummary(summary, projectRoot);
  return NextResponse.json(summary, { status: 201 });
}
