import { NextRequest, NextResponse } from "next/server";
import { getWorkspace } from "@/lib/loop-engineering-builder/workspace";

export async function GET(request: NextRequest) {
  const configuredSecret = process.env.CRON_SECRET;
  const requestSecret = request.headers.get("authorization")?.replace("Bearer ", "");

  if (configuredSecret && configuredSecret !== requestSecret) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const workspace = await getWorkspace();

  return NextResponse.json({
    organizationId: workspace.organization.id,
    managementReview: workspace.managementReview,
    activeLoops: workspace.loops,
    recentRuns: [workspace.runBundle.run],
    failedRuns: [],
    openHumanReviews: workspace.runBundle.review ? [workspace.runBundle.review] : [],
    openImprovementItems: workspace.improvements,
    metrics: workspace.metrics
  });
}

export async function POST(request: NextRequest) {
  return GET(request);
}
