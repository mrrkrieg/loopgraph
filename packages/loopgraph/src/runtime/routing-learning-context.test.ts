import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  businessProblemSchema,
  createEventEnvelopeId,
  eventEnvelopeSchema,
  eventReceiptSchema,
  observedOutcomeSchema,
  routerEvaluationSchema,
  routingCardSchema,
  routingCorrectionSchema,
  routingLearningContextBindingSchema,
  valueLedgerEntrySchema
} from "../core";
import { FileOutcomeStore } from "./outcome-store";
import {
  bindRoutingLearningContext,
  compileRoutingLearningContext,
  routingLearningContextDigest,
  unavailableRoutingLearningContext
} from "./routing-learning-context";
import { FileRoutingStore } from "./routing-store";

describe("Hermes routing learning context", () => {
  it("joins corrections, evaluations, outcomes, value, and subject history without granting route authority", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "loopgraph-routing-learning-"));
    const routingStore = new FileRoutingStore(root);
    const outcomeStore = new FileOutcomeStore(root);
    const event = withEntityResolution(
      companyEvent("delivery_current", "company_1"),
      "entity_campaign_1"
    );
    const historicalEvent = withEntityResolution(
      eventEnvelopeSchema.parse({
        ...companyEvent("delivery_history", "company_1"),
        source: "hubspot",
        subject: { type: "campaign_record", id: "hubspot_campaign_987" }
      }),
      "entity_campaign_1"
    );
    const foreignEvent = companyEvent("delivery_foreign", "company_2");
    const candidate = routingCard("marketing_ads", ["sales_qualification"]);
    const supporting = routingCard("sales_qualification");
    const unrelated = routingCard("engineering_incident");

    for (const receipt of [historicalEvent, foreignEvent]) {
      await routingStore.saveEventReceipt(eventReceiptSchema.parse({
        id: `receipt_${receipt.id}`,
        eventId: receipt.id,
        event: receipt,
        eventHash: `hash_${receipt.id}`,
        status: "received",
        firstSeenAt: receipt.receivedAt,
        lastSeenAt: receipt.receivedAt
      }));
    }
    const problem = businessProblemSchema.parse({
      id: "problem_campaign_1",
      workspaceId: event.workspaceId,
      companyId: event.companyId,
      problemType: "campaign_pipeline_quality",
      subject: historicalEvent.subject,
      summary: "Campaign produces leads that do not qualify.",
      status: "resolved",
      correlationId: event.correlationId,
      dedupeKey: "campaign_123",
      evidenceEventIds: [historicalEvent.id],
      primaryLoopId: "marketing_ads",
      supportingLoopIds: ["sales_qualification"],
      routeCommitIds: [],
      outcomeRefs: ["outcome_ads_1", "outcome_sales_1"],
      openedAt: "2026-07-01T00:00:00.000Z",
      updatedAt: "2026-07-10T00:00:00.000Z",
      resolvedAt: "2026-07-10T00:00:00.000Z"
    });
    await routingStore.saveBusinessProblem(problem);
    await routingStore.saveRouterEvaluation(routerEvaluationSchema.parse({
      id: "evaluation_ads_1",
      fixtureId: "fixture_ads_1",
      eventId: historicalEvent.id,
      expectedAction: "route",
      expectedLoopIds: ["marketing_ads"],
      actualAction: "route",
      actualLoopIds: ["marketing_ads"],
      passed: true,
      evaluatedAt: "2026-07-11T00:00:00.000Z"
    }));
    await routingStore.saveRouterEvaluation(routerEvaluationSchema.parse({
      id: "evaluation_foreign_1",
      fixtureId: "fixture_foreign_1",
      eventId: foreignEvent.id,
      expectedAction: "route",
      expectedLoopIds: ["marketing_ads"],
      actualAction: "request_human",
      actualLoopIds: [],
      passed: false,
      evaluatedAt: "2026-07-12T00:00:00.000Z"
    }));
    await routingStore.saveRoutingCorrection(routingCorrectionSchema.parse({
      id: "correction_ads_1",
      eventId: historicalEvent.id,
      expectedAction: "route",
      expectedLoopIds: ["marketing_ads"],
      reason: "Reviewed campaign mapping.",
      correctedBy: "growth_lead",
      correctedAt: "2026-07-11T01:00:00.000Z"
    }));

    await outcomeStore.saveObservedOutcome(observedOutcomeSchema.parse({
      id: "outcome_ads_1",
      workspaceId: event.workspaceId,
      companyId: event.companyId,
      departmentId: "marketing",
      loopId: "marketing_ads",
      metricDefinitionId: "qualified_cac",
      metricKey: "qualified_cac",
      unit: "USD",
      desiredDirection: "decrease",
      evaluationWindow: {
        start: "2026-07-01T00:00:00.000Z",
        end: "2026-07-10T00:00:00.000Z"
      },
      baseline: { value: 120, sampleIds: ["sample_ads_before"] },
      observed: { value: 95, sampleIds: ["sample_ads_after"] },
      absoluteDelta: -25,
      relativeDeltaPct: -20.83,
      status: "improved",
      truthStatus: "observed",
      confidence: 0.91,
      evidenceSufficiency: { sufficient: true, reasons: [] },
      guardrails: [],
      runIds: ["run_ads_1"],
      problemIds: [problem.id],
      evidenceRefs: ["metric_ads_1"],
      evaluatedAt: "2026-07-10T00:00:00.000Z"
    }));
    await outcomeStore.saveObservedOutcome(observedOutcomeSchema.parse({
      id: "outcome_sales_1",
      workspaceId: event.workspaceId,
      companyId: event.companyId,
      departmentId: "sales",
      loopId: "sales_qualification",
      metricDefinitionId: "qualification_rate",
      metricKey: "qualification_rate",
      unit: "percent",
      desiredDirection: "increase",
      evaluationWindow: {
        start: "2026-07-01T00:00:00.000Z",
        end: "2026-07-10T00:00:00.000Z"
      },
      baseline: { value: 18, sampleIds: ["sample_sales_before"] },
      observed: { value: 23, sampleIds: ["sample_sales_after"] },
      absoluteDelta: 5,
      relativeDeltaPct: 27.78,
      status: "improved",
      truthStatus: "observed",
      confidence: 0.88,
      evidenceSufficiency: { sufficient: true, reasons: [] },
      guardrails: [],
      runIds: ["run_sales_1"],
      problemIds: [problem.id],
      evidenceRefs: ["metric_sales_1"],
      evaluatedAt: "2026-07-10T01:00:00.000Z"
    }));
    await outcomeStore.saveValueLedgerEntry(valueLedgerEntrySchema.parse({
      id: "value_ads_1",
      workspaceId: event.workspaceId,
      companyId: event.companyId,
      departmentId: "marketing",
      loopId: "marketing_ads",
      window: {
        start: "2026-07-01T00:00:00.000Z",
        end: "2026-07-10T00:00:00.000Z"
      },
      grossSavedMinutes: 180,
      hiddenCostMinutes: {
        review: 20,
        rework: 10,
        botsitting: 5,
        escalation: 0,
        governance: 5
      },
      operatingCostMinutes: {
        connectorOperations: 10,
        supervision: 5,
        organizationalChange: 5
      },
      observedCostMinutes: 60,
      netSavedMinutes: 120,
      truthStatus: "observed",
      observedOutcomeIds: ["outcome_ads_1"],
      runIds: ["run_ads_1"],
      reviewIds: ["review_ads_1"],
      evidenceRefs: ["value_evidence_ads_1"],
      recordedAt: "2026-07-10T02:00:00.000Z"
    }));

    const context = await compileRoutingLearningContext({
      event,
      eligibleRoutes: [{
        eligible: true,
        card: candidate,
        matchedAccepts: candidate.accepts,
        matchedExcludes: [],
        missingFields: [],
        reasons: []
      }],
      routingCards: [candidate, supporting, unrelated],
      routingStore,
      outcomeStore,
      now: new Date("2026-07-21T12:00:02.000Z")
    });

    expect(context).toMatchObject({
      status: "available",
      authority: "advisory",
      eligibleLoopIds: ["marketing_ads"],
      subjectProblemIds: [problem.id],
      scope: { canonicalEntityId: "entity_campaign_1" },
      totals: {
        routingEvaluations: 1,
        routingCorrections: 1,
        observedOutcomes: 2,
        valueEntries: 1
      }
    });
    expect(context.loopEvidence).toEqual([
      expect.objectContaining({
        loopId: "marketing_ads",
        relation: "eligible_candidate",
        eligibleForCurrentEvent: true,
        routingQuality: expect.objectContaining({ evaluated: 1, passed: 1, passRate: 1 }),
        humanFeedback: expect.objectContaining({ corrections: 1, selected: 1 }),
        outcomes: expect.objectContaining({ observed: 1, improved: 1 }),
        value: expect.objectContaining({ observedEntries: 1, observedNetSavedMinutes: 120 })
      }),
      expect.objectContaining({
        loopId: "sales_qualification",
        relation: "declared_supporting",
        eligibleForCurrentEvent: false,
        outcomes: expect.objectContaining({ observed: 1, improved: 1 })
      })
    ]);
    expect(context.loopEvidence.some((item) => item.loopId === "engineering_incident")).toBe(false);
    expect(context.decisionRule).toContain("cannot authorize a route");
  });

  it("returns a typed, empty context when learning evidence is unavailable", () => {
    const context = unavailableRoutingLearningContext({
      event: companyEvent("delivery_unavailable", "company_1"),
      now: new Date("2026-07-21T12:00:02.000Z"),
      warning: "Shared learning evidence is unavailable."
    });

    expect(context).toMatchObject({
      status: "unavailable",
      authority: "advisory",
      loopEvidence: [],
      warnings: ["Shared learning evidence is unavailable."]
    });
  });

  it("binds the semantic evidence packet while ignoring generation time", () => {
    const first = unavailableRoutingLearningContext({
      event: companyEvent("delivery_digest_1", "company_1"),
      now: new Date("2026-07-21T12:00:02.000Z"),
      warning: "Shared learning evidence is unavailable."
    });
    const second = {
      ...first,
      generatedAt: "2026-07-21T12:01:02.000Z"
    };
    const digest = routingLearningContextDigest(first);

    expect(routingLearningContextDigest(second)).toBe(digest);
    expect(routingLearningContextDigest({
      ...second,
      warnings: ["A different bounded state was observed."]
    })).not.toBe(digest);
    expect(bindRoutingLearningContext({
      context: second,
      acknowledgedDigest: digest,
      boundAt: new Date("2026-07-21T12:01:03.000Z")
    })).toMatchObject({
      schemaVersion: "routing-learning-context-binding/v1alpha1",
      contextDigest: digest,
      acknowledgedDigest: digest,
      acknowledged: true,
      context: second,
      boundAt: "2026-07-21T12:01:03.000Z"
    });
    expect(() => routingLearningContextBindingSchema.parse({
      ...bindRoutingLearningContext({
        context: second,
        acknowledgedDigest: digest,
        boundAt: new Date("2026-07-21T12:01:03.000Z")
      }),
      contextDigest: "0000000000000000000000000000000000000000000000000000000000000000",
      acknowledged: true
    })).toThrow(/contextDigest must match/);
  });
});

function companyEvent(sourceDeliveryId: string, companyId: string) {
  const identity = {
    workspaceId: "workspace_1",
    companyId,
    source: "google_ads_detector",
    sourceDeliveryId,
    eventType: "campaign.performance_anomaly"
  };
  return eventEnvelopeSchema.parse({
    id: createEventEnvelopeId(identity),
    ...identity,
    sourceRoute: "hermes.google_ads_detector",
    occurredAt: "2026-07-21T12:00:00.000Z",
    receivedAt: "2026-07-21T12:00:01.000Z",
    subject: { type: "campaign", id: "campaign_123" },
    correlationId: `corr_${companyId}`,
    normalizedPayload: { signals: { spendDeltaPct: 18 } },
    trust: { signatureVerified: true, signer: "google_ads", untrustedFields: [] }
  });
}

function routingCard(loopId: string, permittedSupportingLoopIds: string[] = []) {
  return routingCardSchema.parse({
    catalogVersion: "catalog_1",
    loopId,
    loopName: loopId,
    goal: `Handle ${loopId}`,
    currentReadiness: "ready",
    loopStatus: "active",
    problemTypes: ["campaign_pipeline_quality"],
    accepts: [{
      sourcePattern: "google_ads*",
      eventTypePattern: "campaign.*",
      subjectTypes: ["campaign"],
      requiredFields: []
    }],
    minimumConfidence: 0.8,
    priority: 10,
    fanoutPolicy: {
      mode: permittedSupportingLoopIds.length > 0 ? "declared_ordered" : "none",
      maxRoutes: permittedSupportingLoopIds.length > 0 ? 2 : 1,
      requiresIndependentProblems: false
    },
    permittedSupportingLoopIds,
    loopSpecHash: `hash_${loopId}`
  });
}

function withEntityResolution(
  event: ReturnType<typeof companyEvent>,
  canonicalEntityId: string
) {
  return eventEnvelopeSchema.parse({
    ...event,
    normalizedPayload: {
      ...event.normalizedPayload,
      entityResolution: {
        schemaVersion: "entity-resolution/v1alpha1",
        status: "exact",
        canonicalEntityId,
        candidateEntityIds: [],
        matchedBy: "provider_alias",
        requiresHumanReview: false,
        reasons: ["Exact provider alias matched."]
      }
    }
  });
}
