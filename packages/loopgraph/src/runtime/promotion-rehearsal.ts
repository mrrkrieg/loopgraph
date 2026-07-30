import { readFile } from "node:fs/promises";
import path from "node:path";
import {
  PROMOTION_REHEARSAL_SCHEMA_VERSION,
  compileRoutingCardFromLoopSpec,
  contentHash,
  eventEnvelopeSchema,
  getEligibleRoutingCards,
  promotionRehearsalHash,
  promotionRehearsalReportSchema,
  routingActivationModeSchema,
  type EventEnvelope,
  type LoopSpec,
  type PromotionRehearsalReport,
  type PromotionRehearsalScenarioKind,
  type PromotionRehearsalScenarioReceipt,
  type RoutingActivationMode,
  type RoutingCard
} from "../core";
import { FileStorageAdapter } from "../sdk/storage";
import {
  normalizeHermesRoutingEvent,
  routingEvaluationThresholdsSchema,
  runHermesLocalRouteTest,
  runHermesRoutingEvaluation,
  type RoutingEvaluationThresholds
} from "./routing-simulation";
import { FileRoutingStore } from "./routing-store";
import { simulateLoop } from "./simulator";
import { readWorkspaceGraphState } from "./semantic-graph-state";
import {
  FileSemanticGraphStore,
  type SemanticGraphStore
} from "./semantic-graph-store";
import type { LoopSpecRegistryStore } from "./loop-spec-store";
import { getLoopgraphRoot } from "./storage-resolver";

const REQUIRED_SCENARIOS: PromotionRehearsalScenarioKind[] = [
  "loop_happy_path",
  "loop_missing_context",
  "loop_risk_escalation",
  "routing_positive",
  "routing_missing_context",
  "routing_risk",
  "duplicate_delivery",
  "no_match",
  "ambiguity_abstention",
  "catalog_overlap",
  "graph_regression",
  "activation_policy"
];

export type RunLoopPromotionRehearsalInput = {
  projectRoot?: string;
  loopId: string;
  targetMode: RoutingActivationMode;
  thresholds?: Partial<RoutingEvaluationThresholds>;
  generatedBy?: string;
  validForSeconds?: number;
  now?: Date;
};

type LoadedFixture = {
  id: string;
  path: string;
  value: Record<string, unknown>;
  event: EventEnvelope;
  hash: string;
};

export async function runLoopPromotionRehearsal(
  input: RunLoopPromotionRehearsalInput,
  options: {
    store?: SemanticGraphStore;
    loopSpecStore?: LoopSpecRegistryStore;
  } = {}
): Promise<PromotionRehearsalReport> {
  const projectRoot = path.resolve(input.projectRoot ?? process.cwd());
  const state = await readWorkspaceGraphState(
    projectRoot,
    options.loopSpecStore
  );
  const artifacts = options.loopSpecStore
    ? await options.loopSpecStore.listActiveLoopSpecs(projectRoot)
    : [];
  const artifactsById = new Map(
    artifacts.map((artifact) => [artifact.loopId, artifact])
  );
  const entry = state.entries.find((candidate) => candidate.id === input.loopId);
  if (!entry) throw new Error(`Registered loop not found: ${input.loopId}`);
  const previousMode = entry.spec.routing?.activationMode;
  if (!previousMode) throw new Error(`Loop ${input.loopId} has no routing activation mode`);
  const targetMode = routingActivationModeSchema.parse(input.targetMode);
  assertOrderedTarget(previousMode, targetMode);
  const createdAt = (input.now ?? new Date()).toISOString();
  const validForSeconds = input.validForSeconds ?? 7 * 24 * 60 * 60;
  if (!Number.isInteger(validForSeconds) || validForSeconds < 60 || validForSeconds > 30 * 24 * 60 * 60) {
    throw new Error("validForSeconds must be an integer between 60 seconds and 30 days");
  }
  const reportSeed = contentHash({
    projectRootId: state.workspace.projectRootId,
    loopId: input.loopId,
    loopSpecHash: entry.specHash,
    graphHash: state.graphHash,
    targetMode,
    createdAt
  });
  const store = options.store ?? new FileSemanticGraphStore(getLoopgraphRoot(projectRoot));
  const existing = (await store.listPromotionRehearsals(input.loopId)).find((report) =>
    report.loopSpecHash === entry.specHash &&
    report.graphHash === state.graphHash &&
    report.targetMode === targetMode &&
    report.createdAt === createdAt
  );
  if (existing) return existing;
  const rehearsalRoutingStore = new FileRoutingStore(
    path.join(getLoopgraphRoot(projectRoot), "graph", "rehearsal-routing", reportSeed)
  );
  const rehearsalSimulationStore = new FileStorageAdapter(
    path.join(getLoopgraphRoot(projectRoot), "graph", "rehearsal-simulations", reportSeed)
  );
  const cards = routingCardsForState(state.entries.map(({ spec }) => spec), state.graphHash);
  const fixtures = await loadRequiredFixtures(
    projectRoot,
    entry.path,
    entry.spec,
    reportSeed,
    undefined,
    artifactsById.get(entry.id)?.fixtures
  );
  const targetCard = cards.find((card) => card.loopId === input.loopId);
  const scenarios: PromotionRehearsalScenarioReceipt[] = [];

  for (const fixtureId of ["happy-path", "missing-context", "risk-escalation"] as const) {
    const fixture = fixtures.get(fixtureId);
    const kind = fixtureId === "happy-path"
      ? "loop_happy_path"
      : fixtureId === "missing-context"
        ? "loop_missing_context"
        : "loop_risk_escalation";
    if (!fixture) {
      scenarios.push(failedScenario(kind, [`Required fixture "${fixtureId}" is missing or invalid.`]));
      continue;
    }
    try {
      const simulation = await simulateLoop({
        spec: entry.spec,
        fixture: fixture.value as { eventId: string; simulatedAt: string },
        storage: rehearsalSimulationStore
      });
      const valid = true;
      const hasEscalation = Boolean(simulation.escalationCase?.id);
      const requiresHuman = hasEscalation || simulation.trace.status === "WAITING_FOR_REVIEW";
      const simulationStatus = simulation.trace.status;
      const passed = fixtureId === "happy-path"
        ? valid && ["COMPLETED", "WAITING_FOR_REVIEW"].includes(simulationStatus)
        : valid && requiresHuman;
      scenarios.push({
        kind,
        required: true,
        status: passed ? "passed" : "failed",
        fixtureIds: [fixture.id],
        runIds: [simulation.trace.id],
        evaluationIds: [],
        checkedLoopIds: [input.loopId],
        evidenceRefs: [`fixture:${fixture.hash}`],
        errors: passed
          ? []
          : [fixtureId === "happy-path"
              ? "Happy-path simulation must validate and reach COMPLETED or WAITING_FOR_REVIEW."
              : `${fixtureId} simulation must produce an escalation or required review.`]
      });
    } catch (error) {
      scenarios.push(failedScenario(kind, [errorMessage(error)], [fixture.id], [input.loopId]));
    }
  }

  const happy = fixtures.get("happy-path");
  const missing = fixtures.get("missing-context");
  const risk = fixtures.get("risk-escalation");
  const routingFixtures = [];
  if (happy) {
    routingFixtures.push({
      fixtureId: `${reportSeed}:routing-positive`,
      event: happy.event,
      expectedAction: "route" as const,
      expectedLoopIds: [input.loopId]
    });
  }
  if (missing) {
    routingFixtures.push({
      fixtureId: `${reportSeed}:routing-missing`,
      event: missing.event,
      expectedAction: "unhandled" as const,
      expectedLoopIds: []
    });
  }
  if (risk) {
    routingFixtures.push({
      fixtureId: `${reportSeed}:routing-risk`,
      event: risk.event,
      expectedAction: "route" as const,
      expectedLoopIds: [input.loopId]
    });
  }
  if (happy) {
    routingFixtures.push({
      fixtureId: `${reportSeed}:duplicate`,
      event: happy.event,
      expectedAction: "ignore" as const,
      expectedLoopIds: []
    });
  }
  routingFixtures.push({
    fixtureId: `${reportSeed}:no-match`,
    event: unmatchedEvent(happy?.event, reportSeed, createdAt),
    expectedAction: "unhandled" as const,
    expectedLoopIds: []
  });

  const regressionFixtureIds: string[] = [];
  const regressionMissing: string[] = [];
  for (const otherEntry of state.entries.filter((candidate) => candidate.id !== input.loopId)) {
    try {
      const otherFixtures = await loadRequiredFixtures(
        projectRoot,
        otherEntry.path,
        otherEntry.spec,
        `${reportSeed}:${otherEntry.id}`,
        ["happy-path"],
        artifactsById.get(otherEntry.id)?.fixtures
      );
      const fixture = otherFixtures.get("happy-path");
      if (!fixture) {
        regressionMissing.push(`${otherEntry.id}: missing happy-path fixture`);
        continue;
      }
      regressionFixtureIds.push(fixture.id);
      routingFixtures.push({
        fixtureId: `${reportSeed}:regression:${otherEntry.id}`,
        event: fixture.event,
        expectedAction: "route" as const,
        expectedLoopIds: [otherEntry.id]
      });
    } catch (error) {
      regressionMissing.push(`${otherEntry.id}: ${errorMessage(error)}`);
    }
  }

  const thresholds = routingEvaluationThresholdsSchema.parse(input.thresholds ?? {});
  const routing = routingFixtures.length > 0
    ? await runHermesRoutingEvaluation({
        projectRoot,
        fixtures: routingFixtures,
        thresholds,
        routingCards: cards,
        catalogVersion: `rehearsal_${reportSeed}`,
        routingStore: rehearsalRoutingStore,
        now: input.now
      })
    : undefined;
  const resultByFixture = new Map(routing?.results.map((result) => [result.evaluation?.fixtureId, result]) ?? []);
  scenarios.push(routingScenario("routing_positive", `${reportSeed}:routing-positive`, resultByFixture, happy));
  scenarios.push(routingScenario("routing_missing_context", `${reportSeed}:routing-missing`, resultByFixture, missing));
  scenarios.push(routingScenario("routing_risk", `${reportSeed}:routing-risk`, resultByFixture, risk));
  scenarios.push(routingScenario("duplicate_delivery", `${reportSeed}:duplicate`, resultByFixture, happy));
  const noMatchResult = resultByFixture.get(`${reportSeed}:no-match`);
  scenarios.push(noMatchResult
    ? {
        kind: "no_match",
        required: true,
        status: noMatchResult.valid ? "passed" : "failed",
        fixtureIds: [],
        runIds: [],
        evaluationIds: noMatchResult.evaluation?.id ? [noMatchResult.evaluation.id] : [],
        checkedLoopIds: noMatchResult.comparison?.actualLoopIds ?? [],
        evidenceRefs: [],
        errors: noMatchResult.errors
      }
    : failedScenario("no_match", ["Synthetic no-match event could not be evaluated."]));
  const regressionResults = [...resultByFixture.entries()]
    .filter(([fixtureId]) => fixtureId?.startsWith(`${reportSeed}:regression:`))
    .map(([, result]) => result);
  const regressionErrors = [
    ...regressionMissing,
    ...regressionResults.flatMap((result) => result.valid ? [] : result.errors)
  ];
  scenarios.push({
    kind: "graph_regression",
    required: true,
    status: regressionErrors.length === 0 ? "passed" : "failed",
    fixtureIds: regressionFixtureIds,
    runIds: [],
    evaluationIds: regressionResults.flatMap((result) => result.evaluation?.id ? [result.evaluation.id] : []),
    checkedLoopIds: state.entries.map((candidate) => candidate.id),
    evidenceRefs: [],
    errors: regressionErrors
  });

  if (!happy || !targetCard) {
    scenarios.push(failedScenario(
      "catalog_overlap",
      [!happy ? "Happy-path fixture is unavailable." : "Target loop has no compiled routing card."],
      happy ? [happy.id] : [],
      [input.loopId]
    ));
    scenarios.push(failedScenario(
      "ambiguity_abstention",
      ["Happy-path fixture or target routing card is unavailable."],
      happy ? [happy.id] : [],
      [input.loopId]
    ));
  } else {
    const eligible = getEligibleRoutingCards(happy.event, cards);
    const overlapErrors = eligible.length === 1 && eligible[0].card.loopId === input.loopId
      ? []
      : [`Expected only ${input.loopId} to match, but eligible loops were: ${eligible.map((item) => item.card.loopId).join(", ") || "none"}.`];
    scenarios.push({
      kind: "catalog_overlap",
      required: true,
      status: overlapErrors.length === 0 ? "passed" : "failed",
      fixtureIds: [happy.id],
      runIds: [],
      evaluationIds: [],
      checkedLoopIds: eligible.map((item) => item.card.loopId),
      evidenceRefs: [`routing-card:${targetCard.loopSpecHash}`],
      errors: overlapErrors
    });

    const ambiguityEvent = cloneEvent(happy.event, `${reportSeed}:ambiguity`);
    const ambiguousCard = {
      ...targetCard,
      loopId: `${targetCard.loopId}__rehearsal_overlap`,
      loopName: `${targetCard.loopName} rehearsal overlap`
    };
    const ambiguity = await runHermesLocalRouteTest({
      projectRoot,
      event: ambiguityEvent,
      expectedAction: "request_human",
      expectedLoopIds: [],
      fixtureId: `${reportSeed}:ambiguity`,
      routingCards: [targetCard, ambiguousCard],
      catalogVersion: `rehearsal_${reportSeed}`,
      routingStore: rehearsalRoutingStore,
      now: input.now
    });
    scenarios.push({
      kind: "ambiguity_abstention",
      required: true,
      status: ambiguity.valid ? "passed" : "failed",
      fixtureIds: [happy.id],
      runIds: [],
      evaluationIds: ambiguity.evaluation?.id ? [ambiguity.evaluation.id] : [],
      checkedLoopIds: [targetCard.loopId, ambiguousCard.loopId],
      evidenceRefs: [],
      errors: ambiguity.errors
    });
  }

  const policyErrors = activationPolicyErrors(entry.spec, targetMode);
  scenarios.push({
    kind: "activation_policy",
    required: true,
    status: policyErrors.length === 0 ? "passed" : "failed",
    fixtureIds: [],
    runIds: [],
    evaluationIds: [],
    checkedLoopIds: [input.loopId],
    evidenceRefs: [],
    errors: policyErrors
  });

  const fixtureManifestHash = contentHash([...fixtures.values()]
    .map((fixture) => ({ id: fixture.id, path: fixture.path, hash: fixture.hash }))
    .sort((left, right) => left.id.localeCompare(right.id)));
  const routingMetrics = routing?.metrics ?? emptyRoutingMetrics();
  const routingGateFailures = routing?.gate.failures ?? ["No routing evaluation could be run."];
  const failedRequired = scenarios.filter((scenario) => scenario.required && scenario.status !== "passed");
  const reportBody = {
    schemaVersion: PROMOTION_REHEARSAL_SCHEMA_VERSION,
    projectRootId: state.workspace.projectRootId,
    loopId: input.loopId,
    loopSpecHash: entry.specHash,
    graphHash: state.graphHash,
    fixtureManifestHash,
    previousMode,
    targetMode,
    status: failedRequired.length === 0 && routing?.gate.passed ? "passed" as const : "failed" as const,
    requiredScenarioKinds: REQUIRED_SCENARIOS,
    scenarios,
    routingMetrics,
    routingGateFailures,
    generatedBy: input.generatedBy?.trim() || "loopgraph-promotion-rehearsal",
    createdAt,
    validUntil: new Date(Date.parse(createdAt) + validForSeconds * 1000).toISOString()
  };
  const reportHash = promotionRehearsalHash(reportBody);
  const report = promotionRehearsalReportSchema.parse({
    ...reportBody,
    id: `promotion_rehearsal_${reportHash}`,
    reportHash
  });
  await store.savePromotionRehearsal(report);
  return report;
}

export async function requirePassingPromotionRehearsal(input: {
  projectRoot?: string;
  reportId: string;
  loopId: string;
  targetMode: RoutingActivationMode;
  now?: Date;
  store?: SemanticGraphStore;
  loopSpecStore?: LoopSpecRegistryStore;
}): Promise<PromotionRehearsalReport> {
  const projectRoot = path.resolve(input.projectRoot ?? process.cwd());
  const store = input.store ?? new FileSemanticGraphStore(getLoopgraphRoot(projectRoot));
  const report = await store.getPromotionRehearsal(input.reportId);
  if (!report) throw new Error(`Promotion rehearsal report not found: ${input.reportId}`);
  const mutableBody = structuredClone(report) as Partial<PromotionRehearsalReport>;
  delete mutableBody.id;
  delete mutableBody.reportHash;
  const body = mutableBody as Omit<
    PromotionRehearsalReport,
    "id" | "reportHash"
  >;
  if (promotionRehearsalHash(body) !== report.reportHash || report.id !== `promotion_rehearsal_${report.reportHash}`) {
    throw new Error("Promotion rehearsal report failed integrity validation");
  }
  const state = await readWorkspaceGraphState(
    projectRoot,
    input.loopSpecStore
  );
  const entry = state.entries.find((candidate) => candidate.id === input.loopId);
  if (!entry) throw new Error(`Registered loop not found: ${input.loopId}`);
  if (report.status !== "passed") throw new Error(`Promotion rehearsal ${report.id} did not pass`);
  if (report.loopId !== input.loopId || report.targetMode !== input.targetMode) {
    throw new Error("Promotion rehearsal is not bound to this loop and target activation mode");
  }
  if (report.projectRootId !== state.workspace.projectRootId) {
    throw new Error("Promotion rehearsal belongs to a different project");
  }
  if (report.graphHash !== state.graphHash || report.loopSpecHash !== entry.specHash) {
    throw new Error("Promotion rehearsal is stale because the graph or LoopSpec changed");
  }
  if (Date.parse(report.validUntil) < (input.now ?? new Date()).getTime()) {
    throw new Error(`Promotion rehearsal ${report.id} expired at ${report.validUntil}`);
  }
  const byKind = new Map(report.scenarios.map((scenario) => [scenario.kind, scenario]));
  const missingOrFailed = report.requiredScenarioKinds.filter((kind) => byKind.get(kind)?.status !== "passed");
  if (missingOrFailed.length > 0) {
    throw new Error(`Promotion rehearsal is missing passing required scenarios: ${missingOrFailed.join(", ")}`);
  }
  return report;
}

async function loadRequiredFixtures(
  projectRoot: string,
  registeredPath: string,
  spec: LoopSpec,
  seed: string,
  requiredIds: string[] = ["happy-path", "missing-context", "risk-escalation"],
  storedFixtures?: Record<string, unknown>
): Promise<Map<string, LoadedFixture>> {
  const refs = new Map((spec.input.fixtures ?? []).map((fixture) => [fixture.id, fixture]));
  const specPath = resolveSpecPath(projectRoot, registeredPath);
  const fixtures = new Map<string, LoadedFixture>();
  for (const id of requiredIds) {
    const ref = refs.get(id);
    if (!ref) continue;
    const fixturePath = resolveConfinedPath(
      projectRoot,
      path.resolve(path.dirname(specPath), ref.path)
    );
    const storedValue = storedFixtures?.[ref.path];
    const value = storedValue === undefined
      ? JSON.parse(await readFile(fixturePath, "utf8")) as Record<string, unknown>
      : asFixtureObject(storedValue, ref.path);
    const event = cloneEvent(normalizeHermesRoutingEvent(value), `${seed}:${id}`);
    const normalizedValue = {
      ...value,
      eventId: event.id,
      simulatedAt: event.receivedAt,
      trigger: event
    };
    fixtures.set(id, {
      id,
      path: path.relative(projectRoot, fixturePath),
      value: normalizedValue,
      event,
      hash: contentHash(value)
    });
  }
  return fixtures;
}

function asFixtureObject(
  value: unknown,
  fixturePath: string
): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`Stored promotion fixture is not an object: ${fixturePath}`);
  }
  return structuredClone(value) as Record<string, unknown>;
}

function routingCardsForState(specs: LoopSpec[], graphHash: string): RoutingCard[] {
  return specs
    .map((spec) => compileRoutingCardFromLoopSpec(spec, { catalogVersion: `graph_${graphHash}` }))
    .filter((card): card is RoutingCard => Boolean(card));
}

function routingScenario(
  kind: PromotionRehearsalScenarioKind,
  fixtureId: string,
  results: Map<string | undefined, Awaited<ReturnType<typeof runHermesLocalRouteTest>>>,
  fixture?: LoadedFixture
): PromotionRehearsalScenarioReceipt {
  const result = results.get(fixtureId);
  if (!fixture || !result) {
    return failedScenario(kind, ["Required fixture could not be evaluated."], fixture ? [fixture.id] : []);
  }
  return {
    kind,
    required: true,
    status: result.valid ? "passed" : "failed",
    fixtureIds: [fixture.id],
    runIds: [],
    evaluationIds: result.evaluation?.id ? [result.evaluation.id] : [],
    checkedLoopIds: result.comparison?.actualLoopIds ?? [],
    evidenceRefs: [`fixture:${fixture.hash}`],
    errors: result.errors
  };
}

function failedScenario(
  kind: PromotionRehearsalScenarioKind,
  errors: string[],
  fixtureIds: string[] = [],
  checkedLoopIds: string[] = []
): PromotionRehearsalScenarioReceipt {
  return {
    kind,
    required: true,
    status: "failed",
    fixtureIds,
    runIds: [],
    evaluationIds: [],
    checkedLoopIds,
    evidenceRefs: [],
    errors
  };
}

function cloneEvent(event: EventEnvelope, seed: string): EventEnvelope {
  const suffix = contentHash({ seed, eventId: event.id });
  return eventEnvelopeSchema.parse({
    ...event,
    id: `evt_rehearsal_${suffix}`,
    sourceDeliveryId: `delivery_rehearsal_${suffix}`,
    correlationId: `correlation_rehearsal_${suffix}`,
    subject: {
      ...event.subject,
      id: `${event.subject.id}_${suffix.slice(0, 12)}`
    }
  });
}

function unmatchedEvent(base: EventEnvelope | undefined, seed: string, now: string): EventEnvelope {
  return eventEnvelopeSchema.parse({
    id: `evt_rehearsal_unmatched_${contentHash(seed)}`,
    schemaVersion: "event-envelope/v1alpha1",
    workspaceId: base?.workspaceId ?? "workspace_local",
    companyId: base?.companyId ?? "company_local",
    source: "loopgraph_rehearsal_unmatched",
    sourceRoute: "hermes.loopgraph_rehearsal_unmatched",
    sourceDeliveryId: `delivery_rehearsal_unmatched_${contentHash(seed)}`,
    eventType: "rehearsal.no_match",
    occurredAt: now,
    receivedAt: now,
    subject: { type: "rehearsal_unmatched", id: `unmatched_${contentHash(seed)}` },
    correlationId: `correlation_rehearsal_unmatched_${contentHash(seed)}`,
    normalizedPayload: { rehearsal: true },
    evidenceRefs: [],
    trust: { signatureVerified: false, signer: "loopgraph-rehearsal", untrustedFields: [] },
    sensitivity: "internal"
  });
}

function activationPolicyErrors(spec: LoopSpec, targetMode: RoutingActivationMode): string[] {
  if (targetMode !== "autonomous_low_risk") return [];
  const errors: string[] = [];
  const writeTools = new Set(spec.tools.filter((tool) => tool.writeCapable).map((tool) => tool.key));
  for (const action of spec.policy.allowedActions.filter((candidate) => candidate.allowed)) {
    if (!writeTools.has(action.toolKey)) continue;
    if (action.riskLevel !== "low") errors.push(`${action.toolKey} is ${action.riskLevel} risk.`);
    if (action.requiresApproval) errors.push(`${action.toolKey} still requires approval.`);
    if (action.customerFacing) errors.push(`${action.toolKey} is customer-facing.`);
  }
  if (spec.approval.separateCustomerFacingApproval && spec.policy.allowedActions.some((action) =>
    action.allowed && action.customerFacing && writeTools.has(action.toolKey)
  )) {
    errors.push("Customer-facing write actions cannot be promoted to autonomous_low_risk.");
  }
  return errors;
}

function resolveSpecPath(projectRoot: string, registeredPath: string): string {
  const absolute = resolveConfinedPath(
    projectRoot,
    path.isAbsolute(registeredPath) ? registeredPath : path.resolve(projectRoot, registeredPath)
  );
  return /\.(?:json|ya?ml)$/i.test(absolute) ? absolute : path.join(absolute, "loopgraph.yaml");
}

function resolveConfinedPath(projectRoot: string, candidate: string): string {
  const root = path.resolve(projectRoot);
  const resolved = path.resolve(candidate);
  if (resolved !== root && !resolved.startsWith(`${root}${path.sep}`)) {
    throw new Error(`Promotion rehearsal path escapes the project root: ${candidate}`);
  }
  return resolved;
}

function emptyRoutingMetrics(): PromotionRehearsalReport["routingMetrics"] {
  return {
    truePositiveCount: 0,
    falseTriggerCount: 0,
    missedProblemCount: 0,
    abstentionCount: 0,
    expectedRouteCount: 0,
    expectedNoRouteCount: 0,
    duplicateExpectedCount: 0,
    duplicateSuppressedCount: 0,
    precision: 0,
    recall: 0,
    falseTriggerRate: 0,
    missedProblemRate: 0,
    abstentionRate: 0,
    averageDecisionLatencyMs: 0
  };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function assertOrderedTarget(previousMode: RoutingActivationMode, targetMode: RoutingActivationMode): void {
  const nextByMode: Partial<Record<RoutingActivationMode, RoutingActivationMode>> = {
    simulate: "shadow",
    shadow: "recommend",
    recommend: "execute_with_approval",
    execute_with_approval: "autonomous_low_risk"
  };
  if (nextByMode[previousMode] !== targetMode) {
    throw new Error(`Invalid promotion transition: ${previousMode} -> ${targetMode}`);
  }
}
