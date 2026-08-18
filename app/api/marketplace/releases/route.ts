import { NextResponse } from "next/server";
import { z } from "zod";
import {
  artifactDigestSchema,
  loopPackArtifactSchema,
  marketplaceAppSchema,
  marketplaceAppVersionSchema
} from "loopgraph/core";
import { requireHostedStepUp } from "@/lib/auth/hosted-access";
import { hostedMarketplaceError, readBoundedMarketplaceJson, requireHostedMarketplaceContext } from "@/lib/app-platform/hosted-marketplace-api";
import { HostedMarketplaceArtifactService, hostedMarketplaceArtifactObjectKey } from "@/lib/app-platform/hosted-marketplace-artifacts";
import { SupabaseMarketplaceRegistryStore } from "@/lib/db/adapters/supabase-marketplace-registry-store";

export const runtime = "nodejs";

const publicationSchema = z.object({
  app: marketplaceAppSchema,
  version: marketplaceAppVersionSchema,
  artifact: loopPackArtifactSchema,
  snapshotDigest: artifactDigestSchema,
  archiveSizeBytes: z.number().int().positive()
}).strict();

export async function POST(request: Request) {
  try {
    const context = await requireHostedMarketplaceContext("marketplace.publish");
    await requireHostedStepUp();
    const input = publicationSchema.parse(await readBoundedMarketplaceJson(request));
    const identity = {
      organizationId: context.organizationId,
      appId: input.app.id,
      version: input.version.version,
      artifactDigest: input.artifact.digest
    };
    const artifacts = new HostedMarketplaceArtifactService(
      context.userClient,
      context.adminClient,
      context.supabaseUrl
    );
    await artifacts.assertUploadedArtifact({
      ...identity,
      sizeBytes: input.archiveSizeBytes
    });
    const store = new SupabaseMarketplaceRegistryStore(
      context.userClient,
      context.organizationId
    );
    const release = await store.publishPrivateVersion({
      app: input.app,
      version: input.version,
      artifact: input.artifact,
      snapshotDigest: input.snapshotDigest,
      artifactObjectKey: hostedMarketplaceArtifactObjectKey(identity)
    });
    return NextResponse.json({
      schemaVersion: "hosted-marketplace-publication/v1",
      release
    }, { status: release.created ? 201 : 200, headers: { "cache-control": "no-store" } });
  } catch (error) {
    return hostedMarketplaceError(error);
  }
}
