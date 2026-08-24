import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  contentHash,
  createEventEnvelopeId,
  eventEnvelopeSchema,
  LOOPGRAPH_API_VERSION,
  LOOP_KIND,
  routingCardSchema,
  type EventEnvelope,
  type RoutingCard
} from "../core";
import { loadEventRoutingOperations } from "./event-routing-read-model";
import { saveLoopgraphLifecycleDelivery } from "./lifecycle-events";
import {
  bindRoutingLearningContext,
  routingLearningContextDigest,
  unavailableRoutingLearningContext
} from "./routing-learning-context";
import { FileRoutingStore, ingestRoutingEvent, submitRoutingDecision } from "./routing-store";

describe("event routing operations read model", () => {
  it("groups Hermes receipts, decisions, problems, jobs, corrections, and evaluations for the browser", async () => {
    const { projectRoot } = await createProjectWithAdsSpec();
    const store = new FileRoutingStore(path.join(projectRoot, ".loopgraph"));
    const event = adsEvent("delivery_read_model_1");
    const card = adsRoutingCard();
    const contentCard = contentRoutingCard();

    await ingestRoutingEvent({
      store,
      event,
      routingCards: [card, contentCard],
      now: new Date("2026-07-21T12:00:02.000Z")
    });
    const learningContext = unavailableRoutingLearningContext({
      event,
      now: new Date("2026-07-21T12:00:02.000Z"),
      warning: "No prior cross-loop evidence exists yet."
    });
    const learningContextDigest = routingLearningContextDigest(learningContext);
    const submitted = await submitRoutingDecision({
      store,
      decision: {
        schemaVersion: "routing-decision/v1alpha1",
        eventId: event.id,
        catalogVersion: "catalog_v1",
        action: "route",
        problem: {
          summary: "Campaign efficiency dropped.",
          problemTypes: ["paid_acquisition_efficiency_drop"],
          subject: event.subject,
          severity: "medium",
          dedupeKeyInputs: [event.subject.id]
        },
        selectedRoutes: [{
          loopId: "marketing_ads",
          role: "primary",
          confidence: 0.92,
          reasonSummary: "Campaign anomaly contains qualified-cost deterioration.",
          evidenceRefs: [],
          inputMapping: { campaignId: event.subject.id },
          priority: 10
        }],
        alternatives: [{
          loopId: "marketing_content_creation",
          confidence: 0.21,
          reasonSummary: "Rejected because this is not an approved content work item."
        }],
        modelMetadata: { hermesTaskId: "task_read_model_1" },
        policyVersion: "routing-policy/v1alpha1"
      },
      routingCards: [card, contentCard],
      catalogVersion: "catalog_v1",
      now: new Date("2026-07-21T12:00:03.000Z"),
      learningContextBinding: bindRoutingLearningContext({
        context: learningContext,
        acknowledgedDigest: learningContextDigest,
        boundAt: new Date("2026-07-21T12:00:03.000Z")
      })
    });
    await store.saveRoutingCorrection({
      id: "correction_read_model_1",
      eventId: event.id,
      routeAttemptId: submitted.attempt.id,
      expectedAction: "route",
      expectedLoopIds: ["marketing_ads"],
      reason: "Operator confirmed the expected Ads route.",
      correctedBy: "Growth lead",
      correctedAt: "2026-07-21T12:01:00.000Z"
    });
    await store.saveRouterEvaluation({
      id: "evaluation_read_model_1",
      fixtureId: "ads_happy",
      eventId: event.id,
      expectedAction: "route",
      expectedLoopIds: ["marketing_ads"],
      actualAction: "route",
      actualLoopIds: ["marketing_ads"],
      passed: true,
      latencyMs: 10,
      evaluatedAt: "2026-07-21T12:02:00.000Z"
    });
    await saveLoopgraphLifecycleDelivery(projectRoot, {
      schemaVersion: "loopgraph-lifecycle/v1alpha1",
      id: "lifecycle_read_model_1",
      event: eventEnvelopeSchema.parse({
        id: "evt_loop_run_completed_read_model_1",
        schemaVersion: "event-envelope/v1alpha1",
        workspaceId: event.workspaceId,
        companyId: event.companyId,
        source: "loopgraph",
        sourceRoute: "loopgraph.lifecycle",
        sourceDeliveryId: "run_read_model_1:loop.run.completed",
        eventType: "loop.run.completed",
        occurredAt: "2026-07-21T12:02:20.000Z",
        receivedAt: "2026-07-21T12:02:30.000Z",
        subject: { type: "loop_run", id: "run_read_model_1", display: "marketing_ads completed" },
        correlationId: event.correlationId,
        causationId: event.id,
        parentEventId: event.id,
        hopCount: 1,
        normalizedPayload: {
          notificationOnly: true,
          sourceEventId: event.id,
          routeCommitId: submitted.routeCommits[0]?.id,
          routeAttemptId: submitted.attempt.id,
          learningContextBinding: expect.objectContaining({
            contextDigest: learningContextDigest,
            acknowledged: true,
            context: expect.objectContaining({ status: "unavailable" })
          }),
          problemId: submitted.problem?.id,
          loopId: "marketing_ads",
          runId: "run_read_model_1",
          runStatus: "COMPLETED"
        },
        trust: { signatureVerified: true, signer: "loopgraph", untrustedFields: [] }
      }),
      eventHash: contentHash({ id: "evt_loop_run_completed_read_model_1" }),
      notificationOnly: true,
      status: "sent",
      signature: {
        algorithm: "hmac-sha256",
        headerName: "x-loopgraph-signature",
        value: "sha256=test",
        keyRef: "test"
      },
      target: {
        owner: "hermes",
        routeKey: "loopgraph-lifecycle-events",
        sourceRoute: "loopgraph.lifecycle"
      },
      createdAt: "2026-07-21T12:02:30.000Z",
      warnings: []
    });
    if (submitted.problem) {
      await store.saveBusinessProblem({
        ...submitted.problem,
        status: "resolved",
        updatedAt: "2026-07-21T12:03:00.000Z",
        resolvedAt: "2026-07-21T12:03:00.000Z",
        outcomeRefs: ["case_outcome:case_read_model_1"]
      });
    }
    await saveLoopgraphLifecycleDelivery(projectRoot, {
      schemaVersion: "loopgraph-lifecycle/v1alpha1",
      id: "lifecycle_outcome_read_model_1",
      event: eventEnvelopeSchema.parse({
        id: "evt_loop_outcome_recorded_read_model_1",
        schemaVersion: "event-envelope/v1alpha1",
        workspaceId: event.workspaceId,
        companyId: event.companyId,
        source: "loopgraph",
        sourceRoute: "loopgraph.lifecycle",
        sourceDeliveryId: "case_read_model_1:loop.outcome.recorded:2026-07-21T12:03:00.000Z",
        eventType: "loop.outcome.recorded",
        occurredAt: "2026-07-21T12:03:00.000Z",
        receivedAt: "2026-07-21T12:03:01.000Z",
        subject: {
          type: "case_outcome",
          id: "case_outcome_case_read_model_1",
          display: "Budget change approved and efficiency recovered."
        },
        correlationId: event.correlationId,
        causationId: event.id,
        parentEventId: event.id,
        hopCount: 1,
        normalizedPayload: {
          notificationOnly: true,
          sourceEventId: event.id,
          routeCommitId: submitted.routeCommits[0]?.id,
          routeAttemptId: submitted.attempt.id,
          problemId: submitted.problem?.id,
          loopId: "marketing_ads",
          runId: "run_read_model_1",
          runStatus: "WAITING_FOR_REVIEW",
          routeCommitStatus: "waiting_review",
          problemStatus: "resolved",
          escalationCaseId: "case_read_model_1",
          escalationStatus: "resolved",
          outcomeRef: "case_outcome:case_read_model_1",
          outcomeType: "case_resolution",
          resolutionSummary: "Budget change approved and efficiency recovered.",
          resolvedAt: "2026-07-21T12:03:00.000Z",
          businessResult: "Cost per qualified customer returned to target.",
          followUpRequired: false
        },
        trust: { signatureVerified: true, signer: "loopgraph", untrustedFields: [] }
      }),
      eventHash: contentHash({ id: "evt_loop_outcome_recorded_read_model_1" }),
      notificationOnly: true,
      status: "sent",
      signature: {
        algorithm: "hmac-sha256",
        headerName: "x-loopgraph-signature",
        value: "sha256=test",
        keyRef: "test"
      },
      target: {
        owner: "hermes",
        routeKey: "loopgraph-lifecycle-events",
        sourceRoute: "loopgraph.lifecycle"
      },
      createdAt: "2026-07-21T12:03:01.000Z",
      warnings: []
    });

    const model = await loadEventRoutingOperations({
      projectRoot,
      store,
      now: new Date("2026-07-21T12:03:00.000Z")
    });

    expect(model).toMatchObject({
      schemaVersion: "event-routing-operations/v1alpha1",
      filters: {},
      summary: {
        eventCount: 1,
        problemCount: 1,
        unhandledProblemCount: 0,
        routedEventCount: 1,
        pendingHumanChoiceCount: 0,
        failedEvaluationCount: 0
      },
      rows: [expect.objectContaining({
        eventId: event.id,
        source: "google_ads_detector",
        eventType: "campaign.performance_anomaly",
        action: "route",
        problemType: "paid_acquisition_efficiency_drop",
        selectedLoopIds: ["marketing_ads"],
        selectedLoopLabels: ["Ads"],
        alternativeLoopIds: ["marketing_content_creation"],
        confidence: 0.92,
        validationState: "committed",
        problemStatus: "resolved",
        owner: "Unassigned",
        outcome: {
          outcomeRef: "case_outcome:case_read_model_1",
          summary: "Budget change approved and efficiency recovered.",
          resolvedAt: "2026-07-21T12:03:00.000Z",
          businessResult: "Cost per qualified customer returned to target.",
          followUpRequired: false
        },
        decisionDetail: expect.objectContaining({
          action: "route",
          routeAttemptId: submitted.attempt.id,
          modelMetadata: [{ key: "hermesTaskId", value: "task_read_model_1" }],
          selectedRoutes: [expect.objectContaining({
            loopId: "marketing_ads",
            confidence: 0.92,
            reasonSummary: "Campaign anomaly contains qualified-cost deterioration."
          })],
          alternatives: [expect.objectContaining({
            loopId: "marketing_content_creation",
            confidence: 0.21,
            reasonSummary: "Rejected because this is not an approved content work item."
          })],
          routeCommits: [expect.objectContaining({ loopId: "marketing_ads" })],
          routeJobs: [expect.objectContaining({ status: "queued" })]
        }),
        correlationTimeline: expect.arrayContaining([
          expect.objectContaining({ stage: "event_receipt", status: "received" }),
          expect.objectContaining({ stage: "learning_context", status: "acknowledged" }),
          expect.objectContaining({ stage: "hermes_decision", status: "committed" }),
          expect.objectContaining({ stage: "business_problem", status: "resolved" }),
          expect.objectContaining({ stage: "route_commit", status: "queued" }),
          expect.objectContaining({ stage: "route_job", status: "queued" }),
          expect.objectContaining({ stage: "human_correction", status: "route" }),
          expect.objectContaining({ stage: "routing_evaluation", status: "passed" }),
          expect.objectContaining({ stage: "lifecycle_event", status: "sent" }),
          expect.objectContaining({
            stage: "outcome_recorded",
            label: "Verified outcome recorded for Hermes",
            detail: "case_outcome:case_read_model_1 · Budget change approved and efficiency recovered.",
            status: "sent"
          })
        ]),
        corrections: [expect.objectContaining({ correctedBy: "Growth lead" })],
        evaluation: expect.objectContaining({
          count: 1,
          passedCount: 1,
          failedCount: 0,
          latestPassed: true
        })
      })],
      problemInbox: [expect.objectContaining({
        problemType: "paid_acquisition_efficiency_drop",
        evidenceEventCount: 1,
        routeCommitCount: 1
      })]
    });
    expect(model.routingCatalog[0]).toMatchObject({
      loopId: "marketing_ads",
      minimumConfidence: 0.8,
      ambiguityPolicy: "request_human",
      noMatchPolicy: "unhandled",
      fanoutPolicy: {
        mode: "independent_only",
        maxRoutes: 2
      },
      cooldown: {
        dedupeWindowSeconds: 3600
      },
      concurrency: {
        strategy: "append_evidence"
      },
      explicitNonGoals: ["Content brief approvals are owned by Content Creation."],
      lifecycleEvents: expect.arrayContaining([
        "loop.route.accepted",
        "loop.run.completed",
        "loop.problem.unhandled"
      ]),
      examples: {
        shouldNotRoute: expect.arrayContaining([
          "test campaigns and already-resolved anomalies"
        ])
      }
    });
    expect(model.rows[0].timeline).toEqual(expect.arrayContaining([
      "receipt:received",
      "Hermes:route",
      "loop:marketing_ads",
      "outcome:case_outcome:case_read_model_1"
    ]));

    const filtered = await loadEventRoutingOperations({
      projectRoot,
      store,
      source: "google_ads_detector",
      action: "route",
      loopId: "marketing_ads",
      now: new Date("2026-07-21T12:04:00.000Z")
    });
    expect(filtered.filters).toMatchObject({
      source: "google_ads_detector",
      action: "route",
      loopId: "marketing_ads"
    });
    expect(filtered.summary).toMatchObject({
      eventCount: 1,
      problemCount: 1,
      routedEventCount: 1
    });
    expect(filtered.rows.map((row) => row.eventId)).toEqual([event.id]);

    const empty = await loadEventRoutingOperations({
      projectRoot,
      store,
      source: "notion",
      now: new Date("2026-07-21T12:05:00.000Z")
    });
    expect(empty.summary.eventCount).toBe(0);
    expect(empty.problemInbox).toEqual([]);
  });
});

async function createProjectWithAdsSpec(): Promise<{ projectRoot: string; specPath: string }> {
  const projectRoot = await mkdtemp(path.join(tmpdir(), "loopgraph-event-routing-read-model-"));
  const specPath = path.join(projectRoot, "loops", "marketing-ads.loopgraph.json");
  await mkdir(path.dirname(specPath), { recursive: true });
  await writeFile(specPath, `${JSON.stringify(marketingAdsLoopSpec(), null, 2)}\n`);
  await mkdir(path.join(projectRoot, ".loopgraph"), { recursive: true });
  await writeFile(path.join(projectRoot, ".loopgraph", "workspace.json"), `${JSON.stringify({
    version: 1,
    demoCatalogEnabled: false,
    registeredSpecs: [{
      id: "marketing_ads",
      name: "Ads",
      path: path.relative(projectRoot, specPath),
      department: "marketing",
      addedAt: "2026-07-21T12:00:00.000Z"
    }]
  }, null, 2)}\n`);
  return { projectRoot, specPath };
}

function marketingAdsLoopSpec() {
  return {
    apiVersion: LOOPGRAPH_API_VERSION,
    kind: LOOP_KIND,
    metadata: {
      id: "marketing_ads",
      name: "Ads",
      version: "1.0.0",
      description: "Improve qualified acquisition efficiency."
    },
    trigger: { type: "event", source: "hermes", event: "paid_acquisition_efficiency_drop" },
    input: { schema: { type: "object" } },
    output: {
      schema: {
        type: "object",
        required: ["decisionSummary", "proposedActions", "evidence", "policyInputs", "verificationRequest"],
        properties: {
          decisionSummary: { type: "string" },
          proposedActions: { type: "array" },
          evidence: { type: "array" },
          policyInputs: { type: "array" },
          verificationRequest: { type: "object" }
        }
      }
    },
    context: { sources: [], precedence: [] },
    routine: {
      steps: [{
        id: "observe",
        name: "Observe",
        stepType: "observe",
        actor: "system",
        description: "Observe campaign signals."
      }]
    },
    tools: [{ key: "draft_review", adapterId: "manual", label: "Draft review", writeCapable: false, riskLevel: "low" }],
    policy: {
      allowedActions: [{ toolKey: "draft_review", allowed: true, requiresApproval: false, riskLevel: "low" }],
      forbiddenActions: [],
      escalationRules: []
    },
    verification: [],
    approval: { requireFingerprintMatch: true, separateCustomerFacingApproval: true, allowedRoles: ["owner"] },
    persistence: { idempotency: { enabled: true } },
    trace: { captureContextSnapshot: true, captureToolInputOutput: true, evidenceRequired: true },
    topology: { department: "marketing" },
    routing: {
      schemaVersion: "routing-contract/v1alpha1",
      problemTypes: ["paid_acquisition_efficiency_drop"],
      accepts: [{
        sourcePattern: "google_ads*",
        eventTypePattern: "campaign.*",
        subjectTypes: ["campaign"],
        requiredFields: ["signals.spendDeltaPct", "signals.costPerQualifiedCustomerDeltaPct"]
      }],
      excludes: [{
        sourcePattern: "notion",
        eventTypePattern: "content.*",
        subjectTypes: ["content_brief"],
        fields: [],
        reason: "Content brief approvals are owned by Content Creation."
      }],
      inputMapping: { campaignId: "subject.id" },
      minimumConfidence: 0.8,
      ambiguityPolicy: "request_human",
      noMatchPolicy: "unhandled",
      fanoutPolicy: { mode: "independent_only", maxRoutes: 2, requiresIndependentProblems: true },
      cooldown: { seconds: 0, dedupeWindowSeconds: 3600 },
      concurrency: { maxActive: 1, strategy: "append_evidence" },
      activationMode: "simulate",
      lifecycleEvents: [
        "loop.route.accepted",
        "loop.run.completed",
        "loop.problem.unhandled"
      ],
      requiredConnections: ["ads.read"],
      examples: {
        shouldRoute: ["Campaign spend rises while qualified customer conversion drops."],
        shouldNotRoute: ["test campaigns and already-resolved anomalies"]
      }
    }
  };
}

function adsEvent(sourceDeliveryId: string): EventEnvelope {
  const base = {
    workspaceId: "workspace_1",
    companyId: "company_1",
    source: "google_ads_detector",
    sourceDeliveryId,
    eventType: "campaign.performance_anomaly"
  };

  return eventEnvelopeSchema.parse({
    id: createEventEnvelopeId(base),
    ...base,
    sourceRoute: "hermes.google_ads_detector",
    occurredAt: "2026-07-21T12:00:00.000Z",
    receivedAt: "2026-07-21T12:00:01.000Z",
    subject: { type: "campaign", id: "campaign_123" },
    correlationId: "corr_campaign_123",
    normalizedPayload: {
      signals: {
        spendDeltaPct: 18,
        costPerQualifiedCustomerDeltaPct: 31
      }
    },
    trust: { signatureVerified: true, signer: "google_ads", untrustedFields: [] }
  });
}

function adsRoutingCard(): RoutingCard {
  return routingCardSchema.parse({
    schemaVersion: "routing-card/v1alpha1",
    catalogVersion: "catalog_v1",
    loopId: "marketing_ads",
    loopName: "Ads",
    department: "marketing",
    goal: "Improve qualified acquisition efficiency.",
    currentReadiness: "ready",
    loopStatus: "active",
    problemTypes: ["paid_acquisition_efficiency_drop"],
    explicitNonGoals: ["Content brief approvals are owned by Content Creation."],
    accepts: [{
      sourcePattern: "google_ads*",
      eventTypePattern: "campaign.*",
      subjectTypes: ["campaign"],
      requiredFields: ["signals.spendDeltaPct", "signals.costPerQualifiedCustomerDeltaPct"]
    }],
    excludes: [],
    activationMode: "simulate",
    minimumConfidence: 0.8,
    priority: 10,
    fanoutPolicy: { mode: "independent_only", maxRoutes: 2, requiresIndependentProblems: true },
    cooldown: { seconds: 0, dedupeWindowSeconds: 3600 },
    concurrency: { maxActive: 1, strategy: "append_evidence" },
    inputMapping: { campaignId: "subject.id" },
    requiredConnections: ["ads.read"],
    currentState: { activeRuns: 0 },
    lifecycleEvents: [
      "loop.route.accepted",
      "loop.run.completed",
      "loop.problem.unhandled"
    ],
    examples: {
      shouldRoute: ["Campaign spend rises while qualified customer conversion drops."],
      shouldNotRoute: ["test campaigns and already-resolved anomalies"]
    },
    routingContractVersion: "routing-contract/v1alpha1",
    loopSpecHash: "hash_ads"
  });
}

function contentRoutingCard(): RoutingCard {
  return routingCardSchema.parse({
    schemaVersion: "routing-card/v1alpha1",
    catalogVersion: "catalog_v1",
    loopId: "marketing_content_creation",
    loopName: "Content Creation",
    department: "marketing",
    goal: "Create evidence-backed content drafts.",
    currentReadiness: "ready",
    loopStatus: "active",
    problemTypes: ["approved_content_work_item"],
    explicitNonGoals: ["Campaign efficiency problems are owned by Ads."],
    accepts: [{
      sourcePattern: "notion",
      eventTypePattern: "content.brief_approved",
      subjectTypes: ["content_brief"],
      requiredFields: ["approvedEvidenceRefs", "reviewer"]
    }],
    excludes: [{
      sourcePattern: "google_ads*",
      eventTypePattern: "campaign.*",
      subjectTypes: ["campaign"],
      fields: [],
      reason: "Campaign efficiency problems are owned by Ads."
    }],
    activationMode: "simulate",
    minimumConfidence: 0.75,
    priority: 7,
    fanoutPolicy: { mode: "none", maxRoutes: 1, requiresIndependentProblems: true },
    cooldown: { seconds: 0, dedupeWindowSeconds: 0 },
    concurrency: { maxActive: 1, strategy: "append_evidence" },
    inputMapping: { briefId: "subject.id" },
    requiredConnections: ["content_repository.read"],
    currentState: { activeRuns: 0 },
    examples: { shouldRoute: [], shouldNotRoute: [] },
    routingContractVersion: "routing-contract/v1alpha1",
    loopSpecHash: "hash_content"
  });
}
