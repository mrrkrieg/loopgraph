import { NextResponse } from "next/server";
import { getStorageAdapter } from "@/lib/loopgraph-runtime/storage-resolver";

export async function GET(_request: Request, context: { params: Promise<{ loopId: string }> }) {
  const { loopId } = await context.params;
  const storage = getStorageAdapter();
  const runs = await storage.listRuns();
  const filtered = runs.filter((run) => run.loopId === loopId || loopId.startsWith("loop_"));
  return NextResponse.json({ loopId, runs: loopId.startsWith("loop_") ? runs : filtered });
}
