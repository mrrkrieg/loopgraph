import { describe, expect, it } from "vitest";
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { repoRoot } from "../test-repo-root";
import {
  createEventEnvelopeId,
  eventEnvelopeSchema,
  type BusinessProblem,
  type EscalationCase,
  type EventEnvelope,
  type LoopRunTrace,
  type RouteCommit
} from "../core";
import { loadLoopSpecFromPath } from "./loader";
import { simulateLoop } from "./simulator";
import { resolveCase } from "./case-service";
import { FileStorageAdapter } from "../sdk/storage";
import { FileRoutingStore } from "./routing-store";
import { listLoopgraphLifecycleDeliveries } from "./lifecycle-events";


describe("case-service", () => {
  it("writes case outcome and improvement signal back to source trace", async () => {
    const loaded = await loadLoopSpecFromPath(path.join(repoRoot, "examples/strategic-account-escalation"));
    if (!loaded.ok) throw new Error("load failed");
    const storageRoot = await mkdtemp(path.join(os.tmpdir(), "loopgraph-case-service-"));
    const storage = new FileStorageAdapter(storageRoot);
    const result = await simulateLoop({
      spec: loaded.spec,
      fixture: path.join(repoRoot, "fixtures/strategic-account-escalation/enterprise-outage-near-renewal.json"),
      storage
    });

    const caseId = result.escalationCase?.id;
    if (!caseId) throw new Error("expected escalation case");

    const resolved = await resolveCase(storage, caseId, {
      resolutionSummary: "Incident mitigated; customer updated before board meeting.",
      resolvedAt: new Date().toISOString(),
      businessResult: "Renewal retained"
    });

    expect(resolved.status).toBe("resolved");

    const trace = await storage.getRun(result.trace.id);
    expect(trace?.outputs.some((output) => output.type === "case_outcome")).toBe(true);
    expect(trace?.outputs.some((output) => output.type === "improvement_signal" && output.id.includes(caseId))).toBe(
      true
    );
  });

  it("emits an outcome-recorded lifecycle callback when resolving a Hermes-routed case", async () => {
    const projectRoot = await mkdtemp(path.join(os.tmpdir(), "loopgraph-case-service-lifecycle-"));
    const loopgraphRoot = path.join(projectRoot, ".loopgraph");
    const storage = new FileStorageAdapter(loopgraphRoot);
    const routingStore = new FileRoutingStore(loopgraphRoot);
    const event = sourceEvent();
    const commit = routeCommit(event);
    const problem = businessProblem(event, commit);
    const trace = runTrace(event, commit);
    const caseItem = escalationCase(trace);

    await routingStore.saveEventReceipt({
      id: `receipt_${event.id}`,
      eventId: event.id,
      event,
      eventHash: "event_hash_case_lifecycle",
      status: "received",
      firstSeenAt: event.receivedAt,
      lastSeenAt: event.receivedAt
    });
    await routingStore.saveBusinessProblem(problem);
    await routingStore.saveRouteCommit(commit);
    await storage.saveRun(trace);
    await storage.saveEscalationCase(caseItem);

    const resolved = await resolveCase(storage, caseItem.id, {
      resolutionSummary: "Customer risk resolved and renewal plan accepted.",
      resolvedAt: "2026-07-21T14:00:00.000Z",
      businessResult: "Renewal retained",
      customerResult: "Customer received mitigation plan",
      classificationCorrect: true,
      followUpRequired: false
    }, {
      projectRoot,
      routingStore,
      now: new Date("2026-07-21T14:00:01.000Z"),
      signingSecret: "secret_test_case_outcome",
      keyRef: "test:case-outcome"
    });

    expect(resolved).toMatchObject({
      id: caseItem.id,
      status: "resolved",
      outcome: {
        resolutionSummary: "Customer risk resolved and renewal plan accepted.",
        businessResult: "Renewal retained"
      }
    });
    const updatedProblem = await routingStore.getBusinessProblem(problem.id);
    expect(updatedProblem).toMatchObject({
      id: problem.id,
      status: "resolved",
      resolvedAt: "2026-07-21T14:00:00.000Z",
      outcomeRefs: [`case_outcome:${caseItem.id}`]
    });

    const lifecycleDeliveries = await listLoopgraphLifecycleDeliveries(projectRoot);
    expect(lifecycleDeliveries).toHaveLength(1);
    expect(lifecycleDeliveries[0]).toMatchObject({
      event: {
        source: "loopgraph",
        sourceRoute: "loopgraph.lifecycle",
        eventType: "loop.outcome.recorded",
        causationId: event.id,
        parentEventId: event.id,
        correlationId: event.correlationId,
        normalizedPayload: {
          notificationOnly: true,
          routeCommitId: commit.id,
          problemId: problem.id,
          loopId: trace.loopId,
          runId: trace.id,
          runStatus: "WAITING_FOR_REVIEW",
          routeCommitStatus: "waiting_review",
          problemStatus: "resolved",
          escalationCaseId: caseItem.id,
          escalationStatus: "resolved",
          outcomeRef: `case_outcome:${caseItem.id}`,
          resolutionSummary: "Customer risk resolved and renewal plan accepted.",
          businessResult: "Renewal retained",
          classificationCorrect: true,
          followUpRequired: false
        }
      },
      notificationOnly: true,
      signature: {
        algorithm: "hmac-sha256",
        keyRef: "test:case-outcome"
      },
      target: {
        owner: "hermes",
        routeKey: "loopgraph-lifecycle-events"
      }
    });
    expect(lifecycleDeliveries[0].signature.value).toMatch(/^sha256=/);
    expect(JSON.stringify(lifecycleDeliveries[0])).not.toContain("secret_test_case_outcome");
  });
});

function sourceEvent(): EventEnvelope {
  const base = {
    workspaceId: "workspace_1",
    companyId: "company_1",
    source: "hubspot_customer_risk",
    sourceDeliveryId: "delivery_case_outcome_1",
    eventType: "account.renewal_risk"
  };

  return eventEnvelopeSchema.parse({
    id: createEventEnvelopeId(base),
    ...base,
    sourceRoute: "hermes.hubspot_customer_risk",
    occurredAt: "2026-07-21T12:00:00.000Z",
    receivedAt: "2026-07-21T12:00:01.000Z",
    subject: { type: "account", id: "account_123", display: "Acme" },
    correlationId: "corr_account_123",
    normalizedPayload: {
      account: {
        renewalRisk: true
      }
    },
    trust: { signatureVerified: true, signer: "hubspot", untrustedFields: [] }
  });
}

function routeCommit(event: EventEnvelope): RouteCommit {
  return {
    id: "route_case_outcome_1",
    eventId: event.id,
    problemId: "problem_case_outcome_1",
    loopId: "customer_success_renewal_risk",
    loopSpecHash: "hash_customer_success",
    routeAttemptId: "attempt_case_outcome_1",
    runId: "run_case_outcome_1",
    status: "waiting_review",
    inputMapping: { accountId: event.subject.id },
    committedAt: "2026-07-21T12:00:03.000Z"
  };
}

function businessProblem(event: EventEnvelope, commit: RouteCommit): BusinessProblem {
  return {
    id: commit.problemId,
    workspaceId: event.workspaceId,
    companyId: event.companyId,
    problemType: "renewal_risk",
    subject: event.subject,
    summary: "Renewal risk needs human-approved mitigation.",
    severity: "high",
    status: "waiting",
    correlationId: event.correlationId,
    dedupeKey: "problem_case_outcome_1",
    evidenceEventIds: [event.id],
    primaryLoopId: commit.loopId,
    supportingLoopIds: [],
    routeCommitIds: [commit.id],
    outcomeRefs: [],
    openedAt: "2026-07-21T12:00:03.000Z",
    updatedAt: "2026-07-21T12:03:00.000Z"
  };
}

function runTrace(event: EventEnvelope, commit: RouteCommit): LoopRunTrace {
  return {
    id: "run_case_outcome_1",
    loopId: commit.loopId,
    loopSpecVersion: "1.0.0",
    loopSpecHash: commit.loopSpecHash,
    mode: "simulate",
    status: "WAITING_FOR_REVIEW",
    trigger: {
      type: "event",
      source: "hermes",
      event: event.eventType,
      eventId: event.id,
      receivedAt: "2026-07-21T12:00:01.000Z"
    },
    idempotencyKey: "idem_case_outcome_1",
    contextSnapshot: {
      id: "ctx_case_outcome_1",
      loopId: commit.loopId,
      loopSpecVersion: "1.0.0",
      createdAt: "2026-07-21T12:03:00.000Z",
      contentHash: "ctx_hash_case_outcome",
      tokenEstimate: 0,
      entries: []
    },
    inputs: [{
      key: "routing",
      value: {
        routeCommitId: commit.id,
        correlationId: event.correlationId
      },
      source: "simulate"
    }],
    proposedActions: [],
    preparedActions: [],
    toolCalls: [],
    policyDecisions: [],
    verificationResults: [],
    escalationCases: ["case_case_outcome_1"],
    humanReviews: [],
    outputs: [],
    metrics: [],
    errors: [],
    startedAt: "2026-07-21T12:03:00.000Z",
    completedAt: "2026-07-21T12:03:00.000Z"
  };
}

function escalationCase(trace: LoopRunTrace): EscalationCase {
  return {
    id: "case_case_outcome_1",
    sourceRunId: trace.id,
    sourceLoopId: trace.loopId,
    createdAt: "2026-07-21T12:03:00.000Z",
    category: "revenue_risk",
    severity: "P1",
    confidence: 0.91,
    affectedEntities: {
      accountId: "account_123",
      accountName: "Acme"
    },
    summary: "Renewal risk needs human-approved mitigation.",
    evidence: [],
    unresolvedQuestions: [],
    recommendedActions: [],
    decisionsRequired: [{
      id: "decision_1",
      question: "Approve renewal save plan?",
      requiredRole: "csm_lead",
      blocking: true
    }],
    routing: {
      primaryOwner: { role: "csm_lead" },
      reviewers: [{ role: "finance" }],
      informed: [],
      escalationDeadline: "2026-07-21T13:03:00.000Z"
    },
    responsePlan: {
      internalActions: [],
      successCriteria: ["Renewal risk is resolved."]
    },
    status: "open"
  };
}
