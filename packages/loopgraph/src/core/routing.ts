import { z } from "zod";
import { DepartmentTypeSchema, normalizeDepartmentType } from "./department-skills";
import { contentHash, loopSpecHash } from "./hash";
import type { LoopSpec } from "./loop-spec";

export const EVENT_ENVELOPE_SCHEMA_VERSION = "event-envelope/v1alpha1" as const;
export const ROUTING_CONTRACT_SCHEMA_VERSION = "routing-contract/v1alpha1" as const;
export const ROUTING_CARD_SCHEMA_VERSION = "routing-card/v1alpha1" as const;
export const ROUTING_DECISION_SCHEMA_VERSION = "routing-decision/v1alpha1" as const;
export const ROUTE_JOB_SCHEMA_VERSION = "route-job/v1alpha1" as const;

const jsonObjectSchema = z.record(z.string(), z.unknown());

export const routingActivationModeSchema = z.enum([
  "shadow",
  "recommend",
  "simulate",
  "execute_with_approval",
  "autonomous_low_risk"
]);

export type RoutingActivationMode = z.infer<typeof routingActivationModeSchema>;

export const routingAmbiguityPolicySchema = z.enum(["ignore", "defer", "request_human", "route_to_triage"]);
export const routingNoMatchPolicySchema = z.enum(["unhandled", "ignore", "request_human"]);
export const routingFanoutModeSchema = z.enum(["none", "independent_only", "declared_ordered"]);
export const routingDecisionActionSchema = z.enum([
  "route",
  "append_evidence",
  "ignore",
  "defer",
  "request_human",
  "unhandled"
]);

export const eventSubjectSchema = z.object({
  type: z.string().min(1),
  id: z.string().min(1),
  display: z.string().optional()
});

export const payloadReferenceSchema = z.object({
  ref: z.string().min(1),
  hash: z.string().optional(),
  storage: z.string().optional()
});

export const eventEnvelopeSchema = z.object({
  id: z.string().min(1),
  schemaVersion: z.literal(EVENT_ENVELOPE_SCHEMA_VERSION).default(EVENT_ENVELOPE_SCHEMA_VERSION),
  workspaceId: z.string().min(1),
  companyId: z.string().min(1),
  source: z.string().min(1),
  sourceRoute: z.string().min(1),
  sourceDeliveryId: z.string().min(1),
  eventType: z.string().min(1),
  occurredAt: z.string().datetime(),
  receivedAt: z.string().datetime(),
  subject: eventSubjectSchema,
  correlationId: z.string().min(1),
  causationId: z.string().optional(),
  parentEventId: z.string().optional(),
  hopCount: z.number().int().min(0).default(0),
  normalizedPayload: jsonObjectSchema.default({}),
  rawPayloadRef: payloadReferenceSchema.optional(),
  evidenceRefs: z.array(z.string().min(1).max(2048)).max(100).default([]),
  trust: z.object({
    signatureVerified: z.boolean().default(false),
    signer: z.string().optional(),
    untrustedFields: z.array(z.string().max(512)).max(100).default([])
  }).default({ signatureVerified: false, untrustedFields: [] }),
  sensitivity: z.enum(["public", "internal", "confidential", "restricted"]).default("internal")
});

export const routingAcceptRuleSchema = z.object({
  sourcePattern: z.string().min(1),
  eventTypePattern: z.string().min(1),
  subjectTypes: z.array(z.string().min(1)).default([]),
  requiredFields: z.array(z.string().min(1)).default([]),
  optionalConditions: z.array(jsonObjectSchema).default([]),
  reason: z.string().optional()
});

export const routingExcludeRuleSchema = z.object({
  sourcePattern: z.string().min(1).default("*"),
  eventTypePattern: z.string().min(1).default("*"),
  subjectTypes: z.array(z.string().min(1)).default([]),
  fields: z.array(z.string().min(1)).default([]),
  reason: z.string().min(1)
});

export const loopInputMappingSchema = z.record(z.string().min(1), z.string().min(1));

export const loopRoutingContractSchema = z.object({
  schemaVersion: z.literal(ROUTING_CONTRACT_SCHEMA_VERSION).default(ROUTING_CONTRACT_SCHEMA_VERSION),
  problemTypes: z.array(z.string().min(1)).min(1),
  accepts: z.array(routingAcceptRuleSchema).min(1),
  excludes: z.array(routingExcludeRuleSchema).default([]),
  inputMapping: loopInputMappingSchema.default({}),
  priority: z.number().int().default(0),
  minimumConfidence: z.number().min(0).max(1).default(0.75),
  ambiguityPolicy: routingAmbiguityPolicySchema.default("request_human"),
  noMatchPolicy: routingNoMatchPolicySchema.default("unhandled"),
  fanoutPolicy: z.object({
    mode: routingFanoutModeSchema.default("none"),
    maxRoutes: z.number().int().min(1).default(1),
    requiresIndependentProblems: z.boolean().default(true)
  }).default({ mode: "none", maxRoutes: 1, requiresIndependentProblems: true }),
  cooldown: z.object({
    seconds: z.number().int().min(0).default(0),
    dedupeWindowSeconds: z.number().int().min(0).default(0)
  }).default({ seconds: 0, dedupeWindowSeconds: 0 }),
  concurrency: z.object({
    maxActive: z.number().int().min(1).default(1),
    strategy: z.enum(["reject", "append_evidence", "queue"]).default("append_evidence")
  }).default({ maxActive: 1, strategy: "append_evidence" }),
  activationMode: routingActivationModeSchema.default("shadow"),
  lifecycleEvents: z.array(z.string().min(1)).default([]),
  requiredConnections: z.array(z.string().min(1)).default([]),
  examples: z.object({
    shouldRoute: z.array(z.string()).default([]),
    shouldNotRoute: z.array(z.string()).default([])
  }).default({ shouldRoute: [], shouldNotRoute: [] })
});

export const routingCardSchema = z.object({
  schemaVersion: z.literal(ROUTING_CARD_SCHEMA_VERSION).default(ROUTING_CARD_SCHEMA_VERSION),
  catalogVersion: z.string().min(1),
  loopId: z.string().min(1),
  loopName: z.string().min(1),
  department: DepartmentTypeSchema.optional(),
  goal: z.string().min(1),
  currentReadiness: z.enum(["ready", "degraded", "blocked", "unknown"]).default("unknown"),
  loopStatus: z.enum(["active", "disabled", "draft"]).default("active"),
  problemTypes: z.array(z.string().min(1)).min(1),
  explicitNonGoals: z.array(z.string()).default([]),
  accepts: z.array(routingAcceptRuleSchema).min(1),
  excludes: z.array(routingExcludeRuleSchema).default([]),
  primaryAction: z.string().optional(),
  actionRisk: z.enum(["low", "medium", "high", "critical"]).default("low"),
  activationMode: routingActivationModeSchema.default("shadow"),
  minimumConfidence: z.number().min(0).max(1),
  priority: z.number().int(),
  ambiguityPolicy: loopRoutingContractSchema.shape.ambiguityPolicy,
  noMatchPolicy: loopRoutingContractSchema.shape.noMatchPolicy,
  fanoutPolicy: loopRoutingContractSchema.shape.fanoutPolicy,
  cooldown: loopRoutingContractSchema.shape.cooldown,
  concurrency: loopRoutingContractSchema.shape.concurrency,
  inputMapping: loopInputMappingSchema.default({}),
  requiredConnections: z.array(z.string().min(1)).default([]),
  lifecycleEvents: loopRoutingContractSchema.shape.lifecycleEvents,
  currentState: z.object({
    activeRuns: z.number().int().min(0).default(0),
    cooldownUntil: z.string().datetime().optional()
  }).default({ activeRuns: 0 }),
  examples: loopRoutingContractSchema.shape.examples,
  routingContractVersion: z.literal(ROUTING_CONTRACT_SCHEMA_VERSION).default(ROUTING_CONTRACT_SCHEMA_VERSION),
  loopSpecHash: z.string().min(1)
});

export const businessProblemSchema = z.object({
  id: z.string().min(1),
  workspaceId: z.string().min(1),
  companyId: z.string().min(1),
  problemType: z.string().min(1),
  subject: eventSubjectSchema,
  summary: z.string().min(1),
  severity: z.enum(["low", "medium", "high", "critical"]).default("medium"),
  status: z.enum([
    "detected",
    "needs_human",
    "routed",
    "in_progress",
    "waiting",
    "resolved",
    "closed",
    "unhandled"
  ]),
  correlationId: z.string().min(1),
  dedupeKey: z.string().min(1),
  evidenceEventIds: z.array(z.string().min(1)).default([]),
  primaryLoopId: z.string().optional(),
  supportingLoopIds: z.array(z.string()).default([]),
  routeCommitIds: z.array(z.string()).default([]),
  owner: z.string().optional(),
  slaDueAt: z.string().datetime().optional(),
  outcomeRefs: z.array(z.string()).default([]),
  openedAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  resolvedAt: z.string().datetime().optional()
});

export const routingProblemProposalSchema = z.object({
  summary: z.string().min(1),
  problemTypes: z.array(z.string().min(1)).default([]),
  subject: eventSubjectSchema,
  severity: z.enum(["low", "medium", "high", "critical"]).default("medium"),
  dedupeKeyInputs: z.array(z.string()).default([])
});

export const selectedRouteSchema = z.object({
  loopId: z.string().min(1),
  role: z.enum(["primary", "supporting"]).default("primary"),
  confidence: z.number().min(0).max(1),
  reasonSummary: z.string().min(1),
  evidenceRefs: z.array(z.string().min(1)).default([]),
  inputMapping: z.record(z.string(), z.unknown()).default({}),
  priority: z.number().int().default(0)
});

export const routingAlternativeSchema = z.object({
  loopId: z.string().min(1),
  confidence: z.number().min(0).max(1),
  reasonSummary: z.string().min(1)
});

export const routingDecisionSchema = z.object({
  schemaVersion: z.literal(ROUTING_DECISION_SCHEMA_VERSION).default(ROUTING_DECISION_SCHEMA_VERSION),
  eventId: z.string().min(1),
  catalogVersion: z.string().min(1),
  action: routingDecisionActionSchema,
  existingProblemId: z.string().optional(),
  problem: routingProblemProposalSchema.optional(),
  selectedRoutes: z.array(selectedRouteSchema).default([]),
  alternatives: z.array(routingAlternativeSchema).default([]),
  fanoutReason: z.string().optional(),
  modelMetadata: z.record(z.string(), z.unknown()).default({}),
  policyVersion: z.string().min(1)
});

export const eventReceiptSchema = z.object({
  id: z.string().min(1),
  eventId: z.string().min(1),
  event: eventEnvelopeSchema,
  eventHash: z.string().min(1),
  status: z.enum(["received", "duplicate", "ignored", "replayed", "failed"]),
  duplicateOfEventId: z.string().optional(),
  firstSeenAt: z.string().datetime(),
  lastSeenAt: z.string().datetime()
});

export const routingAttemptSchema = z.object({
  id: z.string().min(1),
  eventId: z.string().min(1),
  catalogVersion: z.string().min(1),
  action: routingDecisionActionSchema.optional(),
  status: z.enum(["received", "validated", "rejected", "committed", "failed"]),
  decision: routingDecisionSchema.optional(),
  validationErrors: z.array(z.string()).default([]),
  hermesMetadata: z.record(z.string(), z.unknown()).default({}),
  createdAt: z.string().datetime()
});

export const routeCommitSchema = z.object({
  id: z.string().min(1),
  eventId: z.string().min(1),
  problemId: z.string().min(1),
  loopId: z.string().min(1),
  loopSpecHash: z.string().min(1),
  routeAttemptId: z.string().min(1),
  runId: z.string().optional(),
  status: z.enum(["shadow", "queued", "running", "waiting_review", "completed", "failed", "cancelled"]),
  inputMapping: z.record(z.string(), z.unknown()).default({}),
  committedAt: z.string().datetime()
});

export const routeJobStatusSchema = z.enum([
  "queued",
  "claimed",
  "dispatched",
  "running",
  "waiting_review",
  "completed",
  "failed",
  "dead_letter",
  "cancelled"
]);

export const routeExecutionTargetSchema = z.object({
  runtime: z.enum(["loopgraph_local", "hermes"]),
  environment: z.enum(["local", "sandbox", "staging", "production"]),
  requiredCapabilities: z.array(z.string().min(1).max(160)).max(250).default([]),
  preferredAgentInstanceId: z.string().min(1).max(160).optional()
});

export const routeJobSchema = z.object({
  schemaVersion: z.literal(ROUTE_JOB_SCHEMA_VERSION).default(ROUTE_JOB_SCHEMA_VERSION),
  id: z.string().min(1),
  idempotencyKey: z.string().min(1),
  eventId: z.string().min(1),
  problemId: z.string().min(1),
  routeCommitId: z.string().min(1),
  routeAttemptId: z.string().min(1),
  loopId: z.string().min(1),
  loopSpecHash: z.string().min(1),
  runId: z.string().min(1),
  activationMode: routingActivationModeSchema,
  executionTarget: routeExecutionTargetSchema.default({
    runtime: "loopgraph_local",
    environment: "local",
    requiredCapabilities: []
  }),
  status: routeJobStatusSchema,
  correlationId: z.string().min(1),
  attemptCount: z.number().int().min(0).default(0),
  maxAttempts: z.number().int().min(1).default(3),
  retryPolicy: z.object({
    baseDelaySeconds: z.number().int().min(1).default(30),
    maxDelaySeconds: z.number().int().min(1).default(3600),
    backoffMultiplier: z.number().min(1).default(2)
  }).default({ baseDelaySeconds: 30, maxDelaySeconds: 3600, backoffMultiplier: 2 }),
  nextRunAt: z.string().datetime(),
  lease: z.object({
    claimedBy: z.string().min(1),
    leaseToken: z.string().min(1).optional(),
    claimedAt: z.string().datetime(),
    expiresAt: z.string().datetime(),
    heartbeatAt: z.string().datetime().optional()
  }).optional(),
  result: z.object({
    traceStatus: z.string().min(1),
    completedAt: z.string().datetime().optional(),
    lifecycleDeliveryIds: z.array(z.string().min(1)).default([]),
    metricSampleIds: z.array(z.string().min(1)).default([])
  }).optional(),
  lastError: z.object({
    code: z.string().optional(),
    message: z.string().min(1),
    at: z.string().datetime()
  }).optional(),
  deadLetterReason: z.string().optional(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime()
});

export const routingCorrectionSchema = z.object({
  id: z.string().min(1),
  eventId: z.string().min(1),
  routeAttemptId: z.string().optional(),
  expectedAction: routingDecisionActionSchema,
  expectedLoopIds: z.array(z.string()).default([]),
  reason: z.string().min(1),
  correctedBy: z.string().min(1),
  correctedAt: z.string().datetime()
});

export const routerEvaluationSchema = z.object({
  id: z.string().min(1),
  fixtureId: z.string().min(1),
  eventId: z.string().min(1),
  expectedAction: routingDecisionActionSchema,
  expectedLoopIds: z.array(z.string()).default([]),
  actualAction: routingDecisionActionSchema,
  actualLoopIds: z.array(z.string()).default([]),
  passed: z.boolean(),
  latencyMs: z.number().int().min(0).optional(),
  evaluatedAt: z.string().datetime()
});

export const unhandledBusinessProblemSchema = businessProblemSchema.extend({
  status: z.literal("unhandled"),
  recurrenceCount: z.number().int().min(1).default(1),
  suggestedDiscoveryAction: z.string().optional()
});

export type EventEnvelope = z.infer<typeof eventEnvelopeSchema>;
export type EventSubject = z.infer<typeof eventSubjectSchema>;
export type LoopRoutingContract = z.infer<typeof loopRoutingContractSchema>;
export type RoutingCard = z.infer<typeof routingCardSchema>;
export type BusinessProblem = z.infer<typeof businessProblemSchema>;
export type RoutingDecision = z.infer<typeof routingDecisionSchema>;
export type EventReceipt = z.infer<typeof eventReceiptSchema>;
export type RoutingAttempt = z.infer<typeof routingAttemptSchema>;
export type RouteCommit = z.infer<typeof routeCommitSchema>;
export type RouteJob = z.infer<typeof routeJobSchema>;
export type RouteJobStatus = z.infer<typeof routeJobStatusSchema>;
export type RouteExecutionTarget = z.infer<typeof routeExecutionTargetSchema>;
export type RoutingCorrection = z.infer<typeof routingCorrectionSchema>;
export type RouterEvaluation = z.infer<typeof routerEvaluationSchema>;
export type UnhandledBusinessProblem = z.infer<typeof unhandledBusinessProblemSchema>;

export type RoutingEligibilityResult = {
  eligible: boolean;
  card: RoutingCard;
  matchedAccepts: z.infer<typeof routingAcceptRuleSchema>[];
  matchedExcludes: z.infer<typeof routingExcludeRuleSchema>[];
  missingFields: string[];
  reasons: string[];
};

export type RoutingDecisionValidationResult = {
  valid: boolean;
  errors: string[];
  selectedCards: RoutingCard[];
};

export function createEventEnvelopeId(input: {
  workspaceId: string;
  source: string;
  sourceDeliveryId: string;
  eventType: string;
}): string {
  return `evt_${contentHash(input)}`;
}

export function isEventFieldMarkedUntrusted(event: EventEnvelope, fieldPath: string): boolean {
  const normalizedFieldPath = normalizeEventFieldPath(fieldPath);
  return event.trust.untrustedFields.some((candidate) => {
    const normalizedCandidate = normalizeEventFieldPath(candidate);
    return normalizedCandidate === normalizedFieldPath ||
      normalizedFieldPath.startsWith(`${normalizedCandidate}.`);
  });
}

export function safeEventSubject(event: EventEnvelope): EventSubject {
  const display = event.subject.display?.trim();
  if (!display || isEventFieldMarkedUntrusted(event, "subject.display")) {
    return {
      type: event.subject.type,
      id: event.subject.id
    };
  }

  return {
    type: event.subject.type,
    id: event.subject.id,
    display
  };
}

export function safeEventSubjectLabel(event: EventEnvelope): string {
  return safeEventSubject(event).display ?? event.subject.id;
}

function normalizeEventFieldPath(fieldPath: string): string {
  return fieldPath
    .trim()
    .replace(/^\$\./, "")
    .replace(/^event\./, "")
    .replace(/^trigger\./, "");
}

export function createProblemDedupeKey(input: {
  workspaceId: string;
  problemType: string;
  subjectType: string;
  subjectId: string;
  repeatWindow?: string;
}): string {
  return `problem_${contentHash(input)}`;
}

export function createRouteJobId(input: {
  eventId: string;
  loopId: string;
  loopSpecHash: string;
}): string {
  return `job_${contentHash(input)}`;
}

export function compileRoutingCardFromLoopSpec(
  spec: LoopSpec,
  options: {
    catalogVersion?: string;
    currentReadiness?: RoutingCard["currentReadiness"];
    loopStatus?: RoutingCard["loopStatus"];
    activeRuns?: number;
    cooldownUntil?: string;
  } = {}
): RoutingCard | undefined {
  if (!spec.routing) return undefined;

  const hash = loopSpecHash(spec);
  const routing = spec.routing;
  const allowedAction = spec.policy.allowedActions.find((action) => action.allowed) ?? spec.policy.allowedActions[0];

  return routingCardSchema.parse({
    schemaVersion: ROUTING_CARD_SCHEMA_VERSION,
    catalogVersion: options.catalogVersion ?? `catalog_${hash}`,
    loopId: spec.metadata.id,
    loopName: spec.metadata.name,
    department: spec.topology?.department ? normalizeDepartmentType(spec.topology.department) ?? "custom" : undefined,
    goal: spec.metadata.description ?? spec.metadata.name,
    currentReadiness: options.currentReadiness ?? "unknown",
    loopStatus: options.loopStatus ??
      (spec.metadata.labels?.lifecycleStatus === "paused" || spec.metadata.labels?.lifecycleStatus === "retired"
        ? "disabled"
        : "active"),
    problemTypes: routing.problemTypes,
    explicitNonGoals: routing.excludes.map((rule) => rule.reason),
    accepts: routing.accepts,
    excludes: routing.excludes,
    primaryAction: allowedAction?.toolKey,
    actionRisk: allowedAction?.riskLevel ?? "low",
    activationMode: routing.activationMode,
    minimumConfidence: routing.minimumConfidence,
    priority: routing.priority,
    ambiguityPolicy: routing.ambiguityPolicy,
    noMatchPolicy: routing.noMatchPolicy,
    fanoutPolicy: routing.fanoutPolicy,
    cooldown: routing.cooldown,
    concurrency: routing.concurrency,
    inputMapping: routing.inputMapping,
    requiredConnections: routing.requiredConnections,
    currentState: {
      activeRuns: options.activeRuns ?? 0,
      cooldownUntil: options.cooldownUntil
    },
    examples: routing.examples,
    lifecycleEvents: routing.lifecycleEvents,
    routingContractVersion: routing.schemaVersion,
    loopSpecHash: hash
  });
}

export function evaluateRoutingEligibility(event: EventEnvelope, card: RoutingCard): RoutingEligibilityResult {
  const reasons: string[] = [];
  const matchedAccepts: z.infer<typeof routingAcceptRuleSchema>[] = [];
  const matchedExcludes: z.infer<typeof routingExcludeRuleSchema>[] = [];
  const missingFields = new Set<string>();

  if (card.loopStatus !== "active") reasons.push(`Loop is ${card.loopStatus}`);
  if (card.currentReadiness === "blocked") reasons.push("Loop readiness is blocked");
  if (card.currentState.activeRuns >= card.concurrency.maxActive) reasons.push("Loop is over its concurrency limit");
  if (card.currentState.cooldownUntil && Date.parse(card.currentState.cooldownUntil) > Date.parse(event.receivedAt)) {
    reasons.push("Loop is inside its cooldown window");
  }

  for (const rule of card.accepts) {
    const patternMatchesEvent =
      patternMatches(rule.sourcePattern, event.source) &&
      patternMatches(rule.eventTypePattern, event.eventType) &&
      subjectMatches(rule.subjectTypes, event.subject.type);

    if (!patternMatchesEvent) continue;

    const missing = rule.requiredFields.filter((field) => !eventPathHasValue(event, field));
    if (missing.length === 0) {
      matchedAccepts.push(rule);
    } else {
      for (const field of missing) missingFields.add(field);
    }
  }

  for (const rule of card.excludes) {
    const patternMatchesEvent =
      patternMatches(rule.sourcePattern, event.source) &&
      patternMatches(rule.eventTypePattern, event.eventType) &&
      subjectMatches(rule.subjectTypes, event.subject.type);
    const fieldMatches = rule.fields.length === 0 || rule.fields.every((field) => eventPathHasValue(event, field));
    if (patternMatchesEvent && fieldMatches) matchedExcludes.push(rule);
  }

  if (matchedAccepts.length === 0) reasons.push("No accept rule matched the event");
  if (matchedExcludes.length > 0) reasons.push("An exclude rule matched the event");
  for (const field of missingFields) reasons.push(`Missing required field "${field}"`);

  return {
    eligible: reasons.length === 0,
    card,
    matchedAccepts,
    matchedExcludes,
    missingFields: [...missingFields],
    reasons
  };
}

export function getEligibleRoutingCards(event: EventEnvelope, cards: RoutingCard[]): RoutingEligibilityResult[] {
  return cards
    .map((card) => evaluateRoutingEligibility(event, card))
    .filter((result) => result.eligible)
    .sort((a, b) => b.card.priority - a.card.priority || a.card.loopName.localeCompare(b.card.loopName));
}

export function validateRoutingDecisionForEvent(input: {
  event: EventEnvelope;
  decision: RoutingDecision;
  routingCards: RoutingCard[];
  catalogVersion: string;
}): RoutingDecisionValidationResult {
  const errors: string[] = [];
  const selectedCards: RoutingCard[] = [];
  const cardsById = new Map(input.routingCards.map((card) => [card.loopId, card]));

  if (input.decision.eventId !== input.event.id) errors.push("Routing decision eventId does not match event");
  if (input.decision.catalogVersion !== input.catalogVersion) errors.push("Routing decision catalogVersion is stale");
  if (input.decision.problem && !subjectIdentityMatches(input.decision.problem.subject, input.event.subject)) {
    errors.push("Routing decision problem subject does not match event subject");
  }

  if (input.decision.action === "route" && input.decision.selectedRoutes.length === 0) {
    errors.push("Route action requires at least one selected route");
  }

  if (input.decision.action !== "route" && input.decision.selectedRoutes.length > 0) {
    errors.push(`${input.decision.action} action must not include selected routes`);
  }

  for (const selected of input.decision.selectedRoutes) {
    const card = cardsById.get(selected.loopId);
    if (!card) {
      errors.push(`Selected loop "${selected.loopId}" is not in the routing catalog`);
      continue;
    }

    const eligibility = evaluateRoutingEligibility(input.event, card);
    if (!eligibility.eligible) {
      errors.push(`Selected loop "${selected.loopId}" is not eligible: ${eligibility.reasons.join(", ")}`);
      continue;
    }

    if (selected.confidence < card.minimumConfidence) {
      errors.push(`Selected loop "${selected.loopId}" confidence is below its minimum`);
    }

    errors.push(...validateSelectedRouteInputMapping(input.event, selected, card));
    selectedCards.push(card);
  }

  for (const alternative of input.decision.alternatives) {
    if (!cardsById.has(alternative.loopId)) {
      errors.push(`Alternative loop "${alternative.loopId}" is not in the routing catalog`);
    }
  }

  if (selectedCards.length > 1) {
    const maxAllowedRoutes = Math.min(...selectedCards.map((card) => card.fanoutPolicy.maxRoutes));
    if (selectedCards.length > maxAllowedRoutes) {
      errors.push("Selected route count exceeds fan-out limits");
    }
    for (const card of selectedCards) {
      if (card.fanoutPolicy.mode === "none") {
        errors.push(`Selected loop "${card.loopId}" does not allow fan-out`);
      }
    }
  }

  return { valid: errors.length === 0, errors, selectedCards };
}

export function mapRoutingCardInputs(event: EventEnvelope, card: RoutingCard): Record<string, unknown> {
  const mapped: Record<string, unknown> = {};
  for (const [targetKey, sourcePath] of Object.entries(card.inputMapping)) {
    const value = eventPathValue(event, sourcePath);
    if (value !== undefined && value !== null) mapped[targetKey] = value;
  }
  return mapped;
}

function validateSelectedRouteInputMapping(
  event: EventEnvelope,
  selected: z.infer<typeof selectedRouteSchema>,
  card: RoutingCard
): string[] {
  const errors: string[] = [];
  const declaredTargets = new Set(Object.keys(card.inputMapping));
  const mappedInputs = mapRoutingCardInputs(event, card);

  for (const targetKey of declaredTargets) {
    if (!(targetKey in mappedInputs)) {
      errors.push(`Selected loop "${card.loopId}" inputMapping target "${targetKey}" could not be resolved from the event`);
    }
  }

  for (const [targetKey, selectedValue] of Object.entries(selected.inputMapping)) {
    if (!declaredTargets.has(targetKey)) {
      errors.push(`Selected loop "${card.loopId}" inputMapping contains undeclared target "${targetKey}"`);
      continue;
    }

    if (contentHash(selectedValue) !== contentHash(mappedInputs[targetKey])) {
      errors.push(`Selected loop "${card.loopId}" inputMapping for "${targetKey}" does not match the deterministic event mapping`);
    }
  }

  return errors;
}

function patternMatches(pattern: string, value: string): boolean {
  if (pattern === "*") return true;
  const regex = new RegExp(`^${pattern.split("*").map(escapeRegExp).join(".*")}$`);
  return regex.test(value);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function subjectMatches(subjectTypes: string[], subjectType: string): boolean {
  return subjectTypes.length === 0 || subjectTypes.includes(subjectType);
}

function subjectIdentityMatches(left: EventSubject, right: EventSubject): boolean {
  return left.type === right.type && left.id === right.id;
}

function eventPathHasValue(event: EventEnvelope, path: string): boolean {
  const value = eventPathValue(event, path);
  if (value === undefined || value === null) return false;
  if (typeof value === "string") return value.trim().length > 0;
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === "object") return Object.keys(value as Record<string, unknown>).length > 0;
  return true;
}

function eventPathValue(event: EventEnvelope, path: string): unknown {
  const directValue = readPath(event as unknown as Record<string, unknown>, path);
  if (directValue !== undefined && directValue !== null) return directValue;
  return readPath(event.normalizedPayload, path);
}

function readPath(value: unknown, path: string): unknown {
  const parts = path.split(".").filter(Boolean);
  let current = value;

  for (const part of parts) {
    if (!current || typeof current !== "object") return undefined;
    current = (current as Record<string, unknown>)[part];
  }

  return current;
}
