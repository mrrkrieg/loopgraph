import { NextResponse } from "next/server";
import {
  dismissLoopOpportunity,
  getLoopOpportunity
} from "loopgraph/runtime";
import { getActiveLoopgraphProjectRoot } from "../../../../lib/loopgraph-runtime/storage-resolver";

export async function GET(
  _request: Request,
  context: { params: Promise<{ opportunityId: string }> }
) {
  const { opportunityId } = await context.params;
  const opportunity = await getLoopOpportunity(opportunityId, getActiveLoopgraphProjectRoot());
  if (!opportunity) {
    return NextResponse.json({ error: "Loop opportunity not found" }, { status: 404 });
  }
  return NextResponse.json({ opportunity });
}

export async function POST(
  request: Request,
  context: { params: Promise<{ opportunityId: string }> }
) {
  try {
    const body = await request.json();
    const { opportunityId } = await context.params;
    if (
      !body ||
      typeof body !== "object" ||
      Array.isArray(body) ||
      (body as Record<string, unknown>).action !== "dismiss" ||
      typeof (body as Record<string, unknown>).reason !== "string" ||
      String((body as Record<string, unknown>).reason).trim().length === 0
    ) {
      return NextResponse.json({
        error: "action=dismiss and a reason are required"
      }, { status: 400 });
    }
    const opportunity = await dismissLoopOpportunity({
      projectRoot: getActiveLoopgraphProjectRoot(),
      opportunityId,
      reason: String((body as Record<string, unknown>).reason).trim()
    });
    return NextResponse.json({ opportunity });
  } catch (error) {
    return NextResponse.json({
      error: error instanceof Error ? error.message : "Failed to update loop opportunity"
    }, { status: 400 });
  }
}
