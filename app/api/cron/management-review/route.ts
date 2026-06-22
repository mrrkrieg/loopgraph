import { NextRequest, NextResponse } from "next/server";
import { getDemoWorkspace } from "@/lib/loop-engineering-builder/demo-data";

export async function GET(request: NextRequest) {
  const configuredSecret = process.env.CRON_SECRET;
  const requestSecret = request.headers.get("authorization")?.replace("Bearer ", "");

  if (configuredSecret && configuredSecret !== requestSecret) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const workspace = getDemoWorkspace();

  return NextResponse.json({
    organizationId: workspace.organization.id,
    managementReview: workspace.managementReview,
    activeLoops: [workspace.loop],
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
