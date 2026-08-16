import { NextResponse } from "next/server";
import { createSupabaseAdminClient } from "@/lib/db/supabase-admin";
import { runHostedMarketplaceVerificationWorker } from "@/lib/app-platform/hosted-marketplace-verifier";
import { authorizeCronApiRequest } from "@/lib/loopgraph-runtime/worker-api-auth";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const unauthorized = await authorizeCronApiRequest(
    request,
    "schedule.marketplace_verifier"
  );
  if (unauthorized) return unauthorized;
  const adminClient = createSupabaseAdminClient();
  if (!adminClient) {
    return NextResponse.json(
      { error: "Hosted marketplace verification is not configured" },
      { status: 503, headers: { "cache-control": "no-store" } }
    );
  }
  try {
    const result = await runHostedMarketplaceVerificationWorker({
      adminClient,
      workerId: "hosted-marketplace-cron",
      limit: 5,
      leaseSeconds: 300
    });
    return NextResponse.json(result, {
      status: 202,
      headers: { "cache-control": "no-store" }
    });
  } catch {
    return NextResponse.json(
      { error: "Hosted marketplace verification is temporarily unavailable" },
      { status: 503, headers: { "cache-control": "no-store" } }
    );
  }
}

export async function POST(request: Request) {
  return GET(request);
}
