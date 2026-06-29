import { NextResponse } from "next/server";
import { getStorageAdapter } from "@/lib/loopgraph-runtime/storage-resolver";

export async function GET(_request: Request, context: { params: Promise<{ runId: string }> }) {
  const { runId } = await context.params;
  const trace = await getStorageAdapter().getRun(runId);
  if (!trace) {
    return NextResponse.json({ error: "Trace not found" }, { status: 404 });
  }
  return NextResponse.json(trace);
}
