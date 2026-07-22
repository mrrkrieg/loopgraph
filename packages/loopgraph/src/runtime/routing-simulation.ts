import { readFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import {
  contentHash,
  eventEnvelopeSchema,
  routerEvaluationSchema,
  routingDecisionActionSchema,
  routingDecisionSchema,
  safeEventSubject,
  safeEventSubjectLabel,
  type EventEnvelope,
  type RouterEvaluation,
  type RoutingDecision,
  type RoutingCard,
  type RoutingEligibilityResult
} from "../core";
import { loopgraph_graph_get, type GraphProjectionResult } from "./routing-ops-tools";
import { FileRoutingStore, type EventIngestResult, type RoutingDecisionSubmissionResult } from "./routing-store";
import { loopgraph_events_ingest, loopgraph_routing_decision_submit } from "./routing-tools";
import { getLoopgraphRoot } from "./storage-resolver";

export const ROUTING_SHADOW_TEST_SCHEMA_VERSION = "routing-shadow-test/v1alpha1" as const;
export const ROUTING_EVALUATION_RUN_SCHEMA_VERSION = "routing-evaluation-run/v1alpha1" as const;

export const routingEvaluationThresholdsSchema = z.object({
  minPrecision: z.number().min(0).max(1).default(0.95),
  minRecall: z.number().min(0).max(1).default(0.95),
  maxFalseTriggerRate: z.number().min(0).max(1).default(0.05),
  maxMissedProblemRate: z.number().min(0).max(1).default(0.05),
  maxAbstentionRate: z.number().min(0).max(1).default(0.2),
  minDuplicateSuppressionRate: z.number().min(0).max(1).default(1)
}).default({});

export const routingEvaluationFixtureSchema = z.object({
  fixtureId: z.string().min(1).optional(),
  event: z.union([
    z.string().min(1),
    eventEnvelopeSchema,
    z.record(z.string(), z.unknown())
  ]),
  expectedAction: routingDecisionActionSchema.default("route"),
  expectedLoopIds: z.array(z.string().min(1)).default([]),
  replay: z.boolean().default(false)
}).superRefine((value, context) => {
  if (value.expectedAction === "route" && value.expectedLoopIds.length === 0) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["expectedLoopIds"],
      message: "expectedLoopIds is required when expectedAction=route"
    });
  }
  if (value.expectedAction !== "route" && value.expectedLoopIds.length > 0) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["expectedLoopIds"],
      message: "expectedLoopIds must be empty unless expectedAction=route"
    });
  }
});

export const routingEvaluationRunInputSchema = z.object({
  projectRoot: z.string().optional(),
  fixtures: z.array(routingEvaluationFixtureSchema).min(1),
  thresholds: routingEvaluationThresholdsSchema.optional()
});

export type HermesLocalRouteTestInput = {
  projectRoot?: string;
  event: string | EventEnvelope | Record<string, unknown>;
  expectedLoopId?: string;
  expectedAction?: RoutingDecision["action"];
  expectedLoopIds?: string[];
  specPaths?: string[];
  routingCards?: RoutingCard[];
  catalogVersion?: string;
  fixtureId?: string;
  replay?: boolean;
  now?: Date;
};

export type HermesLocalRouteTestResult = {
  schemaVersion: typeof ROUTING_SHADOW_TEST_SCHEMA_VERSION;
  projectRoot: string;
  valid: boolean;
  errors: string[];
  event: EventEnvelope;
  ingest: EventIngestResult & {
    catalogVersion: string;
  };
  decision?: RoutingDecision;
  submission?: RoutingDecisionSubmissionResult;
  comparison?: {
    expectedAction: RoutingDecision["action"];
    expectedLoopIds: string[];
    actualAction: RoutingDecision["action"];
    actualLoopIds: string[];
    passed: boolean;
  };
  evaluation?: RouterEvaluation;
  graph?: GraphProjectionResult;
  nextActions: string[];
};

export type RoutingEvaluationFixtureInput = z.input<typeof routingEvaluationFixtureSchema>;
export type RoutingEvaluationThresholds = z.infer<typeof routingEvaluationThresholdsSchema>;
export type RoutingEvaluationRunInput = z.input<typeof routingEvaluationRunInputSchema> & {
  now?: Date;
};

export type RoutingEvaluationRunResult = {
  schemaVersion: typeof ROUTING_EVALUATION_RUN_SCHEMA_VERSION;
  projectRoot: string;
  evaluatedAt: string;
  fixtureCount: number;
  results: HermesLocalRouteTestResult[];
  evaluations: RouterEvaluation[];
  metrics: {
    truePositiveCount: number;
    falseTriggerCount: number;
    missedProblemCount: number;
    abstentionCount: number;
    expectedRouteCount: number;
    expectedNoRouteCount: number;
    duplicateExpectedCount: number;
    duplicateSuppressedCount: number;
    precision: number;
    recall: number;
    falseTriggerRate: number;
    missedProblemRate: number;
    abstentionRate: number;
    duplicateSuppressionRate?: number;
    averageDecisionLatencyMs: number;
  };
  gate: {
    passed: boolean;
    targetActivationMode: "recommend";
    thresholds: RoutingEvaluationThresholds;
    failures: string[];
    nextAllowedActivationMode: "shadow" | "recommend";
  };
  nextActions: string[];
};

export async function runHermesLocalRouteTest(
  input: HermesLocalRouteTestInput
): Promise<HermesLocalRouteTestResult> {
  const projectRoot = path.resolve(input.projectRoot ?? process.cwd());
  const now = input.now ?? new Date();
  const expectedAction = input.expectedAction ??
    (input.expectedLoopIds?.length || input.expectedLoopId ? "route" : undefined);
  const expectedLoopIds = input.expectedLoopIds ?? (input.expectedLoopId ? [input.expectedLoopId] : []);
  const event = typeof input.event === "string"
    ? await loadHermesRoutingEventFromFile(input.event)
    : normalizeHermesRoutingEvent(input.event);
  const routingContext = {
    trustedSpecPaths: input.specPaths,
    trustedRoutingCards: input.routingCards,
    trustedCatalogVersion: input.catalogVersion
  };
  const store = new FileRoutingStore(getLoopgraphRoot(projectRoot));
  const startedAt = Date.now();
  const ingest = await loopgraph_events_ingest({
    projectRoot,
    event,
    replay: input.replay ?? false
  }, { store, now, ...routingContext });

  if (ingest.duplicate) {
    const actualAction: RoutingDecision["action"] = "ignore";
    const comparison = expectedAction
      ? {
          expectedAction,
          expectedLoopIds,
          actualAction,
          actualLoopIds: [],
          passed: routeExpectationPassed({
            expectedAction,
            expectedLoopIds,
            actualAction,
            actualLoopIds: []
          })
        }
      : undefined;
    const evaluation = comparison
      ? routerEvaluationSchema.parse({
          id: evaluationId({
            eventId: event.id,
            fixtureId: input.fixtureId ?? event.sourceDeliveryId,
            expectedAction: comparison.expectedAction,
            expectedLoopIds: comparison.expectedLoopIds,
            evaluatedAt: now.toISOString()
          }),
          fixtureId: input.fixtureId ?? event.sourceDeliveryId,
          eventId: event.id,
          expectedAction: comparison.expectedAction,
          expectedLoopIds: comparison.expectedLoopIds,
          actualAction,
          actualLoopIds: [],
          passed: comparison.passed,
          latencyMs: Date.now() - startedAt,
          evaluatedAt: now.toISOString()
        })
      : undefined;
    if (evaluation) await store.saveRouterEvaluation(evaluation);
    const graph = await loopgraph_graph_get({
      projectRoot,
      projection: "event_routing",
      eventId: event.id
    }, { store, now });
    return {
      schemaVersion: ROUTING_SHADOW_TEST_SCHEMA_VERSION,
      projectRoot,
      valid: comparison ? comparison.passed : true,
      errors: comparison?.passed === false
        ? [`Expected ${expectedAction}${expectedLoopIds.length ? `:${expectedLoopIds.join(",")}` : ""} but event was a duplicate.`]
        : [],
      event,
      ingest,
      comparison,
      evaluation,
      graph,
      nextActions: [
        "Hermes duplicate delivery detected; no new route decision was committed.",
        "Use replay mode if you intentionally want to test the same event again."
      ]
    };
  }

  const decision = deterministicHermesShadowDecision({
    event,
    catalogVersion: ingest.catalogVersion,
    eligibleRoutes: ingest.eligibleRoutes,
    openProblemCandidates: ingest.openProblemCandidates
  });
  const submission = await loopgraph_routing_decision_submit({
    projectRoot,
    decision,
    hermesMetadata: {
      mode: "local-shadow-route-test",
      sourceRoute: event.sourceRoute
    }
  }, { store, now, ...routingContext });
  const actualLoopIds = submission.routeCommits.map((commit) => commit.loopId);
  const comparison = expectedAction
    ? {
        expectedAction,
        expectedLoopIds,
        actualAction: decision.action,
        actualLoopIds,
        passed: routeExpectationPassed({
          expectedAction,
          expectedLoopIds,
          actualAction: decision.action,
          actualLoopIds
        })
      }
    : undefined;
  const evaluation = comparison
    ? routerEvaluationSchema.parse({
        id: evaluationId({
          eventId: event.id,
          fixtureId: input.fixtureId ?? event.sourceDeliveryId,
          expectedAction: comparison.expectedAction,
          expectedLoopIds: comparison.expectedLoopIds,
          evaluatedAt: now.toISOString()
        }),
        fixtureId: input.fixtureId ?? event.sourceDeliveryId,
        eventId: event.id,
        expectedAction: comparison.expectedAction,
        expectedLoopIds: comparison.expectedLoopIds,
        actualAction: decision.action,
        actualLoopIds,
        passed: comparison.passed,
        latencyMs: Date.now() - startedAt,
        evaluatedAt: now.toISOString()
      })
    : undefined;

  if (evaluation) await store.saveRouterEvaluation(evaluation);

  const graph = await loopgraph_graph_get({
    projectRoot,
    projection: "event_routing",
    eventId: event.id
  }, { store, now });
  const errors = [
    ...submission.validationErrors,
    ...(comparison && !comparison.passed
      ? [`Expected ${comparison.expectedAction}${comparison.expectedLoopIds.length ? `:${comparison.expectedLoopIds.join(",")}` : ""}, but Hermes local shadow route selected ${actualLoopIds.join(", ") || decision.action}.`]
      : [])
  ];

  return {
    schemaVersion: ROUTING_SHADOW_TEST_SCHEMA_VERSION,
    projectRoot,
    valid: submission.valid && errors.length === 0,
    errors,
    event,
    ingest,
    decision,
    submission,
    comparison,
    evaluation,
    graph,
    nextActions: nextActionsForShadowRoute(decision, submission, comparison)
  };
}

export async function runHermesRoutingEvaluation(
  input: RoutingEvaluationRunInput
): Promise<RoutingEvaluationRunResult> {
  const parsed = routingEvaluationRunInputSchema.parse(input);
  const projectRoot = path.resolve(parsed.projectRoot ?? process.cwd());
  const evaluatedAt = (input.now ?? new Date()).toISOString();
  const thresholds = routingEvaluationThresholdsSchema.parse(parsed.thresholds ?? {});
  const results: HermesLocalRouteTestResult[] = [];

  for (let index = 0; index < parsed.fixtures.length; index += 1) {
    const fixture = parsed.fixtures[index];
    const result = await runHermesLocalRouteTest({
      projectRoot,
      event: fixture.event,
      expectedAction: fixture.expectedAction,
      expectedLoopIds: fixture.expectedLoopIds,
      fixtureId: fixture.fixtureId,
      replay: fixture.replay,
      now: addMilliseconds(input.now ?? new Date(), index)
    });
    results.push(result);
  }

  const evaluations = results
    .map((result) => result.evaluation)
    .filter((evaluation): evaluation is RouterEvaluation => Boolean(evaluation));
  const metrics = summarizeRoutingEvaluations(results);
  const gate = evaluateRoutingPromotionGate(metrics, thresholds);

  return {
    schemaVersion: ROUTING_EVALUATION_RUN_SCHEMA_VERSION,
    projectRoot,
    evaluatedAt,
    fixtureCount: parsed.fixtures.length,
    results,
    evaluations,
    metrics,
    gate,
    nextActions: nextActionsForEvaluationGate(gate)
  };
}

export async function loadHermesRoutingEventFromFile(filePath: string): Promise<EventEnvelope> {
  const raw = await readFile(path.resolve(filePath), "utf8");
  return normalizeHermesRoutingEvent(JSON.parse(raw) as Record<string, unknown>);
}

export function normalizeHermesRoutingEvent(input: EventEnvelope | Record<string, unknown>): EventEnvelope {
  const record = input as Record<string, unknown>;
  const trigger = record.trigger;
  if (isRecord(trigger) && trigger.schemaVersion === "event-envelope/v1alpha1") {
    return eventEnvelopeSchema.parse({
      id: trigger.id ?? record.eventId ?? trigger.sourceDeliveryId,
      ...trigger
    });
  }

  return eventEnvelopeSchema.parse(input);
}

function deterministicHermesShadowDecision(input: {
  event: EventEnvelope;
  catalogVersion: string;
  eligibleRoutes: RoutingEligibilityResult[];
  openProblemCandidates: EventIngestResult["openProblemCandidates"];
}): RoutingDecision {
  const openProblem = input.openProblemCandidates.find((problem) => problem.routeCommitIds.length > 0) ??
    input.openProblemCandidates[0];
  const subject = safeEventSubject(input.event);
  const subjectLabel = safeEventSubjectLabel(input.event);
  if (openProblem) {
    return routingDecisionSchema.parse({
      schemaVersion: "routing-decision/v1alpha1",
      eventId: input.event.id,
      catalogVersion: input.catalogVersion,
      action: "append_evidence",
      existingProblemId: openProblem.id,
      selectedRoutes: [],
      alternatives: input.eligibleRoutes.slice(0, 3).map((route) => ({
        loopId: route.card.loopId,
        confidence: confidenceForRoute(route),
        reasonSummary: `Eligible but existing problem ${openProblem.id} should receive this event as evidence.`
      })),
      modelMetadata: {
        router: "deterministic-local-shadow",
        hermesRole: "company_brain"
      },
      policyVersion: "routing-policy/v1alpha1"
    });
  }

  if (input.eligibleRoutes.length > 1) {
    return routingDecisionSchema.parse({
      schemaVersion: "routing-decision/v1alpha1",
      eventId: input.event.id,
      catalogVersion: input.catalogVersion,
      action: "request_human",
      problem: {
        summary: `Multiple Loopgraph loops could handle ${input.event.eventType} for ${subjectLabel}; Hermes needs confirmation before triggering automation.`,
        problemTypes: uniqueStrings(input.eligibleRoutes.flatMap((route) => route.card.problemTypes)),
        subject,
        severity: severityFromEvent(input.event),
        dedupeKeyInputs: [input.event.subject.type, input.event.subject.id, input.event.eventType]
      },
      selectedRoutes: [],
      alternatives: input.eligibleRoutes.slice(0, 5).map((route) => ({
        loopId: route.card.loopId,
        confidence: confidenceForRoute(route),
        reasonSummary: `Eligible for ${route.card.problemTypes.join(", ")}; held for human confirmation because multiple loops matched.`
      })),
      modelMetadata: {
        router: "deterministic-local-shadow",
        hermesRole: "company_brain",
        ambiguityPolicy: "request_human",
        ambiguityReason: "multiple_eligible_routes"
      },
      policyVersion: "routing-policy/v1alpha1"
    });
  }

  const primary = input.eligibleRoutes[0];
  if (!primary) {
    return routingDecisionSchema.parse({
      schemaVersion: "routing-decision/v1alpha1",
      eventId: input.event.id,
      catalogVersion: input.catalogVersion,
      action: "unhandled",
      problem: {
        summary: `No eligible Loopgraph loop accepted ${input.event.eventType} from ${input.event.source}.`,
        problemTypes: problemTypesForUnhandledEvent(input.event),
        subject,
        severity: severityFromEvent(input.event),
        dedupeKeyInputs: [input.event.subject.type, input.event.subject.id, input.event.eventType]
      },
      selectedRoutes: [],
      alternatives: [],
      modelMetadata: {
        router: "deterministic-local-shadow",
        hermesRole: "company_brain"
      },
      policyVersion: "routing-policy/v1alpha1"
    });
  }

  const card = primary.card;
  return routingDecisionSchema.parse({
    schemaVersion: "routing-decision/v1alpha1",
    eventId: input.event.id,
    catalogVersion: input.catalogVersion,
    action: "route",
    problem: {
      summary: `${card.loopName} should handle ${input.event.eventType} for ${subjectLabel}.`,
      problemTypes: [card.problemTypes[0] ?? "business_problem"],
      subject,
      severity: severityFromEvent(input.event),
      dedupeKeyInputs: [input.event.subject.id, input.event.eventType]
    },
    selectedRoutes: [{
      loopId: card.loopId,
      role: "primary",
      confidence: confidenceForRoute(primary),
      reasonSummary: `The event matches ${card.loopName}'s accepted source, event family, subject type, and required fields.`,
      evidenceRefs: input.event.evidenceRefs,
      inputMapping: mapEventInputs(input.event, card.inputMapping),
      priority: card.priority
    }],
    alternatives: input.eligibleRoutes.slice(1, 4).map((route) => ({
      loopId: route.card.loopId,
      confidence: confidenceForRoute(route),
      reasonSummary: `Also eligible for ${route.card.problemTypes.join(", ")}.`
    })),
    modelMetadata: {
      router: "deterministic-local-shadow",
      hermesRole: "company_brain"
    },
    policyVersion: "routing-policy/v1alpha1"
  });
}

function confidenceForRoute(route: RoutingEligibilityResult): number {
  return Math.min(0.98, Math.max(route.card.minimumConfidence, 0.86 + route.card.priority / 1000));
}

function mapEventInputs(event: EventEnvelope, inputMapping: Record<string, string>): Record<string, unknown> {
  const mapped: Record<string, unknown> = {};
  for (const [targetKey, sourcePath] of Object.entries(inputMapping)) {
    const value = readEventPath(event, sourcePath);
    if (value !== undefined) mapped[targetKey] = value;
  }
  return mapped;
}

function readEventPath(event: EventEnvelope, sourcePath: string): unknown {
  const direct = readPath(event as unknown as Record<string, unknown>, sourcePath);
  if (direct !== undefined) return direct;
  return readPath(event.normalizedPayload, sourcePath);
}

function readPath(input: Record<string, unknown>, dottedPath: string): unknown {
  let cursor: unknown = input;
  for (const segment of dottedPath.split(".").filter(Boolean)) {
    if (!isRecord(cursor)) return undefined;
    cursor = cursor[segment];
  }
  return cursor;
}

function severityFromEvent(event: EventEnvelope): "low" | "medium" | "high" | "critical" {
  const value = String(
    readEventPath(event, "severity") ??
    readEventPath(event, "risk.severity") ??
    readEventPath(event, "priority") ??
    "medium"
  ).toLowerCase();
  if (value === "critical" || value === "p0") return "critical";
  if (value === "high" || value === "p1") return "high";
  if (value === "low" || value === "p3") return "low";
  return "medium";
}

function problemTypesForUnhandledEvent(event: EventEnvelope): string[] {
  if (
    event.eventType === "page.conversion_drop" ||
    (event.subject.type === "page" && event.eventType.includes("conversion"))
  ) {
    return ["landing_page_optimization"];
  }

  return ["unhandled_business_problem"];
}

function nextActionsForShadowRoute(
  decision: RoutingDecision,
  submission: RoutingDecisionSubmissionResult,
  comparison?: HermesLocalRouteTestResult["comparison"]
): string[] {
  if (!submission.valid) {
    return ["Fix the routing validation errors before allowing Hermes to use this route."];
  }
  if (comparison && !comparison.passed) {
    return ["Review the routing contract or fixture expectation; the local shadow route selected a different result."];
  }
  if (decision.action === "route") {
    return [
      "Open the event-routing graph to inspect the Hermes Brain decision path.",
      "Keep this loop in shadow mode until routing evaluations and manual review prove it is safe to promote."
    ];
  }
  if (decision.action === "append_evidence") {
    return ["Hermes should attach this event as evidence to the existing business problem instead of starting duplicate work."];
  }
  if (decision.action === "unhandled") {
    return ["Use discovery to design a new loop, or update existing routing contracts if this problem should be handled."];
  }
  return ["Inspect the persisted routing attempt and decide the next safe action."];
}

function routeExpectationPassed(input: {
  expectedAction: RoutingDecision["action"];
  expectedLoopIds: string[];
  actualAction: RoutingDecision["action"];
  actualLoopIds: string[];
}): boolean {
  if (input.expectedAction !== input.actualAction) return false;
  if (input.expectedAction !== "route") {
    return input.expectedLoopIds.length === 0 && input.actualLoopIds.length === 0;
  }
  return sameStringSet(input.expectedLoopIds, input.actualLoopIds);
}

function evaluationId(input: {
  eventId: string;
  fixtureId?: string;
  expectedAction: RoutingDecision["action"];
  expectedLoopIds: string[];
  evaluatedAt: string;
}): string {
  return `evaluation_${contentHash({
    eventId: input.eventId,
    fixtureId: input.fixtureId,
    expectedAction: input.expectedAction,
    expectedLoopIds: [...input.expectedLoopIds].sort(),
    evaluatedAt: input.evaluatedAt
  })}`;
}

function summarizeRoutingEvaluations(results: HermesLocalRouteTestResult[]): RoutingEvaluationRunResult["metrics"] {
  let truePositiveCount = 0;
  let falseTriggerCount = 0;
  let missedProblemCount = 0;
  let abstentionCount = 0;
  let expectedRouteCount = 0;
  let expectedNoRouteCount = 0;
  let duplicateExpectedCount = 0;
  let duplicateSuppressedCount = 0;
  let latencyTotal = 0;
  let latencyCount = 0;

  for (const result of results) {
    const comparison = result.comparison;
    if (!comparison) continue;

    const expectedRoute = comparison.expectedAction === "route";
    const actualRoute = comparison.actualAction === "route";
    const actualAbstained = comparison.actualAction === "request_human" ||
      comparison.actualAction === "defer" ||
      (expectedRoute && comparison.actualAction === "unhandled");

    if (expectedRoute) expectedRouteCount += 1;
    else expectedNoRouteCount += 1;

    if (comparison.expectedAction === "ignore") {
      duplicateExpectedCount += 1;
      if (result.ingest.duplicate && comparison.actualAction === "ignore") {
        duplicateSuppressedCount += 1;
      }
    }

    if (expectedRoute && comparison.passed) {
      truePositiveCount += 1;
    }
    if ((!expectedRoute && actualRoute) || (expectedRoute && actualRoute && !comparison.passed)) {
      falseTriggerCount += 1;
    }
    if (expectedRoute && !comparison.passed) {
      missedProblemCount += 1;
    }
    if (actualAbstained) {
      abstentionCount += 1;
    }

    if (typeof result.evaluation?.latencyMs === "number") {
      latencyTotal += result.evaluation.latencyMs;
      latencyCount += 1;
    }
  }

  const routedDecisionCount = truePositiveCount + falseTriggerCount;
  const duplicateSuppressionRate = duplicateExpectedCount > 0
    ? duplicateSuppressedCount / duplicateExpectedCount
    : undefined;

  return {
    truePositiveCount,
    falseTriggerCount,
    missedProblemCount,
    abstentionCount,
    expectedRouteCount,
    expectedNoRouteCount,
    duplicateExpectedCount,
    duplicateSuppressedCount,
    precision: safeRate(truePositiveCount, routedDecisionCount),
    recall: safeRate(truePositiveCount, expectedRouteCount),
    falseTriggerRate: safeRate(falseTriggerCount, Math.max(results.length, 1)),
    missedProblemRate: safeRate(missedProblemCount, Math.max(expectedRouteCount, 1)),
    abstentionRate: safeRate(abstentionCount, Math.max(results.length, 1)),
    ...(duplicateSuppressionRate === undefined ? {} : { duplicateSuppressionRate }),
    averageDecisionLatencyMs: latencyCount === 0 ? 0 : Math.round(latencyTotal / latencyCount)
  };
}

function evaluateRoutingPromotionGate(
  metrics: RoutingEvaluationRunResult["metrics"],
  thresholds: RoutingEvaluationThresholds
): RoutingEvaluationRunResult["gate"] {
  const failures: string[] = [];

  if (metrics.precision < thresholds.minPrecision) {
    failures.push(`precision ${formatRate(metrics.precision)} is below ${formatRate(thresholds.minPrecision)}`);
  }
  if (metrics.recall < thresholds.minRecall) {
    failures.push(`recall ${formatRate(metrics.recall)} is below ${formatRate(thresholds.minRecall)}`);
  }
  if (metrics.falseTriggerRate > thresholds.maxFalseTriggerRate) {
    failures.push(`false trigger rate ${formatRate(metrics.falseTriggerRate)} is above ${formatRate(thresholds.maxFalseTriggerRate)}`);
  }
  if (metrics.missedProblemRate > thresholds.maxMissedProblemRate) {
    failures.push(`missed problem rate ${formatRate(metrics.missedProblemRate)} is above ${formatRate(thresholds.maxMissedProblemRate)}`);
  }
  if (metrics.abstentionRate > thresholds.maxAbstentionRate) {
    failures.push(`abstention rate ${formatRate(metrics.abstentionRate)} is above ${formatRate(thresholds.maxAbstentionRate)}`);
  }
  if (
    metrics.duplicateSuppressionRate !== undefined &&
    metrics.duplicateSuppressionRate < thresholds.minDuplicateSuppressionRate
  ) {
    failures.push(`duplicate suppression ${formatRate(metrics.duplicateSuppressionRate)} is below ${formatRate(thresholds.minDuplicateSuppressionRate)}`);
  }

  return {
    passed: failures.length === 0,
    targetActivationMode: "recommend",
    thresholds,
    failures,
    nextAllowedActivationMode: failures.length === 0 ? "recommend" : "shadow"
  };
}

function nextActionsForEvaluationGate(gate: RoutingEvaluationRunResult["gate"]): string[] {
  if (gate.passed) {
    return [
      "Routing fixtures passed the promotion gate; a human can review loop activation modes before moving any loop from shadow to recommend.",
      "Keep provider webhooks terminating at Hermes, then use event-routing graph inspection to verify the next real route."
    ];
  }

  return [
    "Keep all affected loops in shadow mode.",
    "Review failed fixtures, routing contracts, and Hermes decision instructions before testing promotion again.",
    ...gate.failures.map((failure) => `Fix gate failure: ${failure}.`)
  ];
}

function addMilliseconds(date: Date, milliseconds: number): Date {
  return new Date(date.getTime() + milliseconds);
}

function sameStringSet(left: string[], right: string[]): boolean {
  const normalizedLeft = [...new Set(left)].sort();
  const normalizedRight = [...new Set(right)].sort();
  return normalizedLeft.length === normalizedRight.length &&
    normalizedLeft.every((value, index) => value === normalizedRight[index]);
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values)];
}

function safeRate(numerator: number, denominator: number): number {
  if (denominator <= 0) return 1;
  return Number((numerator / denominator).toFixed(4));
}

function formatRate(value: number): string {
  return `${Math.round(value * 1000) / 10}%`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
