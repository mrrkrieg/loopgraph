import { NextResponse } from "next/server";
import { z } from "zod";
import { artifactDigestSchema } from "loopgraph/core";
import { hostedMarketplaceError, readBoundedMarketplaceJson, requireHostedMarketplaceContext } from "@/lib/app-platform/hosted-marketplace-api";
import { HostedMarketplaceArtifactService } from "@/lib/app-platform/hosted-marketplace-artifacts";

export const runtime = "nodejs";

const downloadSchema = z.object({
  appId: z.string().min(3).max(160),
  version: z.string().min(1).max(100),
  artifactDigest: artifactDigestSchema
}).strict();

export async function POST(request: Request) {
  try {
    const context = await requireHostedMarketplaceContext("workspace.read");
    const input = downloadSchema.parse(await readBoundedMarketplaceJson(request));
    const service = new HostedMarketplaceArtifactService(
      context.userClient,
      context.adminClient,
      context.supabaseUrl
    );
    const download = await service.createDownloadIntent(input);
    return NextResponse.json({
      schemaVersion: "hosted-marketplace-download/v1",
      download
    }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    return hostedMarketplaceError(error);
  }
}
