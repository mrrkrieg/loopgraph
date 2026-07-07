import { NextResponse } from "next/server";
import { generateDemoDailySummary, loadDailySummary } from "@/lib/loopgraph-runtime/discovery-engine";

export async function GET() {
  const today = new Date().toISOString().slice(0, 10);
  const stored = await loadDailySummary(today);
  return NextResponse.json(stored ?? (await generateDemoDailySummary()).summary);
}

