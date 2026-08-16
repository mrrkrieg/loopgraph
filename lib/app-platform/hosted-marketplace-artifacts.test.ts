import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";
import {
  HostedMarketplaceArtifactService,
  HOSTED_MARKETPLACE_ARTIFACT_BUCKET,
  hostedMarketplaceArtifactObjectKey
} from "./hosted-marketplace-artifacts";

const organizationId = "123e4567-e89b-12d3-a456-426614174000";
const identity = {
  organizationId,
  appId: "acme.product.feedback",
  version: "1.2.3",
  artifactDigest: `sha256:${"a".repeat(64)}`
};
const objectKey =
  `${organizationId}/marketplace/acme.product.feedback/1.2.3/` +
  `${"a".repeat(64)}.loopgraph-pack.json`;

describe("hosted marketplace artifact delivery", () => {
  it("mints a non-upsert upload in the tenant namespace without exposing its key", async () => {
    const createSignedUploadUrl = vi.fn().mockResolvedValue({
      data: {
        signedUrl:
          "https://example.supabase.co/storage/v1/object/upload/sign/loopgraph-marketplace-artifacts/redacted?token=secret"
      },
      error: null
    });
    const storageFrom = vi.fn(() => ({ createSignedUploadUrl }));
    const service = new HostedMarketplaceArtifactService(
      {} as SupabaseClient,
      { storage: { from: storageFrom } } as unknown as SupabaseClient,
      "https://example.supabase.co"
    );

    const upload = await service.createUploadIntent({
      ...identity,
      sizeBytes: 1024,
      mediaType: "application/json"
    });

    expect(storageFrom).toHaveBeenCalledWith(HOSTED_MARKETPLACE_ARTIFACT_BUCKET);
    expect(createSignedUploadUrl).toHaveBeenCalledWith(objectKey, { upsert: false });
    expect(upload).toMatchObject({ mediaType: "application/json" });
    expect(upload).not.toHaveProperty("objectKey");
  });

  it("authorizes a download with the user session before looking up its service key", async () => {
    const visible = {
      app_id: identity.appId,
      version: identity.version,
      artifact_digest: identity.artifactDigest,
      release_status: "active",
      verified_at: "2026-08-16T12:00:00.000Z"
    };
    const userQuery = queryReturning(visible);
    const adminQuery = queryReturning({ ...visible, artifact_object_key: objectKey });
    const createSignedUrl = vi.fn().mockResolvedValue({
      data: {
        signedUrl:
          "https://example.supabase.co/storage/v1/object/sign/loopgraph-marketplace-artifacts/redacted?token=secret"
      },
      error: null
    });
    const service = new HostedMarketplaceArtifactService(
      { from: vi.fn(() => userQuery) } as unknown as SupabaseClient,
      {
        from: vi.fn(() => adminQuery),
        storage: { from: vi.fn(() => ({ createSignedUrl })) }
      } as unknown as SupabaseClient,
      "https://example.supabase.co"
    );

    const download = await service.createDownloadIntent({
      appId: identity.appId,
      version: identity.version,
      artifactDigest: identity.artifactDigest
    });

    expect(userQuery.maybeSingle).toHaveBeenCalledTimes(1);
    expect(adminQuery.maybeSingle).toHaveBeenCalledTimes(1);
    expect(createSignedUrl).toHaveBeenCalledWith(
      objectKey,
      60,
      { download: "acme.product.feedback-1.2.3.loopgraph-pack.json" }
    );
    expect(download).not.toHaveProperty("objectKey");
    expect(JSON.stringify(download)).not.toContain(objectKey);
  });

  it("refuses cross-origin signed storage URLs", async () => {
    const service = new HostedMarketplaceArtifactService(
      {} as SupabaseClient,
      {
        storage: {
          from: vi.fn(() => ({
            createSignedUploadUrl: vi.fn().mockResolvedValue({
              data: { signedUrl: "https://attacker.example/upload?token=secret" },
              error: null
            })
          }))
        }
      } as unknown as SupabaseClient,
      "https://example.supabase.co"
    );

    await expect(service.createUploadIntent({
      ...identity,
      sizeBytes: 1024,
      mediaType: "application/json"
    })).rejects.toThrow("untrusted signed URL");
  });

  it("derives an immutable digest-addressed object key", () => {
    expect(hostedMarketplaceArtifactObjectKey(identity)).toBe(objectKey);
  });
});

function queryReturning(data: unknown) {
  const query = {
    select: vi.fn(),
    eq: vi.fn(),
    in: vi.fn(),
    maybeSingle: vi.fn().mockResolvedValue({ data, error: null })
  };
  query.select.mockReturnValue(query);
  query.eq.mockReturnValue(query);
  query.in.mockReturnValue(query);
  return query;
}
