import { z } from "zod";
import {
  routingDecisionActionSchema,
  type RouterEvaluation,
  type RoutingAttempt,
  type RoutingCorrection,
  type RoutingDecision
} from "../core";
import {
  STALE_ROUTING_LEARNING_CONTEXT_ERROR,
  type RoutingStore
} from "./routing-store";

export const ROUTING_LEARNING_EFFECTIVENESS_SCHEMA_VERSION =
  "routing-learning-effectiveness/v1alpha1" as const;

const countSchema = z.number().int().min(0);

export const routingLearningEffectivenessSchema = z.object({
  schemaVersion: z.literal(ROUTING_LEARNING_EFFECTIVENESS_SCHEMA_VERSION),
  generatedAt: z.string().datetime(),
  attempts: z.object({
    total: countSchema,
    committed: countSchema,
    rejected: countSchema,
    evidenceAcknowledged: countSchema,
    evidenceUnacknowledged: countSchema,
    evidenceNotRecorded: countSchema,
    staleEvidenceRejected: countSchema,
    evidenceCoverageRate: z.number().min(0).max(1).optional(),
    actions: z.record(routingDecisionActionSchema, countSchema)
  }),
  humanFeedback: z.object({
    corrections: countSchema,
    correctedAttempts: countSchema
  }),
  evaluations: z.object({
    total: countSchema,
    passed: countSchema,
    failed: countSchema,
    passRate: z.number().min(0).max(1).optional()
  }),
  loops: z.array(z.object({
    loopId: z.string().min(1),
    selected: countSchema,
    expected: countSchema,
    correctedSelections: countSchema,
    evaluated: countSchema,
    passed: countSchema,
    failed: countSchema
  })).max(100),
  recentDecisions: z.array(z.object({
    attemptId: z.string().min(1),
    eventId: z.string().min(1),
    createdAt: z.string().datetime(),
    status: z.string().min(1),
    action: routingDecisionActionSchema.optional(),
    selectedLoopIds: z.array(z.string().min(1)).max(32),
    evidenceState: z.enum(["acknowledged", "unacknowledged", "not_recorded"]),
    staleEvidenceRejected: z.boolean()
  })).max(25),
  truncated: z.object({
    loops: z.boolean(),
    recentDecisions: z.boolean()
  })
});

export type RoutingLearningEffectiveness = z.infer<typeof routingLearningEffectivenessSchema>;

const ROUTING_ACTIONS = routingDecisionActionSchema.options;

export async function compileRoutingLearningEffectiveness(
  store: RoutingStore,
  options: { now?: Date } = {}
): Promise<RoutingLearningEffectiveness> {
  const [attempts, corrections, evaluations] = await Promise.all([
    store.listRoutingAttempts(),
    store.listRoutingCorrections(),
    store.listRouterEvaluations()
  ]);
  return summarizeRoutingLearningEffectiveness({
    attempts,
    corrections,
    evaluations,
    now: options.now
  });
}

export function summarizeRoutingLearningEffectiveness(input: {
  attempts: RoutingAttempt[];
  corrections: RoutingCorrection[];
  evaluations: RouterEvaluation[];
  now?: Date;
}): RoutingLearningEffectiveness {
  const actionCounts = Object.fromEntries(
    ROUTING_ACTIONS.map((action) => [action, 0])
  ) as Record<RoutingDecision["action"], number>;
  const loopStats = new Map<string, {
    loopId: string;
    selected: number;
    expected: number;
    correctedSelections: number;
    evaluated: number;
    passed: number;
    failed: number;
  }>();
  const loop = (loopId: string) => {
    const current = loopStats.get(loopId) ?? {
      loopId,
      selected: 0,
      expected: 0,
      correctedSelections: 0,
      evaluated: 0,
      passed: 0,
      failed: 0
    };
    loopStats.set(loopId, current);
    return current;
  };

  for (const attempt of input.attempts) {
    if (attempt.action) actionCounts[attempt.action] += 1;
    for (const selected of attempt.decision?.selectedRoutes ?? []) loop(selected.loopId).selected += 1;
  }
  for (const correction of input.corrections) {
    for (const loopId of correction.expectedLoopIds) loop(loopId).correctedSelections += 1;
  }
  for (const evaluation of input.evaluations) {
    for (const loopId of new Set([...evaluation.expectedLoopIds, ...evaluation.actualLoopIds])) {
      const current = loop(loopId);
      current.evaluated += 1;
      current[evaluation.passed ? "passed" : "failed"] += 1;
    }
    for (const loopId of evaluation.expectedLoopIds) loop(loopId).expected += 1;
  }

  const evidenceAcknowledged = input.attempts.filter(
    (attempt) => attempt.learningContextBinding?.acknowledged
  ).length;
  const evidenceUnacknowledged = input.attempts.filter(
    (attempt) => attempt.learningContextBinding && !attempt.learningContextBinding.acknowledged
  ).length;
  const evidenceNotRecorded = input.attempts.filter(
    (attempt) => !attempt.learningContextBinding
  ).length;
  const passed = input.evaluations.filter((evaluation) => evaluation.passed).length;
  const loopRows = [...loopStats.values()]
    .sort((left, right) => {
      const activityDifference = loopActivity(right) - loopActivity(left);
      return activityDifference || left.loopId.localeCompare(right.loopId);
    });
  const recent = [...input.attempts]
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt));

  return routingLearningEffectivenessSchema.parse({
    schemaVersion: ROUTING_LEARNING_EFFECTIVENESS_SCHEMA_VERSION,
    generatedAt: (input.now ?? new Date()).toISOString(),
    attempts: {
      total: input.attempts.length,
      committed: input.attempts.filter((attempt) => attempt.status === "committed").length,
      rejected: input.attempts.filter((attempt) => attempt.status === "rejected").length,
      evidenceAcknowledged,
      evidenceUnacknowledged,
      evidenceNotRecorded,
      staleEvidenceRejected: input.attempts.filter(isStaleEvidenceRejection).length,
      ...(input.attempts.length > 0
        ? { evidenceCoverageRate: evidenceAcknowledged / input.attempts.length }
        : {}),
      actions: actionCounts
    },
    humanFeedback: {
      corrections: input.corrections.length,
      correctedAttempts: new Set(
        input.corrections.flatMap((correction) => correction.routeAttemptId ? [correction.routeAttemptId] : [])
      ).size
    },
    evaluations: {
      total: input.evaluations.length,
      passed,
      failed: input.evaluations.length - passed,
      ...(input.evaluations.length > 0 ? { passRate: passed / input.evaluations.length } : {})
    },
    loops: loopRows.slice(0, 100),
    recentDecisions: recent.slice(0, 25).map((attempt) => ({
      attemptId: attempt.id,
      eventId: attempt.eventId,
      createdAt: attempt.createdAt,
      status: attempt.status,
      action: attempt.action,
      selectedLoopIds: (attempt.decision?.selectedRoutes ?? [])
        .map((route) => route.loopId)
        .slice(0, 32),
      evidenceState: attempt.learningContextBinding
        ? attempt.learningContextBinding.acknowledged ? "acknowledged" : "unacknowledged"
        : "not_recorded",
      staleEvidenceRejected: isStaleEvidenceRejection(attempt)
    })),
    truncated: {
      loops: loopRows.length > 100,
      recentDecisions: recent.length > 25
    }
  });
}

function loopActivity(loop: RoutingLearningEffectiveness["loops"][number]): number {
  return loop.selected + loop.expected + loop.correctedSelections + loop.evaluated;
}

function isStaleEvidenceRejection(attempt: RoutingAttempt): boolean {
  return attempt.status === "rejected" &&
    attempt.validationErrors.includes(STALE_ROUTING_LEARNING_CONTEXT_ERROR);
}
