import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import type { MarketplaceAppVersion } from "loopgraph/core";
import {
  validateHostedMarketplaceReleaseRevocationStaging,
  type HostedMarketplaceReleaseRevocationConfig,
  type HostedMarketplaceReleaseRevocationCredentials
} from "./validate-hosted-marketplace-release-revocation-staging";

const config: HostedMarketplaceReleaseRevocationConfig = {
  baseUrl: "https://release-revocation.loopgraph.test",
  audience: "https://release-revocation.loopgraph.test/marketplace",
  organizationId: "123e4567-e89b-42d3-a456-426614174000",
  projectKey: "main",
  appId: "acme.product.insight",
  version: "1.2.3",
  artifactDigest: `sha256:${"a".repeat(64)}`
};
const credentials: HostedMarketplaceReleaseRevocationCredentials = {
  aal1AdminCookie: "sb-auth-token=aal1-cookie-value",
  aal2AdminCookie: "sb-auth-token=aal2-cookie-value",
  allowedWorkloadToken: `allowed.${"w".repeat(40)}.token`,
  observabilityToken: `observability.${"o".repeat(40)}.token`
};
const correlationId =
  "marketplace_release_status_123e4567-e89b-42d3-a456-426614174099";
const reason = "Disposable staging marketplace release revocation drill";

describe("hosted marketplace release revocation staging gate", () => {
  it("proves MFA denial, exact revocation, workload denial, cache eviction, and audit evidence", async () => {
    let revoked = false;
    let cached = false;
    const ensureArtifact = vi.fn(async (): Promise<MarketplaceAppVersion> => {
      if (revoked) {
        cached = false;
        throw new Error(`Hosted marketplace app version not found: ${config.appId}@${config.version}`);
      }
      cached = true;
      return marketplaceVersion();
    });
    const hasArtifact = vi.fn(async () => cached);
    const fetcher = vi.fn(async (input: URL | RequestInfo, init?: RequestInit) => {
      const url = new URL(input instanceof URL ? input : String(input));
      const headers = new Headers(init?.headers);
      if (url.pathname === "/api/operations/metrics") {
        expect(headers.get("authorization")).toBe(`Bearer ${credentials.observabilityToken}`);
        return new Response("loopgraph_security_audit_head_sequence 51\n");
      }
      if (url.pathname === "/api/marketplace/releases") {
        expect(init?.method).toBe("PATCH");
        expect(headers.get("origin")).toBe(config.baseUrl);
        expect(JSON.parse(String(init?.body))).toEqual({
          appId: config.appId,
          version: config.version,
          status: "revoked",
          reason
        });
        if (headers.get("cookie") === credentials.aal1AdminCookie) {
          expect(revoked).toBe(false);
          return json({ error: "MFA required", code: "step_up_required" }, 403);
        }
        expect(headers.get("cookie")).toBe(credentials.aal2AdminCookie);
        expect(revoked).toBe(false);
        revoked = true;
        return json({
          schemaVersion: "hosted-marketplace-release-status/v1",
          accepted: true,
          release: {
            appId: config.appId,
            version: config.version,
            artifactDigest: config.artifactDigest,
            previousStatus: "active",
            releaseStatus: "revoked",
            changed: true,
            correlationId
          }
        });
      }
      if (url.pathname === "/api/operations/audit-export") {
        const reasonDigest = createHash("sha256").update(reason, "utf8").digest("hex");
        return json({
          schemaVersion: "loopgraph-security-audit-export/v2",
          organizationId: config.organizationId,
          projectKey: config.projectKey,
          afterSequence: 51,
          throughSequence: 52,
          integrity: { valid: true, headHash: "e".repeat(64) },
          events: [{
            event_type: "marketplace.release.status_changed",
            outcome: "accepted",
            actor_type: "user",
            capability: "marketplace.publish",
            correlation_id: correlationId,
            source: "marketplace-release-admin",
            resource_type: "marketplace_release",
            resource_id: `${config.appId}@${config.version}`,
            metadata: {
              previous_status: "active",
              release_status: "revoked",
              changed: true,
              artifact_digest: config.artifactDigest,
              reason_recorded: true,
              reason_sha256: reasonDigest
            }
          }],
          hasMore: false
        });
      }
      throw new Error(`Unexpected staging request ${url}`);
    });
    let requestSequence = 0;
    const receipt = await validateHostedMarketplaceReleaseRevocationStaging(
      config,
      credentials,
      {
        fetcher: fetcher as typeof fetch,
        ensureArtifact,
        hasArtifact,
        now: () => new Date("2026-08-23T19:00:00.000Z"),
        requestId: () =>
          `123e4567-e89b-42d3-a456-${String(++requestSequence).padStart(12, "0")}`
      }
    );

    expect(receipt).toMatchObject({
      schemaVersion: "hosted-marketplace-release-revocation-staging-validation/v1",
      targetOrigin: config.baseUrl,
      organizationId: config.organizationId,
      projectKey: config.projectKey,
      release: {
        appId: config.appId,
        version: config.version,
        artifactDigest: config.artifactDigest
      },
      revocation: { changed: true, correlationId },
      auditEvidence: {
        afterSequence: 51,
        throughSequence: 52,
        headHash: "e".repeat(64),
        correlationId
      }
    });
    expect(receipt.checks.map((check) => check.name)).toEqual([
      "verified_release_cached",
      "aal1_step_up_denial",
      "denied_request_preserves_release",
      "aal2_exact_release_revocation",
      "workload_revocation_and_cache_eviction",
      "independent_audit_evidence"
    ]);
    expect(ensureArtifact).toHaveBeenCalledTimes(3);
    expect(cached).toBe(false);
    const serialized = JSON.stringify(receipt);
    expect(serialized).not.toContain(credentials.aal1AdminCookie);
    expect(serialized).not.toContain(credentials.aal2AdminCookie);
    expect(serialized).not.toContain(credentials.allowedWorkloadToken);
    expect(serialized).not.toContain(credentials.observabilityToken);
    expect(serialized).not.toContain(reason);
  });

  it("rejects an unsafe origin and invalid release identity before fetching", async () => {
    await expect(validateHostedMarketplaceReleaseRevocationStaging({
      ...config,
      baseUrl: "http://release-revocation.loopgraph.test"
    }, credentials)).rejects.toThrow(/HTTPS origin/i);
    await expect(validateHostedMarketplaceReleaseRevocationStaging({
      ...config,
      version: "latest"
    }, credentials)).rejects.toThrow(/version is invalid/i);
  });
});

function marketplaceVersion(): MarketplaceAppVersion {
  return {
    schemaVersion: "loopgraph-marketplace/v1alpha1",
    appId: config.appId,
    version: config.version,
    digest: config.artifactDigest,
    publishedAt: "2026-08-23T18:00:00.000Z",
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
      sourceId: "hosted.test",
      sourceType: "hosted",
      sourceUri: "hosted://catalog/acme",
      sourceRef: config.version,
      snapshotDigest: config.artifactDigest,
      trustPolicy: "signed",
      synchronizedAt: "2026-08-23T18:00:00.000Z"
    },
    provenanceVerified: true
  };
}

function json(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json" }
  });
}
