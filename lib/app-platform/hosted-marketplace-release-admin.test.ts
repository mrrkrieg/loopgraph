import { describe, expect, it, vi } from "vitest";
import {
  setHostedMarketplaceReleaseStatus
} from "./hosted-marketplace-release-admin";

describe("hosted marketplace release administration", () => {
  it("uses the atomic service-role RPC and returns only bounded release evidence", async () => {
    const rpc = vi.fn(async () => ({
      data: {
        appId: "acme.product.insight",
        version: "1.2.3",
        artifactDigest: `sha256:${"a".repeat(64)}`,
        previousStatus: "active",
        releaseStatus: "revoked",
        changed: true,
        correlationId: "marketplace_release_status_123e4567-e89b-42d3-a456-426614174099"
      },
      error: null
    }));
    const receipt = await setHostedMarketplaceReleaseStatus({
      adminClient: { rpc } as never,
      organizationId: "123e4567-e89b-42d3-a456-426614174000",
      projectKey: "main",
      actorUserId: "123e4567-e89b-42d3-a456-426614174001",
      release: {
        appId: "acme.product.insight",
        version: "1.2.3",
        status: "revoked",
        reason: "Disposable release revocation proof"
      }
    });

    expect(rpc).toHaveBeenCalledWith("admin_set_private_marketplace_release_status", {
      p_organization_id: "123e4567-e89b-42d3-a456-426614174000",
      p_project_key: "main",
      p_actor_user_id: "123e4567-e89b-42d3-a456-426614174001",
      p_app_id: "acme.product.insight",
      p_version: "1.2.3",
      p_release_status: "revoked",
      p_reason: "Disposable release revocation proof"
    });
    expect(receipt).toMatchObject({ changed: true, releaseStatus: "revoked" });
    expect(JSON.stringify(receipt)).not.toContain("Disposable release revocation proof");
  });

  it("rejects invalid tenant and release scope before calling storage", async () => {
    const rpc = vi.fn();
    await expect(setHostedMarketplaceReleaseStatus({
      adminClient: { rpc } as never,
      organizationId: "not-a-tenant",
      projectKey: "main",
      actorUserId: "123e4567-e89b-42d3-a456-426614174001",
      release: {
        appId: "acme.product.insight",
        version: "1.2.3",
        status: "revoked",
        reason: "Disposable release revocation proof"
      }
    })).rejects.toThrow();
    expect(rpc).not.toHaveBeenCalled();
  });
});
