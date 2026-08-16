import path from "node:path";
import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";
import {
  canonicalAppDigest,
  loopPackArtifactSchema,
  marketplaceAppSchema,
  marketplaceAppVersionSchema,
  type LoopPackArtifact,
  type MarketplaceApp,
  type MarketplaceAppVersion
} from "loopgraph/core";
import { loadLoopPackDirectory } from "loopgraph/runtime";
import {
  hostedMarketplaceArtifactAttestation,
  SupabaseMarketplaceRegistryStore,
  SupabaseMarketplaceReleaseVerifier
} from "./supabase-marketplace-registry-store";

const organizationId = "123e4567-e89b-12d3-a456-426614174000";
const granteeOrganizationId = "123e4567-e89b-12d3-a456-426614174001";
const snapshotDigest = `sha256:${"b".repeat(64)}`;
const receiptDigest = `sha256:${"c".repeat(64)}`;

describe("Supabase hosted marketplace registry", () => {
  it("rejects unsafe tenant and artifact namespaces before an RPC", async () => {
    const client = { rpc: vi.fn(), from: vi.fn() } as unknown as SupabaseClient;
    expect(() => new SupabaseMarketplaceRegistryStore(client, "../other"))
      .toThrow("organization ID");
    const fixture = await marketplaceFixture();
    const store = new SupabaseMarketplaceRegistryStore(client, organizationId);
    await expect(store.publishPrivateVersion({
      ...fixture,
      snapshotDigest,
      artifactObjectKey: `${organizationId}/../other/archive.tgz`
    })).rejects.toThrow("tenant marketplace namespace");
    expect(client.rpc).not.toHaveBeenCalled();
  });

  it("rejects reserved and self-verified publisher identities before an RPC", async () => {
    const client = { rpc: vi.fn(), from: vi.fn() } as unknown as SupabaseClient;
    const fixture = await marketplaceFixture();
    const reservedVersion = marketplaceAppVersionSchema.parse({
      ...fixture.version,
      appId: "loopgraph.private-test"
    });
    const reservedApp = marketplaceAppSchema.parse({
      ...fixture.app,
      id: "loopgraph.private-test",
      publisher: { id: "loopgraph", name: "Untrusted publisher", verified: true },
      latestVersion: reservedVersion.version,
      versions: [reservedVersion]
    });
    const store = new SupabaseMarketplaceRegistryStore(client, organizationId);

    await expect(store.publishPrivateVersion({
      app: reservedApp,
      version: reservedVersion,
      artifact: fixture.artifact,
      snapshotDigest,
      artifactObjectKey: `${organizationId}/marketplace/loopgraph.private-test/1.0.0/pack.tgz`
    })).rejects.toThrow("reserved for the official catalog");
    expect(client.rpc).not.toHaveBeenCalled();
  });

  it("stages a signed private version with hosted provenance and no self-attestation", async () => {
    const fixture = await marketplaceFixture();
    const rpc = vi.fn(async (_name: string, parameters: Record<string, unknown>) => ({
      data: {
        appId: fixture.app.id,
        version: fixture.version.version,
        artifactDigest: fixture.artifact.digest,
        releaseStatus: "pending_verification",
        created: true
      },
      error: null,
      parameters
    }));
    const store = new SupabaseMarketplaceRegistryStore(
      { rpc, from: vi.fn() } as unknown as SupabaseClient,
      organizationId
    );
    const artifactObjectKey =
      `${organizationId}/marketplace/${fixture.app.id}/${fixture.version.version}/pack.tgz`;
    await expect(store.publishPrivateVersion({
      ...fixture,
      snapshotDigest,
      artifactObjectKey,
      now: new Date("2026-08-16T12:00:00.000Z")
    })).resolves.toMatchObject({ releaseStatus: "pending_verification", created: true });

    expect(rpc).toHaveBeenCalledTimes(1);
    const [rpcName, args] = rpc.mock.calls[0]!;
    expect(rpcName).toBe("publish_private_marketplace_app_version");
    expect(args).toMatchObject({
      p_organization_id: organizationId,
      p_artifact_object_key: artifactObjectKey,
      p_payload: {
        schemaVersion: "hosted-marketplace-publication/v1alpha1",
        app: { id: fixture.app.id, visibility: "private" },
        version: {
          artifactUri: `hosted://marketplace/${fixture.app.id}/${fixture.version.version}`,
          maturity: "concept",
          provenanceVerified: false,
          source: {
            sourceType: "hosted",
            sourceUri: `hosted://catalog/${organizationId}`,
            sourceRef: fixture.version.version,
            snapshotDigest,
            trustPolicy: "signed"
          }
        },
        artifact: {
          provenance: {
            sourceType: "hosted",
            sourceUri: `hosted://catalog/${organizationId}`,
            sourceRef: fixture.version.version,
            signature: { publisherId: fixture.app.publisher.id }
          }
        },
        manifestDigest: hostedMarketplaceArtifactAttestation(fixture.artifact).manifestDigest,
        fileIndexDigest: hostedMarketplaceArtifactAttestation(fixture.artifact).fileIndexDigest
      }
    });
    const payload = (args as { p_payload: Record<string, unknown> }).p_payload;
    expect(payload).not.toHaveProperty("releaseStatus");
  });

  it("reconstructs only verified active/deprecated releases without delivery secrets", async () => {
    const fixture = await marketplaceFixture();
    const appMetadata = {
      ...fixture.app,
      latestVersion: undefined,
      versions: undefined
    };
    delete appMetadata.latestVersion;
    delete appMetadata.versions;
    const first = hostedVersion(fixture.version, "1.0.0", fixture.artifact.digest);
    const secondDigest = `sha256:${"d".repeat(64)}`;
    const second = hostedVersion(fixture.version, "1.1.0-beta.1", secondDigest);
    const appQuery = thenableQuery({ data: [{ app_id: fixture.app.id }], error: null });
    const versionRows = [
      versionRow(appMetadata, first, "active"),
      versionRow(appMetadata, second, "deprecated", "Use the stable release instead")
    ];
    const versionQuery = thenableQuery({ data: versionRows, error: null });
    const from = vi.fn((table: string) =>
      table === "marketplace_apps" ? appQuery : versionQuery
    );
    const store = new SupabaseMarketplaceRegistryStore(
      { rpc: vi.fn(), from } as unknown as SupabaseClient,
      organizationId
    );

    const apps = await store.listVisibleApps();
    expect(apps).toHaveLength(1);
    expect(apps[0]).toMatchObject({
      id: fixture.app.id,
      latestVersion: "1.1.0-beta.1",
      versions: [
        { version: "1.0.0", provenanceVerified: true, deprecated: false },
        {
          version: "1.1.0-beta.1",
          provenanceVerified: true,
          deprecated: true,
          deprecationMessage: "Use the stable release instead"
        }
      ]
    });
    expect(JSON.stringify(apps)).not.toContain("artifact_object_key");
    expect(versionQuery.in).toHaveBeenCalledWith(
      "release_status",
      ["active", "deprecated"]
    );
  });

  it("uses bounded lifecycle, access, and service verifier RPCs", async () => {
    const fixture = await marketplaceFixture();
    const attestation = hostedMarketplaceArtifactAttestation(fixture.artifact);
    const rpc = vi.fn(async (name: string) => {
      if (name === "attest_hosted_marketplace_release") {
        return {
          data: {
            appId: "acme.product.feedback",
            version: "1.0.0",
            artifactDigest: fixture.artifact.digest,
            releaseStatus: "active",
            created: true
          },
          error: null
        };
      }
      if (name.includes("marketplace_app_access")) {
        return {
          data: {
            appId: "acme.product.feedback",
            granteeOrganizationId,
            granted: name.startsWith("grant_"),
            created: true
          },
          error: null
        };
      }
      return {
        data: {
          appId: "acme.product.feedback",
          version: "1.0.0",
          artifactDigest: `sha256:${"a".repeat(64)}`,
          releaseStatus: "revoked",
          created: true
        },
        error: null
      };
    });
    const client = { rpc, from: vi.fn() } as unknown as SupabaseClient;
    const store = new SupabaseMarketplaceRegistryStore(client, organizationId);
    await store.setReleaseStatus({
      appId: "acme.product.feedback",
      version: "1.0.0",
      releaseStatus: "revoked",
      reason: "Signing key was rotated"
    });
    await store.grantPrivateAccess({
      appId: "acme.product.feedback",
      granteeOrganizationId
    });
    await store.revokePrivateAccess({
      appId: "acme.product.feedback",
      granteeOrganizationId
    });
    const verifier = new SupabaseMarketplaceReleaseVerifier(client);
    await verifier.attest({
      appId: "acme.product.feedback",
      version: "1.0.0",
      artifact: fixture.artifact,
      verificationReceiptDigest: receiptDigest,
      accepted: true
    });

    expect(rpc).toHaveBeenCalledWith("attest_hosted_marketplace_release", {
      p_app_id: "acme.product.feedback",
      p_version: "1.0.0",
      p_artifact_digest: attestation.artifactDigest,
      p_manifest_digest: attestation.manifestDigest,
      p_file_index_digest: attestation.fileIndexDigest,
      p_verified_manifest: fixture.artifact.manifest,
      p_verified_file_index: [...fixture.artifact.files]
        .sort((left, right) => left.path.localeCompare(right.path))
        .map(({ path, digest, sizeBytes, mediaType }) => ({
          path,
          digest,
          sizeBytes,
          mediaType
        })),
      p_verification_receipt_digest: receiptDigest,
      p_accepted: true,
      p_reason: null
    });
  });
});

async function marketplaceFixture(): Promise<{
  app: MarketplaceApp;
  version: MarketplaceAppVersion;
  artifact: LoopPackArtifact;
}> {
  const packRoot = path.resolve(
    process.cwd(),
    "packs/official/product/turn-feedback-into-product-problems"
  );
  const loaded = await loadLoopPackDirectory(packRoot);
  const publisher = { id: "acme", name: "Acme", verified: false };
  const manifest = {
    ...loaded.artifact.manifest,
    metadata: {
      ...loaded.artifact.manifest.metadata,
      id: "acme.product.feedback",
      publisher,
      visibility: "private" as const
    }
  };
  const digest = canonicalAppDigest({
    manifest,
    files: loaded.artifact.files
      .filter((file) => file.path !== "loopgraph.pack.signature.json")
      .map(({ path: filePath, digest: fileDigest, sizeBytes }) => ({
        path: filePath,
        digest: fileDigest,
        sizeBytes
      }))
  });
  const artifact = loopPackArtifactSchema.parse({
    ...loaded.artifact,
    manifest,
    digest,
    provenance: {
      ...loaded.artifact.provenance,
      signature: {
        algorithm: "ed25519",
        publisherId: publisher.id,
        keyId: "acme.test.primary",
        publicKey: "test-public-key-material-that-is-long-enough",
        value: "test-signature-value"
      }
    }
  });
  const version = marketplaceAppVersionSchema.parse({
    schemaVersion: "loopgraph-marketplace/v1alpha1",
    appId: artifact.manifest.metadata.id,
    version: artifact.manifest.metadata.version,
    digest: artifact.digest,
    publishedAt: "2026-08-16T11:00:00.000Z",
    compatibility: artifact.manifest.compatibility,
    dependencies: artifact.manifest.dependencies,
    permissions: artifact.manifest.permissions,
    requiredCapabilities: artifact.manifest.requiredCapabilities,
    presets: artifact.manifest.presets,
    modules: artifact.manifest.modules,
    maturity: "tested",
    artifactUri: "file:///private/catalog/pack.tgz",
    source: {
      sourceId: "private-test",
      sourceType: "filesystem",
      sourceUri: "file:///private/catalog",
      snapshotDigest,
      trustPolicy: "explicit_local",
      synchronizedAt: "2026-08-16T11:00:00.000Z"
    },
    provenanceVerified: true
  });
  const app = marketplaceAppSchema.parse({
    schemaVersion: "loopgraph-marketplace/v1alpha1",
    id: artifact.manifest.metadata.id,
    name: artifact.manifest.metadata.name,
    summary: artifact.manifest.metadata.summary,
    description: artifact.manifest.metadata.description,
    department: artifact.manifest.metadata.department,
    publisher: artifact.manifest.metadata.publisher,
    visibility: "private",
    tags: artifact.manifest.metadata.tags,
    latestVersion: version.version,
    versions: [version],
    searchTerms: ["feedback", "product"]
  });
  return { app, version, artifact };
}

function hostedVersion(
  base: MarketplaceAppVersion,
  version: string,
  digest: string
): MarketplaceAppVersion {
  return marketplaceAppVersionSchema.parse({
    ...base,
    version,
    digest,
    artifactUri: `hosted://marketplace/${base.appId}/${version}`,
    source: {
      sourceId: `hosted.${organizationId.replaceAll("-", "")}`,
      sourceType: "hosted",
      sourceUri: `hosted://catalog/${organizationId}`,
      sourceRef: version,
      snapshotDigest,
      trustPolicy: "signed",
      synchronizedAt: "2026-08-16T12:00:00.000Z"
    },
    provenanceVerified: false
  });
}

function versionRow(
  appMetadata: Record<string, unknown>,
  version: MarketplaceAppVersion,
  releaseStatus: "active" | "deprecated",
  statusMessage: string | null = null
) {
  return {
    app_id: version.appId,
    version: version.version,
    artifact_digest: version.digest,
    snapshot_digest: snapshotDigest,
    release_status: releaseStatus,
    app_metadata: appMetadata,
    version_payload: version,
    published_at: version.publishedAt,
    verified_at: "2026-08-16T12:05:00.000Z",
    status_message: statusMessage,
    status_updated_at: statusMessage ? "2026-08-16T12:06:00.000Z" : null
  };
}

function thenableQuery(result: { data: unknown; error: unknown }) {
  const query = {
    select: vi.fn(() => query),
    eq: vi.fn(() => query),
    in: vi.fn(() => query),
    order: vi.fn(() => query),
    then: (
      resolve: (value: typeof result) => unknown,
      reject?: (reason: unknown) => unknown
    ) => Promise.resolve(result).then(resolve, reject)
  };
  return query;
}
