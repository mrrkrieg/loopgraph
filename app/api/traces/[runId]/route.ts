import { NextResponse } from "next/server";
import { getPersistedTrace } from "@/lib/loop-engineering-builder/runtime-bridge";

export async function GET(_request: Request, context: { params: Promise<{ runId: string }> }) {
  const { runId } = await context.params;
  const trace = await getPersistedTrace(runId);
  if (!trace) {
    return NextResponse.json({ error: "Trace not found" }, { status: 404 });
  }
  return NextResponse.json(trace);
}
