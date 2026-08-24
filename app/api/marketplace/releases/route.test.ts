import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireContext: vi.fn(),
  requireStepUp: vi.fn(),
  setStatus: vi.fn()
}));

vi.mock("@/lib/app-platform/hosted-marketplace-api", async (loadOriginal) => {
  const original = await loadOriginal<typeof import("@/lib/app-platform/hosted-marketplace-api")>();
  return { ...original, requireHostedMarketplaceContext: mocks.requireContext };
});
vi.mock("@/lib/auth/hosted-access", async (loadOriginal) => {
  const original = await loadOriginal<typeof import("@/lib/auth/hosted-access")>();
  return { ...original, requireHostedStepUp: mocks.requireStepUp };
});
vi.mock("@/lib/app-platform/hosted-marketplace-release-admin", async (loadOriginal) => {
  const original = await loadOriginal<
    typeof import("@/lib/app-platform/hosted-marketplace-release-admin")
  >();
  return { ...original, setHostedMarketplaceReleaseStatus: mocks.setStatus };
});

import { PATCH } from "./route";

describe("hosted marketplace release status API", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("LOOPGRAPH_HOSTED_PROJECT_KEY", "main");
    mocks.requireContext.mockResolvedValue({
      organizationId: "123e4567-e89b-42d3-a456-426614174000",
      identity: { userId: "123e4567-e89b-42d3-a456-426614174001" },
      adminClient: { rpc: vi.fn() }
    });
    mocks.setStatus.mockResolvedValue({
      appId: "acme.product.insight",
      version: "1.2.3",
      artifactDigest: `sha256:${"a".repeat(64)}`,
      previousStatus: "active",
      releaseStatus: "revoked",
      changed: true,
      correlationId: "marketplace_release_status_123e4567-e89b-42d3-a456-426614174099"
    });
  });

  it("requires publish authority plus MFA and returns the atomic receipt", async () => {
    const response = await PATCH(request({
      appId: "acme.product.insight",
      version: "1.2.3",
      status: "revoked",
      reason: "Disposable release revocation proof"
    }));

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(mocks.requireContext).toHaveBeenCalledWith("marketplace.publish");
    expect(mocks.requireStepUp).toHaveBeenCalledOnce();
    expect(mocks.setStatus).toHaveBeenCalledWith(expect.objectContaining({
      organizationId: "123e4567-e89b-42d3-a456-426614174000",
      projectKey: "main",
      actorUserId: "123e4567-e89b-42d3-a456-426614174001",
      release: {
        appId: "acme.product.insight",
        version: "1.2.3",
        status: "revoked",
        reason: "Disposable release revocation proof"
      }
    }));
    expect(await response.json()).toMatchObject({
      schemaVersion: "hosted-marketplace-release-status/v1",
      accepted: true,
      release: { changed: true, releaseStatus: "revoked" }
    });
  });

  it("rejects malformed lifecycle requests before storage", async () => {
    const response = await PATCH(request({
      appId: "acme.product.insight",
      version: "latest",
      status: "active",
      reason: "no"
    }));
    expect(response.status).toBe(400);
    expect(mocks.setStatus).not.toHaveBeenCalled();
  });
});

function request(body: unknown) {
  return new Request("https://loopgraph.test/api/marketplace/releases", {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body)
  });
}
