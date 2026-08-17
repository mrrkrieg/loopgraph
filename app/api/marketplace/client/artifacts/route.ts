import { NextResponse } from "next/server";
import { z } from "zod";
import { artifactDigestSchema } from "loopgraph/core";
import { hostedMarketplaceError, readBoundedMarketplaceJson } from "@/lib/app-platform/hosted-marketplace-api";
import { HostedMarketplaceMachineArtifactService } from "@/lib/app-platform/hosted-marketplace-artifacts";
import { requireHostedMarketplaceMachineContext } from "@/lib/app-platform/hosted-marketplace-machine-api";

export const runtime = "nodejs";

const downloadSchema = z.object({
  appId: z.string().min(3).max(160),
  version: z.string().min(1).max(100),
  artifactDigest: artifactDigestSchema
}).strict();

export async function POST(request: Request) {
  try {
    const context = await requireHostedMarketplaceMachineContext(request);
    if ("response" in context) return context.response;
    const input = downloadSchema.parse(await readBoundedMarketplaceJson(request));
    const artifact = await new HostedMarketplaceMachineArtifactService(
      context.adminClient
    ).downloadVerifiedArtifact({
      organizationId: context.organizationId,
      ...input
    });
    const publicKey = Buffer.from(
      artifact.publisherKey.publicKey,
      "utf8"
    ).toString("base64url");
    if (publicKey.length > 4096) {
      throw new Error("Marketplace publisher key exceeds the delivery header limit");
    }
    const responseBody = new ArrayBuffer(artifact.bytes.byteLength);
    new Uint8Array(responseBody).set(artifact.bytes);
    return new NextResponse(responseBody, {
      status: 200,
      headers: {
        "cache-control": "no-store",
        "content-type": "application/json",
        "content-disposition": `attachment; filename="${safeFilename(input.appId)}-${input.version}.loopgraph-pack.json"`,
        "x-content-type-options": "nosniff",
        "x-loopgraph-artifact-digest": artifact.artifactDigest,
        "x-loopgraph-publisher-id": artifact.publisherKey.publisherId,
        "x-loopgraph-signature-algorithm": artifact.publisherKey.algorithm,
        "x-loopgraph-key-id": artifact.publisherKey.keyId,
        "x-loopgraph-public-key": publicKey
      }
    });
  } catch (error) {
    return hostedMarketplaceError(error);
  }
}

function safeFilename(value: string) {
  return value.replace(/[^A-Za-z0-9._-]/g, "_");
}
