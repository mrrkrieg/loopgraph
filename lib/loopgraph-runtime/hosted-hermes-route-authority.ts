import "server-only";

import path from "node:path";
import {
  connectionInstanceFromBrokerInstallation,
  HERMES_ROUTE_ACTIVATION_AUTHORITY_SCHEMA_VERSION,
  planHermesWebhookRoutes,
  validateHermesRouteActivationAuthority,
  type HermesRouteActivationAuthorityProvider,
  type HermesWebhookDoctorResult,
  type StoredLoopSpecArtifact
} from "loopgraph/runtime";
import {
  contentHash,
  type ConnectionInstance,
  type WorkspaceAppInstallation
} from "loopgraph/core";
import { getHostedOrganizationId } from "@/lib/auth/hosted-config";
import { listConnectorInstallations } from "@/lib/connector-broker/admin";
import {
  getAppInstallationStore,
  getLoopSpecRegistryStore
} from "@/lib/loopgraph-runtime/storage-resolver";

const WORKSPACE_PATTERN = /^[a-z0-9][a-z0-9_-]{0,63}$/;

/**
 * Builds route desired state from the same distributed registries used by the
 * hosted App/runtime surfaces. No deployment-local manifest, App registry, or
 * connector projection is accepted as authority.
 */
export function createHostedHermesRouteActivationAuthorityProvider(input: {
  projectRoot: string;
  workspaceId: string;
}): HermesRouteActivationAuthorityProvider {
  const projectRoot = path.resolve(input.projectRoot);
  const workspaceId = input.workspaceId.trim();
  if (!WORKSPACE_PATTERN.test(workspaceId)) {
    throw new Error("Hosted Hermes route authority workspace is invalid");
  }
  return async ({ projectRoot: requestedProjectRoot, now }) => {
    if (path.resolve(requestedProjectRoot) !== projectRoot) {
      throw new Error("Hosted Hermes route authority project root does not match its server binding");
    }
    const organizationId = getHostedOrganizationId();
    if (!organizationId) {
      throw new Error("Hosted Hermes route authority requires an organization-bound runtime");
    }
    const projectKey = process.env.LOOPGRAPH_HOSTED_PROJECT_KEY?.trim() || "default";
    if (workspaceId !== projectKey) {
      throw new Error("Hosted Hermes route authority workspace must match the server-bound project");
    }
    const loopSpecStore = getLoopSpecRegistryStore({ projectRoot });
    const installationStore = getAppInstallationStore({ projectRoot, workspaceId });
    if (loopSpecStore.persistence !== "distributed" || installationStore.persistence !== "distributed") {
      throw new Error("Hosted Hermes route authority requires distributed LoopSpec and App registries");
    }
    const database = { client: null, organizationId, hosted: true as const };
    const [loopWorkspaceBefore, installationRegistry, connectorInstallations] = await Promise.all([
      loopSpecStore.getWorkspace(projectRoot),
      installationStore.read(),
      listConnectorInstallations(database)
    ]);
    const connections = connectorInstallations
      .map((installation) => connectionInstanceFromBrokerInstallation(installation))
      .sort((left, right) => left.id.localeCompare(right.id));
    const artifacts = await loopSpecStore.listActiveLoopSpecs(projectRoot);
    const webhookPlan = await planHermesWebhookRoutes(
      { projectRoot, now },
      { loopSpecStore, trustedConnections: connections }
    );
    const appConnectionBindingsByLoopId = appBindings({
      artifacts,
      installations: installationRegistry.installations,
      connections
    });
    const [loopWorkspaceAfter, installationRegistryAfter, connectorInstallationsAfter] = await Promise.all([
      loopSpecStore.getWorkspace(projectRoot),
      installationStore.read(),
      listConnectorInstallations(database)
    ]);
    const connectionsAfter = connectorInstallationsAfter
      .map((installation) => connectionInstanceFromBrokerInstallation(installation))
      .sort((left, right) => left.id.localeCompare(right.id));
    if (
      loopWorkspaceAfter.revision !== loopWorkspaceBefore.revision ||
      contentHash(installationRegistryAfter) !== contentHash(installationRegistry) ||
      contentHash(connectionsAfter.map(connectionAuthorityIdentity)) !==
        contentHash(connections.map(connectionAuthorityIdentity))
    ) {
      throw new Error("Hosted Hermes route authority changed while it was being compiled; retry from the new current state");
    }
    const projectRootHash = contentHash({
      organizationId,
      projectKey,
      workspaceId
    });
    const manifestDigest = contentHash({
      schemaVersion: "hosted-hermes-route-authority-manifest/v1alpha1",
      projectRootHash,
      catalogVersion: webhookPlan.catalogVersion,
      loopSpecRevision: loopWorkspaceBefore.revision,
      appInstallationRevision: installationRegistry.revision,
      routes: webhookPlan.routes,
      connections: connections.map(connectionAuthorityIdentity),
      appConnectionBindingsByLoopId
    });
    return validateHermesRouteActivationAuthority({
      schemaVersion: HERMES_ROUTE_ACTIVATION_AUTHORITY_SCHEMA_VERSION,
      projectRootHash,
      manifestDigest,
      webhookPlan,
      connections,
      appConnectionBindingsByLoopId,
      warnings: []
    });
  };
}

export function createHostedHermesWebhookDoctorProvider(
  authorityProvider: HermesRouteActivationAuthorityProvider
) {
  return async (input: {
    projectRoot?: string;
    now?: Date;
  }): Promise<HermesWebhookDoctorResult> => {
    const projectRoot = path.resolve(input.projectRoot ?? process.cwd());
    const now = input.now ?? new Date();
    const authority = await authorityProvider({ projectRoot, now });
    const routeNames = authority.webhookPlan.routes.map((route) => route.routeName);
    return {
      schemaVersion: "hermes-webhook-doctor/v1alpha1",
      projectRoot,
      manifestPath: "distributed:hermes-route-authority",
      checkedAt: now.toISOString(),
      ok: true,
      manifestExists: true,
      plan: authority.webhookPlan,
      summary: {
        plannedRouteCount: routeNames.length,
        manifestRouteCount: routeNames.length,
        missingRouteNames: [],
        staleRouteNames: [],
        unexpectedManagedRouteNames: [],
        preservedExternalRouteCount: 0
      },
      warnings: authority.warnings,
      nextActions: [
        "Use the current hosted authority digest with the workload-authenticated Hermes Route Controller boundary."
      ]
    };
  };
}

function appBindings(input: {
  artifacts: StoredLoopSpecArtifact[];
  installations: WorkspaceAppInstallation[];
  connections: ConnectionInstance[];
}): Record<string, string[]> {
  const activeById = new Map(input.artifacts.map((artifact) => [artifact.loopId, artifact]));
  const knownConnectionIds = new Set(input.connections.map((connection) => connection.id));
  const bindings = new Map<string, Set<string>>();
  for (const installation of input.installations) {
    const loopIds = installation.ownedAssets
      .filter((asset) => asset.kind === "loop_spec" && asset.assetId.startsWith("loop."))
      .map((asset) => asset.assetId.slice("loop.".length))
      .filter((loopId) => activeById.has(loopId));
    for (const loopId of loopIds) {
      const requiredCapabilities = activeById.get(loopId)?.spec.routing?.requiredConnections ?? [];
      const connectionIds = requiredCapabilities.flatMap((capability) => [
        installation.connectionBindings[capability],
        installation.operationBindings[capability]?.connectionId
      ]).filter((connectionId): connectionId is string =>
        Boolean(connectionId && knownConnectionIds.has(connectionId)));
      const current = bindings.get(loopId) ?? new Set<string>();
      for (const connectionId of connectionIds) current.add(connectionId);
      bindings.set(loopId, current);
    }
  }
  return Object.fromEntries(
    [...bindings.entries()]
      .map(([loopId, connectionIds]): [string, string[]] => [loopId, [...connectionIds].sort()])
      .sort(([left], [right]) => left.localeCompare(right))
  );
}

function connectionAuthorityIdentity(connection: ConnectionInstance) {
  return {
    id: connection.id,
    manifestId: connection.manifestId,
    brokerCapabilities: [...connection.brokerCapabilities].sort(),
    capabilityKeys: [...connection.capabilityKeys].sort(),
    grantedScopes: [...connection.grantedScopes].sort(),
    status: connection.status,
    environment: connection.environment,
    brokerEnvironment: connection.brokerEnvironment,
    readPolicy: connection.readPolicy,
    writePolicy: connection.writePolicy
  };
}
