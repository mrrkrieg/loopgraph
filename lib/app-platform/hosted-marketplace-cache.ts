import "server-only";

import { writeFile, rm } from "node:fs/promises";
import path from "node:path";
import {
  canonicalAppDigest,
  type MarketplaceAppVersion
} from "loopgraph/core";
import {
  extractLoopPackArchive,
  hostedCatalogCacheRoot,
  LocalAppMarketplace,
  satisfiesVersionRange,
  type HostedCatalogSynchronizer
} from "loopgraph/runtime";
import { requireHostedMarketplaceContext } from "./hosted-marketplace-api";
import { HostedMarketplaceArtifactService } from "./hosted-marketplace-artifacts";
import { SupabaseMarketplaceRegistryStore } from "@/lib/db/adapters/supabase-marketplace-registry-store";

export async function ensureHostedMarketplaceArtifact(input: {
  projectRoot: string;
  appId: string;
  version?: string;
  versionRange?: string;
  artifactDigest?: string;
  includeDeprecated?: boolean;
}): Promise<MarketplaceAppVersion> {
  const context = await requireHostedMarketplaceContext("workspace.read");
  const registry = new SupabaseMarketplaceRegistryStore(
    context.userClient,
    context.organizationId
  );
  const app = await registry.getVisibleApp(input.appId, {
    includeDeprecated: input.includeDeprecated ?? true
  });
  if (!app) {
    await evictCachedHostedMarketplaceSources(input);
    throw new Error(`Hosted marketplace app not found: ${input.appId}`);
  }
  await reconcileCachedHostedMarketplaceSources(input.projectRoot, app);
  const requestedRange = input.version ?? input.versionRange ?? "latest";
  const version = app.versions
    .filter((candidate) => input.version
      ? candidate.version === input.version
      : satisfiesVersionRange(candidate.version, requestedRange)
    )
    .sort((left, right) => compareSemanticVersions(right.version, left.version))[0];
  if (!version) {
    await evictCachedHostedMarketplaceSources(input);
    throw new Error(
      `Hosted marketplace app version not found: ${input.appId}@${requestedRange}`
    );
  }
  if (input.artifactDigest && input.artifactDigest !== version.digest) {
    throw new Error("Hosted marketplace artifact digest does not match the reviewed request");
  }
  const stateRoot = path.join(input.projectRoot, ".loopgraph", "apps", "marketplace");
  const existing = new LocalAppMarketplace(stateRoot);
  const localVersion = (await existing.listAppVersions(app.id)).find((candidate) =>
    candidate.version === version.version && candidate.digest === version.digest
  );
  if (localVersion) {
    try {
      await existing.getAppArtifact(app.id, version.version, version.digest);
      return localVersion;
    } catch {
      const source = (await existing.listCatalogSources()).find((candidate) =>
        candidate.id === localVersion.source.sourceId &&
        candidate.type === "hosted" &&
        candidate.pinnedRef === version.version &&
        candidate.expectedDigest === version.digest
      );
      if (source) {
        await rm(hostedCatalogCacheRoot(stateRoot, source), {
          recursive: true,
          force: true
        });
      }
    }
  }

  const artifacts = new HostedMarketplaceArtifactService(
    context.userClient,
    context.adminClient,
    context.supabaseUrl
  );
  const downloaded = await artifacts.downloadVerifiedArtifact({
    appId: app.id,
    version: version.version,
    artifactDigest: version.digest
  });
  const sourceId = hostedSourceId(app.id, version.version, version.digest);
  const sourceUri = hostedSourceUri(app.id, version.version, version.digest);
  const synchronize: HostedCatalogSynchronizer["synchronize"] = async (
    source,
    destination
  ) => {
    if (
      source.id !== sourceId ||
      source.uri !== sourceUri ||
      source.pinnedRef !== version.version ||
      source.expectedDigest !== version.digest
    ) {
      throw new Error("Hosted marketplace cache source changed during staging");
    }
    const archivePath = `${destination}.${process.pid}.loopgraph-pack.json`;
    try {
      await writeFile(archivePath, downloaded.bytes, { flag: "wx", mode: 0o600 });
      const artifact = await extractLoopPackArchive(archivePath, destination);
      if (
        artifact.manifest.metadata.id !== app.id ||
        artifact.manifest.metadata.version !== version.version ||
        artifact.digest !== version.digest ||
        artifact.provenance.signature?.publisherId !== downloaded.publisherKey.publisherId ||
        artifact.provenance.signature?.keyId !== downloaded.publisherKey.keyId
      ) {
        throw new Error("Hosted marketplace archive identity changed during staging");
      }
      return { resolvedRef: version.version };
    } finally {
      await rm(archivePath, { force: true });
    }
  };
  const marketplace = new LocalAppMarketplace(stateRoot, undefined, {
    hostedSynchronizer: { synchronize }
  });
  await marketplace.addCatalogSource({
    schemaVersion: "loopgraph-marketplace/v1alpha1",
    id: sourceId,
    type: "hosted",
    uri: sourceUri,
    pinnedRef: version.version,
    expectedDigest: version.digest,
    enabled: true,
    trustPolicy: "signed",
    trustedPublisherKeys: [downloaded.publisherKey]
  });
  await marketplace.refreshCatalogSource(sourceId);
  const staged = (await marketplace.listAppVersions(app.id)).find((candidate) =>
    candidate.version === version.version && candidate.digest === version.digest
  );
  if (!staged || !staged.provenanceVerified) {
    throw new Error("Hosted marketplace artifact did not enter the verified local cache");
  }
  return staged;
}

export async function hasCachedHostedMarketplaceArtifact(input: {
  projectRoot: string;
  appId: string;
  version?: string;
  versionRange?: string;
  artifactDigest?: string;
}): Promise<boolean> {
  const marketplace = localMarketplace(input.projectRoot);
  const versions = await marketplace.listAppVersions(input.appId);
  return versions.some((candidate) =>
    candidate.source.sourceType === "hosted" &&
    (!input.version || candidate.version === input.version) &&
    (!input.versionRange || satisfiesVersionRange(candidate.version, input.versionRange)) &&
    (!input.artifactDigest || candidate.digest === input.artifactDigest)
  );
}

async function evictCachedHostedMarketplaceSources(input: {
  projectRoot: string;
  appId: string;
  version?: string;
  versionRange?: string;
  artifactDigest?: string;
}) {
  const marketplace = localMarketplace(input.projectRoot);
  const sourceIds = new Set(
    (await marketplace.listAppVersions(input.appId))
      .filter((candidate) =>
        candidate.source.sourceType === "hosted" &&
        (!input.version || candidate.version === input.version) &&
        (!input.versionRange || satisfiesVersionRange(candidate.version, input.versionRange)) &&
        (!input.artifactDigest || candidate.digest === input.artifactDigest)
      )
      .map((candidate) => candidate.source.sourceId)
  );
  for (const sourceId of sourceIds) await marketplace.removeCatalogSource(sourceId);
}

async function reconcileCachedHostedMarketplaceSources(
  projectRoot: string,
  visibleApp: { id: string; versions: MarketplaceAppVersion[] }
) {
  const marketplace = localMarketplace(projectRoot);
  const visibleIdentities = new Set(visibleApp.versions.map((version) =>
    `${version.version}#${version.digest}`
  ));
  const staleSourceIds = new Set(
    (await marketplace.listAppVersions(visibleApp.id))
      .filter((candidate) =>
        candidate.source.sourceType === "hosted" &&
        !visibleIdentities.has(`${candidate.version}#${candidate.digest}`)
      )
      .map((candidate) => candidate.source.sourceId)
  );
  for (const sourceId of staleSourceIds) {
    await marketplace.removeCatalogSource(sourceId);
  }
}

function localMarketplace(projectRoot: string) {
  return new LocalAppMarketplace(
    path.join(projectRoot, ".loopgraph", "apps", "marketplace")
  );
}

function hostedSourceId(appId: string, version: string, artifactDigest: string) {
  const suffix = canonicalAppDigest({ appId, version, artifactDigest })
    .slice("sha256:".length, "sha256:".length + 24);
  return `hosted.${suffix}`;
}

function hostedSourceUri(appId: string, version: string, artifactDigest: string) {
  return `hosted://marketplace/${appId}/${version}/${artifactDigest.slice("sha256:".length)}`;
}

function compareSemanticVersions(left: string, right: string) {
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
  const withoutBuild = value.split("+", 1)[0]!;
  const [numbersPart, ...prereleaseParts] = withoutBuild.split("-");
  return {
    numbers: numbersPart!.split(".").map(Number),
    prerelease: prereleaseParts.join("-").split(".").filter(Boolean)
  };
}
