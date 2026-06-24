import { NextResponse } from "next/server";
import { getWorkspace } from "@/lib/loop-engineering-builder/workspace";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ loopId: string }> }
) {
  const { loopId } = await params;
  const workspace = await getWorkspace(loopId);

  return NextResponse.json({
    loop: workspace.loop,
    implementationPack: {
      spec: workspace.spec,
      artifacts: workspace.artifacts,
      graphUrl: `/api/loops/${loopId}/graph`,
      runUrl: `/api/loops/${loopId}/run`
    }
  });
}
