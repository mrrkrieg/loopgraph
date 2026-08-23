import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import {
  contentHash,
  eventEnvelopeSchema,
  routingDecisionActionSchema,
  type DepartmentType,
  type EventEnvelope,
  type RoutingDecision,
  type RoutingCard
} from "../core";
import { LOOPGRAPH_ROUTING_OPS_TOOL_NAMES } from "./routing-ops-tools";
import { LOOPGRAPH_ROUTING_TOOL_NAMES, loopgraph_routing_catalog_get } from "./routing-tools";
import {
  loadHermesRoutingEventFromFile,
  normalizeHermesRoutingEvent,
  runHermesLocalRouteTest,
  type HermesLocalRouteTestResult
} from "./routing-simulation";
import { getLoopgraphRoot } from "./storage-resolver";
import {
  LOOPGRAPH_LIFECYCLE_EVENT_TYPES,
  LOOPGRAPH_LIFECYCLE_ROUTE,
  LOOPGRAPH_LIFECYCLE_ROUTE_KEY
} from "./lifecycle-events";

export const HERMES_WEBHOOK_PLAN_SCHEMA_VERSION = "hermes-webhook-plan/v1alpha1" as const;
export const HERMES_WEBHOOK_SYNC_SCHEMA_VERSION = "hermes-webhook-sync/v1alpha1" as const;
export const HERMES_WEBHOOK_DOCTOR_SCHEMA_VERSION = "hermes-webhook-doctor/v1alpha1" as const;
export const HERMES_WEBHOOK_FIXTURE_TEST_SCHEMA_VERSION = "hermes-webhook-fixture-test/v1alpha1" as const;
export const HERMES_ROUTES_MANIFEST_SCHEMA_VERSION = "hermes-routes-manifest/v1alpha1" as const;

export const hermesWebhooksPlanInputSchema = z.object({
  projectRoot: z.string().optional()
}).default({});

export const hermesWebhooksSyncInputSchema = z.object({
  projectRoot: z.string().optional(),
  dryRun: z.boolean().default(false)
}).default({});

export const hermesWebhooksDoctorInputSchema = z.object({
  projectRoot: z.string().optional()
}).default({});

export const hermesWebhookFixtureTestInputSchema = z.object({
  projectRoot: z.string().optional(),
  fixture: z.string().min(1).optional(),
  event: z.union([
    eventEnvelopeSchema,
    z.record(z.string(), z.unknown())
  ]).optional(),
  sourcePattern: z.string().min(1).optional(),
  expectedAction: routingDecisionActionSchema.optional(),
  expectedLoopIds: z.array(z.string().min(1)).default([]),
  requireSyncedManifest: z.boolean().default(false)
}).superRefine((value, context) => {
  if (!value.fixture && !value.event) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["fixture"],
      message: "fixture or event is required"
    });
  }
  if (value.fixture && value.event) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["event"],
      message: "Provide either fixture or event, not both"
    });
  }
  if (value.expectedAction === "route" && value.expectedLoopIds.length === 0) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["expectedLoopIds"],
      message: "expectedLoopIds is required when expectedAction=route"
    });
  }
});

export type HermesWebhooksPlanInput = z.input<typeof hermesWebhooksPlanInputSchema>;
export type HermesWebhooksSyncInput = z.input<typeof hermesWebhooksSyncInputSchema>;
export type HermesWebhooksDoctorInput = z.input<typeof hermesWebhooksDoctorInputSchema>;
export type HermesWebhookFixtureTestInput = z.input<typeof hermesWebhookFixtureTestInputSchema>;

export type HermesWebhookRoutePlanItem = {
  routeKind: "provider_event" | "loopgraph_lifecycle";
  routeName: string;
  routeId: string;
  sourcePattern: string;
  eventTypePatterns: string[];
  subjectTypes: string[];
  loopIds: string[];
  departments: DepartmentType[];
  requiredFields: string[];
  skills: ["loopgraph-event-router"];
  restrictedMcpTools: Array<
    | "loopgraph_routing_catalog_get"
    | "loopgraph_events_ingest"
    | "loopgraph_routing_decision_submit"
    | "loopgraph_events_get"
    | "loopgraph_problems_get"
    | "loopgraph_routing_decision_get"
    | "loopgraph_graph_get"
  >;
  deliveryMode: "log";
  auth: {
    owner: "hermes";
    secretStorage: "hermes";
    instruction: string;
  };
  transform: {
    outputSchema: "EventEnvelope";
    dropsRawPayload: boolean;
    stableDeliveryIdRequired: boolean;
    untrustedPayloadFields: string[];
  };
  filters: string[];
  configPreview: {
    routeKey: string;
    events: string[];
    skills: ["loopgraph-event-router"];
    deliver: "log";
    mcpTools: string[];
  };
  warnings: string[];
};

export type HermesWebhookPlanResult = {
  schemaVersion: typeof HERMES_WEBHOOK_PLAN_SCHEMA_VERSION;
  projectRoot: string;
  generatedAt: string;
  catalogVersion: string;
  summary: {
    routeCount: number;
    eventFamilyCount: number;
    loopCount: number;
    broadRouteCount: number;
  };
  routes: HermesWebhookRoutePlanItem[];
  warnings: string[];
  nextActions: string[];
};

export type HermesRoutesManifestRoute = {
  managedBy: "loopgraph" | "external";
  routeKind?: "provider_event" | "loopgraph_lifecycle";
  routeName: string;
  routeId?: string;
  sourcePattern?: string;
  eventTypePatterns?: string[];
  subjectTypes?: string[];
  loopIds?: string[];
  departments?: DepartmentType[];
  requiredFields?: string[];
  skills?: string[];
  restrictedMcpTools?: string[];
  deliveryMode?: "log";
  authentication?: {
    owner: "hermes";
    secretStoredInLoopgraph: false;
    instruction: string;
  };
  transform?: HermesWebhookRoutePlanItem["transform"];
  filters?: string[];
  configPreview?: HermesWebhookRoutePlanItem["configPreview"];
  warnings?: string[];
  updatedAt?: string;
};

export type HermesRoutesManifest = {
  schemaVersion: typeof HERMES_ROUTES_MANIFEST_SCHEMA_VERSION;
  managedBy: "loopgraph";
  projectRootHash: string;
  catalogVersion: string;
  updatedAt: string;
  routes: HermesRoutesManifestRoute[];
};

export type HermesWebhookSyncResult = {
  schemaVersion: typeof HERMES_WEBHOOK_SYNC_SCHEMA_VERSION;
  projectRoot: string;
  manifestPath: string;
  dryRun: boolean;
  generatedAt: string;
  plan: HermesWebhookPlanResult;
  summary: {
    plannedRouteCount: number;
    syncedRouteCount: number;
    addedRouteNames: string[];
    updatedRouteNames: string[];
    removedRouteNames: string[];
    preservedExternalRouteCount: number;
  };
  manifest: HermesRoutesManifest;
  nextActions: string[];
};

export type HermesWebhookDoctorResult = {
  schemaVersion: typeof HERMES_WEBHOOK_DOCTOR_SCHEMA_VERSION;
  projectRoot: string;
  manifestPath: string;
  checkedAt: string;
  ok: boolean;
  manifestExists: boolean;
  plan: HermesWebhookPlanResult;
  summary: {
    plannedRouteCount: number;
    manifestRouteCount: number;
    missingRouteNames: string[];
    staleRouteNames: string[];
    unexpectedManagedRouteNames: string[];
    preservedExternalRouteCount: number;
  };
  warnings: string[];
  nextActions: string[];
};

export type HermesWebhookFixtureTestResult = {
  schemaVersion: typeof HERMES_WEBHOOK_FIXTURE_TEST_SCHEMA_VERSION;
  projectRoot: string;
  testedAt: string;
  valid: boolean;
  errors: string[];
  event: EventEnvelope;
  routePlan: {
    catalogVersion: string;
    routeCount: number;
    matchedRoutes: Array<{
      routeName: string;
      routeId: string;
      sourcePattern: string;
      eventTypePatterns: string[];
      loopIds: string[];
      deliveryMode: "log";
    }>;
    manifestRequired: boolean;
    manifestOk?: boolean;
    manifestPath?: string;
  };
  routing: HermesLocalRouteTestResult;
  nextActions: string[];
};

export const LOOPGRAPH_HERMES_WEBHOOK_TOOL_NAMES = [
  "loopgraph_hermes_webhooks_plan",
  "loopgraph_hermes_webhooks_sync",
  "loopgraph_hermes_webhooks_doctor",
  "loopgraph_hermes_webhooks_test"
] as const;

export type LoopgraphHermesWebhookToolName = (typeof LOOPGRAPH_HERMES_WEBHOOK_TOOL_NAMES)[number];

export const loopgraphHermesWebhookToolDefinitions = [
  {
    name: "loopgraph_hermes_webhooks_plan",
    description: "Derive non-secret Hermes webhook gateway route plans from registered Loopgraph routing contracts.",
    readOnly: true,
    idempotent: true
  },
  {
    name: "loopgraph_hermes_webhooks_sync",
    description: "Write a project-local non-secret Hermes route manifest from the current Loopgraph webhook plan.",
    readOnly: false,
    idempotent: true
  },
  {
    name: "loopgraph_hermes_webhooks_doctor",
    description: "Verify the project-local Hermes route manifest matches the current Loopgraph routing catalog.",
    readOnly: true,
    idempotent: true
  },
  {
    name: "loopgraph_hermes_webhooks_test",
    description: "Test a synthetic normalized event fixture against planned Hermes routes and local Loopgraph shadow routing.",
    readOnly: false,
    idempotent: false
  }
] satisfies Array<{
  name: LoopgraphHermesWebhookToolName;
  description: string;
  readOnly: boolean;
  idempotent: boolean;
}>;

export async function callLoopgraphHermesWebhookTool(
  name: LoopgraphHermesWebhookToolName,
  input: unknown,
  options: { projectRoot?: string; now?: Date } = {}
) {
  if (name === "loopgraph_hermes_webhooks_plan") {
    const parsed = hermesWebhooksPlanInputSchema.parse(input);
    return planHermesWebhookRoutes({
      projectRoot: parsed.projectRoot ?? options.projectRoot,
      now: options.now
    });
  }
  if (name === "loopgraph_hermes_webhooks_sync") {
    const parsed = hermesWebhooksSyncInputSchema.parse(input);
    return syncHermesWebhookRoutes({
      projectRoot: parsed.projectRoot ?? options.projectRoot,
      dryRun: parsed.dryRun,
      now: options.now
    });
  }
  if (name === "loopgraph_hermes_webhooks_doctor") {
    const parsed = hermesWebhooksDoctorInputSchema.parse(input);
    return doctorHermesWebhookRoutes({
      projectRoot: parsed.projectRoot ?? options.projectRoot,
      now: options.now
    });
  }
  if (name === "loopgraph_hermes_webhooks_test") {
    const parsed = hermesWebhookFixtureTestInputSchema.parse(input);
    return testHermesWebhookFixture({
      projectRoot: parsed.projectRoot ?? options.projectRoot,
      fixture: parsed.fixture,
      event: parsed.event,
      sourcePattern: parsed.sourcePattern,
      expectedAction: parsed.expectedAction,
      expectedLoopIds: parsed.expectedLoopIds,
      requireSyncedManifest: parsed.requireSyncedManifest,
      now: options.now
    });
  }
  throw new Error(`Unknown Loopgraph Hermes webhook tool: ${String(name)}`);
}

export async function planHermesWebhookRoutes(
  input: HermesWebhooksPlanInput & { now?: Date } = {}
): Promise<HermesWebhookPlanResult> {
  const parsed = hermesWebhooksPlanInputSchema.parse(input);
  const projectRoot = path.resolve(parsed.projectRoot ?? process.cwd());
  const generatedAt = (input.now ?? new Date()).toISOString();
  const catalog = await loopgraph_routing_catalog_get({ projectRoot });
  const routeGroups = new Map<string, MutableRouteGroup>();
  const warnings: string[] = [];

  for (const card of catalog.routingCards) {
    for (const accept of card.accepts) {
      const key = sourceRouteKey(accept.sourcePattern);
      const group = ensureRouteGroup(routeGroups, key, accept.sourcePattern);
      group.cards.set(card.loopId, card);
      group.eventTypePatterns.add(accept.eventTypePattern);
      for (const subjectType of accept.subjectTypes) group.subjectTypes.add(subjectType);
      for (const field of accept.requiredFields) group.requiredFields.add(field);
      for (const warning of warningsForAcceptRule(accept.sourcePattern, accept.eventTypePattern, card.loopId)) {
        group.warnings.add(warning);
        warnings.push(warning);
      }
    }
  }

  const providerRoutes = Array.from(routeGroups.values())
    .map(finalizeRouteGroup)
    .sort((left, right) => left.routeName.localeCompare(right.routeName));
  const routes = [createLifecycleRoutePlanItem(), ...providerRoutes]
    .sort((left, right) => left.routeName.localeCompare(right.routeName));
  const nextActions = nextActionsForRoutes(routes);

  return {
    schemaVersion: HERMES_WEBHOOK_PLAN_SCHEMA_VERSION,
    projectRoot,
    generatedAt,
    catalogVersion: catalog.catalogVersion,
    summary: {
      routeCount: routes.length,
      eventFamilyCount: routes.reduce((total, route) => total + route.eventTypePatterns.length, 0),
      loopCount: new Set(routes.flatMap((route) => route.loopIds)).size,
      broadRouteCount: routes.filter((route) => route.warnings.length > 0).length
    },
    routes,
    warnings: [...new Set(warnings)].sort(),
    nextActions
  };
}

export async function syncHermesWebhookRoutes(
  input: HermesWebhooksSyncInput & { now?: Date } = {}
): Promise<HermesWebhookSyncResult> {
  const parsed = hermesWebhooksSyncInputSchema.parse(input);
  const projectRoot = path.resolve(parsed.projectRoot ?? process.cwd());
  const generatedAt = (input.now ?? new Date()).toISOString();
  const manifestPath = path.join(getLoopgraphRoot(projectRoot), "hermes-routes.json");
  const plan = await planHermesWebhookRoutes({ projectRoot, now: input.now });
  const existingManifest = await readHermesRoutesManifest(manifestPath);
  const existingRoutes = existingManifest?.routes ?? [];
  const existingManaged = existingRoutes.filter((route) => route.managedBy === "loopgraph");
  const preservedExternalRoutes = existingRoutes
    .filter((route) => route.managedBy !== "loopgraph")
    .map(sanitizeExternalRoute)
    .filter((route): route is HermesRoutesManifestRoute => Boolean(route));
  const syncedRoutes = plan.routes.map((route) => routePlanToManifestRoute(route, generatedAt));
  const manifest: HermesRoutesManifest = {
    schemaVersion: HERMES_ROUTES_MANIFEST_SCHEMA_VERSION,
    managedBy: "loopgraph",
    projectRootHash: contentHash(projectRoot),
    catalogVersion: plan.catalogVersion,
    updatedAt: generatedAt,
    routes: [...preservedExternalRoutes, ...syncedRoutes].sort((left, right) =>
      left.routeName.localeCompare(right.routeName)
    )
  };

  assertManifestHasNoSecretValues(manifest);

  if (!parsed.dryRun) {
    await mkdir(path.dirname(manifestPath), { recursive: true });
    await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  }

  const summary = summarizeSync({
    existingManaged,
    syncedRoutes,
    preservedExternalRoutes
  });

  return {
    schemaVersion: HERMES_WEBHOOK_SYNC_SCHEMA_VERSION,
    projectRoot,
    manifestPath,
    dryRun: parsed.dryRun,
    generatedAt,
    plan,
    summary,
    manifest,
    nextActions: nextActionsForSync(parsed.dryRun, manifestPath, plan)
  };
}

export async function doctorHermesWebhookRoutes(
  input: HermesWebhooksDoctorInput & { now?: Date } = {}
): Promise<HermesWebhookDoctorResult> {
  const parsed = hermesWebhooksDoctorInputSchema.parse(input);
  const projectRoot = path.resolve(parsed.projectRoot ?? process.cwd());
  const checkedAt = (input.now ?? new Date()).toISOString();
  const manifestPath = path.join(getLoopgraphRoot(projectRoot), "hermes-routes.json");
  const plan = await planHermesWebhookRoutes({ projectRoot, now: input.now });
  const manifest = await readHermesRoutesManifest(manifestPath);
  const manifestRoutes = manifest?.routes ?? [];
  const managedRoutes = manifestRoutes.filter((route) => route.managedBy === "loopgraph");
  const externalRoutes = manifestRoutes.filter((route) => route.managedBy !== "loopgraph");
  const expectedRoutes = plan.routes.map((route) => routePlanToManifestRoute(route, checkedAt));
  const expectedByIdentity = new Map(expectedRoutes.map((route) => [routeIdentity(route), route]));
  const managedByIdentity = new Map(managedRoutes.map((route) => [routeIdentity(route), route]));
  const missingRouteNames: string[] = [];
  const staleRouteNames: string[] = [];
  const unexpectedManagedRouteNames: string[] = [];
  const warnings = [...plan.warnings];

  for (const [identity, expected] of expectedByIdentity) {
    const actual = managedByIdentity.get(identity);
    if (!actual) {
      missingRouteNames.push(expected.routeName);
    } else if (comparableRouteHash(actual) !== comparableRouteHash(expected)) {
      staleRouteNames.push(expected.routeName);
    }
  }

  for (const [identity, actual] of managedByIdentity) {
    if (!expectedByIdentity.has(identity)) unexpectedManagedRouteNames.push(actual.routeName);
  }

  if (!manifest) warnings.push("Hermes route manifest has not been synced yet.");
  for (const name of missingRouteNames) warnings.push(`Missing Hermes route manifest entry: ${name}.`);
  for (const name of staleRouteNames) warnings.push(`Stale Hermes route manifest entry: ${name}.`);
  for (const name of unexpectedManagedRouteNames) warnings.push(`Unexpected stale Loopgraph-managed route manifest entry: ${name}.`);

  const ok = Boolean(manifest) &&
    missingRouteNames.length === 0 &&
    staleRouteNames.length === 0 &&
    unexpectedManagedRouteNames.length === 0;

  return {
    schemaVersion: HERMES_WEBHOOK_DOCTOR_SCHEMA_VERSION,
    projectRoot,
    manifestPath,
    checkedAt,
    ok,
    manifestExists: Boolean(manifest),
    plan,
    summary: {
      plannedRouteCount: expectedRoutes.length,
      manifestRouteCount: managedRoutes.length,
      missingRouteNames: missingRouteNames.sort(),
      staleRouteNames: staleRouteNames.sort(),
      unexpectedManagedRouteNames: unexpectedManagedRouteNames.sort(),
      preservedExternalRouteCount: externalRoutes.length
    },
    warnings: [...new Set(warnings)].sort(),
    nextActions: nextActionsForDoctor(ok, manifestPath)
  };
}

export async function testHermesWebhookFixture(
  input: HermesWebhookFixtureTestInput & { now?: Date } = {}
): Promise<HermesWebhookFixtureTestResult> {
  const parsed = hermesWebhookFixtureTestInputSchema.parse(input);
  const projectRoot = path.resolve(parsed.projectRoot ?? process.cwd());
  const testedAt = (input.now ?? new Date()).toISOString();
  const event = parsed.fixture
    ? await loadHermesRoutingEventFromFile(parsed.fixture)
    : normalizeHermesRoutingEvent(parsed.event ?? {});
  const plan = await planHermesWebhookRoutes({ projectRoot, now: input.now });
  const matchedRoutes = plan.routes.filter((route) =>
    patternMatches(route.sourcePattern, event.source) &&
    route.eventTypePatterns.some((pattern) => patternMatches(pattern, event.eventType))
  );
  const sourcePatternMatches = !parsed.sourcePattern || patternMatches(parsed.sourcePattern, event.source);
  const manifestDoctor = parsed.requireSyncedManifest
    ? await doctorHermesWebhookRoutes({ projectRoot, now: input.now })
    : undefined;
  const expectedAction = parsed.expectedAction ??
    (parsed.expectedLoopIds.length > 0 ? "route" : undefined);
  const routing = await runHermesLocalRouteTest({
    projectRoot,
    event,
    expectedAction: expectedAction as RoutingDecision["action"] | undefined,
    expectedLoopIds: parsed.expectedLoopIds,
    now: input.now
  });
  const errors = [
    ...(!sourcePatternMatches
      ? [`Fixture source "${event.source}" does not match requested source pattern "${parsed.sourcePattern}".`]
      : []),
    ...(matchedRoutes.length === 0
      ? [`No planned Hermes route accepts ${event.eventType} from ${event.source}. Run webhooks plan/sync or adjust the fixture source/event family.`]
      : []),
    ...(manifestDoctor && !manifestDoctor.ok
      ? [`Synced Hermes route manifest is not current: ${manifestDoctor.warnings.join(" ")}`]
      : []),
    ...routing.errors
  ];
  const valid = errors.length === 0 && routing.valid;

  return {
    schemaVersion: HERMES_WEBHOOK_FIXTURE_TEST_SCHEMA_VERSION,
    projectRoot,
    testedAt,
    valid,
    errors,
    event,
    routePlan: {
      catalogVersion: plan.catalogVersion,
      routeCount: plan.routes.length,
      matchedRoutes: matchedRoutes.map((route) => ({
        routeName: route.routeName,
        routeId: route.routeId,
        sourcePattern: route.sourcePattern,
        eventTypePatterns: route.eventTypePatterns,
        loopIds: route.loopIds,
        deliveryMode: route.deliveryMode
      })),
      manifestRequired: parsed.requireSyncedManifest,
      ...(manifestDoctor ? {
        manifestOk: manifestDoctor.ok,
        manifestPath: manifestDoctor.manifestPath
      } : {})
    },
    routing,
    nextActions: nextActionsForFixtureTest(valid, matchedRoutes, parsed.requireSyncedManifest)
  };
}

type MutableRouteGroup = {
  sourceKey: string;
  sourcePattern: string;
  cards: Map<string, RoutingCard>;
  eventTypePatterns: Set<string>;
  subjectTypes: Set<string>;
  requiredFields: Set<string>;
  warnings: Set<string>;
};

function ensureRouteGroup(groups: Map<string, MutableRouteGroup>, sourceKey: string, sourcePattern: string): MutableRouteGroup {
  const existing = groups.get(sourceKey);
  if (existing) return existing;
  const group: MutableRouteGroup = {
    sourceKey,
    sourcePattern,
    cards: new Map(),
    eventTypePatterns: new Set(),
    subjectTypes: new Set(),
    requiredFields: new Set(),
    warnings: new Set()
  };
  groups.set(sourceKey, group);
  return group;
}

function finalizeRouteGroup(group: MutableRouteGroup): HermesWebhookRoutePlanItem {
  const cards = Array.from(group.cards.values()).sort((left, right) => left.loopName.localeCompare(right.loopName));
  const eventTypePatterns = [...group.eventTypePatterns].sort();
  const routeName = `loopgraph-${group.sourceKey}-events`;
  const restrictedMcpTools = restrictedWebhookToolset();

  return {
    routeKind: "provider_event",
    routeName,
    routeId: `hermes_route_${contentHash({
      sourcePattern: group.sourcePattern,
      eventTypePatterns,
      loopIds: cards.map((card) => card.loopId)
    })}`,
    sourcePattern: group.sourcePattern,
    eventTypePatterns,
    subjectTypes: [...group.subjectTypes].sort(),
    loopIds: cards.map((card) => card.loopId),
    departments: [...new Set(cards.flatMap((card) => card.department ? [card.department] : []))].sort(),
    requiredFields: [...group.requiredFields].sort(),
    skills: ["loopgraph-event-router"],
    restrictedMcpTools,
    deliveryMode: "log",
    auth: {
      owner: "hermes",
      secretStorage: "hermes",
      instruction: "Configure provider-specific signature verification and route secret in Hermes; do not store webhook secrets in Loopgraph."
    },
    transform: {
      outputSchema: "EventEnvelope",
      dropsRawPayload: true,
      stableDeliveryIdRequired: true,
      untrustedPayloadFields: ["normalizedPayload"]
    },
    filters: [
      `Allow source pattern ${group.sourcePattern}.`,
      `Allow event families: ${eventTypePatterns.join(", ")}.`,
      "Drop unrelated raw payload fields before invoking the Loopgraph event-router skill."
    ],
    configPreview: {
      routeKey: routeName,
      events: eventTypePatterns,
      skills: ["loopgraph-event-router"],
      deliver: "log",
      mcpTools: restrictedMcpTools
    },
    warnings: [...group.warnings].sort()
  };
}

function createLifecycleRoutePlanItem(): HermesWebhookRoutePlanItem {
  const eventTypePatterns = [...LOOPGRAPH_LIFECYCLE_EVENT_TYPES];
  const restrictedMcpTools: HermesWebhookRoutePlanItem["restrictedMcpTools"] = [
    "loopgraph_events_ingest",
    "loopgraph_events_get",
    "loopgraph_graph_get"
  ];

  return {
    routeKind: "loopgraph_lifecycle",
    routeName: LOOPGRAPH_LIFECYCLE_ROUTE_KEY,
    routeId: `hermes_route_${contentHash({
      sourceRoute: LOOPGRAPH_LIFECYCLE_ROUTE,
      eventTypePatterns
    })}`,
    sourcePattern: "loopgraph",
    eventTypePatterns,
    subjectTypes: ["business_problem", "loop_run", "route_commit"],
    loopIds: [],
    departments: [],
    requiredFields: ["normalizedPayload.notificationOnly", "normalizedPayload.sourceEventId"],
    skills: ["loopgraph-event-router"],
    restrictedMcpTools,
    deliveryMode: "log",
    auth: {
      owner: "hermes",
      secretStorage: "hermes",
      instruction: "Verify the x-loopgraph-signature HMAC using the Hermes-stored Loopgraph lifecycle secret; do not store the secret in Loopgraph."
    },
    transform: {
      outputSchema: "EventEnvelope",
      dropsRawPayload: true,
      stableDeliveryIdRequired: true,
      untrustedPayloadFields: []
    },
    filters: [
      `Allow sourceRoute ${LOOPGRAPH_LIFECYCLE_ROUTE} from source loopgraph only.`,
      `Allow lifecycle events: ${eventTypePatterns.join(", ")}.`,
      "Require normalizedPayload.notificationOnly=true and stop after durable receipt ingest; lifecycle notifications must not submit RoutingDecision."
    ],
    configPreview: {
      routeKey: LOOPGRAPH_LIFECYCLE_ROUTE_KEY,
      events: eventTypePatterns,
      skills: ["loopgraph-event-router"],
      deliver: "log",
      mcpTools: restrictedMcpTools
    },
    warnings: []
  };
}

function restrictedWebhookToolset(): HermesWebhookRoutePlanItem["restrictedMcpTools"] {
  const allowed = new Set([
    "loopgraph_routing_catalog_get",
    "loopgraph_events_ingest",
    "loopgraph_routing_decision_submit",
    "loopgraph_events_get",
    "loopgraph_problems_get",
    "loopgraph_routing_decision_get",
    "loopgraph_graph_get"
  ]);
  return [...LOOPGRAPH_ROUTING_TOOL_NAMES, ...LOOPGRAPH_ROUTING_OPS_TOOL_NAMES]
    .filter((tool): tool is HermesWebhookRoutePlanItem["restrictedMcpTools"][number] => allowed.has(tool));
}

function sourceRouteKey(sourcePattern: string): string {
  const cleaned = sourcePattern
    .replace(/\*/g, "")
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase();
  return cleaned || "custom";
}

function warningsForAcceptRule(sourcePattern: string, eventTypePattern: string, loopId: string): string[] {
  const warnings: string[] = [];
  if (sourcePattern === "*" || sourcePattern.trim().length === 0) {
    warnings.push(`Loop ${loopId} uses a broad source pattern; narrow the Hermes route before enabling production webhooks.`);
  }
  if (eventTypePattern === "*" || eventTypePattern.trim().length === 0) {
    warnings.push(`Loop ${loopId} uses a broad event pattern; configure a tighter Hermes event allowlist.`);
  }
  return warnings;
}

function patternMatches(pattern: string, value: string): boolean {
  if (pattern === "*") return true;
  const regex = new RegExp(`^${pattern.split("*").map(escapeRegExp).join(".*")}$`);
  return regex.test(value);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function nextActionsForRoutes(routes: HermesWebhookRoutePlanItem[]): string[] {
  const providerRoutes = routes.filter((route) => route.routeKind === "provider_event");
  if (providerRoutes.length === 0) {
    return [
      "Create or update the dedicated Hermes route named loopgraph-lifecycle-events for signed Loopgraph lifecycle callbacks and keep it notification-only.",
      "Materialize at least one LoopSpec with a routing contract before planning external provider Hermes webhook routes."
    ];
  }
  return [
    "Create or update one Hermes webhook gateway route for each planned source pattern; do not point providers directly at Loopgraph.",
    "Create a dedicated Hermes route named loopgraph-lifecycle-events for signed Loopgraph lifecycle callbacks and keep it notification-only.",
    "Configure provider-specific signature verification and secrets inside Hermes.",
    "Install the loopgraph-event-router skill on each route and restrict the route profile to the listed Loopgraph routing tools.",
    "Keep delivery in log/shadow mode until synthetic and shadow routing checks pass."
  ];
}

export async function readHermesRoutesManifest(manifestPath: string): Promise<HermesRoutesManifest | null> {
  try {
    const raw = await readFile(manifestPath, "utf8");
    const parsed = JSON.parse(raw) as unknown;
    if (!isRecord(parsed) || !Array.isArray(parsed.routes)) return null;

    return {
      schemaVersion: HERMES_ROUTES_MANIFEST_SCHEMA_VERSION,
      managedBy: "loopgraph",
      projectRootHash: typeof parsed.projectRootHash === "string" ? parsed.projectRootHash : "",
      catalogVersion: typeof parsed.catalogVersion === "string" ? parsed.catalogVersion : "",
      updatedAt: typeof parsed.updatedAt === "string" ? parsed.updatedAt : "",
      routes: parsed.routes
        .map(sanitizeManifestRoute)
        .filter((route): route is HermesRoutesManifestRoute => Boolean(route))
    };
  } catch {
    return null;
  }
}

function routePlanToManifestRoute(
  route: HermesWebhookRoutePlanItem,
  updatedAt: string
): HermesRoutesManifestRoute {
  return {
    managedBy: "loopgraph",
    routeKind: route.routeKind,
    routeId: route.routeId,
    routeName: route.routeName,
    sourcePattern: route.sourcePattern,
    eventTypePatterns: route.eventTypePatterns,
    subjectTypes: route.subjectTypes,
    loopIds: route.loopIds,
    departments: route.departments,
    requiredFields: route.requiredFields,
    skills: route.skills,
    restrictedMcpTools: route.restrictedMcpTools,
    deliveryMode: route.deliveryMode,
    authentication: {
      owner: "hermes",
      secretStoredInLoopgraph: false,
      instruction: route.auth.instruction
    },
    transform: route.transform,
    filters: route.filters,
    configPreview: route.configPreview,
    warnings: route.warnings,
    updatedAt
  };
}

function sanitizeManifestRoute(value: unknown): HermesRoutesManifestRoute | null {
  if (!isRecord(value)) return null;
  const managedBy = value.managedBy === "loopgraph" ? "loopgraph" : "external";
  if (managedBy === "external") return sanitizeExternalRoute(value);

  const routeName = stringValue(value.routeName);
  if (!routeName) return null;
  return {
    managedBy,
    ...(value.routeKind === "provider_event" || value.routeKind === "loopgraph_lifecycle" ? { routeKind: value.routeKind } : {}),
    routeName,
    ...optionalStringField(value, "routeId"),
    ...optionalStringField(value, "sourcePattern"),
    ...optionalStringArrayField(value, "eventTypePatterns"),
    ...optionalStringArrayField(value, "subjectTypes"),
    ...optionalStringArrayField(value, "loopIds"),
    ...optionalDepartmentArrayField(value, "departments"),
    ...optionalStringArrayField(value, "requiredFields"),
    ...optionalStringArrayField(value, "skills"),
    ...optionalStringArrayField(value, "restrictedMcpTools"),
    ...(value.deliveryMode === "log" ? { deliveryMode: "log" as const } : {}),
    ...optionalAuthentication(value),
    ...optionalTransform(value),
    ...optionalStringArrayField(value, "filters"),
    ...optionalConfigPreview(value),
    ...optionalStringArrayField(value, "warnings"),
    ...optionalStringField(value, "updatedAt")
  };
}

function sanitizeExternalRoute(value: unknown): HermesRoutesManifestRoute | null {
  if (!isRecord(value)) return null;
  const routeName = stringValue(value.routeName) ?? stringValue(value.name);
  if (!routeName) return null;

  return {
    managedBy: "external",
    routeName,
    ...optionalStringField(value, "routeId"),
    ...optionalStringField(value, "sourcePattern"),
    ...optionalStringArrayField(value, "eventTypePatterns"),
    ...optionalStringArrayField(value, "subjectTypes"),
    ...optionalStringField(value, "updatedAt")
  };
}

function summarizeSync(input: {
  existingManaged: HermesRoutesManifestRoute[];
  syncedRoutes: HermesRoutesManifestRoute[];
  preservedExternalRoutes: HermesRoutesManifestRoute[];
}): HermesWebhookSyncResult["summary"] {
  const existingById = new Map(input.existingManaged.map((route) => [routeIdentity(route), route]));
  const syncedById = new Map(input.syncedRoutes.map((route) => [routeIdentity(route), route]));
  const addedRouteNames: string[] = [];
  const updatedRouteNames: string[] = [];
  const removedRouteNames: string[] = [];

  for (const [identity, route] of syncedById) {
    const existing = existingById.get(identity);
    if (!existing) {
      addedRouteNames.push(route.routeName);
    } else if (comparableRouteHash(existing) !== comparableRouteHash(route)) {
      updatedRouteNames.push(route.routeName);
    }
  }

  for (const [identity, route] of existingById) {
    if (!syncedById.has(identity)) removedRouteNames.push(route.routeName);
  }

  return {
    plannedRouteCount: input.syncedRoutes.length,
    syncedRouteCount: input.syncedRoutes.length,
    addedRouteNames: addedRouteNames.sort(),
    updatedRouteNames: updatedRouteNames.sort(),
    removedRouteNames: removedRouteNames.sort(),
    preservedExternalRouteCount: input.preservedExternalRoutes.length
  };
}

function routeIdentity(route: HermesRoutesManifestRoute): string {
  return route.routeId ?? route.routeName;
}

function comparableRouteHash(route: HermesRoutesManifestRoute): string {
  const comparable = { ...route, updatedAt: undefined };
  return contentHash(comparable);
}

function nextActionsForSync(dryRun: boolean, manifestPath: string, plan: HermesWebhookPlanResult): string[] {
  if (dryRun) {
    return [
      "Dry run only; rerun without dryRun to write the project-local Hermes route manifest.",
      ...plan.nextActions
    ];
  }

  return [
    `Wrote non-secret Hermes route metadata to ${manifestPath}.`,
    "Review the manifest, then use Hermes-owned route/config commands to apply it; provider secrets remain in Hermes.",
    ...plan.nextActions
  ];
}

function nextActionsForDoctor(ok: boolean, manifestPath: string): string[] {
  if (ok) {
    return [
      `Hermes route manifest is in sync at ${manifestPath}.`,
      "Keep provider secrets and live subscription application in Hermes."
    ];
  }

  return [
    "Run `loopgraph hermes webhooks sync --project <root>` after reviewing the current route plan.",
    "Then apply or refresh the corresponding Hermes-owned gateway routes without storing secrets in Loopgraph."
  ];
}

function nextActionsForFixtureTest(
  valid: boolean,
  matchedRoutes: HermesWebhookRoutePlanItem[],
  manifestRequired: boolean
): string[] {
  if (!valid) {
    return [
      "Review the fixture source/event family, route manifest sync status, and routing expectation before enabling this provider route.",
      "Keep Hermes delivery in log/shadow mode until the fixture test passes."
    ];
  }

  return [
    `Fixture matched ${matchedRoutes.length} planned Hermes route family${matchedRoutes.length === 1 ? "" : "ies"} and passed local Loopgraph shadow routing.`,
    ...(manifestRequired ? [] : ["Run with requireSyncedManifest=true or --require-synced-manifest before applying a real Hermes provider route."]),
    "Keep provider secrets in Hermes and apply live subscriptions only after signature/allowlist checks are configured."
  ];
}

function assertManifestHasNoSecretValues(value: unknown, trail: string[] = []): void {
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertManifestHasNoSecretValues(item, [...trail, String(index)]));
    return;
  }
  if (!isRecord(value)) return;

  for (const [key, child] of Object.entries(value)) {
    const normalizedKey = key.toLowerCase().replace(/[^a-z0-9]/g, "");
    const childTrail = [...trail, key];
    if (isSecretLikeKey(normalizedKey) && isDisallowedSecretValue(child)) {
      throw new Error(`Refusing to write secret-like value at ${childTrail.join(".")}`);
    }
    assertManifestHasNoSecretValues(child, childTrail);
  }
}

function isSecretLikeKey(normalizedKey: string): boolean {
  return [
    "apikey",
    "token",
    "secret",
    "password",
    "passwd",
    "privatekey",
    "authorization",
    "authheader",
    "credential",
    "clientsecret"
  ].some((fragment) => normalizedKey.includes(fragment));
}

function isDisallowedSecretValue(value: unknown): boolean {
  if (value === false || value === null || value === undefined) return false;
  if (typeof value === "string") {
    return !["", "hermes", "not_stored", "not-in-loopgraph"].includes(value.toLowerCase());
  }
  return typeof value !== "boolean";
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value : undefined;
}

function optionalStringField(record: Record<string, unknown>, key: string): Record<string, string> {
  const value = stringValue(record[key]);
  return value ? { [key]: value } : {};
}

function optionalStringArrayField(record: Record<string, unknown>, key: string): Record<string, string[]> {
  const value = record[key];
  return Array.isArray(value) ? { [key]: value.filter((item): item is string => typeof item === "string") } : {};
}

function optionalDepartmentArrayField(record: Record<string, unknown>, key: string): Record<string, DepartmentType[]> {
  const value = record[key];
  return Array.isArray(value) ? { [key]: value.filter((item): item is DepartmentType => typeof item === "string") } : {};
}

function optionalAuthentication(record: Record<string, unknown>): Pick<HermesRoutesManifestRoute, "authentication"> {
  const value = record.authentication;
  if (!isRecord(value)) return {};
  if (value.owner !== "hermes" || value.secretStoredInLoopgraph !== false) return {};
  const instruction = stringValue(value.instruction);
  if (!instruction) return {};
  return {
    authentication: {
      owner: "hermes",
      secretStoredInLoopgraph: false,
      instruction
    }
  };
}

function optionalTransform(record: Record<string, unknown>): Pick<HermesRoutesManifestRoute, "transform"> {
  const value = record.transform;
  if (!isRecord(value)) return {};
  if (value.outputSchema !== "EventEnvelope") return {};
  if (typeof value.dropsRawPayload !== "boolean") return {};
  if (typeof value.stableDeliveryIdRequired !== "boolean") return {};
  const untrustedPayloadFields = Array.isArray(value.untrustedPayloadFields)
    ? value.untrustedPayloadFields.filter((item): item is string => typeof item === "string")
    : [];
  return {
    transform: {
      outputSchema: "EventEnvelope",
      dropsRawPayload: value.dropsRawPayload,
      stableDeliveryIdRequired: value.stableDeliveryIdRequired,
      untrustedPayloadFields
    }
  };
}

function optionalConfigPreview(record: Record<string, unknown>): Pick<HermesRoutesManifestRoute, "configPreview"> {
  const value = record.configPreview;
  if (!isRecord(value)) return {};
  const routeKey = stringValue(value.routeKey);
  if (!routeKey || value.deliver !== "log") return {};
  const events = Array.isArray(value.events)
    ? value.events.filter((item): item is string => typeof item === "string")
    : [];
  const mcpTools = Array.isArray(value.mcpTools)
    ? value.mcpTools.filter((item): item is string => typeof item === "string")
    : [];
  return {
    configPreview: {
      routeKey,
      events,
      skills: ["loopgraph-event-router"],
      deliver: "log",
      mcpTools
    }
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}
