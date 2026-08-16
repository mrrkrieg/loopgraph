import { NextResponse } from "next/server";
import { z } from "zod";
import { requireHostedMarketplaceContext, hostedMarketplaceError } from "@/lib/app-platform/hosted-marketplace-api";
import { SupabaseMarketplaceRegistryStore } from "@/lib/db/adapters/supabase-marketplace-registry-store";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const querySchema = z.object({
  query: z.string().trim().max(160).optional(),
  department: z.string().trim().max(120).optional(),
  capability: z.string().trim().max(240).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  offset: z.coerce.number().int().min(0).max(10_000).default(0)
}).strict();

export async function GET(request: Request) {
  try {
    const context = await requireHostedMarketplaceContext("workspace.read");
    const url = new URL(request.url);
    const input = querySchema.parse({
      query: url.searchParams.get("q") || undefined,
      department: url.searchParams.get("department") || undefined,
      capability: url.searchParams.get("capability") || undefined,
      limit: url.searchParams.get("limit") || undefined,
      offset: url.searchParams.get("offset") || undefined
    });
    const store = new SupabaseMarketplaceRegistryStore(
      context.userClient,
      context.organizationId
    );
    const results = await store.searchVisibleApps(input);
    return NextResponse.json({
      schemaVersion: "hosted-marketplace-search/v1",
      query: input,
      results
    }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    return hostedMarketplaceError(error);
  }
}
