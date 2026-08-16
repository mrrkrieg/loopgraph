import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { artifactDigestSchema } from "loopgraph/core";

export const HOSTED_MARKETPLACE_ARTIFACT_BUCKET =
  "loopgraph-marketplace-artifacts";
export const HOSTED_MARKETPLACE_ARTIFACT_MEDIA_TYPE = "application/json";
export const MAX_HOSTED_MARKETPLACE_ARCHIVE_BYTES = 100 * 1024 * 1024;
export const HOSTED_MARKETPLACE_DOWNLOAD_TTL_SECONDS = 60;

const identitySchema = z.object({
  organizationId: z.string().uuid(),
  appId: z.string()
    .min(3)
    .max(160)
    .regex(/^[a-z0-9](?:[a-z0-9._-]{1,158}[a-z0-9])?$/),
  version: z.string()
    .min(1)
    .max(100)
    .regex(/^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(-[0-9A-Za-z-]+(\.[0-9A-Za-z-]+)*)?(\+[0-9A-Za-z-]+(\.[0-9A-Za-z-]+)*)?$/),
  artifactDigest: artifactDigestSchema
}).strict();

const visibleReleaseSchema = z.object({
  app_id: z.string(),
  version: z.string(),
  artifact_digest: artifactDigestSchema,
  release_status: z.enum(["active", "deprecated"]),
  verified_at: z.string().min(1)
}).strict();

const deliveryReleaseSchema = visibleReleaseSchema.extend({
  artifact_object_key: z.string().min(1).max(512)
}).strict();

export type HostedMarketplaceArtifactIdentity = z.infer<typeof identitySchema>;

export type HostedMarketplaceUploadIntent = {
  signedUrl: string;
  expiresUnderProviderPolicy: true;
  mediaType: typeof HOSTED_MARKETPLACE_ARTIFACT_MEDIA_TYPE;
  maxSizeBytes: number;
};

export type HostedMarketplaceDownloadIntent = {
  signedUrl: string;
  expiresAt: string;
  filename: string;
  artifactDigest: string;
};

/**
 * Capability-scoped artifact delivery. The user-bound client proves catalog
 * visibility; the service client knows the opaque object key and signs the
 * storage operation. The API never returns the key as an independently usable
 * catalog field; Supabase may include its path inside the expiring capability
 * URL itself.
 */
export class HostedMarketplaceArtifactService {
  constructor(
    private readonly userClient: SupabaseClient,
    private readonly adminClient: SupabaseClient,
    private readonly supabaseUrl: string
  ) {
    assertSupabaseOrigin(supabaseUrl);
  }

  async createUploadIntent(input: HostedMarketplaceArtifactIdentity & {
    sizeBytes: number;
    mediaType: string;
  }): Promise<HostedMarketplaceUploadIntent> {
    const identity = identitySchema.parse({
      organizationId: input.organizationId,
      appId: input.appId,
      version: input.version,
      artifactDigest: input.artifactDigest
    });
    if (
      !Number.isSafeInteger(input.sizeBytes) ||
      input.sizeBytes < 1 ||
      input.sizeBytes > MAX_HOSTED_MARKETPLACE_ARCHIVE_BYTES
    ) {
      throw new HostedMarketplaceArtifactError(
        "invalid_archive_size",
        `LoopPack archives must be between 1 and ${MAX_HOSTED_MARKETPLACE_ARCHIVE_BYTES} bytes.`
      );
    }
    if (input.mediaType !== HOSTED_MARKETPLACE_ARTIFACT_MEDIA_TYPE) {
      throw new HostedMarketplaceArtifactError(
        "invalid_archive_media_type",
        "Hosted LoopPack archives must use application/json."
      );
    }
    const objectKey = hostedMarketplaceArtifactObjectKey(identity);
    const { data, error } = await this.adminClient.storage
      .from(HOSTED_MARKETPLACE_ARTIFACT_BUCKET)
      .createSignedUploadUrl(objectKey, { upsert: false });
    if (error || !data?.signedUrl) {
      throw new HostedMarketplaceArtifactError(
        "artifact_upload_unavailable",
        "A private artifact upload URL could not be created."
      );
    }
    return {
      signedUrl: assertSignedStorageUrl(data.signedUrl, this.supabaseUrl),
      expiresUnderProviderPolicy: true,
      mediaType: HOSTED_MARKETPLACE_ARTIFACT_MEDIA_TYPE,
      maxSizeBytes: MAX_HOSTED_MARKETPLACE_ARCHIVE_BYTES
    };
  }

  async assertUploadedArtifact(input: HostedMarketplaceArtifactIdentity & {
    sizeBytes: number;
  }): Promise<void> {
    const identity = identitySchema.parse({
      organizationId: input.organizationId,
      appId: input.appId,
      version: input.version,
      artifactDigest: input.artifactDigest
    });
    const objectKey = hostedMarketplaceArtifactObjectKey(identity);
    const { prefix, filename } = splitObjectKey(objectKey);
    const { data, error } = await this.adminClient.storage
      .from(HOSTED_MARKETPLACE_ARTIFACT_BUCKET)
      .list(prefix, { limit: 2, search: filename });
    if (error) {
      throw new HostedMarketplaceArtifactError(
        "artifact_storage_unavailable",
        "The private artifact store could not be checked."
      );
    }
    const object = (data ?? []).find((item) => item.name === filename);
    const metadata = asRecord(object?.metadata);
    const storedSize = Number(metadata?.size);
    const mediaType = typeof metadata?.mimetype === "string"
      ? metadata.mimetype.split(";", 1)[0]
      : undefined;
    if (!object || storedSize !== input.sizeBytes) {
      throw new HostedMarketplaceArtifactError(
        "artifact_upload_incomplete",
        "The uploaded archive is missing or its size does not match the publication request."
      );
    }
    if (mediaType && mediaType !== HOSTED_MARKETPLACE_ARTIFACT_MEDIA_TYPE) {
      throw new HostedMarketplaceArtifactError(
        "artifact_upload_incomplete",
        "The uploaded archive has an unexpected media type."
      );
    }
  }

  async createDownloadIntent(
    input: Omit<HostedMarketplaceArtifactIdentity, "organizationId">
  ): Promise<HostedMarketplaceDownloadIntent> {
    const identity = identitySchema.omit({ organizationId: true }).parse(input);
    const visible = await this.visibleRelease(identity);
    const delivery = await this.deliveryRelease(identity);
    if (
      visible.app_id !== delivery.app_id ||
      visible.version !== delivery.version ||
      visible.artifact_digest !== delivery.artifact_digest ||
      visible.release_status !== delivery.release_status ||
      !delivery.artifact_object_key.endsWith(
        `/${identity.artifactDigest.slice("sha256:".length)}.loopgraph-pack.json`
      )
    ) {
      throw new HostedMarketplaceArtifactError(
        "release_identity_mismatch",
        "The visible release does not match its private delivery record."
      );
    }
    const { data, error } = await this.adminClient.storage
      .from(HOSTED_MARKETPLACE_ARTIFACT_BUCKET)
      .createSignedUrl(
        delivery.artifact_object_key,
        HOSTED_MARKETPLACE_DOWNLOAD_TTL_SECONDS,
        { download: hostedMarketplaceArchiveFilename(identity) }
      );
    if (error || !data?.signedUrl) {
      throw new HostedMarketplaceArtifactError(
        "artifact_download_unavailable",
        "A private artifact download URL could not be created."
      );
    }
    return {
      signedUrl: assertSignedStorageUrl(data.signedUrl, this.supabaseUrl),
      expiresAt: new Date(
        Date.now() + HOSTED_MARKETPLACE_DOWNLOAD_TTL_SECONDS * 1000
      ).toISOString(),
      filename: hostedMarketplaceArchiveFilename(identity),
      artifactDigest: identity.artifactDigest
    };
  }

  private async visibleRelease(input: {
    appId: string;
    version: string;
    artifactDigest: string;
  }) {
    const { data, error } = await this.userClient
      .from("marketplace_app_versions")
      .select("app_id, version, artifact_digest, release_status, verified_at")
      .eq("app_id", input.appId)
      .eq("version", input.version)
      .eq("artifact_digest", input.artifactDigest)
      .in("release_status", ["active", "deprecated"])
      .maybeSingle();
    if (error || !data) {
      throw new HostedMarketplaceArtifactError(
        "release_not_visible",
        "The requested marketplace release is not available to this organization."
      );
    }
    return visibleReleaseSchema.parse(data);
  }

  private async deliveryRelease(input: {
    appId: string;
    version: string;
    artifactDigest: string;
  }) {
    const { data, error } = await this.adminClient
      .from("marketplace_app_versions")
      .select(
        "app_id, version, artifact_digest, release_status, verified_at, artifact_object_key"
      )
      .eq("app_id", input.appId)
      .eq("version", input.version)
      .eq("artifact_digest", input.artifactDigest)
      .in("release_status", ["active", "deprecated"])
      .maybeSingle();
    if (error || !data) {
      throw new HostedMarketplaceArtifactError(
        "artifact_download_unavailable",
        "The release delivery record is unavailable."
      );
    }
    return deliveryReleaseSchema.parse(data);
  }
}

export class HostedMarketplaceArtifactError extends Error {
  constructor(
    readonly code:
      | "invalid_archive_size"
      | "invalid_archive_media_type"
      | "artifact_upload_unavailable"
      | "artifact_storage_unavailable"
      | "artifact_upload_incomplete"
      | "release_not_visible"
      | "release_identity_mismatch"
      | "artifact_download_unavailable",
    message: string
  ) {
    super(message);
    this.name = "HostedMarketplaceArtifactError";
  }
}

export function hostedMarketplaceArtifactObjectKey(
  input: HostedMarketplaceArtifactIdentity
): string {
  const identity = identitySchema.parse(input);
  return [
    identity.organizationId,
    "marketplace",
    identity.appId,
    identity.version,
    `${identity.artifactDigest.slice("sha256:".length)}.loopgraph-pack.json`
  ].join("/");
}

function hostedMarketplaceArchiveFilename(input: {
  appId: string;
  version: string;
}) {
  return `${input.appId}-${input.version}.loopgraph-pack.json`;
}

function splitObjectKey(value: string) {
  const separator = value.lastIndexOf("/");
  return { prefix: value.slice(0, separator), filename: value.slice(separator + 1) };
}

function assertSupabaseOrigin(value: string) {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("Hosted marketplace delivery requires a valid Supabase URL");
  }
  if (url.protocol !== "https:" || url.username || url.password) {
    throw new Error("Hosted marketplace delivery requires a trusted HTTPS Supabase URL");
  }
}

function assertSignedStorageUrl(value: string, supabaseUrl: string) {
  const signed = new URL(value, supabaseUrl);
  const expected = new URL(supabaseUrl);
  if (
    signed.protocol !== "https:" ||
    signed.origin !== expected.origin ||
    !signed.pathname.startsWith("/storage/v1/object/") ||
    !signed.pathname.includes(`/${HOSTED_MARKETPLACE_ARTIFACT_BUCKET}/`) ||
    signed.username ||
    signed.password
  ) {
    throw new HostedMarketplaceArtifactError(
      "artifact_download_unavailable",
      "The artifact store returned an untrusted signed URL."
    );
  }
  return signed.toString();
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}
