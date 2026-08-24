import { readFile } from "node:fs/promises";
import path from "node:path";
import YAML from "yaml";
import {
  APP_INSTALL_SCHEMA_VERSION,
  APP_EVAL_SCHEMA_VERSION,
  appEvalRunSchema,
  appHistoricalReplayRequestSchema,
  appPromotionRecommendationSchema,
  contentHash,
  evaluateRoutingEligibility,
  type AppEvalRun,
  type AppHistoricalReplayRequest,
  type AppPromotionRecommendation,
  type RoutingCard,
  type WorkspaceAppInstallation
} from "../core";
import { appEvalSuiteSchema, type AppEvalSuite } from "../core/app-pack-content";
import type { CompiledLoopPack } from "./app-pack-compiler";
import type { LoopPackLoadResult } from "./app-pack-loader";

type AppDecisionAction = NonNullable<AppEvalRun["scenarios"][number]["actualAction"]>;

type QualityDecision = {
  action: AppDecisionAction;
  loopId?: string;
  approvalRequired: boolean;
  reason: string;
};

type QualityEvent = {
  id: string;
  source: string;
  eventType: string;
  subject: { type: string; id: string };
  normalizedPayload: Record<string, unknown>;
  evidenceRefs: string[];
  connectorState: "connected" | "degraded" | "unavailable";
  sourceDeliveryId?: string;
};

const REQUIRED_CONFORMANCE_CATEGORIES = {
  happy_path: ["high-fit", "happy-path"],
  missing_context: ["missing-enrichment", "missing-context"],
  exclusion: ["existing-customer", "exclusion", "low-fit"],
  duplicate: ["duplicate-lead", "duplicate"],
  ambiguous_route: ["ambiguous-account", "ambiguous-route"],
  low_confidence: ["low-confidence"],
  connector_unavailable: ["connector-unavailable"],
  missing_field: ["missing-field"],
  human_approval: ["approval-required", "human-approval"],
  customer_facing_action: ["customer-facing-action"],
  missing_outcome: ["outcome-unavailable", "missing-outcome"],
  retry_idempotency: ["retry-replay", "retry-idempotency"],
  upgrade_rollback: ["upgrade-rollback"]
} as const;

export function createSyntheticValidationInstallation(
  loaded: LoopPackLoadResult,
  actor: string
): WorkspaceAppInstallation {
  const { manifest, artifact } = loaded;
  return {
    schemaVersion: APP_INSTALL_SCHEMA_VERSION,
    id: `validation.${manifest.metadata.id}`,
    workspaceId: "publisher-validation",
    appId: manifest.metadata.id,
    version: manifest.metadata.version,
    artifactDigest: artifact.digest,
    state: "ready_to_test",
    mode: "simulation",
    selectedModules: manifest.modules.map((moduleDefinition) => moduleDefinition.id),
    presetId: "validation",
    configuration: {
      schemaVersion: "loopgraph-app-configuration/v1alpha1",
      appId: manifest.metadata.id,
      version: manifest.metadata.version,
      fields: [],
      values: {},
      provenance: {},
      completedAt: new Date(0).toISOString()
    },
    connectionBindings: {},
    operationBindings: {},
    fieldMappingIds: [],
    permissions: manifest.permissions.map((permission) => ({
      capability: permission.capability,
      authority: permission.authority,
      decision: permission.defaultPolicy === "allowed" ? "allow" : permission.defaultPolicy === "forbidden" ? "forbid" : "approval_required",
      reason: "Synthetic conformance keeps provider execution blocked.",
      changedFromInstalled: false
    })),
    ownedAssets: [],
    history: [],
    installedAt: new Date(0).toISOString(),
    updatedAt: new Date(0).toISOString(),
    installedBy: actor
  };
}

export async function runAppSyntheticConformance(input: {
  loaded: LoopPackLoadResult;
  compiled: CompiledLoopPack;
  installation: WorkspaceAppInstallation;
  actor: string;
  now: Date;
}): Promise<AppEvalRun> {
  const suites = await loadEvalSuites(input.loaded, input.compiled.activeEntrypoints.evals);
  const activeLoopIds = new Set(input.compiled.loopSpecs.map((spec) => spec.metadata.id));
  const scenarios = [] as AppEvalRun["scenarios"];
  for (const suite of suites) {
    for (const scenario of suite.scenarios) {
      const fixture = asRecord(JSON.parse(await readFile(resolvePackFile(input.loaded.root, scenario.fixture), "utf8")));
      const event = fixtureToQualityEvent(fixture, scenario, input.compiled.routingCards);
      const decision = evaluateQualityEvent(event, input.compiled);
      const expectedLoopEnabled = !scenario.expectedLoopId || activeLoopIds.has(scenario.expectedLoopId);
      const expectedAction = expectedLoopEnabled ? scenario.expectedAction : "unhandled" as const;
      const expectedLoopId = expectedLoopEnabled ? scenario.expectedLoopId : undefined;
      const expectedApproval = expectedLoopEnabled ? scenario.expectedApproval : false;
      const passed = decision.action === expectedAction &&
        (!expectedLoopId || decision.loopId === expectedLoopId) &&
        decision.approvalRequired === expectedApproval;
      scenarios.push({
        id: scenario.id,
        status: passed ? "passed" : "failed",
        sourceEventId: event.id,
        expectedAction,
        actualAction: decision.action,
        expectedRoute: expectedLoopId,
        actualRoute: decision.loopId,
        approvalRequired: decision.approvalRequired,
        reason: decision.reason,
        evidenceRefs: [`fixture:${scenario.fixture}`]
      });
    }
  }

  const scenarioIds = new Set(scenarios.map((scenario) => scenario.id));
  for (const [category, aliases] of Object.entries(REQUIRED_CONFORMANCE_CATEGORIES)) {
    if (aliases.some((alias) => scenarioIds.has(alias))) continue;
    scenarios.push({
      id: `coverage-${category.replaceAll("_", "-")}`,
      status: "failed",
      reason: `Marketplace quality contract is missing a ${category.replaceAll("_", " ")} scenario.`,
      evidenceRefs: []
    });
  }

  const unsafePermission = input.installation.permissions.some((permission) =>
    permission.authority === "execute" && permission.decision === "allow");
  if (unsafePermission) {
    scenarios.push({
      id: "provider-write-safety",
      status: "failed",
      reason: "An execute permission is enabled during conformance; installation must remain write-blocked.",
      evidenceRefs: []
    });
  }
  const passedCount = scenarios.filter((scenario) => scenario.status === "passed").length;
  const failedCount = scenarios.filter((scenario) => scenario.status === "failed").length;
  const startedAt = input.now.toISOString();
  return appEvalRunSchema.parse({
    schemaVersion: APP_EVAL_SCHEMA_VERSION,
    id: `eval.${contentHash({ installationId: input.installation.id, level: "synthetic", startedAt, actor: input.actor })}`,
    installationId: input.installation.id,
    appId: input.installation.appId,
    appVersion: input.installation.version,
    artifactDigest: input.installation.artifactDigest,
    level: "synthetic",
    status: failedCount === 0 ? "passed" : "failed",
    replay: false,
    writeBlocked: true,
    startedAt,
    completedAt: startedAt,
    scenarios,
    metrics: {
      passed: passedCount,
      failed: failedCount,
      total: scenarios.length,
      coverageRequired: Object.keys(REQUIRED_CONFORMANCE_CATEGORIES).length,
      providerWrites: 0
    },
    evidenceRefs: suites.map((suite) => `eval-suite:${suite.id}`)
  });
}

export function runAppHistoricalReplay(input: {
  request: AppHistoricalReplayRequest;
  compiled: CompiledLoopPack;
  installation: WorkspaceAppInstallation;
  now: Date;
}): AppEvalRun {
  const request = appHistoricalReplayRequestSchema.parse(input.request);
  if (request.installationId !== input.installation.id) {
    throw new Error("Historical replay request belongs to another installation");
  }
  const scenarios = request.events.map((event) => {
    const decision = evaluateQualityEvent({
      id: event.id,
      source: event.source,
      eventType: event.eventType,
      subject: event.subject,
      normalizedPayload: event.normalizedPayload,
      evidenceRefs: event.evidenceRefs,
      connectorState: event.connectorState
    }, input.compiled);
    const hasExpected = Boolean(event.expectedAction || event.expectedLoopId);
    const passed = (!event.expectedAction || decision.action === event.expectedAction) &&
      (!event.expectedLoopId || decision.loopId === event.expectedLoopId);
    return {
      id: `replay.${contentHash(event.id)}`,
      status: hasExpected && !passed ? "failed" as const : "passed" as const,
      sourceEventId: event.id,
      expectedAction: event.expectedAction,
      actualAction: decision.action,
      expectedRoute: event.expectedLoopId,
      actualRoute: decision.loopId,
      approvalRequired: decision.approvalRequired,
      reason: decision.reason,
      evidenceRefs: [...event.evidenceRefs, `historical-event:${event.id}`]
    };
  });
  const routed = scenarios.filter((scenario) => scenario.actualAction === "route").length;
  const abstained = scenarios.filter((scenario) => scenario.actualAction === "request_human").length;
  const deferred = scenarios.filter((scenario) => scenario.actualAction === "defer").length;
  const failed = scenarios.filter((scenario) => scenario.status === "failed").length;
  const startedAt = input.now.toISOString();
  return appEvalRunSchema.parse({
    schemaVersion: APP_EVAL_SCHEMA_VERSION,
    id: `eval.${contentHash({ installationId: input.installation.id, level: "historical_replay", request, startedAt })}`,
    installationId: input.installation.id,
    appId: input.installation.appId,
    appVersion: input.installation.version,
    artifactDigest: input.installation.artifactDigest,
    level: "historical_replay",
    status: failed === 0 ? "passed" : "failed",
    replay: true,
    writeBlocked: true,
    startedAt,
    completedAt: startedAt,
    sourceWindow: { from: request.from, to: request.to },
    scenarios,
    metrics: {
      eventCount: scenarios.length,
      routed,
      abstained,
      deferred,
      failedExpectations: failed,
      providerWrites: 0,
      estimatedReviewMinutes: 0
    },
    evidenceRefs: [
      `historical-window:${request.from}/${request.to}`,
      `historical-input-digest:${contentHash(request.events)}`
    ]
  });
}

export function createPromotionRecommendation(input: {
  installationId: string;
  evaluations: AppEvalRun[];
  now: Date;
}): AppPromotionRecommendation {
  const runs = input.evaluations.filter((run) => run.installationId === input.installationId);
  const synthetic = [...runs].reverse().find((run) => run.level === "synthetic");
  const replay = [...runs].reverse().find((run) => run.level === "historical_replay");
  const replayScenarios = replay?.scenarios ?? [];
  const labeled = replayScenarios.filter((scenario) => scenario.humanLabel);
  const falsePositives = labeled.filter((scenario) => scenario.humanLabel === "false_positive").length;
  const incomplete = labeled.filter((scenario) => scenario.humanLabel === "incomplete").length;
  const falsePositiveRate = labeled.length ? falsePositives / labeled.length : undefined;
  const incompleteRate = labeled.length ? incomplete / labeled.length : undefined;
  const estimatedReviewMinutes = replayScenarios.reduce((total, scenario) => total + (scenario.reviewMinutes ?? 0), 0);
  const gates: AppPromotionRecommendation["gates"] = [
    {
      id: "synthetic-conformance",
      status: synthetic?.status === "passed" ? "pass" : "fail",
      summary: synthetic?.status === "passed" ? "Required deterministic conformance passed." : "A passing deterministic conformance run is required."
    },
    {
      id: "historical-replay",
      status: replay?.status === "passed" ? "pass" : replay ? "fail" : "warn",
      summary: replay?.status === "passed" ? "Bounded historical replay completed with no failed expectations." : replay ? "Historical replay has failed expectations." : "Historical replay has not been run."
    },
    {
      id: "human-labels",
      status: replay && labeled.length === replayScenarios.length && labeled.length > 0 ? "pass" : replay ? "warn" : "warn",
      summary: replay && labeled.length === replayScenarios.length && labeled.length > 0
        ? "Every historical decision has a human judgment."
        : `${labeled.length} of ${replayScenarios.length} historical decisions have human judgments.`
    },
    {
      id: "false-positive-rate",
      status: falsePositiveRate === undefined ? "warn" : falsePositiveRate <= 0.05 ? "pass" : "fail",
      summary: falsePositiveRate === undefined ? "False-positive rate needs reviewer labels." : `Observed false-positive rate is ${(falsePositiveRate * 100).toFixed(1)}%.`
    },
    {
      id: "incomplete-rate",
      status: incompleteRate === undefined ? "warn" : incompleteRate <= 0.05 ? "pass" : "fail",
      summary: incompleteRate === undefined ? "Incomplete-decision rate needs reviewer labels." : `Observed incomplete-decision rate is ${(incompleteRate * 100).toFixed(1)}%.`
    },
    {
      id: "review-burden",
      status: !replayScenarios.length ? "warn" : estimatedReviewMinutes / replayScenarios.length <= 5 ? "pass" : "warn",
      summary: `${estimatedReviewMinutes.toFixed(1)} review minutes recorded across ${replayScenarios.length} historical decisions.`
    }
  ];
  const hasFailure = gates.some((gate) => gate.status === "fail");
  const fullyLabeled = replayScenarios.length > 0 && labeled.length === replayScenarios.length;
  const recommendedMode = hasFailure
    ? "hold" as const
    : replay?.status === "passed" && fullyLabeled
      ? "recommend" as const
      : synthetic?.status === "passed"
        ? "shadow" as const
        : "hold" as const;
  const passingGates = gates.filter((gate) => gate.status === "pass").length;
  return appPromotionRecommendationSchema.parse({
    schemaVersion: APP_EVAL_SCHEMA_VERSION,
    installationId: input.installationId,
    recommendedMode,
    canAutoPromote: false,
    confidence: passingGates / gates.length,
    falsePositiveRate,
    incompleteRate,
    estimatedReviewMinutes,
    gates,
    requiredApprovals: recommendedMode === "recommend" ? ["app_owner", "promotion_approver"] : ["app_owner"],
    evidenceRefs: runs.map((run) => run.id),
    evaluatedAt: input.now.toISOString()
  });
}

function evaluateQualityEvent(event: QualityEvent, compiled: CompiledLoopPack): QualityDecision {
  const cards = compiled.routingCards.map((card) => ({ ...card, currentReadiness: "ready" as const, loopStatus: "active" as const }));
  const eventEnvelope = {
    id: event.id,
    schemaVersion: "event-envelope/v1alpha1" as const,
    workspaceId: "replay",
    companyId: "replay",
    source: event.source,
    sourceRoute: `app-quality:${event.source}`,
    sourceDeliveryId: event.sourceDeliveryId ?? event.id,
    eventType: event.eventType,
    occurredAt: new Date(0).toISOString(),
    receivedAt: new Date(0).toISOString(),
    subject: event.subject,
    correlationId: event.id,
    hopCount: 0,
    normalizedPayload: event.normalizedPayload,
    evidenceRefs: event.evidenceRefs,
    trust: { signatureVerified: true, untrustedFields: [] as string[] },
    sensitivity: "confidential" as const
  };
  const candidates = cards
    .filter((card) => card.accepts.some((rule) =>
      wildcardMatch(rule.sourcePattern, event.source) &&
      wildcardMatch(rule.eventTypePattern, event.eventType) &&
      (rule.subjectTypes.length === 0 || rule.subjectTypes.includes(event.subject.type))))
    .sort((left, right) => right.priority - left.priority);
  const primaryCandidate = candidates[0];

  if (event.connectorState !== "connected") {
    return { action: "defer", loopId: primaryCandidate?.loopId, approvalRequired: false, reason: `Connector state is ${event.connectorState}; replay cannot assume provider availability.` };
  }
  const candidateSubjectIds = Array.isArray(event.normalizedPayload.candidateSubjectIds)
    ? event.normalizedPayload.candidateSubjectIds
    : event.normalizedPayload.candidateAccountIds;
  if (Array.isArray(candidateSubjectIds) && candidateSubjectIds.length > 1) {
    return { action: "request_human", loopId: primaryCandidate?.loopId, approvalRequired: false, reason: "Multiple subject identities match the event." };
  }
  if (event.normalizedPayload.excluded === true || event.normalizedPayload.existingCustomer === true) {
    return { action: "request_human", approvalRequired: false, reason: "The event matches an explicit app exclusion and requires a bounded alternate route or human decision." };
  }
  if (typeof event.normalizedPayload.permissionChange === "string") {
    return { action: "request_human", approvalRequired: true, reason: "Permission changes require explicit update review and a rollback plan." };
  }
  if (typeof event.normalizedPayload.matchedProblemId === "string" ||
      typeof event.normalizedPayload.matchedLeadId === "string" ||
      Number(event.normalizedPayload.deliveryAttempt ?? 0) > 1) {
    return { action: "append_evidence", loopId: primaryCandidate?.loopId, approvalRequired: false, reason: "The event is additional evidence for existing work and cannot create duplicate work." };
  }
  const confidence = Number(event.normalizedPayload.confidence ?? 1);
  if (primaryCandidate && Number.isFinite(confidence) && confidence < primaryCandidate.minimumConfidence) {
    return { action: "request_human", loopId: primaryCandidate.loopId, approvalRequired: false, reason: `Confidence ${confidence.toFixed(2)} is below the loop minimum ${primaryCandidate.minimumConfidence.toFixed(2)}.` };
  }

  const eligible = cards
    .map((card) => evaluateRoutingEligibility(eventEnvelope, card))
    .filter((result) => result.eligible)
    .sort((left, right) => right.card.priority - left.card.priority);
  if (eligible.length > 1) {
    return { action: "request_human", approvalRequired: false, reason: "Multiple loops are eligible and explicit fan-out was not proven." };
  }
  if (eligible.length === 0 && primaryCandidate) {
    return { action: "request_human", loopId: primaryCandidate.loopId, approvalRequired: false, reason: "A matching loop family lacks required context, so Hermes must abstain." };
  }
  if (eligible.length === 0) {
    return { action: "unhandled", approvalRequired: false, reason: "No installed loop claims this event family." };
  }
  const loopId = eligible[0].card.loopId;
  return {
    action: "route",
    loopId,
    approvalRequired: loopRequiresApproval(loopId, compiled),
    reason: `The event satisfies the active routing contract for ${eligible[0].card.loopName}.`
  };
}

function loopRequiresApproval(loopId: string, compiled: CompiledLoopPack): boolean {
  const spec = compiled.loopSpecs.find((candidate) => candidate.metadata.id === loopId);
  if (!spec) return false;
  return spec.policy.allowedActions.some((action) => action.requiresApproval) ||
    (spec.approval.separateCustomerFacingApproval && spec.policy.allowedActions.some((action) => action.customerFacing));
}

function fixtureToQualityEvent(fixture: Record<string, unknown>, scenario: AppEvalSuite["scenarios"][number], cards: RoutingCard[]): QualityEvent {
  const normalizedPayload = asRecord(fixture.normalizedPayload);
  const subject = asRecord(fixture.subject);
  const eventType = String(fixture.eventType ?? "unknown");
  const expectedCard = scenario.expectedLoopId ? cards.find((card) => card.loopId === scenario.expectedLoopId) : undefined;
  const matchingRule = expectedCard?.accepts.find((rule) => wildcardMatch(rule.eventTypePattern, eventType)) ??
    expectedCard?.accepts[0] ??
    cards.flatMap((card) => card.accepts).find((rule) => wildcardMatch(rule.eventTypePattern, eventType));
  const source = matchingRule && !matchingRule.sourcePattern.includes("*") ? matchingRule.sourcePattern : "fixture";
  return {
    id: String(fixture.id ?? scenario.id),
    source,
    eventType,
    subject: { type: String(subject.type ?? "unknown"), id: String(subject.id ?? scenario.id) },
    normalizedPayload,
    evidenceRefs: Array.isArray(fixture.evidenceRefs) ? fixture.evidenceRefs.filter((value): value is string => typeof value === "string") : [],
    connectorState: scenario.connectorState,
    sourceDeliveryId: typeof fixture.sourceDeliveryId === "string" ? fixture.sourceDeliveryId : undefined
  };
}

async function loadEvalSuites(loaded: LoopPackLoadResult, entrypoints = loaded.manifest.entrypoints.evals): Promise<AppEvalSuite[]> {
  return Promise.all(entrypoints.map(async (relativePath) =>
    appEvalSuiteSchema.parse(YAML.parse(await readFile(resolvePackFile(loaded.root, relativePath), "utf8")))));
}

function resolvePackFile(root: string, relativePath: string): string {
  const absolute = path.resolve(root, relativePath);
  const relative = path.relative(root, absolute);
  if (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error(`Pack path escapes root: ${relativePath}`);
  }
  return absolute;
}

function wildcardMatch(pattern: string, value: string): boolean {
  if (pattern === "*") return true;
  const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replaceAll("*", ".*");
  return new RegExp(`^${escaped}$`).test(value);
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
