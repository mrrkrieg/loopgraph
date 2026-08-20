import { describe, expect, it, vi } from "vitest";
import type { MarketplaceAppVersion } from "../packages/loopgraph/src/core";
import {
  validateHostedMarketplaceStaging,
  type HostedMarketplaceStagingConfig
} from "./validate-hosted-marketplace-staging";

const config: HostedMarketplaceStagingConfig = {
  baseUrl: "https://staging.loopgraph.test",
  audience: "https://staging.loopgraph.test/marketplace",
  organizationId: "123e4567-e89b-42d3-a456-426614174000",
  projectKey: "main",
  appId: "acme.product.insight",
  version: "1.2.3",
  artifactDigest: `sha256:${"a".repeat(64)}`
};

const tokens = {
  allowed: `allowed.${"a".repeat(40)}.token`,
  foreignTenant: `foreign.${"b".repeat(40)}.token`,
  revoked: `revoked.${"c".repeat(40)}.token`,
  observability: `observability.${"d".repeat(40)}.token`
};

describe("hosted marketplace staging gate", () => {
  it("proves exact delivery, isolation, revocation, replay, and audit evidence", async () => {
    const seenRequestIds = new Set<string>();
    let replayRequestId = "";
    let auditPage = 0;
    const fetcher = vi.fn(async (input: URL | RequestInfo, init?: RequestInit) => {
      const url = new URL(input instanceof URL ? input : String(input));
      const headers = new Headers(init?.headers);
      const authorization = headers.get("authorization");
      if (!authorization) return json({ error: "Unauthorized" }, 401);
      if (authorization === `Bearer ${tokens.foreignTenant}`) {
        return json({ error: "Workload identity is not authorized" }, 401);
      }
      if (authorization === `Bearer ${tokens.revoked}`) {
        return json({ error: "workload_capability_not_granted" }, 403);
      }
      if (url.pathname === "/api/operations/metrics") {
        expect(authorization).toBe(`Bearer ${tokens.observability}`);
        return new Response("loopgraph_security_audit_head_sequence 41\n");
      }
      if (url.pathname === "/api/operations/audit-export") {
        expect(authorization).toBe(`Bearer ${tokens.observability}`);
        auditPage += 1;
        if (auditPage === 1) {
          expect(url.searchParams.get("after")).toBe("41");
          expect(url.searchParams.has("through")).toBe(false);
          return json({
            throughSequence: 43,
            integrity: { valid: true, headHash: "e".repeat(64) },
            events: [],
            hasMore: true,
            nextCursor: 42
          });
        }
        expect(url.searchParams.get("after")).toBe("42");
        expect(url.searchParams.get("through")).toBe("43");
        return json({
          throughSequence: 43,
          integrity: { valid: true, headHash: "e".repeat(64) },
          events: [{
            event_type: "machine.request.authorized",
            capability: "marketplace.consume",
            request_id: replayRequestId
          }]
        });
      }
      expect(authorization).toBe(`Bearer ${tokens.allowed}`);
      const requestId = headers.get("x-loopgraph-request-id") ?? "";
      if (requestId.startsWith("marketplace_gate_")) {
        replayRequestId = requestId;
        if (seenRequestIds.has(requestId)) return json({ error: "replayed_request" }, 409);
        seenRequestIds.add(requestId);
      }
      return json({
        schemaVersion: "hosted-marketplace-machine-app/v1",
        app: marketplaceApp()
      });
    });
    const verifyArtifact = vi.fn(async (): Promise<MarketplaceAppVersion> =>
      marketplaceVersion()
    );

    const receipt = await validateHostedMarketplaceStaging(config, tokens, {
      fetcher: fetcher as typeof fetch,
      requestId: () => "123e4567-e89b-42d3-a456-426614174999",
      now: () => new Date("2026-08-17T00:00:00.000Z"),
      verifyArtifact
    });

    expect(receipt).toMatchObject({
      schemaVersion: "hosted-marketplace-staging-validation/v2",
      targetOrigin: "https://staging.loopgraph.test",
      organizationId: config.organizationId,
      projectKey: config.projectKey,
      app: { id: config.appId, version: config.version, artifactDigest: config.artifactDigest },
      auditEvidence: {
        afterSequence: 41,
        throughSequence: 43,
        headHash: "e".repeat(64)
      }
    });
    expect(receipt.checks.map((check) => check.name)).toEqual([
      "unauthenticated_denial",
      "tenant_catalog_visibility",
      "artifact_signature_and_cache",
      "cross_tenant_denial",
      "durable_revocation",
      "replay_denial",
      "independent_audit_evidence"
    ]);
    expect(verifyArtifact).toHaveBeenCalledWith(expect.objectContaining({
      appId: config.appId,
      version: config.version,
      artifactDigest: config.artifactDigest
    }));
    expect(JSON.stringify(receipt)).not.toContain(tokens.allowed);
    expect(JSON.stringify(receipt)).not.toContain(tokens.observability);
  });

  it("rejects insecure staging origins before sending a token", async () => {
    await expect(validateHostedMarketplaceStaging(
      { ...config, baseUrl: "http://staging.loopgraph.test" },
      tokens
    )).rejects.toThrow(/must use HTTPS/i);
  });
});

function marketplaceApp() {
  return {
    schemaVersion: "loopgraph-marketplace/v1alpha1",
    id: config.appId,
    name: "Product Insight",
    summary: "Find product problems",
    description: "Find product problems from verified company evidence.",
    department: "product",
    publisher: { id: "acme", name: "Acme", verified: true },
    visibility: "private",
    tags: ["product"],
    latestVersion: config.version,
    versions: [marketplaceVersion()],
    searchTerms: ["product", "insight"]
  };
}

function marketplaceVersion(): MarketplaceAppVersion {
  return {
    schemaVersion: "loopgraph-marketplace/v1alpha1",
    appId: config.appId,
    version: config.version,
    digest: config.artifactDigest,
    publishedAt: "2026-08-17T00:00:00.000Z",
    compatibility: {
      loopgraph: "*",
      hermes: "*",
      platforms: ["darwin", "linux", "win32"]
    },
    dependencies: [],
    permissions: [],
    requiredCapabilities: [],
    optionalCapabilities: [],
    includedLoopCount: 1,
    preview: {
      synthetic: true,
      sampleData: true,
      historicalReplay: "installed_read_only"
    },
    presets: [],
    modules: [],
    maturity: "tested",
    deprecated: false,
    artifactUri: "hosted://marketplace/acme.product.insight/1.2.3",
    source: {
      sourceId: "hosted.acme",
      sourceType: "hosted",
      sourceUri: "hosted://catalog/acme",
      sourceRef: config.version,
      snapshotDigest: config.artifactDigest,
      trustPolicy: "signed",
      synchronizedAt: "2026-08-17T00:00:00.000Z"
    },
    provenanceVerified: true
  };
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" }
  });
}
