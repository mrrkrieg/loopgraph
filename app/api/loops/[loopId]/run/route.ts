import { NextResponse } from "next/server";
import { getDemoWorkspace } from "@/lib/loop-engineering-builder/demo-data";

export async function POST() {
  const workspace = getDemoWorkspace();

  return NextResponse.json({
    run: workspace.runBundle.run,
    steps: workspace.runBundle.steps,
    review: workspace.runBundle.review
  });
}
