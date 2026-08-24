import { NextResponse } from "next/server";
import { z } from "zod";
import { requireHostedMarketplaceContext, hostedMarketplaceError } from "@/lib/app-platform/hosted-marketplace-api";
import { SupabaseMarketplaceRegistryStore } from "@/lib/db/adapters/supabase-marketplace-registry-store";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const appIdSchema = z.string()
  .min(3)
  .max(160)
  .regex(/^[a-z0-9](?:[a-z0-9._-]{1,158}[a-z0-9])?$/);

export async function GET(
  _request: Request,
  context: { params: Promise<{ appId: string }> }
) {
  try {
    const hosted = await requireHostedMarketplaceContext("workspace.read");
    const appId = appIdSchema.parse((await context.params).appId);
    const store = new SupabaseMarketplaceRegistryStore(
      hosted.userClient,
      hosted.organizationId
    );
    const app = await store.getVisibleApp(appId);
    if (!app) {
      return NextResponse.json(
        { error: "Marketplace app not found", code: "app_not_found" },
        { status: 404, headers: { "cache-control": "no-store" } }
      );
    }
    return NextResponse.json({
      schemaVersion: "hosted-marketplace-app/v1",
      app
    }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    return hostedMarketplaceError(error);
  }
}
