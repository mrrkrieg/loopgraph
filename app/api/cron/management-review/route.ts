import { NextRequest, NextResponse } from "next/server";
import { getStorageAdapter } from "@/lib/loopgraph-runtime/storage-resolver";
import { consumeEscalationCase } from "@/lib/loopgraph-runtime/management-consumer";

export async function GET(request: NextRequest) {
  const configuredSecret = process.env.CRON_SECRET;
  const requestSecret = request.headers.get("authorization")?.replace("Bearer ", "");

  if (configuredSecret && configuredSecret !== requestSecret) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const storage = getStorageAdapter();
  const cases = await storage.listCases();
  const plans = [];

  for (const item of cases.filter((entry) => entry.status === "open" || entry.status === "under_review")) {
    const caseItem = await storage.getEscalationCase(item.id);
    if (caseItem) {
      plans.push({
        caseId: caseItem.id,
        summary: caseItem.summary,
        severity: caseItem.severity,
        plan: consumeEscalationCase(caseItem)
      });
    }
  }

  return NextResponse.json({
    generatedAt: new Date().toISOString(),
    openCases: cases.filter((item) => item.status === "open").length,
    plans,
    decisionsNeeded: plans.filter((plan) => plan.plan.leadershipDecisionRequired).map((plan) => plan.summary)
  });
}

export async function POST(request: NextRequest) {
  return GET(request);
}
