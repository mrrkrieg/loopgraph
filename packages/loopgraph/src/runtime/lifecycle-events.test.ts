import { mkdtemp, readFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  createEventEnvelopeId,
  eventEnvelopeSchema,
  type BusinessProblem,
  type EventEnvelope,
  type EscalationCase,
  type LoopRunTrace,
  type RouteCommit
} from "../core";
import {
  emitEscalationCreatedLifecycleEvent,
  emitLoopRunLifecycleEvent,
  emitLoopRunStartedLifecycleEvent,
  emitOutcomeRecordedLifecycleEvent,
  emitRouteAcceptedLifecycleEvent,
  listLoopgraphLifecycleDeliveries
} from "./lifecycle-events";

function sourceEvent(): EventEnvelope {
  const base = {
    workspaceId: "workspace_1",
    companyId: "company_1",
    source: "google_ads_detector",
    sourceDeliveryId: "delivery_lifecycle_1",
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

function routeCommit(): RouteCommit {
  return {
    id: "route_lifecycle_1",
    eventId: "evt_source",
    problemId: "problem_lifecycle_1",
    loopId: "marketing_ads",
    loopSpecHash: "hash_ads",
    routeAttemptId: "attempt_lifecycle_1",
    runId: "run_lifecycle_1",
    status: "completed",
    inputMapping: { campaignId: "campaign_123" },
    committedAt: "2026-07-21T12:00:03.000Z"
  };
}

function problem(event: EventEnvelope): BusinessProblem {
  return {
    id: "problem_lifecycle_1",
    workspaceId: event.workspaceId,
    companyId: event.companyId,
    problemType: "paid_acquisition_efficiency_drop",
    subject: event.subject,
    summary: "Campaign efficiency dropped.",
    severity: "medium",
    status: "routed",
    correlationId: event.correlationId,
    dedupeKey: "problem_lifecycle_1",
    evidenceEventIds: [event.id],
    primaryLoopId: "marketing_ads",
    supportingLoopIds: [],
    routeCommitIds: ["route_lifecycle_1"],
    outcomeRefs: [],
    openedAt: "2026-07-21T12:00:03.000Z",
    updatedAt: "2026-07-21T12:03:00.000Z"
  };
}

function trace(): LoopRunTrace {
  return {
    id: "run_lifecycle_1",
    loopId: "marketing_ads",
    loopSpecVersion: "1.0.0",
    loopSpecHash: "hash_ads",
    mode: "simulate",
    status: "COMPLETED",
    trigger: {
      type: "event",
      source: "hermes",
      event: "campaign.performance_anomaly",
      eventId: "evt_source",
      receivedAt: "2026-07-21T12:00:01.000Z"
    },
    idempotencyKey: "idem_lifecycle_1",
    contextSnapshot: {
      id: "ctx_lifecycle_1",
      loopId: "marketing_ads",
      loopSpecVersion: "1.0.0",
      createdAt: "2026-07-21T12:03:00.000Z",
      contentHash: "ctx_hash",
      tokenEstimate: 0,
      entries: []
    },
    inputs: [],
    proposedActions: [],
    preparedActions: [],
    toolCalls: [],
    policyDecisions: [],
    verificationResults: [],
    escalationCases: [],
    humanReviews: [],
    outputs: [],
    metrics: [],
    errors: [],
    startedAt: "2026-07-21T12:03:00.000Z",
    completedAt: "2026-07-21T12:03:01.000Z"
  };
}

function escalationCase(): EscalationCase {
  return {
    id: "case_lifecycle_1",
    sourceRunId: "run_lifecycle_1",
    sourceLoopId: "marketing_ads",
    createdAt: "2026-07-21T12:03:00.000Z",
    category: "operational_blocker",
    severity: "P1",
    confidence: 0.87,
    affectedEntities: {},
    summary: "Campaign spend anomaly needs human review before action.",
    evidence: [{
      id: "evidence_event",
      sourceId: "event:evt_source",
      sourceType: "event",
      excerpt: "Campaign anomaly exceeded policy threshold.",
      trusted: true
    }],
    unresolvedQuestions: ["Should the budget pause immediately?"],
    recommendedActions: [{
      id: "act_pause_budget",
      toolKey: "draft_review",
      label: "Draft budget pause review",
      input: { campaignId: "campaign_123" },
      riskLevel: "medium",
      requiresApproval: true,
      customerFacing: false
    }],
    decisionsRequired: [{
      id: "decision_1",
      question: "Approve a temporary budget pause?",
      requiredRole: "growth_lead",
      blocking: true
    }],
    routing: {
      primaryOwner: { role: "growth_lead" },
      reviewers: [{ role: "finance" }],
      informed: [{ role: "marketing_ops" }],
      escalationDeadline: "2026-07-21T13:03:00.000Z"
    },
    responsePlan: {
      internalActions: [],
      successCriteria: ["Reviewer approves or rejects the action."]
    },
    status: "open"
  };
}

describe("Loopgraph lifecycle events for Hermes", () => {
  it("creates a private per-project signing key instead of using a shared fallback secret", async () => {
    const projectRoot = await mkdtemp(path.join(tmpdir(), "loopgraph-project-lifecycle-key-"));
    const event = sourceEvent();
    const input = {
      projectRoot,
      sourceEvent: event,
      routeCommit: { ...routeCommit(), eventId: event.id },
      problem: problem(event),
      now: new Date("2026-07-21T12:00:04.000Z")
    };

    const first = await emitRouteAcceptedLifecycleEvent(input);
    const second = await emitRouteAcceptedLifecycleEvent(input);
    if (!first.emitted || !second.emitted) throw new Error("Expected lifecycle events");
    const keyPath = path.join(projectRoot, ".loopgraph", "hermes", "lifecycle-signing.key");
    const key = (await readFile(keyPath, "utf8")).trim();

    expect(key).toHaveLength(43);
    expect(key).not.toBe("loopgraph-local-development-lifecycle-secret");
    expect(first.delivery.signature).toMatchObject({
      keyRef: "project:.loopgraph/hermes/lifecycle-signing.key",
      value: second.delivery.signature.value
    });
    expect((await stat(keyPath)).mode & 0o777).toBe(0o600);
  });

  it("persists signed route-accepted callbacks when Loopgraph accepts a Hermes route decision", async () => {
    const projectRoot = await mkdtemp(path.join(tmpdir(), "loopgraph-route-accepted-lifecycle-"));
    const event = sourceEvent();
    const commit = {
      ...routeCommit(),
      eventId: event.id,
      runId: undefined,
      status: "shadow" as const,
      inputMapping: { campaignId: "campaign_123", hiddenRawValue: "do-not-echo" }
    };

    const emitted = await emitRouteAcceptedLifecycleEvent({
      projectRoot,
      sourceEvent: event,
      routeCommit: commit,
      problem: problem(event),
      signingSecret: "secret_test_route_accepted",
      keyRef: "test:route-accepted",
      now: new Date("2026-07-21T12:00:04.000Z")
    });

    expect(emitted).toMatchObject({
      emitted: true,
      delivery: {
        event: {
          source: "loopgraph",
          sourceRoute: "loopgraph.lifecycle",
          eventType: "loop.route.accepted",
          subject: {
            type: "route_commit",
            id: commit.id
          },
          correlationId: event.correlationId,
          causationId: event.id,
          parentEventId: event.id,
          normalizedPayload: {
            notificationOnly: true,
            sourceEventId: event.id,
            routeCommitId: commit.id,
            routeAttemptId: commit.routeAttemptId,
            problemId: commit.problemId,
            loopId: commit.loopId,
            loopSpecHash: commit.loopSpecHash,
            routeCommitStatus: "shadow",
            problemStatus: "routed",
            acceptedAt: commit.committedAt
          }
        },
        signature: {
          algorithm: "hmac-sha256",
          keyRef: "test:route-accepted"
        },
        target: {
          owner: "hermes",
          routeKey: "loopgraph-lifecycle-events"
        }
      }
    });
    if (!emitted.emitted) throw new Error("Expected route-accepted lifecycle event to be emitted");
    expect(emitted.delivery.signature.value).toMatch(/^sha256=/);
    expect(JSON.stringify(emitted.delivery)).not.toContain("secret_test_route_accepted");
    expect(JSON.stringify(emitted.delivery)).not.toContain("hiddenRawValue");
    expect(await listLoopgraphLifecycleDeliveries(projectRoot)).toHaveLength(1);
  });

  it("persists signed notification-only lifecycle callbacks and blocks lifecycle re-entry", async () => {
    const projectRoot = await mkdtemp(path.join(tmpdir(), "loopgraph-lifecycle-"));
    const event = sourceEvent();

    const emitted = await emitLoopRunLifecycleEvent({
      projectRoot,
      sourceEvent: event,
      routeCommit: routeCommit(),
      trace: trace(),
      problem: problem(event),
      signingSecret: "secret_test_lifecycle",
      keyRef: "test:lifecycle",
      now: new Date("2026-07-21T12:03:02.000Z")
    });

    expect(emitted).toMatchObject({
      emitted: true,
      delivery: {
        event: {
          source: "loopgraph",
          sourceRoute: "loopgraph.lifecycle",
          eventType: "loop.run.completed",
          correlationId: event.correlationId,
          causationId: event.id,
          normalizedPayload: {
            notificationOnly: true,
            sourceEventId: event.id,
            routeCommitId: "route_lifecycle_1",
            problemId: "problem_lifecycle_1",
            loopId: "marketing_ads",
            runId: "run_lifecycle_1"
          }
        },
        signature: {
          algorithm: "hmac-sha256",
          keyRef: "test:lifecycle"
        },
        target: {
          owner: "hermes",
          routeKey: "loopgraph-lifecycle-events"
        }
      }
    });
    if (!emitted.emitted) throw new Error("Expected lifecycle event to be emitted");
    expect(emitted.delivery.signature.value).toMatch(/^sha256=/);
    expect(JSON.stringify(emitted.delivery)).not.toContain("secret_test_lifecycle");
    expect(await listLoopgraphLifecycleDeliveries(projectRoot)).toHaveLength(1);

    const skipped = await emitLoopRunLifecycleEvent({
      projectRoot,
      sourceEvent: emitted.delivery.event,
      routeCommit: routeCommit(),
      trace: trace(),
      problem: problem(event),
      signingSecret: "secret_test_lifecycle",
      keyRef: "test:lifecycle",
      now: new Date("2026-07-21T12:04:00.000Z")
    });

    expect(skipped).toMatchObject({
      emitted: false,
      skippedReason: expect.stringContaining("notification-only")
    });
    expect(await listLoopgraphLifecycleDeliveries(projectRoot)).toHaveLength(1);
  });

  it("persists signed run-started lifecycle callbacks for a routed loop run", async () => {
    const projectRoot = await mkdtemp(path.join(tmpdir(), "loopgraph-run-started-lifecycle-"));
    const event = sourceEvent();

    const emitted = await emitLoopRunStartedLifecycleEvent({
      projectRoot,
      sourceEvent: event,
      routeCommit: routeCommit(),
      trace: trace(),
      problem: problem(event),
      signingSecret: "secret_test_run_started",
      keyRef: "test:run-started",
      now: new Date("2026-07-21T12:03:00.500Z")
    });

    expect(emitted).toMatchObject({
      emitted: true,
      delivery: {
        event: {
          source: "loopgraph",
          sourceRoute: "loopgraph.lifecycle",
          eventType: "loop.run.started",
          occurredAt: "2026-07-21T12:03:00.000Z",
          correlationId: event.correlationId,
          causationId: event.id,
          parentEventId: event.id,
          normalizedPayload: {
            notificationOnly: true,
            sourceEventId: event.id,
            routeCommitId: "route_lifecycle_1",
            routeAttemptId: "attempt_lifecycle_1",
            problemId: "problem_lifecycle_1",
            loopId: "marketing_ads",
            runId: "run_lifecycle_1",
            runStatus: "STARTED",
            startedAt: "2026-07-21T12:03:00.000Z"
          }
        },
        signature: {
          algorithm: "hmac-sha256",
          keyRef: "test:run-started"
        },
        target: {
          owner: "hermes",
          routeKey: "loopgraph-lifecycle-events"
        }
      }
    });
    if (!emitted.emitted) throw new Error("Expected run-started lifecycle event to be emitted");
    expect(emitted.delivery.signature.value).toMatch(/^sha256=/);
    expect(JSON.stringify(emitted.delivery)).not.toContain("secret_test_run_started");
    expect(await listLoopgraphLifecycleDeliveries(projectRoot)).toHaveLength(1);
  });

  it("persists signed escalation-created lifecycle callbacks for Hermes follow-on decisions", async () => {
    const projectRoot = await mkdtemp(path.join(tmpdir(), "loopgraph-escalation-created-lifecycle-"));
    const event = sourceEvent();
    const caseItem = escalationCase();

    const emitted = await emitEscalationCreatedLifecycleEvent({
      projectRoot,
      sourceEvent: event,
      routeCommit: {
        ...routeCommit(),
        status: "waiting_review"
      },
      trace: {
        ...trace(),
        status: "WAITING_FOR_REVIEW",
        escalationCases: [caseItem.id]
      },
      escalationCase: caseItem,
      problem: {
        ...problem(event),
        status: "waiting"
      },
      signingSecret: "secret_test_escalation_created",
      keyRef: "test:escalation-created",
      now: new Date("2026-07-21T12:03:01.000Z")
    });

    expect(emitted).toMatchObject({
      emitted: true,
      delivery: {
        event: {
          source: "loopgraph",
          sourceRoute: "loopgraph.lifecycle",
          eventType: "loop.escalation.created",
          occurredAt: caseItem.createdAt,
          subject: {
            type: "escalation_case",
            id: caseItem.id
          },
          correlationId: event.correlationId,
          causationId: event.id,
          parentEventId: event.id,
          normalizedPayload: {
            notificationOnly: true,
            sourceEventId: event.id,
            routeCommitId: "route_lifecycle_1",
            routeAttemptId: "attempt_lifecycle_1",
            problemId: "problem_lifecycle_1",
            loopId: "marketing_ads",
            runId: "run_lifecycle_1",
            runStatus: "WAITING_FOR_REVIEW",
            routeCommitStatus: "waiting_review",
            problemStatus: "waiting",
            escalationCaseId: caseItem.id,
            escalationStatus: "open",
            escalationSeverity: "P1",
            escalationCategory: "operational_blocker",
            escalationConfidence: 0.87,
            escalationSummary: caseItem.summary,
            primaryOwnerRole: "growth_lead",
            reviewerRoles: ["finance"],
            informedRoles: ["marketing_ops"],
            escalationDeadline: "2026-07-21T13:03:00.000Z",
            decisionCount: 1,
            recommendedActionCount: 1,
            createdAt: caseItem.createdAt
          }
        },
        signature: {
          algorithm: "hmac-sha256",
          keyRef: "test:escalation-created"
        },
        target: {
          owner: "hermes",
          routeKey: "loopgraph-lifecycle-events"
        }
      }
    });
    if (!emitted.emitted) throw new Error("Expected escalation-created lifecycle event to be emitted");
    expect(emitted.delivery.signature.value).toMatch(/^sha256=/);
    expect(JSON.stringify(emitted.delivery)).not.toContain("secret_test_escalation_created");
    expect(await listLoopgraphLifecycleDeliveries(projectRoot)).toHaveLength(1);
  });

  it("persists signed outcome-recorded lifecycle callbacks for Hermes learning loops", async () => {
    const projectRoot = await mkdtemp(path.join(tmpdir(), "loopgraph-outcome-recorded-lifecycle-"));
    const event = sourceEvent();
    const caseItem = {
      ...escalationCase(),
      status: "resolved" as const,
      outcome: {
        resolutionSummary: "Budget change approved and efficiency recovered.",
        resolvedAt: "2026-07-21T14:00:00.000Z",
        businessResult: "Cost per qualified customer returned to target.",
        customerResult: "No customer-facing impact.",
        classificationCorrect: true,
        followUpRequired: false
      }
    };

    const emitted = await emitOutcomeRecordedLifecycleEvent({
      projectRoot,
      sourceEvent: event,
      routeCommit: routeCommit(),
      trace: trace(),
      escalationCase: caseItem,
      outcome: caseItem.outcome,
      problem: {
        ...problem(event),
        status: "resolved",
        resolvedAt: "2026-07-21T14:00:00.000Z",
        outcomeRefs: [`case_outcome:${caseItem.id}`]
      },
      signingSecret: "secret_test_outcome_recorded",
      keyRef: "test:outcome-recorded",
      now: new Date("2026-07-21T14:00:01.000Z")
    });

    expect(emitted).toMatchObject({
      emitted: true,
      delivery: {
        event: {
          source: "loopgraph",
          sourceRoute: "loopgraph.lifecycle",
          eventType: "loop.outcome.recorded",
          occurredAt: "2026-07-21T14:00:00.000Z",
          subject: {
            type: "case_outcome",
            id: `case_outcome_${caseItem.id}`
          },
          correlationId: event.correlationId,
          causationId: event.id,
          parentEventId: event.id,
          normalizedPayload: {
            notificationOnly: true,
            sourceEventId: event.id,
            routeCommitId: "route_lifecycle_1",
            routeAttemptId: "attempt_lifecycle_1",
            problemId: "problem_lifecycle_1",
            loopId: "marketing_ads",
            runId: "run_lifecycle_1",
            routeCommitStatus: "completed",
            problemStatus: "resolved",
            escalationCaseId: caseItem.id,
            escalationStatus: "resolved",
            outcomeRef: `case_outcome:${caseItem.id}`,
            outcomeType: "case_resolution",
            resolutionSummary: "Budget change approved and efficiency recovered.",
            resolvedAt: "2026-07-21T14:00:00.000Z",
            businessResult: "Cost per qualified customer returned to target.",
            customerResult: "No customer-facing impact.",
            classificationCorrect: true,
            followUpRequired: false
          }
        },
        signature: {
          algorithm: "hmac-sha256",
          keyRef: "test:outcome-recorded"
        },
        target: {
          owner: "hermes",
          routeKey: "loopgraph-lifecycle-events"
        }
      }
    });
    if (!emitted.emitted) throw new Error("Expected outcome-recorded lifecycle event to be emitted");
    expect(emitted.delivery.signature.value).toMatch(/^sha256=/);
    expect(JSON.stringify(emitted.delivery)).not.toContain("secret_test_outcome_recorded");
    expect(await listLoopgraphLifecycleDeliveries(projectRoot)).toHaveLength(1);
  });
});
