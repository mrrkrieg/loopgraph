import { NextResponse } from "next/server";
import { generateDemoDailySummary, saveDailySummary } from "@/lib/loopgraph-runtime/discovery-engine";

export async function POST() {
  const { summary } = await generateDemoDailySummary();
  await saveDailySummary(summary);
  return NextResponse.json(summary, { status: 201 });
}

