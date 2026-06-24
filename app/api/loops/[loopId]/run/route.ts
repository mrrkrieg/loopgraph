import { NextResponse } from "next/server";
import { startLoopRun } from "@/lib/loop-engineering-builder/workspace";

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ loopId: string }> }
) {
  const { loopId } = await params;
  const runBundle = await startLoopRun(loopId);

  return NextResponse.json({
    run: runBundle.run,
    steps: runBundle.steps,
    review: runBundle.review
  });
}
