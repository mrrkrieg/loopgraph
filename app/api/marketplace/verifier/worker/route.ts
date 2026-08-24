import { NextResponse } from "next/server";
import { z } from "zod";
import { runHostedMarketplaceVerificationWorker } from "@/lib/app-platform/hosted-marketplace-verifier";
import { createSupabaseAdminClient } from "@/lib/db/supabase-admin";
import { authorizeWorkerApiRequest } from "@/lib/loopgraph-runtime/worker-api-auth";

export const runtime = "nodejs";

const requestSchema = z.object({
  workerId: z.string()
    .min(3)
    .max(128)
    .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{2,127}$/)
    .default("hosted-marketplace-worker"),
  limit: z.number().int().min(1).max(25).default(5),
  leaseSeconds: z.number().int().min(30).max(1800).default(300)
}).strict();

export async function POST(request: Request) {
  const unauthorized = await authorizeWorkerApiRequest(request, "marketplace.verify");
  if (unauthorized) return unauthorized;
  const adminClient = createSupabaseAdminClient();
  if (!adminClient) {
    return NextResponse.json(
      { error: "Hosted marketplace verification is not configured" },
      { status: 503, headers: { "cache-control": "no-store" } }
    );
  }
  try {
    const raw = await request.text();
    const input = requestSchema.parse(raw.trim() ? JSON.parse(raw) : {});
    const result = await runHostedMarketplaceVerificationWorker({
      adminClient,
      ...input
    });
    return NextResponse.json(result, {
      status: 202,
      headers: { "cache-control": "no-store" }
    });
  } catch (error) {
    if (error instanceof z.ZodError || error instanceof SyntaxError) {
      return NextResponse.json(
        { error: "Marketplace verifier request is invalid" },
        { status: 400, headers: { "cache-control": "no-store" } }
      );
    }
    return NextResponse.json(
      { error: "Hosted marketplace verification is temporarily unavailable" },
      { status: 503, headers: { "cache-control": "no-store" } }
    );
  }
}
