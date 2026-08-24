import { NextResponse } from "next/server";
import { z } from "zod";
import { hostedMarketplaceError } from "@/lib/app-platform/hosted-marketplace-api";
import { requireHostedMarketplaceMachineContext } from "@/lib/app-platform/hosted-marketplace-machine-api";
import { SupabaseMarketplaceMachineRegistryStore } from "@/lib/db/adapters/supabase-marketplace-registry-store";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const querySchema = z.object({
  appId: z.string().trim().min(3).max(160).optional(),
  query: z.string().trim().max(160).optional(),
  department: z.string().trim().max(120).optional(),
  capability: z.string().trim().max(240).optional(),
  includeDeprecated: z.enum(["true", "false"]).transform((value) => value === "true").default("false"),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  offset: z.coerce.number().int().min(0).max(10_000).default(0)
}).strict();

export async function GET(request: Request) {
  try {
    const context = await requireHostedMarketplaceMachineContext(request);
    if ("response" in context) return context.response;
    const url = new URL(request.url);
    const input = querySchema.parse({
      appId: url.searchParams.get("appId") || undefined,
      query: url.searchParams.get("q") || undefined,
      department: url.searchParams.get("department") || undefined,
      capability: url.searchParams.get("capability") || undefined,
      includeDeprecated: url.searchParams.get("includeDeprecated") || undefined,
      limit: url.searchParams.get("limit") || undefined,
      offset: url.searchParams.get("offset") || undefined
    });
    const store = new SupabaseMarketplaceMachineRegistryStore(
      context.adminClient,
      context.organizationId
    );
    if (input.appId) {
      const app = await store.getVisibleApp(input.appId, {
        includeDeprecated: input.includeDeprecated
      });
      return NextResponse.json({
        schemaVersion: "hosted-marketplace-machine-app/v1",
        app: app ?? null
      }, { headers: { "cache-control": "no-store" } });
    }
    const results = await store.searchVisibleApps(input);
    return NextResponse.json({
      schemaVersion: "hosted-marketplace-machine-search/v1",
      query: input,
      results
    }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    return hostedMarketplaceError(error);
  }
}
