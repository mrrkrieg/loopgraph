import { NextResponse } from "next/server";
import { getHermesDesignTask } from "loopgraph/runtime";
import { getActiveLoopgraphProjectRoot } from "../../../../../lib/loopgraph-runtime/storage-resolver";

export async function GET(
  _request: Request,
  context: { params: Promise<{ taskId: string }> }
) {
  const { taskId } = await context.params;
  const task = await getHermesDesignTask(taskId, getActiveLoopgraphProjectRoot());
  if (!task) return NextResponse.json({ error: "Hermes design task not found" }, { status: 404 });
  return NextResponse.json({ task });
}
