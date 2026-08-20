import "server-only";

import path from "node:path";
import {
  callLoopgraphAppTool as callRuntimeAppTool,
  connectionInstanceFromBrokerInstallation,
  type LoopgraphAppToolName
} from "loopgraph/runtime";
import { marketplaceAppSchema, type ConnectionInstance, type MarketplaceApp } from "loopgraph/core";
import { isHostedAuthRequired } from "@/lib/auth/hosted-config";
import { getWorkspaceDatabase } from "@/lib/db/workspace-database";
import { listConnectorInstallations } from "@/lib/connector-broker/admin";
import { getActiveLoopgraphProjectRoot } from "@/lib/loopgraph-runtime/storage-resolver";
import { requireHostedMarketplaceContext } from "./hosted-marketplace-api";
import {
  ensureHostedMarketplaceArtifact,
  hasCachedHostedMarketplaceArtifact
} from "./hosted-marketplace-cache";
import { SupabaseMarketplaceRegistryStore } from "@/lib/db/adapters/supabase-marketplace-registry-store";

const CONNECTION_AWARE_TOOLS = new Set<LoopgraphAppToolName>([
  "loopgraph_app_onboarding_get",
  "loopgraph_app_install_plan",
  "loopgraph_connector_schema_record",
  "loopgraph_app_field_mappings_get",
  "loopgraph_app_field_mapping_confirm",
  "loopgraph_app_update_plan"
]);

const HOSTED_ARTIFACT_TOOLS = new Set<LoopgraphAppToolName>([
  "loopgraph_app_get",
  "loopgraph_app_onboarding_get",
  "loopgraph_app_install_plan",
  "loopgraph_app_install_apply",
  "loopgraph_app_field_mappings_get"
]);

/**
 * Server-only App Platform entry point.
 *
 * Connector Broker installations are projected into the generic connection
 * contract through trusted call options. They are never accepted from browser,
 * MCP, or CLI input, and the projection intentionally omits every credential
 * and vault reference.
 */
export async function callLoopgraphAppTool(
  name: LoopgraphAppToolName,
  input: unknown,
  options: { projectRoot?: string; now?: Date } = {}
): Promise<unknown> {
  const hostedMode = isHostedAuthRequired();
  const effectiveInput = hostedMode
    ? { ...asRecord(input), projectRoot: pathFromInput(input, options.projectRoot) }
    : input;
  if (name === "loopgraph_marketplace_search" && hostedMode) {
    return combinedMarketplaceSearch(effectiveInput, options);
  }
  const hostedIdentity = hostedArtifactRequest(name, effectiveInput);
  if (
    hostedMode &&
    hostedIdentity &&
    await hasCachedHostedMarketplaceArtifact({
      projectRoot: pathFromInput(effectiveInput, options.projectRoot),
      ...hostedIdentity
    })
  ) {
    await ensureHostedMarketplaceArtifact({
      projectRoot: pathFromInput(effectiveInput, options.projectRoot),
      ...hostedIdentity,
      includeDeprecated: hostedReadMayUseDeprecated(name)
    });
  }
  const callOptions = CONNECTION_AWARE_TOOLS.has(name)
    ? { ...options, connections: await trustedConnections(), hostedMarketplaceClient: null }
    : { ...options, hostedMarketplaceClient: null };
  try {
    return await callRuntimeAppTool(name, effectiveInput, callOptions);
  } catch (error) {
    if (!hostedIdentity || !hostedMode || !isMissingMarketplaceArtifact(error)) {
      throw error;
    }
    const projectRoot = pathFromInput(effectiveInput, options.projectRoot);
    await ensureHostedMarketplaceArtifact({
      projectRoot,
      ...hostedIdentity,
      includeDeprecated: hostedReadMayUseDeprecated(name)
    });
    return callRuntimeAppTool(name, effectiveInput, callOptions);
  }
}

async function combinedMarketplaceSearch(
  input: unknown,
  options: { projectRoot?: string; now?: Date }
) {
  const raw = asRecord(input);
  const local = await callRuntimeAppTool(
    "loopgraph_marketplace_search",
    input,
    { ...options, hostedMarketplaceClient: null }
  ) as {
    schemaVersion: string;
    query?: string;
    results: Array<{ app: MarketplaceApp; score: number; matchedTerms: string[] }>;
  };
  const context = await requireHostedMarketplaceContext("workspace.read");
  const hosted = await new SupabaseMarketplaceRegistryStore(
    context.userClient,
    context.organizationId
  ).searchVisibleApps({
    query: stringValue(raw.query)?.slice(0, 160),
    department: stringValue(raw.department),
    capability: stringValue(raw.capability),
    limit: integerValue(raw.limit, 20, 1, 100)
  });
  const localResults = local.results.flatMap(withoutCachedHostedVersions);
  const hostedResults = hosted
    .filter((entry) => Boolean(raw.includeDeprecated) || !entry.app.versions[0]?.deprecated)
    .filter((entry) => !raw.maturity || entry.app.versions[0]?.maturity === raw.maturity);
  const results = mergeMarketplaceSearchResults([
    ...localResults,
    ...hostedResults.map((entry) => ({
      app: entry.app,
      score: stringValue(raw.query) ? entry.score / 100 : 1,
      matchedTerms: entry.matchedTerms
    }))
  ]).slice(0, integerValue(raw.limit, 20, 1, 100));
  return {
    schemaVersion: "loopgraph-marketplace-search/v1alpha1",
    query: local.query,
    count: results.length,
    results,
    sources: { local: localResults.length, hosted: hostedResults.length }
  };
}

async function trustedConnections(): Promise<ConnectionInstance[]> {
  const database = await getWorkspaceDatabase("integrations.read");
  const installations = await listConnectorInstallations(database);
  return installations.map((installation) =>
    connectionInstanceFromBrokerInstallation(installation)
  );
}

function hostedArtifactRequest(
  name: LoopgraphAppToolName,
  input: unknown
): {
  appId: string;
  version?: string;
  versionRange?: string;
  artifactDigest?: string;
} | undefined {
  if (
    !HOSTED_ARTIFACT_TOOLS.has(name)
  ) {
    return undefined;
  }
  const raw = asRecord(input);
  const plan = asRecord(raw.plan);
  const appId = stringValue(raw.appId) ?? stringValue(plan.appId);
  if (!appId) return undefined;
  const requestedVersion = stringValue(raw.version);
  const versionRange = stringValue(raw.versionRange);
  const exactVersion = requestedVersion ??
    (versionRange && /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.test(versionRange)
      ? versionRange
      : undefined) ??
    stringValue(plan.version);
  return {
    appId,
    version: exactVersion,
    ...(!exactVersion && versionRange ? { versionRange } : {}),
    artifactDigest: stringValue(plan.artifactDigest)
  };
}

function isMissingMarketplaceArtifact(error: unknown) {
  return error instanceof Error &&
    /marketplace app not found|marketplace (?:app )?version not found|no eligible version|artifact is not available|hosted marketplace artifact is not cached/i.test(error.message);
}

function hostedReadMayUseDeprecated(name: LoopgraphAppToolName) {
  return name === "loopgraph_app_get" || name === "loopgraph_app_onboarding_get" || name === "loopgraph_app_field_mappings_get";
}

function withoutCachedHostedVersions(entry: {
  app: MarketplaceApp;
  score: number;
  matchedTerms: string[];
}) {
  const versions = entry.app.versions.filter((version) =>
    version.source.sourceType !== "hosted"
  );
  if (versions.length === 0) return [];
  const sorted = versions.sort((left, right) =>
    compareSemanticVersions(right.version, left.version) ||
    left.source.sourceId.localeCompare(right.source.sourceId)
  );
  return [{
    ...entry,
    app: marketplaceAppSchema.parse({
      ...entry.app,
      latestVersion: sorted[0]!.version,
      versions: sorted,
      readmeUri: `${sorted[0]!.artifactUri}/README.md`
    })
  }];
}

function mergeMarketplaceSearchResults(
  entries: Array<{ app: MarketplaceApp; score: number; matchedTerms: string[] }>
) {
  const byId = new Map<string, { app: MarketplaceApp; score: number; matchedTerms: string[] }>();
  for (const entry of entries) {
    const current = byId.get(entry.app.id);
    if (!current) {
      byId.set(entry.app.id, entry);
      continue;
    }
    if (current.app.publisher.id !== entry.app.publisher.id) {
      throw new Error(`Marketplace publisher conflict for ${entry.app.id}`);
    }
    const versions = new Map<string, MarketplaceApp["versions"][number]>();
    const digestByVersion = new Map<string, string>();
    for (const version of [...current.app.versions, ...entry.app.versions]) {
      const existingDigest = digestByVersion.get(version.version);
      if (existingDigest && existingDigest !== version.digest) {
        throw new Error(
          `Immutable marketplace version conflict for ${entry.app.id}@${version.version}`
        );
      }
      digestByVersion.set(version.version, version.digest);
      const key = `${version.version}#${version.digest}#${version.source.sourceId}`;
      versions.set(key, version);
    }
    const mergedVersions = [...versions.values()].sort((left, right) =>
      compareSemanticVersions(right.version, left.version) ||
      left.source.sourceId.localeCompare(right.source.sourceId)
    );
    const latestVersion = mergedVersions[0]!.version;
    const metadata = entry.app.latestVersion === latestVersion ? entry.app : current.app;
    byId.set(entry.app.id, {
      app: marketplaceAppSchema.parse({
        ...metadata,
        latestVersion,
        versions: mergedVersions
      }),
      score: Math.max(current.score, entry.score),
      matchedTerms: [...new Set([...current.matchedTerms, ...entry.matchedTerms])]
    });
  }
  return [...byId.values()].sort((left, right) =>
    right.score - left.score || left.app.name.localeCompare(right.app.name)
  );
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

function pathFromInput(input: unknown, fallback?: string) {
  const value = stringValue(asRecord(input).projectRoot) ?? fallback;
  return getActiveLoopgraphProjectRoot(path.resolve(value ?? process.cwd()));
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function stringValue(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function integerValue(
  value: unknown,
  fallback: number,
  minimum: number,
  maximum: number
) {
  return Number.isInteger(value) && Number(value) >= minimum && Number(value) <= maximum
    ? Number(value)
    : fallback;
}

export type { LoopgraphAppToolName };
