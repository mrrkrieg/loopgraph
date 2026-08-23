import { randomUUID } from "node:crypto";
import { chmod, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import {
  HERMES_ROUTE_ACTIVATION_PLAN_SCHEMA_VERSION,
  HERMES_ROUTE_ACTIVATION_RECORD_SCHEMA_VERSION,
  HERMES_ROUTE_CONTROLLER_REQUEST_SCHEMA_VERSION,
  contentHash,
  hermesRouteActivationPlanSchema,
  hermesRouteActivationRecordSchema,
  hermesRouteControllerReceiptSchema,
  type HermesRouteActivationPlan,
  type HermesRouteActivationRecord,
  type HermesRouteActivationRoute,
  type HermesRouteControllerRequest,
  type HermesRouteControllerReceipt,
  type ConnectorManifest,
  type ConnectionInstance
} from "../core";
import { defaultConnectorManifests, readConnectionInstances } from "./connector-registry";
import {
  doctorHermesWebhookRoutes,
  readHermesRoutesManifest,
  type HermesWebhookRoutePlanItem
} from "./hermes-webhooks";
import { appInstallationRegistrySchema } from "./app-installation-store";
import { FileLoopSpecRegistryStore } from "./loop-spec-store";
import { assertSecretFree, redactSensitiveString } from "./secret-redaction";
import { getLoopgraphRoot } from "./storage-resolver";
import type { WorkloadTokenProvider } from "./workload-token-provider";

export const HERMES_ROUTE_ACTIVATION_FILE = "hermes-route-activation.json" as const;

export const hermesRouteActivationPrepareInputSchema = z.object({
  projectRoot: z.string().optional()
}).default({});

export const hermesRouteActivationStatusInputSchema = z.object({
  projectRoot: z.string().optional()
}).default({});

export const LOOPGRAPH_HERMES_ROUTE_ACTIVATION_TOOL_NAMES = [
  "loopgraph_hermes_webhooks_prepare",
  "loopgraph_hermes_webhooks_activation_status"
] as const;

export type LoopgraphHermesRouteActivationToolName =
  (typeof LOOPGRAPH_HERMES_ROUTE_ACTIVATION_TOOL_NAMES)[number];

export const loopgraphHermesRouteActivationToolDefinitions = [
  {
    name: "loopgraph_hermes_webhooks_prepare",
    description: "Prepare the exact secret-free Hermes shadow-route controller contract and confirmation digest.",
    readOnly: true,
    idempotent: true
  },
  {
    name: "loopgraph_hermes_webhooks_activation_status",
    description: "Read whether the last Hermes route-controller receipt is current and every provider route is ready.",
    readOnly: true,
    idempotent: true
  }
] satisfies Array<{
  name: LoopgraphHermesRouteActivationToolName;
  description: string;
  readOnly: boolean;
  idempotent: boolean;
}>;

export async function callLoopgraphHermesRouteActivationTool(
  name: LoopgraphHermesRouteActivationToolName,
  input: unknown,
  options: { projectRoot?: string; now?: Date } = {}
) {
  if (name === "loopgraph_hermes_webhooks_prepare") {
    const parsed = hermesRouteActivationPrepareInputSchema.parse(input);
    return prepareHermesRouteActivation({
      projectRoot: parsed.projectRoot ?? options.projectRoot,
      now: options.now
    });
  }
  if (name === "loopgraph_hermes_webhooks_activation_status") {
    const parsed = hermesRouteActivationStatusInputSchema.parse(input);
    return getHermesRouteActivationStatus({
      projectRoot: parsed.projectRoot ?? options.projectRoot,
      now: options.now
    });
  }
  throw new Error(`Unknown Loopgraph Hermes route activation tool: ${String(name)}`);
}

export type PrepareHermesRouteActivationInput = {
  projectRoot?: string;
  now?: Date;
};

export type ActivateHermesRoutesInput = PrepareHermesRouteActivationInput & {
  controllerUrl: string;
  audience: string;
  confirmationDigest: string;
  tokenProvider: WorkloadTokenProvider;
  fetcher?: typeof fetch;
};

export type HermesRouteActivationStatus = {
  projectRoot: string;
  recordPath: string;
  checkedAt: string;
  exists: boolean;
  current: boolean;
  ready: boolean;
  planDigest?: string;
  currentPlanDigest?: string;
  routeStates: Array<{
    routeId: string;
    routeName: string;
    routeKind: HermesRouteActivationRoute["routeKind"];
    loopIds: string[];
    state: HermesRouteControllerReceipt["routes"][number]["state"];
    subscriptionState: HermesRouteControllerReceipt["routes"][number]["subscriptionState"];
    signatureVerificationConfigured: boolean;
    ready: boolean;
  }>;
  warnings: string[];
  nextActions: string[];
};

export async function prepareHermesRouteActivation(
  input: PrepareHermesRouteActivationInput = {}
): Promise<HermesRouteActivationPlan> {
  const projectRoot = path.resolve(input.projectRoot ?? process.cwd());
  const generatedAt = (input.now ?? new Date()).toISOString();
  const doctor = await doctorHermesWebhookRoutes({ projectRoot, now: input.now });
  if (!doctor.ok) {
    throw new HermesRouteActivationError(
      "manifest_not_current",
      "Hermes route activation requires a current .loopgraph/hermes-routes.json manifest"
    );
  }
  const manifest = await readHermesRoutesManifest(doctor.manifestPath);
  if (!manifest) {
    throw new HermesRouteActivationError("manifest_missing", "Hermes route manifest is missing");
  }

  const connections = await readConnectionInstances(projectRoot);
  const connectorManifests = defaultConnectorManifests();
  const appConnectionBindingsByLoopId = await readAppConnectionBindingsByLoopId(projectRoot);
  const warnings = [...doctor.warnings];
  const routes = doctor.plan.routes.flatMap((route) => {
    if (route.routeKind !== "provider_event") {
      return [activationRoute(route, {
        transformerId: route.routeKind === "loopgraph_lifecycle"
          ? "loopgraph-lifecycle-event-envelope/v1alpha1"
          : route.sourcePattern === "hermes"
            ? "hermes-business-event-envelope/v1alpha1"
            : "loopgraph-business-event-envelope/v1alpha1",
        connectionIds: []
      })];
    }
    const candidates = connectorCandidatesForRoute(
      route,
      connectorManifests,
      connections,
      appConnectionBindingsByLoopId
    );
    if (candidates.length === 0) {
      throw new HermesRouteActivationError(
        "transformer_unresolved",
        route.sourcePattern === "*"
          ? `Wildcard Hermes route ${route.routeName} cannot be activated until a connected provider selects its reviewed transformer`
          : `No reviewed Hermes transformer contract is registered for source pattern ${route.sourcePattern}`
      );
    }
    return candidates.map(({ connector, connectionIds, loopIds }) => {
      const scopedRoute = scopeRouteToLoops(route, loopIds);
      const specialized = route.sourcePattern === "*"
        ? specializeWildcardRoute(scopedRoute, connector.id, connector.webhook!.routeNameTemplate, connector.webhook!.sourcePatterns[0]!)
        : scopedRoute;
      if (connectionIds.length === 0) {
        warnings.push(`Route ${specialized.routeName} has no connected ${connector.label} installation; Hermes may prepare the route but must keep its subscription pending.`);
      }
      return activationRoute(specialized, {
        transformerId: connector.webhook!.transformVersion,
        connectionIds
      });
    });
  }).sort((left, right) => left.routeName.localeCompare(right.routeName));
  const manifestDigest = contentHash(manifest);
  const planIdentity = {
    projectRootHash: manifest.projectRootHash,
    catalogVersion: manifest.catalogVersion,
    manifestDigest,
    controllerProtocol: HERMES_ROUTE_CONTROLLER_REQUEST_SCHEMA_VERSION,
    destructiveChangesAllowed: false as const,
    routes
  };
  const plan = hermesRouteActivationPlanSchema.parse({
    schemaVersion: HERMES_ROUTE_ACTIVATION_PLAN_SCHEMA_VERSION,
    ...planIdentity,
    planDigest: contentHash(planIdentity),
    generatedAt,
    warnings: [...new Set(warnings)].sort(),
    nextActions: [
      "Review the exact route, profile, transformer, connection, and restricted-tool contracts.",
      "Pass planDigest to `loopgraph hermes webhooks activate --confirm <digest>` using a projected workload token readable only by the current user.",
      "Hermes owns webhook secrets and provider subscription changes; Loopgraph stores only the resulting secret-free receipt.",
      "A controller may add or update shadow routes, but this protocol never authorizes route deletion or live execution."
    ]
  });
  assertSecretFree(plan, "Hermes route activation plan");
  return plan;
}

export async function activateHermesRoutes(
  input: ActivateHermesRoutesInput
): Promise<HermesRouteActivationRecord> {
  const projectRoot = path.resolve(input.projectRoot ?? process.cwd());
  const now = input.now ?? new Date();
  const plan = await prepareHermesRouteActivation({ projectRoot, now });
  if (input.confirmationDigest !== plan.planDigest) {
    throw new HermesRouteActivationError(
      "confirmation_digest_mismatch",
      `Activation confirmation must equal current plan digest ${plan.planDigest}`
    );
  }
  const request = controllerRequest(plan, now);
  const controller = new HermesRouteControllerClient({
    url: input.controllerUrl,
    audience: input.audience,
    tokenProvider: input.tokenProvider,
    fetcher: input.fetcher
  });
  const receipt = await controller.reconcile(request);
  verifyControllerReceipt(request, receipt);
  const desiredById = new Map(plan.routes.map((route) => [route.routeId, route]));
  const ready = receipt.routes.every((route) => {
    const desired = desiredById.get(route.routeId);
    return Boolean(desired && routeReceiptReady(desired, route));
  });
  const record = hermesRouteActivationRecordSchema.parse({
    schemaVersion: HERMES_ROUTE_ACTIVATION_RECORD_SCHEMA_VERSION,
    activatedAt: now.toISOString(),
    controllerOrigin: controller.origin,
    ready,
    requestDigest: contentHash(request),
    plan,
    receipt
  });
  assertSecretFree(record, "Hermes route activation record");
  await writeActivationRecord(projectRoot, record);
  return record;
}

export async function getHermesRouteActivationStatus(
  input: PrepareHermesRouteActivationInput = {}
): Promise<HermesRouteActivationStatus> {
  const projectRoot = path.resolve(input.projectRoot ?? process.cwd());
  const recordPath = activationRecordPath(projectRoot);
  const checkedAt = (input.now ?? new Date()).toISOString();
  const record = await readActivationRecord(projectRoot);
  if (!record) {
    return {
      projectRoot,
      recordPath,
      checkedAt,
      exists: false,
      current: false,
      ready: false,
      routeStates: [],
      warnings: ["No Hermes route activation receipt exists for this project."],
      nextActions: ["Run `loopgraph hermes webhooks prepare`, review the plan, then activate it through the Hermes route controller."]
    };
  }

  let currentPlan: HermesRouteActivationPlan | undefined;
  let planError: string | undefined;
  try {
    currentPlan = await prepareHermesRouteActivation({ projectRoot, now: input.now });
  } catch (error) {
    planError = redactSensitiveString(error instanceof Error ? error.message : "Current route plan could not be prepared");
  }
  const current = Boolean(currentPlan && currentPlan.planDigest === record.plan.planDigest);
  const ready = current && record.ready;
  const warnings = [
    ...(planError ? [planError] : []),
    ...(!current ? ["The applied Hermes route receipt does not match the current Loopgraph route plan."] : []),
    ...record.receipt.routes.flatMap((route) => route.errors.map((error) => `${route.routeName}: ${error}`))
  ];
  return {
    projectRoot,
    recordPath,
    checkedAt,
    exists: true,
    current,
    ready,
    planDigest: record.plan.planDigest,
    currentPlanDigest: currentPlan?.planDigest,
    routeStates: record.receipt.routes.map((route) => {
      const desired = record.plan.routes.find((candidate) => candidate.routeId === route.routeId)!;
      return {
        routeId: route.routeId,
        routeName: route.routeName,
        routeKind: desired.routeKind,
        loopIds: desired.loopIds,
        state: route.state,
        subscriptionState: route.subscriptionState,
        signatureVerificationConfigured: route.signatureVerificationConfigured,
        ready: routeReceiptReady(desired, route)
      };
    }),
    warnings: [...new Set(warnings)].sort(),
    nextActions: ready
      ? ["Hermes routes match the current Loopgraph plan and remain in shadow/log mode."]
      : ["Prepare and apply the current plan again, then resolve every pending connection, confirmation, or signature-verification state in Hermes."]
  };
}

export class HermesRouteControllerClient {
  readonly origin: string;
  private readonly url: URL;

  constructor(private readonly options: {
    url: string;
    audience: string;
    tokenProvider: WorkloadTokenProvider;
    fetcher?: typeof fetch;
  }) {
    this.url = trustedControllerUrl(options.url);
    this.origin = this.url.origin;
    if (!options.audience.trim()) throw new Error("Hermes route controller audience is required");
  }

  async reconcile(request: HermesRouteControllerRequest): Promise<HermesRouteControllerReceipt> {
    assertSecretFree(request, "Hermes route controller request");
    const token = await this.options.tokenProvider.getToken({ audience: this.options.audience });
    const response = await (this.options.fetcher ?? fetch)(this.url, {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        accept: "application/json",
        "content-type": "application/json",
        "x-loopgraph-request-id": request.requestId,
        "x-loopgraph-plan-digest": request.planDigest
      },
      body: JSON.stringify(request),
      redirect: "error",
      signal: AbortSignal.timeout(15_000)
    });
    const declaredLength = Number(response.headers.get("content-length") ?? "0");
    if (Number.isFinite(declaredLength) && declaredLength > 512 * 1024) {
      throw new HermesRouteActivationError("controller_response_too_large", "Hermes route controller response exceeded 512 KiB");
    }
    const body = await response.text();
    if (Buffer.byteLength(body, "utf8") > 512 * 1024) {
      throw new HermesRouteActivationError("controller_response_too_large", "Hermes route controller response exceeded 512 KiB");
    }
    if (!response.ok) {
      throw new HermesRouteActivationError(
        "controller_request_failed",
        `Hermes route controller rejected activation (${response.status}): ${safeControllerError(body)}`
      );
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(body);
    } catch {
      throw new HermesRouteActivationError("controller_receipt_invalid", "Hermes route controller returned invalid JSON");
    }
    const receipt = hermesRouteControllerReceiptSchema.parse(parsed);
    assertSecretFree(receipt, "Hermes route controller receipt");
    return receipt;
  }
}

export class HermesRouteActivationError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
    this.name = "HermesRouteActivationError";
  }
}

function activationRoute(
  route: HermesWebhookRoutePlanItem,
  input: { transformerId: string; connectionIds: string[] }
): HermesRouteActivationRoute {
  const routeIdentity = {
    routeId: route.routeId,
    routeName: route.routeName,
    routeKind: route.routeKind,
    sourcePattern: route.sourcePattern,
    eventTypePatterns: route.eventTypePatterns,
    subjectTypes: route.subjectTypes,
    loopIds: route.loopIds,
    requiredCapabilities: route.requiredConnections,
    profileId: route.routeKind === "loopgraph_lifecycle"
      ? "loopgraph_lifecycle_router" as const
      : "loopgraph_webhook_router" as const,
    skills: route.skills,
    restrictedMcpTools: route.restrictedMcpTools,
    deliveryMode: route.deliveryMode,
    activationMode: "shadow" as const,
    authentication: {
      owner: "hermes" as const,
      signatureVerificationRequired: true as const,
      secretStoredInLoopgraph: false as const
    },
    transformation: {
      transformerId: input.transformerId,
      outputSchema: "EventEnvelope" as const,
      dropsRawPayload: true as const,
      stableDeliveryIdRequired: true as const
    },
    subscription: {
      owner: "hermes" as const,
      policy: route.routeKind === "provider_event"
        ? "configure_if_connected" as const
        : "notification_only" as const,
      connectionIds: input.connectionIds,
      required: route.routeKind === "provider_event"
    },
    filters: route.filters
  };
  return {
    ...routeIdentity,
    configDigest: contentHash(routeIdentity)
  };
}

function connectorCandidatesForRoute(
  route: HermesWebhookRoutePlanItem,
  manifests: ConnectorManifest[],
  connections: ConnectionInstance[],
  bindingsByLoopId: ReadonlyMap<string, ReadonlySet<string>>
): Array<{ connector: ConnectorManifest; connectionIds: string[]; loopIds: string[] }> {
  const usableConnections = connections.filter((connection) => connection.status !== "missing");
  const matched = route.sourcePattern === "*"
    ? manifests.filter((connector) =>
        connector.webhook && usableConnections.some((connection) => connection.manifestId === connector.id))
    : manifests.filter((connector) => connector.webhook?.sourcePatterns.some((pattern) =>
        patternsOverlap(pattern, route.sourcePattern)));
  const candidates = matched
    .filter((connector) => connector.webhook)
    .map((connector) => {
      const connectorConnections = usableConnections.filter((connection) => connection.manifestId === connector.id);
      const loopIds = route.loopIds.filter((loopId) => {
        const bindings = bindingsByLoopId.get(loopId);
        return bindings === undefined || connectorConnections.some((connection) => bindings.has(connection.id));
      });
      const hasUnboundLoop = loopIds.some((loopId) => !bindingsByLoopId.has(loopId));
      const connectionIds = connectorConnections
        .filter((connection) => hasUnboundLoop || loopIds.some((loopId) => bindingsByLoopId.get(loopId)?.has(connection.id)))
        .map((connection) => connection.id)
        .sort();
      return { connector, connectionIds, loopIds };
    })
    .filter((candidate) => candidate.loopIds.length > 0)
    .sort((left, right) => left.connector.id.localeCompare(right.connector.id));
  const coveredLoopIds = new Set(candidates.flatMap((candidate) => candidate.loopIds));
  const missingAppLoopIds = route.loopIds.filter((loopId) =>
    bindingsByLoopId.has(loopId) && !coveredLoopIds.has(loopId));
  if (missingAppLoopIds.length > 0) {
    throw new HermesRouteActivationError(
      "app_route_binding_unresolved",
      `Hermes route ${route.routeName} has no reviewed connected transformer for App loop(s): ${missingAppLoopIds.join(", ")}`
    );
  }
  return candidates;
}

async function readAppConnectionBindingsByLoopId(projectRoot: string): Promise<Map<string, Set<string>>> {
  const registryPath = path.join(getLoopgraphRoot(projectRoot), "apps", "installations.json");
  let registry: z.infer<typeof appInstallationRegistrySchema>;
  try {
    registry = appInstallationRegistrySchema.parse(JSON.parse(await readFile(registryPath, "utf8")));
  } catch (error) {
    if (isFileNotFound(error)) return new Map();
    throw new HermesRouteActivationError(
      "app_installation_registry_invalid",
      "Hermes route activation cannot trust the App installation registry"
    );
  }

  const loopSpecStore = new FileLoopSpecRegistryStore(projectRoot);
  const [{ workspace }, activeArtifacts] = await Promise.all([
    loopSpecStore.getWorkspace(projectRoot),
    loopSpecStore.listActiveLoopSpecs(projectRoot)
  ]);
  const artifactByLoopId = new Map(activeArtifacts.map((artifact) => [artifact.loopId, artifact]));
  const bindingsByLoopId = new Map<string, Set<string>>();
  for (const installation of registry.installations) {
    const installationSegment = `${path.sep}installations${path.sep}${installation.id}${path.sep}`;
    const loopIds = workspace.registeredSpecs
      .filter((entry) => path.resolve(workspace.projectRoot, entry.path).includes(installationSegment))
      .map((entry) => entry.id);
    for (const loopId of loopIds) {
      const requiredCapabilities = artifactByLoopId.get(loopId)?.spec.routing?.requiredConnections ?? [];
      const connectionIds = new Set(requiredCapabilities.flatMap((capability) => {
        const direct = installation.connectionBindings[capability];
        const operation = installation.operationBindings[capability]?.connectionId;
        return [...(direct ? [direct] : []), ...(operation ? [operation] : [])];
      }));
      const current = bindingsByLoopId.get(loopId) ?? new Set<string>();
      for (const connectionId of connectionIds) current.add(connectionId);
      bindingsByLoopId.set(loopId, current);
    }
  }
  return bindingsByLoopId;
}

function scopeRouteToLoops(
  route: HermesWebhookRoutePlanItem,
  loopIds: string[]
): HermesWebhookRoutePlanItem {
  if (loopIds.length === route.loopIds.length && loopIds.every((loopId, index) => loopId === route.loopIds[index])) {
    return route;
  }
  const selected = new Set(loopIds);
  const requiredConnections = route.requiredConnectionsByLoopId
    ? [...new Set(Object.entries(route.requiredConnectionsByLoopId)
        .filter(([loopId]) => selected.has(loopId))
        .flatMap(([, capabilities]) => capabilities))].sort()
    : route.requiredConnections;
  return { ...route, loopIds, requiredConnections };
}

function specializeWildcardRoute(
  route: HermesWebhookRoutePlanItem,
  connectorId: string,
  routeNameTemplate: string,
  sourcePattern: string
): HermesWebhookRoutePlanItem {
  const routeIdentity = {
    logicalRouteId: route.routeId,
    connectorId,
    sourcePattern,
    eventTypePatterns: route.eventTypePatterns,
    loopIds: route.loopIds
  };
  return {
    ...route,
    routeName: `${routeNameTemplate}-${contentHash(routeIdentity)}`,
    routeId: `hermes_route_${contentHash(routeIdentity)}`,
    sourcePattern,
    filters: [
      `Accept provider events from ${sourcePattern} through the reviewed ${connectorId} transformer.`,
      ...route.filters
    ]
  };
}

function controllerRequest(plan: HermesRouteActivationPlan, now: Date): HermesRouteControllerRequest {
  return {
    schemaVersion: HERMES_ROUTE_CONTROLLER_REQUEST_SCHEMA_VERSION,
    requestId: `hermes_route_reconcile_${contentHash({ planDigest: plan.planDigest, requestedAt: now.toISOString() })}`,
    requestedAt: now.toISOString(),
    projectRootHash: plan.projectRootHash,
    catalogVersion: plan.catalogVersion,
    manifestDigest: plan.manifestDigest,
    planDigest: plan.planDigest,
    operation: "reconcile_shadow_routes",
    destructiveChangesAllowed: false,
    routes: plan.routes
  };
}

function verifyControllerReceipt(
  request: HermesRouteControllerRequest,
  receipt: HermesRouteControllerReceipt
): void {
  for (const field of ["requestId", "projectRootHash", "catalogVersion", "manifestDigest", "planDigest"] as const) {
    if (receipt[field] !== request[field]) {
      throw new HermesRouteActivationError("controller_receipt_scope_mismatch", `Hermes route controller receipt changed ${field}`);
    }
  }
  if (receipt.destructiveChangesApplied) {
    throw new HermesRouteActivationError("controller_destructive_change", "Hermes route controller applied an unauthorized destructive change");
  }
  const desiredById = new Map(request.routes.map((route) => [route.routeId, route]));
  const receivedById = new Map(receipt.routes.map((route) => [route.routeId, route]));
  if (desiredById.size !== receivedById.size) {
    throw new HermesRouteActivationError("controller_receipt_route_mismatch", "Hermes route controller receipt route count does not match the request");
  }
  for (const [routeId, desired] of desiredById) {
    const actual = receivedById.get(routeId);
    if (!actual || actual.routeName !== desired.routeName) {
      throw new HermesRouteActivationError("controller_receipt_route_mismatch", `Hermes route controller omitted or renamed route ${desired.routeName}`);
    }
    if (
      actual.appliedConfigDigest !== desired.configDigest ||
      actual.profileId !== desired.profileId ||
      contentHash(actual.skills) !== contentHash(desired.skills) ||
      contentHash(actual.restrictedMcpTools) !== contentHash(desired.restrictedMcpTools) ||
      actual.transformerId !== desired.transformation.transformerId
    ) {
      throw new HermesRouteActivationError("controller_receipt_contract_mismatch", `Hermes route controller did not prove the exact contract for ${desired.routeName}`);
    }
    if (actual.routeUrl) assertSafeRouteUrl(actual.routeUrl);
    if (
      desired.subscription.required &&
      desired.subscription.connectionIds.length === 0 &&
      actual.subscriptionState === "active"
    ) {
      throw new HermesRouteActivationError("controller_receipt_connection_mismatch", `Hermes route ${desired.routeName} claimed an active subscription without a bound connection`);
    }
    if (desired.subscription.required && actual.subscriptionState === "not_applicable") {
      throw new HermesRouteActivationError("controller_receipt_subscription_mismatch", `Hermes route ${desired.routeName} requires an active provider subscription`);
    }
    if (actual.state === "shadow" && !actual.signatureVerificationConfigured) {
      throw new HermesRouteActivationError("signature_verification_missing", `Hermes route ${desired.routeName} entered shadow state without signature verification`);
    }
  }
}

function trustedControllerUrl(value: string): URL {
  const url = new URL(value);
  if (url.username || url.password || url.search || url.hash) {
    throw new Error("Hermes route controller URL must not contain credentials, query, or fragment");
  }
  const loopback = ["localhost", "127.0.0.1", "::1"].includes(url.hostname);
  if (url.protocol !== "https:" && !(url.protocol === "http:" && loopback)) {
    throw new Error("Hermes route controller URL must use HTTPS or loopback HTTP");
  }
  return url;
}

function assertSafeRouteUrl(value: string): void {
  const url = new URL(value);
  if (url.username || url.password || url.search || url.hash) {
    throw new HermesRouteActivationError("route_url_unsafe", "Hermes route URL must not contain credentials, query, or fragment");
  }
  const loopback = ["localhost", "127.0.0.1", "::1"].includes(url.hostname);
  if (url.protocol !== "https:" && !(url.protocol === "http:" && loopback)) {
    throw new HermesRouteActivationError("route_url_unsafe", "Hermes route URL must use HTTPS or loopback HTTP");
  }
}

function safeControllerError(body: string): string {
  try {
    const parsed = JSON.parse(body) as Record<string, unknown>;
    const message = typeof parsed.error === "string" ? parsed.error : "request rejected";
    return redactSensitiveString(message).slice(0, 500);
  } catch {
    return redactSensitiveString(body).slice(0, 500) || "request rejected";
  }
}

function patternsOverlap(left: string, right: string): boolean {
  return patternMatches(left, right.replace(/\*/g, "sample")) || patternMatches(right, left.replace(/\*/g, "sample"));
}

function patternMatches(pattern: string, value: string): boolean {
  if (pattern === "*") return true;
  const escaped = pattern.split("*").map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join(".*");
  return new RegExp(`^${escaped}$`).test(value);
}

export function activationRecordPath(projectRoot: string): string {
  return path.join(getLoopgraphRoot(projectRoot), HERMES_ROUTE_ACTIVATION_FILE);
}

async function readActivationRecord(projectRoot: string): Promise<HermesRouteActivationRecord | null> {
  try {
    const record = hermesRouteActivationRecordSchema.parse(JSON.parse(await readFile(activationRecordPath(projectRoot), "utf8")));
    verifyStoredActivationRecord(record);
    return record;
  } catch (error) {
    if (isFileNotFound(error)) return null;
    throw new HermesRouteActivationError("activation_record_invalid", "Stored Hermes route activation receipt is invalid");
  }
}

function verifyStoredActivationRecord(record: HermesRouteActivationRecord): void {
  const receipt = record.receipt;
  const plan = record.plan;
  if (
    receipt.projectRootHash !== plan.projectRootHash ||
    receipt.catalogVersion !== plan.catalogVersion ||
    receipt.manifestDigest !== plan.manifestDigest ||
    receipt.planDigest !== plan.planDigest
  ) {
    throw new Error("Stored Hermes route receipt changed its activation-plan scope");
  }
  const desiredById = new Map(plan.routes.map((route) => [route.routeId, route]));
  const receivedById = new Map(receipt.routes.map((route) => [route.routeId, route]));
  if (desiredById.size !== receivedById.size) {
    throw new Error("Stored Hermes route receipt changed its route set");
  }
  for (const [routeId, desired] of desiredById) {
    const actual = receivedById.get(routeId);
    if (!actual || actual.routeName !== desired.routeName) {
      throw new Error(`Stored Hermes route receipt omitted or renamed ${desired.routeName}`);
    }
    if (
      actual.appliedConfigDigest !== desired.configDigest ||
      actual.profileId !== desired.profileId ||
      contentHash(actual.skills) !== contentHash(desired.skills) ||
      contentHash(actual.restrictedMcpTools) !== contentHash(desired.restrictedMcpTools) ||
      actual.transformerId !== desired.transformation.transformerId
    ) {
      throw new Error(`Stored Hermes route receipt changed the exact contract for ${desired.routeName}`);
    }
    if (actual.routeUrl) assertSafeRouteUrl(actual.routeUrl);
    if (actual.state === "shadow" && !actual.signatureVerificationConfigured) {
      throw new Error(`Stored Hermes route ${desired.routeName} lacks signature verification`);
    }
    if (
      desired.subscription.required &&
      desired.subscription.connectionIds.length === 0 &&
      actual.subscriptionState === "active"
    ) {
      throw new Error(`Stored Hermes route ${desired.routeName} claims an unbound active subscription`);
    }
    if (desired.subscription.required && actual.subscriptionState === "not_applicable") {
      throw new Error(`Stored Hermes route ${desired.routeName} requires an active provider subscription`);
    }
  }
  const derivedReady = receipt.routes.every((route) => {
    const desired = desiredById.get(route.routeId);
    return Boolean(desired && routeReceiptReady(desired, route));
  });
  if (record.ready !== derivedReady) {
    throw new Error("Stored Hermes route readiness does not match its route receipts");
  }
  assertSecretFree(record, "stored Hermes route activation record");
}

function routeReceiptReady(
  desired: HermesRouteActivationRoute,
  actual: HermesRouteControllerReceipt["routes"][number]
): boolean {
  return actual.state === "shadow" &&
    actual.signatureVerificationConfigured &&
    (desired.subscription.required
      ? actual.subscriptionState === "active"
      : ["active", "not_applicable"].includes(actual.subscriptionState));
}

async function writeActivationRecord(projectRoot: string, record: HermesRouteActivationRecord): Promise<void> {
  const filePath = activationRecordPath(projectRoot);
  await mkdir(path.dirname(filePath), { recursive: true, mode: 0o700 });
  const temporaryPath = `${filePath}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(temporaryPath, `${JSON.stringify(record, null, 2)}\n`, { mode: 0o600, flag: "wx" });
  if (process.platform !== "win32") await chmod(temporaryPath, 0o600);
  await rename(temporaryPath, filePath);
  if (process.platform !== "win32") await chmod(filePath, 0o600);
}

function isFileNotFound(error: unknown): boolean {
  return Boolean(error && typeof error === "object" && "code" in error && error.code === "ENOENT");
}
