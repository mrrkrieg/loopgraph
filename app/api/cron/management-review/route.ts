import { NextRequest, NextResponse } from "next/server";
import { generateAndPersistManagementRollup } from "@/lib/loopgraph-runtime/management-rollup";
import { getStorageAdapter } from "@/lib/loopgraph-runtime/storage-resolver";

export async function GET(request: NextRequest) {
  const configuredSecret = process.env.CRON_SECRET;
  const requestSecret = request.headers.get("authorization")?.replace("Bearer ", "");

  if (configuredSecret && configuredSecret !== requestSecret) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const storage = getStorageAdapter();
  const rollup = await generateAndPersistManagementRollup(storage);

  return NextResponse.json({
    generatedAt: rollup.generatedAt,
    weekKey: rollup.weekKey,
    openCases: rollup.openCases,
    plans: rollup.plans,
    decisionsNeeded: rollup.decisionsNeeded
  });
}

export async function POST(request: NextRequest) {
  return GET(request);
}
