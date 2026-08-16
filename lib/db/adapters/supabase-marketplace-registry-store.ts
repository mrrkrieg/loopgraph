import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import {
  artifactDigestSchema,
  canonicalAppDigest,
  loopPackArtifactSchema,
  marketplaceAppSchema,
  marketplaceAppVersionSchema,
  type LoopPackArtifact,
  type MarketplaceApp,
  type MarketplaceAppVersion
} from "loopgraph/core";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const OBJECT_KEY_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._/-]{0,511}$/;
const RELEASE_STATUSES = [
  "pending_verification",
  "active",
  "deprecated",
  "revoked",
  "rejected"
] as const;

const releaseResultSchema = z.object({
  appId: z.string().min(3).max(160),
  version: z.string().min(1).max(100),
  artifactDigest: artifactDigestSchema,
  releaseStatus: z.enum(RELEASE_STATUSES),
  created: z.boolean()
}).strict();

const accessResultSchema = z.object({
  appId: z.string().min(3).max(160),
  granteeOrganizationId: z.string().uuid(),
  granted: z.boolean(),
  created: z.boolean()
}).strict();

const searchRowSchema = z.object({
  app_id: z.string().min(3).max(160),
  version: z.string().min(1).max(100),
  artifact_digest: artifactDigestSchema,
  snapshot_digest: artifactDigestSchema,
  release_status: z.enum(["active", "deprecated"]),
  app_metadata: z.unknown(),
  version_payload: z.unknown(),
  published_at: z.string(),
  verified_at: z.string().min(1),
  status_message: z.string().nullable(),
  status_updated_at: z.string().nullable(),
  relevance_score: z.number().int().min(1).max(100),
  matched_terms: z.array(z.enum(["id", "name", "summary", "description"]))
}).strict();

const verificationJobSchema = z.object({
  jobId: z.string().uuid(),
  appId: z.string().min(3).max(160),
  version: z.string().min(1).max(100),
  attempts: z.number().int().min(1).max(25),
  leaseToken: z.string().uuid(),
  leaseExpiresAt: z.string().min(1),
  releaseStatus: z.enum(["pending_verification", "active", "rejected"]),
  artifactDigest: artifactDigestSchema,
  manifestDigest: artifactDigestSchema,
  fileIndexDigest: artifactDigestSchema,
  snapshotDigest: artifactDigestSchema,
  artifactObjectKey: z.string().min(1).max(512),
  manifestPayload: z.unknown(),
  fileIndexPayload: z.unknown(),
  signature: z.object({
    publisherId: z.string().min(1).max(160),
    algorithm: z.enum(["ed25519", "ecdsa-p256-sha256"]),
    keyId: z.string().min(3).max(160),
    publicKey: z.string().min(32).max(8192),
    value: z.string().min(32).max(16384)
  }).strict()
}).strict();

const verificationJobResultSchema = z.object({
  jobId: z.string().uuid(),
  status: z.enum(["pending", "completed", "failed"]),
  attempts: z.number().int().min(1).max(25),
  errorCode: z.string().nullable()
}).strict();

export type HostedMarketplaceReleaseStatus =
  (typeof RELEASE_STATUSES)[number];
export type HostedMarketplaceReleaseResult = z.infer<typeof releaseResultSchema>;
export type HostedMarketplaceSearchResult = {
  app: MarketplaceApp;
  score: number;
  matchedTerms: Array<"id" | "name" | "summary" | "description">;
};
export type HostedMarketplaceVerificationJob = z.infer<typeof verificationJobSchema>;

export type PublishPrivateMarketplaceVersionInput = {
  app: MarketplaceApp;
  version: MarketplaceAppVersion;
  artifact: LoopPackArtifact;
  snapshotDigest: string;
  artifactObjectKey: string;
  now?: Date;
};

export type HostedMarketplaceArtifactAttestation = {
  artifactDigest: string;
  manifestDigest: string;
  fileIndexDigest: string;
};

type AppRow = { app_id: string };
type VersionRow = {
  app_id: string;
  version: string;
  artifact_digest: string;
  snapshot_digest: string;
  release_status: HostedMarketplaceReleaseStatus;
  app_metadata: unknown;
  version_payload: unknown;
  published_at: string;
  verified_at: string | null;
  status_message: string | null;
  status_updated_at: string | null;
};

export type HostedMarketplaceReleaseSummary = {
  appId: string;
  version: string;
  artifactDigest: string;
  snapshotDigest: string;
  releaseStatus: HostedMarketplaceReleaseStatus;
  publishedAt: string;
  verifiedAt?: string;
  statusMessage?: string;
  statusUpdatedAt?: string;
};

/**
 * User-bound hosted marketplace access. The supplied client must carry the
 * authenticated user's Supabase session; RLS is the catalog visibility
 * boundary. This adapter never uses a service key or returns artifact object
 * keys/signature values to catalog consumers.
 */
export class SupabaseMarketplaceRegistryStore {
  constructor(
    private readonly supabase: SupabaseClient,
    private readonly organizationId: string
  ) {
    assertOrganizationId(organizationId);
  }

  async publishPrivateVersion(
    input: PublishPrivateMarketplaceVersionInput
  ): Promise<HostedMarketplaceReleaseResult> {
    const app = marketplaceAppSchema.parse(input.app);
    const requestedVersion = marketplaceAppVersionSchema.parse(input.version);
    const artifact = loopPackArtifactSchema.parse(input.artifact);
    const snapshotDigest = artifactDigestSchema.parse(input.snapshotDigest);
    assertPublication(app, requestedVersion, artifact);
    assertArtifactObjectKey(input.artifactObjectKey, this.organizationId);

    const synchronizedAt = (input.now ?? new Date()).toISOString();
    const sourceUri = `hosted://catalog/${this.organizationId}`;
    const sourceId = `hosted.${this.organizationId.replaceAll("-", "")}`;
    const artifactUri = `hosted://marketplace/${app.id}/${requestedVersion.version}`;
    const version = marketplaceAppVersionSchema.parse({
      ...requestedVersion,
      maturity: "concept",
      artifactUri,
      source: {
        sourceId,
        sourceType: "hosted",
        sourceUri,
        sourceRef: requestedVersion.version,
        snapshotDigest,
        trustPolicy: "signed",
        synchronizedAt
      },
      provenanceVerified: false
    });
    const hostedArtifact = loopPackArtifactSchema.parse({
      ...artifact,
      provenance: {
        ...artifact.provenance,
        sourceType: "hosted",
        sourceUri,
        sourceRef: requestedVersion.version
      }
    });
    const appMetadata = {
      schemaVersion: app.schemaVersion,
      id: app.id,
      name: app.name,
      summary: app.summary,
      description: app.description,
      department: app.department,
      publisher: app.publisher,
      visibility: app.visibility,
      tags: app.tags,
      searchTerms: app.searchTerms,
      ...(app.iconUri ? { iconUri: app.iconUri } : {}),
      ...(app.readmeUri ? { readmeUri: app.readmeUri } : {})
    };
    const attestation = hostedMarketplaceArtifactAttestation(hostedArtifact);
    const fileIndex = canonicalFileIndex(hostedArtifact);
    const payload = {
      schemaVersion: "hosted-marketplace-publication/v1alpha1",
      publisher: app.publisher,
      app: appMetadata,
      version,
      artifact: { ...hostedArtifact, files: fileIndex },
      manifestDigest: attestation.manifestDigest,
      fileIndexDigest: attestation.fileIndexDigest
    };
    const { data, error } = await this.supabase.rpc(
      "publish_private_marketplace_app_version",
      {
        p_organization_id: this.organizationId,
        p_artifact_object_key: input.artifactObjectKey,
        p_payload: payload
      }
    );
    if (error) {
      throw new Error(`Failed to publish private marketplace release: ${error.message}`);
    }
    const result = releaseResultSchema.parse(data);
    if (
      result.appId !== app.id ||
      result.version !== version.version ||
      result.artifactDigest !== artifact.digest
    ) {
      throw new Error("Hosted marketplace publication returned an inconsistent identity");
    }
    return result;
  }

  async listVisibleApps(input: {
    appId?: string;
    includeDeprecated?: boolean;
  } = {}): Promise<MarketplaceApp[]> {
    let appQuery = this.supabase
      .from("marketplace_apps")
      .select("app_id")
      .order("app_id", { ascending: true });
    if (input.appId) appQuery = appQuery.eq("app_id", input.appId);
    const { data: appData, error: appError } = await appQuery;
    if (appError) {
      throw new Error(`Failed to list visible marketplace apps: ${appError.message}`);
    }
    const appIds = ((appData ?? []) as AppRow[]).map((row) => row.app_id);
    if (appIds.length === 0) return [];

    const statuses = input.includeDeprecated === false
      ? ["active"]
      : ["active", "deprecated"];
    const { data: versionData, error: versionError } = await this.supabase
      .from("marketplace_app_versions")
      .select(
        "app_id, version, artifact_digest, snapshot_digest, release_status, " +
          "app_metadata, version_payload, published_at, verified_at, " +
          "status_message, status_updated_at"
      )
      .in("app_id", appIds)
      .in("release_status", statuses)
      .order("published_at", { ascending: true });
    if (versionError) {
      throw new Error(`Failed to list visible marketplace versions: ${versionError.message}`);
    }
    return buildMarketplaceApps((versionData ?? []) as unknown as VersionRow[]);
  }

  async getVisibleApp(
    appId: string,
    input: { includeDeprecated?: boolean } = {}
  ): Promise<MarketplaceApp | undefined> {
    const [app] = await this.listVisibleApps({
      appId,
      includeDeprecated: input.includeDeprecated
    });
    return app;
  }

  async searchVisibleApps(input: {
    query?: string;
    department?: string;
    capability?: string;
    limit?: number;
    offset?: number;
  } = {}): Promise<HostedMarketplaceSearchResult[]> {
    const limit = boundedInteger(input.limit, 20, 1, 100);
    const offset = boundedInteger(input.offset, 0, 0, 10_000);
    const { data, error } = await this.supabase.rpc(
      "search_visible_marketplace_apps",
      {
        p_query: boundedText(input.query, 160),
        p_department: boundedText(input.department, 120),
        p_capability: boundedText(input.capability, 240),
        p_limit: limit,
        p_offset: offset
      }
    );
    if (error) {
      throw new Error(`Failed to search visible marketplace apps: ${error.message}`);
    }
    return z.array(searchRowSchema).parse(data ?? []).map((row) => {
      const [app] = buildMarketplaceApps([row as unknown as VersionRow]);
      if (!app) throw new Error("Hosted marketplace search returned an empty app");
      return {
        app,
        score: row.relevance_score,
        matchedTerms: row.matched_terms
      };
    });
  }

  async listOwnedReleases(appId?: string): Promise<HostedMarketplaceReleaseSummary[]> {
    let appQuery = this.supabase
      .from("marketplace_apps")
      .select("app_id")
      .eq("owner_organization_id", this.organizationId)
      .order("app_id", { ascending: true });
    if (appId) appQuery = appQuery.eq("app_id", appId);
    const { data: appData, error: appError } = await appQuery;
    if (appError) {
      throw new Error(`Failed to list owned marketplace apps: ${appError.message}`);
    }
    const ownedAppIds = ((appData ?? []) as AppRow[]).map((row) => row.app_id);
    if (ownedAppIds.length === 0) return [];

    const query = this.supabase
      .from("marketplace_app_versions")
      .select(
        "app_id, version, artifact_digest, snapshot_digest, release_status, " +
          "app_metadata, version_payload, published_at, verified_at, " +
          "status_message, status_updated_at"
      )
      .in("app_id", ownedAppIds)
      .order("published_at", { ascending: false });
    const { data, error } = await query;
    if (error) {
      throw new Error(`Failed to list owned marketplace releases: ${error.message}`);
    }
    return ((data ?? []) as unknown as VersionRow[]).map(parseReleaseSummary);
  }

  async setReleaseStatus(input: {
    appId: string;
    version: string;
    releaseStatus: "deprecated" | "revoked";
    reason: string;
  }): Promise<HostedMarketplaceReleaseResult> {
    const { data, error } = await this.supabase.rpc(
      "set_private_marketplace_release_status",
      {
        p_organization_id: this.organizationId,
        p_app_id: input.appId,
        p_version: input.version,
        p_release_status: input.releaseStatus,
        p_reason: input.reason
      }
    );
    if (error) {
      throw new Error(`Failed to change marketplace release status: ${error.message}`);
    }
    return releaseResultSchema.parse(data);
  }

  async grantPrivateAccess(input: {
    appId: string;
    granteeOrganizationId: string;
  }): Promise<z.infer<typeof accessResultSchema>> {
    assertOrganizationId(input.granteeOrganizationId);
    return this.updatePrivateAccess("grant_private_marketplace_app_access", input);
  }

  async revokePrivateAccess(input: {
    appId: string;
    granteeOrganizationId: string;
  }): Promise<z.infer<typeof accessResultSchema>> {
    assertOrganizationId(input.granteeOrganizationId);
    return this.updatePrivateAccess("revoke_private_marketplace_app_access", input);
  }

  private async updatePrivateAccess(
    rpcName:
      | "grant_private_marketplace_app_access"
      | "revoke_private_marketplace_app_access",
    input: { appId: string; granteeOrganizationId: string }
  ): Promise<z.infer<typeof accessResultSchema>> {
    const { data, error } = await this.supabase.rpc(rpcName, {
      p_organization_id: this.organizationId,
      p_app_id: input.appId,
      p_grantee_organization_id: input.granteeOrganizationId
    });
    if (error) {
      throw new Error(`Failed to update private marketplace access: ${error.message}`);
    }
    return accessResultSchema.parse(data);
  }
}

/** Service-role-only digest attestation after out-of-process signature checks. */
export class SupabaseMarketplaceReleaseVerifier {
  constructor(private readonly supabase: SupabaseClient) {}

  async attest(input: {
    appId: string;
    version: string;
    artifact: LoopPackArtifact;
    verificationReceiptDigest: string;
    accepted: boolean;
    reason?: string;
  }): Promise<HostedMarketplaceReleaseResult> {
    const artifact = loopPackArtifactSchema.parse(input.artifact);
    if (
      artifact.manifest.metadata.id !== input.appId ||
      artifact.manifest.metadata.version !== input.version
    ) {
      throw new Error("Verified marketplace artifact identity does not match the release");
    }
    const attestation = hostedMarketplaceArtifactAttestation(artifact);
    const receiptDigest = artifactDigestSchema.parse(input.verificationReceiptDigest);
    const { data, error } = await this.supabase.rpc(
      "attest_hosted_marketplace_release",
      {
        p_app_id: input.appId,
        p_version: input.version,
        p_artifact_digest: attestation.artifactDigest,
        p_manifest_digest: attestation.manifestDigest,
        p_file_index_digest: attestation.fileIndexDigest,
        p_verified_manifest: artifact.manifest,
        p_verified_file_index: canonicalFileIndex(artifact),
        p_verification_receipt_digest: receiptDigest,
        p_accepted: input.accepted,
        p_reason: input.reason ?? null
      }
    );
    if (error) {
      throw new Error(`Failed to attest hosted marketplace release: ${error.message}`);
    }
    return releaseResultSchema.parse(data);
  }

  async reject(input: {
    appId: string;
    version: string;
    verificationReceiptDigest: string;
    reasonCode: string;
  }): Promise<HostedMarketplaceReleaseResult> {
    const receiptDigest = artifactDigestSchema.parse(input.verificationReceiptDigest);
    if (!/^[a-z][a-z0-9_]{2,79}$/.test(input.reasonCode)) {
      throw new Error("Marketplace verification rejection requires a safe reason code");
    }
    const { data, error } = await this.supabase.rpc(
      "reject_hosted_marketplace_release",
      {
        p_app_id: input.appId,
        p_version: input.version,
        p_verification_receipt_digest: receiptDigest,
        p_reason_code: input.reasonCode
      }
    );
    if (error) {
      throw new Error(`Failed to reject hosted marketplace release: ${error.message}`);
    }
    return releaseResultSchema.parse(data);
  }
}

/** Service-role-only leased verification queue. */
export class SupabaseMarketplaceVerificationJobStore {
  constructor(private readonly supabase: SupabaseClient) {}

  async claim(input: {
    workerId: string;
    limit?: number;
    leaseSeconds?: number;
  }): Promise<HostedMarketplaceVerificationJob[]> {
    const { data, error } = await this.supabase.rpc(
      "claim_hosted_marketplace_verification_jobs",
      {
        p_worker_id: input.workerId,
        p_limit: boundedInteger(input.limit, 5, 1, 25),
        p_lease_seconds: boundedInteger(input.leaseSeconds, 300, 30, 1800)
      }
    );
    if (error) {
      throw new Error(`Failed to claim hosted marketplace verification jobs: ${error.message}`);
    }
    return z.array(verificationJobSchema).parse(data ?? []);
  }

  async finish(input: {
    jobId: string;
    leaseToken: string;
    outcome: "completed" | "retry" | "failed";
    errorCode?: string;
  }): Promise<z.infer<typeof verificationJobResultSchema>> {
    const { data, error } = await this.supabase.rpc(
      "finish_hosted_marketplace_verification_job",
      {
        p_job_id: input.jobId,
        p_lease_token: input.leaseToken,
        p_outcome: input.outcome,
        p_error_code: input.errorCode ?? null
      }
    );
    if (error) {
      throw new Error(`Failed to finish hosted marketplace verification job: ${error.message}`);
    }
    return verificationJobResultSchema.parse(data);
  }
}

function buildMarketplaceApps(rows: VersionRow[]): MarketplaceApp[] {
  const rowsByApp = new Map<string, VersionRow[]>();
  for (const row of rows) {
    const current = rowsByApp.get(row.app_id) ?? [];
    current.push(row);
    rowsByApp.set(row.app_id, current);
  }
  return [...rowsByApp.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([appId, appRows]) => {
      const sortedRows = [...appRows].sort((left, right) =>
        compareSemanticVersions(left.version, right.version)
      );
      const versions = sortedRows.map(parseActiveVersion);
      const metadata = asObject(sortedRows.at(-1)?.app_metadata);
      return marketplaceAppSchema.parse({
        ...metadata,
        id: appId,
        latestVersion: versions.at(-1)?.version,
        versions
      });
    });
}

function parseActiveVersion(row: VersionRow): MarketplaceAppVersion {
  if (row.release_status !== "active" && row.release_status !== "deprecated") {
    throw new Error(`Unavailable marketplace release leaked into active catalog: ${row.release_status}`);
  }
  const version = marketplaceAppVersionSchema.parse({
    ...asObject(row.version_payload),
    appId: row.app_id,
    version: row.version,
    digest: row.artifact_digest,
    publishedAt: row.published_at,
    provenanceVerified: Boolean(row.verified_at),
    deprecated: row.release_status === "deprecated",
    ...(row.release_status === "deprecated"
      ? { deprecationMessage: row.status_message ?? "Deprecated by the publisher" }
      : {})
  });
  if (version.source.snapshotDigest !== row.snapshot_digest) {
    throw new Error(`Hosted marketplace snapshot digest mismatch for ${row.app_id}@${row.version}`);
  }
  if (!version.provenanceVerified) {
    throw new Error(`Unverified marketplace release leaked into active catalog: ${row.app_id}@${row.version}`);
  }
  return version;
}

function parseReleaseSummary(row: VersionRow): HostedMarketplaceReleaseSummary {
  if (!RELEASE_STATUSES.includes(row.release_status)) {
    throw new Error(`Unknown hosted marketplace release status: ${row.release_status}`);
  }
  return {
    appId: row.app_id,
    version: row.version,
    artifactDigest: artifactDigestSchema.parse(row.artifact_digest),
    snapshotDigest: artifactDigestSchema.parse(row.snapshot_digest),
    releaseStatus: row.release_status,
    publishedAt: new Date(row.published_at).toISOString(),
    ...(row.verified_at ? { verifiedAt: new Date(row.verified_at).toISOString() } : {}),
    ...(row.status_message ? { statusMessage: row.status_message } : {}),
    ...(row.status_updated_at
      ? { statusUpdatedAt: new Date(row.status_updated_at).toISOString() }
      : {})
  };
}

function assertPublication(
  app: MarketplaceApp,
  version: MarketplaceAppVersion,
  artifact: LoopPackArtifact
) {
  if (
    app.publisher.id === "loopgraph" ||
    app.id.startsWith("loopgraph.") ||
    app.publisher.verified ||
    artifact.manifest.metadata.publisher.verified
  ) {
    throw new Error(
      "The Loopgraph app and verified publisher namespaces are reserved for the official catalog"
    );
  }
  assertHostedCatalogUri(app.iconUri, "icon URI");
  assertHostedCatalogUri(app.readmeUri, "README URI");
  if (app.visibility !== "private" || artifact.manifest.metadata.visibility !== "private") {
    throw new Error("Hosted organization publication currently accepts private apps only");
  }
  if (
    version.appId !== app.id ||
    artifact.manifest.metadata.id !== app.id ||
    artifact.manifest.metadata.version !== version.version ||
    artifact.digest !== version.digest
  ) {
    throw new Error("Hosted marketplace app, version, and artifact identities must match");
  }
  if (
    app.publisher.id !== artifact.manifest.metadata.publisher.id ||
    artifact.provenance.signature?.publisherId !== app.publisher.id
  ) {
    throw new Error("Hosted marketplace publication requires a matching publisher signature");
  }
  if (!artifact.provenance.signature) {
    throw new Error("Hosted marketplace publication requires a signed LoopPack artifact");
  }
}

/**
 * Canonical file identity independently recomputed by the verifier after it
 * loads the archive. Keeping this separate from the archive digest makes the
 * database activation predicate explicitly bind the stored file projection.
 */
export function hostedMarketplaceArtifactAttestation(
  artifactInput: LoopPackArtifact
): HostedMarketplaceArtifactAttestation {
  const artifact = loopPackArtifactSchema.parse(artifactInput);
  return {
    artifactDigest: artifact.digest,
    manifestDigest: canonicalAppDigest(artifact.manifest),
    fileIndexDigest: canonicalAppDigest(canonicalFileIndex(artifact))
  };
}

function canonicalFileIndex(artifact: LoopPackArtifact) {
  return [...artifact.files]
    .sort((left, right) => left.path.localeCompare(right.path))
    .map(({ path, digest, sizeBytes, mediaType }) => ({
      path,
      digest,
      sizeBytes,
      mediaType
    }));
}

function assertOrganizationId(value: string) {
  if (!UUID_PATTERN.test(value)) {
    throw new Error("Hosted marketplace organization ID must be a UUID");
  }
}

function assertHostedCatalogUri(value: string | undefined, label: string) {
  if (!value) return;
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error(`Hosted marketplace ${label} must be an HTTPS URL`);
  }
  if (
    parsed.protocol !== "https:" ||
    parsed.username ||
    parsed.password ||
    parsed.port
  ) {
    throw new Error(`Hosted marketplace ${label} must be an HTTPS URL`);
  }
}

function assertArtifactObjectKey(value: string, organizationId: string) {
  if (
    !OBJECT_KEY_PATTERN.test(value) ||
    !value.startsWith(`${organizationId}/marketplace/`) ||
    value.includes("//") ||
    value.split("/").includes("..")
  ) {
    throw new Error("Hosted marketplace artifact object key must stay in the tenant marketplace namespace");
  }
}

function asObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Hosted marketplace row contains invalid JSON metadata");
  }
  return value as Record<string, unknown>;
}

function boundedText(value: string | undefined, maximum: number) {
  const normalized = value?.trim();
  if (!normalized) return null;
  if (normalized.length > maximum) {
    throw new Error(`Hosted marketplace search text exceeds ${maximum} characters`);
  }
  return normalized;
}

function boundedInteger(
  value: number | undefined,
  fallback: number,
  minimum: number,
  maximum: number
) {
  const resolved = value ?? fallback;
  if (!Number.isInteger(resolved) || resolved < minimum || resolved > maximum) {
    throw new Error(`Hosted marketplace integer must be between ${minimum} and ${maximum}`);
  }
  return resolved;
}

function compareSemanticVersions(left: string, right: string): number {
  const parsedLeft = parseSemanticVersion(left);
  const parsedRight = parseSemanticVersion(right);
  for (let index = 0; index < 3; index += 1) {
    const difference = parsedLeft.numbers[index]! - parsedRight.numbers[index]!;
    if (difference !== 0) return difference;
  }
  if (parsedLeft.prerelease.length === 0 && parsedRight.prerelease.length > 0) return 1;
  if (parsedRight.prerelease.length === 0 && parsedLeft.prerelease.length > 0) return -1;
  const length = Math.max(parsedLeft.prerelease.length, parsedRight.prerelease.length);
  for (let index = 0; index < length; index += 1) {
    const leftPart = parsedLeft.prerelease[index];
    const rightPart = parsedRight.prerelease[index];
    if (leftPart === undefined) return -1;
    if (rightPart === undefined) return 1;
    if (leftPart === rightPart) continue;
    const leftNumber = /^\d+$/.test(leftPart) ? Number(leftPart) : undefined;
    const rightNumber = /^\d+$/.test(rightPart) ? Number(rightPart) : undefined;
    if (leftNumber !== undefined && rightNumber !== undefined) return leftNumber - rightNumber;
    if (leftNumber !== undefined) return -1;
    if (rightNumber !== undefined) return 1;
    return leftPart.localeCompare(rightPart);
  }
  return 0;
}

function parseSemanticVersion(value: string) {
  const buildIndex = value.indexOf("+");
  const withoutBuild = buildIndex === -1 ? value : value.slice(0, buildIndex);
  const prereleaseIndex = withoutBuild.indexOf("-");
  const numbersPart = prereleaseIndex === -1
    ? withoutBuild
    : withoutBuild.slice(0, prereleaseIndex);
  const prereleasePart = prereleaseIndex === -1
    ? undefined
    : withoutBuild.slice(prereleaseIndex + 1);
  const numbers = numbersPart!.split(".").map(Number);
  if (numbers.length !== 3 || numbers.some((part) => !Number.isSafeInteger(part))) {
    throw new Error(`Invalid semantic version in hosted marketplace: ${value}`);
  }
  return {
    numbers,
    prerelease: prereleasePart ? prereleasePart.split(".") : []
  };
}
