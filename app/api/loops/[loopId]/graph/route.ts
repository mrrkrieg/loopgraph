import { NextResponse } from "next/server";
import { getLoopGraph } from "@/lib/loop-engineering-builder/workspace";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ loopId: string }> }
) {
  const { loopId } = await params;
  const graph = await getLoopGraph(loopId);

  return NextResponse.json(graph);
}
