import { NextResponse } from "next/server";
import { z } from "zod";
import { artifactDigestSchema } from "loopgraph/core";
import { requireHostedStepUp } from "@/lib/auth/hosted-access";
import { hostedMarketplaceError, readBoundedMarketplaceJson, requireHostedMarketplaceContext } from "@/lib/app-platform/hosted-marketplace-api";
import { HostedMarketplaceArtifactService, HOSTED_MARKETPLACE_ARTIFACT_MEDIA_TYPE } from "@/lib/app-platform/hosted-marketplace-artifacts";

export const runtime = "nodejs";

const uploadSchema = z.object({
  appId: z.string().min(3).max(160),
  version: z.string().min(1).max(100),
  artifactDigest: artifactDigestSchema,
  sizeBytes: z.number().int().positive(),
  mediaType: z.literal(HOSTED_MARKETPLACE_ARTIFACT_MEDIA_TYPE)
}).strict();

export async function POST(request: Request) {
  try {
    const context = await requireHostedMarketplaceContext("marketplace.publish");
    await requireHostedStepUp();
    const input = uploadSchema.parse(await readBoundedMarketplaceJson(request));
    const service = new HostedMarketplaceArtifactService(
      context.userClient,
      context.adminClient,
      context.supabaseUrl
    );
    const upload = await service.createUploadIntent({
      organizationId: context.organizationId,
      ...input
    });
    return NextResponse.json({
      schemaVersion: "hosted-marketplace-upload/v1",
      upload
    }, { status: 201, headers: { "cache-control": "no-store" } });
  } catch (error) {
    return hostedMarketplaceError(error);
  }
}
