import {
  ROUTING_LEARNING_CONTEXT_SCHEMA_VERSION,
  entityResolutionResultSchema,
  routingLearningContextSchema,
  safeEventSubject,
  type BusinessProblem,
  type EventEnvelope,
  type RoutingCard,
  type RoutingEligibilityResult,
  type RoutingLearningContext,
  type RoutingLearningLoopEvidence
} from "../core";
import type { OutcomeStore } from "./outcome-store";
import type { RoutingStore } from "./routing-store";

const MAX_CONTEXT_LOOPS = 32;
const MAX_ELIGIBLE_LOOPS = 100;
const MAX_SUBJECT_PROBLEMS = 100;
const MAX_SOURCE_RECORDS = 500;
const MAX_EVIDENCE_REFS = 20;
const DECISION_RULE =
  "Only currently eligible routing cards may be selected; learning evidence cannot authorize a route, fan-out, execution, or provider action." as const;

export async function compileRoutingLearningContext(input: {
  event: EventEnvelope;
  eligibleRoutes: RoutingEligibilityResult[];
  routingCards: RoutingCard[];
  routingStore: RoutingStore;
  outcomeStore: OutcomeStore;
  now?: Date;
}): Promise<RoutingLearningContext> {
  const generatedAt = (input.now ?? new Date()).toISOString();
  const [receipts, problems, corrections, evaluations, outcomes, valueEntries] =
    await Promise.all([
      input.routingStore.listEventReceipts(),
      input.routingStore.listBusinessProblems(),
      input.routingStore.listRoutingCorrections(),
      input.routingStore.listRouterEvaluations(),
      input.outcomeStore.listObservedOutcomes({
        workspaceId: input.event.workspaceId,
        companyId: input.event.companyId
      }),
      input.outcomeStore.listValueLedgerEntries({
        workspaceId: input.event.workspaceId,
        companyId: input.event.companyId
      })
    ]);

  const scopedEventIds = new Set(
    receipts
      .filter((receipt) =>
        receipt.event.workspaceId === input.event.workspaceId &&
        receipt.event.companyId === input.event.companyId
      )
      .map((receipt) => receipt.eventId)
  );
  const canonicalEntityIdByEventId = new Map(
    receipts.flatMap((receipt) => {
      const canonicalEntityId = eventCanonicalEntityId(receipt.event);
      return canonicalEntityId ? [[receipt.eventId, canonicalEntityId] as const] : [];
    })
  );
  const canonicalEntityId = eventCanonicalEntityId(input.event);
  const subjectProblems = problems
    .filter((problem) => subjectMatchesEvent({
      problem,
      event: input.event,
      canonicalEntityId,
      canonicalEntityIdByEventId
    }))
    .sort((left, right) =>
      right.updatedAt.localeCompare(left.updatedAt) || left.id.localeCompare(right.id)
    );
  const subjectProblemIds = new Set(subjectProblems.map((problem) => problem.id));
  const scopedCorrections = corrections
    .filter((correction) => scopedEventIds.has(correction.eventId))
    .sort((left, right) =>
      right.correctedAt.localeCompare(left.correctedAt) || left.id.localeCompare(right.id)
    );
  const scopedEvaluations = evaluations
    .filter((evaluation) => scopedEventIds.has(evaluation.eventId))
    .sort((left, right) =>
      right.evaluatedAt.localeCompare(left.evaluatedAt) || left.id.localeCompare(right.id)
    );
  const relatedOutcomes = outcomes
    .filter((outcome) =>
      input.eligibleRoutes.some((route) => route.card.loopId === outcome.loopId) ||
      outcome.problemIds.some((problemId) => subjectProblemIds.has(problemId))
    )
    .sort((left, right) =>
      right.evaluatedAt.localeCompare(left.evaluatedAt) || left.id.localeCompare(right.id)
    );
  const relatedOutcomeIds = new Set(relatedOutcomes.map((outcome) => outcome.id));
  const relatedValueEntries = valueEntries
    .filter((entry) =>
      input.eligibleRoutes.some((route) => route.card.loopId === entry.loopId) ||
      entry.observedOutcomeIds.some((outcomeId) => relatedOutcomeIds.has(outcomeId))
    )
    .sort((left, right) =>
      right.recordedAt.localeCompare(left.recordedAt) || left.id.localeCompare(right.id)
    );

  const relationByLoopId = collectLoopRelations({
    eligibleRoutes: input.eligibleRoutes,
    routingCards: input.routingCards,
    subjectProblems,
    outcomeLoopIds: relatedOutcomes.map((outcome) => outcome.loopId),
    valueLoopIds: relatedValueEntries.map((entry) => entry.loopId)
  });
  const loopIds = [...relationByLoopId.keys()];
  const boundedLoopIds = loopIds.slice(0, MAX_CONTEXT_LOOPS);
  const boundedEvaluations = scopedEvaluations.slice(0, MAX_SOURCE_RECORDS);
  const boundedCorrections = scopedCorrections.slice(0, MAX_SOURCE_RECORDS);
  const boundedOutcomes = relatedOutcomes.slice(0, MAX_SOURCE_RECORDS);
  const boundedValueEntries = relatedValueEntries.slice(0, MAX_SOURCE_RECORDS);
  const allEligibleLoopIds = input.eligibleRoutes.map((route) => route.card.loopId);
  const eligibleLoopIds = allEligibleLoopIds.slice(0, MAX_ELIGIBLE_LOOPS);
  const eligibleLoopIdSet = new Set(allEligibleLoopIds);
  const loopEvidence = boundedLoopIds.map((loopId) => compileLoopEvidence({
    loopId,
    relation: relationByLoopId.get(loopId)!,
    eligibleForCurrentEvent: eligibleLoopIdSet.has(loopId),
    evaluations: boundedEvaluations,
    corrections: boundedCorrections,
    outcomes: boundedOutcomes,
    valueEntries: boundedValueEntries
  }));
  const truncated = {
    eligibleLoops: allEligibleLoopIds.length > MAX_ELIGIBLE_LOOPS,
    subjectProblems: subjectProblems.length > MAX_SUBJECT_PROBLEMS,
    loops: loopIds.length > MAX_CONTEXT_LOOPS,
    routingEvaluations: scopedEvaluations.length > MAX_SOURCE_RECORDS,
    routingCorrections: scopedCorrections.length > MAX_SOURCE_RECORDS,
    observedOutcomes: relatedOutcomes.length > MAX_SOURCE_RECORDS,
    valueEntries: relatedValueEntries.length > MAX_SOURCE_RECORDS
  };

  return routingLearningContextSchema.parse({
    schemaVersion: ROUTING_LEARNING_CONTEXT_SCHEMA_VERSION,
    status: "available",
    authority: "advisory",
    generatedAt,
    scope: {
      workspaceId: input.event.workspaceId,
      companyId: input.event.companyId,
      subject: safeEventSubject(input.event),
      canonicalEntityId
    },
    eligibleLoopIds,
    subjectProblemIds: subjectProblems.slice(0, MAX_SUBJECT_PROBLEMS).map((problem) => problem.id),
    loopEvidence,
    totals: {
      routingEvaluations: scopedEvaluations.length,
      routingCorrections: scopedCorrections.length,
      observedOutcomes: relatedOutcomes.length,
      valueEntries: relatedValueEntries.length
    },
    truncated,
    decisionRule: DECISION_RULE,
    warnings: Object.values(truncated).some(Boolean)
      ? ["Learning evidence was bounded to the newest records; use it as directional evidence only."]
      : []
  });
}

export function unavailableRoutingLearningContext(input: {
  event: EventEnvelope;
  now?: Date;
  status?: "not_applicable" | "unavailable";
  warning: string;
}): RoutingLearningContext {
  return routingLearningContextSchema.parse({
    schemaVersion: ROUTING_LEARNING_CONTEXT_SCHEMA_VERSION,
    status: input.status ?? "unavailable",
    authority: "advisory",
    generatedAt: (input.now ?? new Date()).toISOString(),
    scope: {
      workspaceId: input.event.workspaceId,
      companyId: input.event.companyId,
      subject: safeEventSubject(input.event),
      canonicalEntityId: eventCanonicalEntityId(input.event)
    },
    eligibleLoopIds: [],
    subjectProblemIds: [],
    loopEvidence: [],
    totals: {
      routingEvaluations: 0,
      routingCorrections: 0,
      observedOutcomes: 0,
      valueEntries: 0
    },
    truncated: {
      eligibleLoops: false,
      subjectProblems: false,
      loops: false,
      routingEvaluations: false,
      routingCorrections: false,
      observedOutcomes: false,
      valueEntries: false
    },
    decisionRule: DECISION_RULE,
    warnings: [input.warning]
  });
}

function collectLoopRelations(input: {
  eligibleRoutes: RoutingEligibilityResult[];
  routingCards: RoutingCard[];
  subjectProblems: BusinessProblem[];
  outcomeLoopIds: string[];
  valueLoopIds: string[];
}): Map<string, RoutingLearningLoopEvidence["relation"]> {
  const relations = new Map<string, RoutingLearningLoopEvidence["relation"]>();
  const cardById = new Map(input.routingCards.map((card) => [card.loopId, card]));
  for (const route of input.eligibleRoutes) {
    relations.set(route.card.loopId, "eligible_candidate");
  }
  for (const route of input.eligibleRoutes) {
    for (const supportingLoopId of route.card.permittedSupportingLoopIds) {
      if (cardById.has(supportingLoopId) && !relations.has(supportingLoopId)) {
        relations.set(supportingLoopId, "declared_supporting");
      }
    }
  }
  for (const problem of input.subjectProblems) {
    for (const loopId of [problem.primaryLoopId, ...problem.supportingLoopIds]) {
      if (loopId && !relations.has(loopId)) relations.set(loopId, "subject_history");
    }
  }
  for (const loopId of [...input.outcomeLoopIds, ...input.valueLoopIds]) {
    if (!relations.has(loopId)) relations.set(loopId, "subject_history");
  }
  return relations;
}

function compileLoopEvidence(input: {
  loopId: string;
  relation: RoutingLearningLoopEvidence["relation"];
  eligibleForCurrentEvent: boolean;
  evaluations: Awaited<ReturnType<RoutingStore["listRouterEvaluations"]>>;
  corrections: Awaited<ReturnType<RoutingStore["listRoutingCorrections"]>>;
  outcomes: Awaited<ReturnType<OutcomeStore["listObservedOutcomes"]>>;
  valueEntries: Awaited<ReturnType<OutcomeStore["listValueLedgerEntries"]>>;
}): RoutingLearningLoopEvidence {
  const evaluations = input.evaluations.filter((evaluation) =>
    evaluation.expectedLoopIds.includes(input.loopId) ||
    evaluation.actualLoopIds.includes(input.loopId)
  );
  const corrections = input.corrections.filter((correction) =>
    correction.expectedLoopIds.includes(input.loopId)
  );
  const outcomes = input.outcomes.filter((outcome) => outcome.loopId === input.loopId);
  const valueEntries = input.valueEntries.filter((entry) => entry.loopId === input.loopId);
  const observedValueEntries = valueEntries.filter((entry) => entry.truthStatus === "observed");

  return {
    loopId: input.loopId,
    relation: input.relation,
    eligibleForCurrentEvent: input.eligibleForCurrentEvent,
    routingQuality: {
      evaluated: evaluations.length,
      passed: evaluations.filter((evaluation) => evaluation.passed).length,
      failed: evaluations.filter((evaluation) => !evaluation.passed).length,
      expectedSelections: evaluations.filter((evaluation) =>
        evaluation.expectedLoopIds.includes(input.loopId)
      ).length,
      actualSelections: evaluations.filter((evaluation) =>
        evaluation.actualLoopIds.includes(input.loopId)
      ).length,
      passRate: evaluations.length > 0
        ? evaluations.filter((evaluation) => evaluation.passed).length / evaluations.length
        : undefined,
      evaluationRefs: evaluations.slice(0, MAX_EVIDENCE_REFS).map((evaluation) => evaluation.id)
    },
    humanFeedback: {
      corrections: corrections.length,
      selected: corrections.filter((correction) =>
        correction.expectedAction === "route"
      ).length,
      correctionRefs: corrections.slice(0, MAX_EVIDENCE_REFS).map((correction) => correction.id)
    },
    outcomes: {
      total: outcomes.length,
      observed: outcomes.filter((outcome) => outcome.truthStatus === "observed").length,
      improved: outcomes.filter((outcome) => outcome.status === "improved").length,
      targetMet: outcomes.filter((outcome) => outcome.status === "target_met").length,
      unchanged: outcomes.filter((outcome) => outcome.status === "unchanged").length,
      regressed: outcomes.filter((outcome) => outcome.status === "regressed").length,
      incomplete: outcomes.filter((outcome) => outcome.status === "incomplete").length,
      latestAt: outcomes[0]?.evaluatedAt,
      outcomeRefs: outcomes.slice(0, MAX_EVIDENCE_REFS).map((outcome) => outcome.id)
    },
    value: {
      entries: valueEntries.length,
      observedEntries: observedValueEntries.length,
      observedNetSavedMinutes: observedValueEntries.reduce(
        (total, entry) => total + entry.netSavedMinutes,
        0
      ),
      latestAt: valueEntries[0]?.recordedAt,
      valueRefs: valueEntries.slice(0, MAX_EVIDENCE_REFS).map((entry) => entry.id)
    }
  };
}

function subjectMatchesEvent(input: {
  problem: BusinessProblem;
  event: EventEnvelope;
  canonicalEntityId?: string;
  canonicalEntityIdByEventId: Map<string, string>;
}): boolean {
  if (
    input.problem.workspaceId !== input.event.workspaceId ||
    input.problem.companyId !== input.event.companyId
  ) return false;
  if (
    input.problem.subject.type === input.event.subject.type &&
    input.problem.subject.id === input.event.subject.id
  ) return true;
  return Boolean(input.canonicalEntityId) && input.problem.evidenceEventIds.some((eventId) =>
    input.canonicalEntityIdByEventId.get(eventId) === input.canonicalEntityId
  );
}

function eventCanonicalEntityId(event: EventEnvelope): string | undefined {
  const parsed = entityResolutionResultSchema.safeParse(
    event.normalizedPayload.entityResolution
  );
  if (!parsed.success || parsed.data.requiresHumanReview) return undefined;
  if (parsed.data.status !== "exact" && parsed.data.status !== "created") return undefined;
  return parsed.data.canonicalEntityId;
}
