import { describe, expect, it } from "vitest";
import type {
  RouterEvaluation,
  RoutingAttempt,
  RoutingCorrection,
  RoutingDecision
} from "../core";
import { STALE_ROUTING_LEARNING_CONTEXT_ERROR } from "./routing-store";
import { summarizeRoutingLearningEffectiveness } from "./routing-learning-effectiveness";

describe("Hermes routing learning effectiveness", () => {
  it("separates evidence coverage, abstention, corrections, and evaluated routing quality", () => {
    const attempts: RoutingAttempt[] = [
      attempt("attempt_ack", "committed", "route", ["marketing_ads"], "acknowledged"),
      attempt("attempt_review", "committed", "request_human", [], "unacknowledged"),
      {
        ...attempt("attempt_stale", "rejected", "route", ["marketing_ads"], "unacknowledged"),
        validationErrors: [STALE_ROUTING_LEARNING_CONTEXT_ERROR]
      },
      attempt("attempt_legacy", "committed", "append_evidence", ["product_feedback"], "not_recorded")
    ];
    const corrections: RoutingCorrection[] = [{
      id: "correction_1",
      eventId: "event_attempt_review",
      routeAttemptId: "attempt_review",
      expectedAction: "route",
      expectedLoopIds: ["sales_qualification"],
      reason: "The account owner confirmed the lead was qualified.",
      correctedBy: "revenue-operations",
      correctedAt: "2026-08-20T10:10:00.000Z"
    }];
    const evaluations: RouterEvaluation[] = [
      evaluation("evaluation_pass", ["marketing_ads"], ["marketing_ads"], true),
      evaluation("evaluation_fail", ["marketing_content"], ["marketing_ads"], false)
    ];

    const result = summarizeRoutingLearningEffectiveness({
      attempts,
      corrections,
      evaluations,
      now: new Date("2026-08-23T12:00:00.000Z")
    });

    expect(result).toMatchObject({
      schemaVersion: "routing-learning-effectiveness/v1alpha1",
      attempts: {
        total: 4,
        committed: 3,
        rejected: 1,
        evidenceAcknowledged: 1,
        evidenceUnacknowledged: 2,
        evidenceNotRecorded: 1,
        staleEvidenceRejected: 1,
        evidenceCoverageRate: 0.25,
        actions: {
          route: 2,
          append_evidence: 1,
          request_human: 1
        }
      },
      humanFeedback: { corrections: 1, correctedAttempts: 1 },
      evaluations: { total: 2, passed: 1, failed: 1, passRate: 0.5 }
    });
    expect(result.loops).toEqual(expect.arrayContaining([
      expect.objectContaining({
        loopId: "marketing_ads",
        selected: 2,
        expected: 1,
        evaluated: 2,
        passed: 1,
        failed: 1
      }),
      expect.objectContaining({
        loopId: "sales_qualification",
        correctedSelections: 1
      })
    ]));
    expect(result.recentDecisions[0]).toMatchObject({
      attemptId: "attempt_legacy",
      evidenceState: "not_recorded"
    });
  });

  it("does not invent rates when no routing evidence exists", () => {
    const result = summarizeRoutingLearningEffectiveness({
      attempts: [],
      corrections: [],
      evaluations: [],
      now: new Date("2026-08-23T12:00:00.000Z")
    });

    expect(result.attempts.evidenceCoverageRate).toBeUndefined();
    expect(result.evaluations.passRate).toBeUndefined();
    expect(result.recentDecisions).toEqual([]);
    expect(result.loops).toEqual([]);
  });
});

function attempt(
  id: string,
  status: RoutingAttempt["status"],
  action: RoutingDecision["action"],
  selectedLoopIds: string[],
  evidenceState: "acknowledged" | "unacknowledged" | "not_recorded"
): RoutingAttempt {
  return {
    id,
    eventId: `event_${id}`,
    catalogVersion: "catalog_test",
    action,
    status,
    decision: {
      schemaVersion: "routing-decision/v1alpha1",
      eventId: `event_${id}`,
      catalogVersion: "catalog_test",
      action,
      selectedRoutes: selectedLoopIds.map((loopId) => ({
        loopId,
        role: "primary",
        confidence: 0.9,
        reasonSummary: "Test route",
        evidenceRefs: [],
        inputMapping: {},
        priority: 0
      })),
      alternatives: [],
      modelMetadata: {},
      policyVersion: "routing-policy/v1alpha1"
    },
    validationErrors: [],
    hermesMetadata: {},
    ...(evidenceState === "not_recorded" ? {} : {
      learningContextBinding: {
        acknowledged: evidenceState === "acknowledged"
      } as RoutingAttempt["learningContextBinding"]
    }),
    createdAt: id === "attempt_legacy"
      ? "2026-08-20T10:03:00.000Z"
      : id === "attempt_stale"
        ? "2026-08-20T10:02:00.000Z"
        : id === "attempt_review"
          ? "2026-08-20T10:01:00.000Z"
          : "2026-08-20T10:00:00.000Z"
  };
}

function evaluation(
  id: string,
  expectedLoopIds: string[],
  actualLoopIds: string[],
  passed: boolean
): RouterEvaluation {
  return {
    id,
    fixtureId: `fixture_${id}`,
    eventId: `event_${id}`,
    expectedAction: "route",
    expectedLoopIds,
    actualAction: "route",
    actualLoopIds,
    passed,
    evaluatedAt: "2026-08-20T11:00:00.000Z"
  };
}
