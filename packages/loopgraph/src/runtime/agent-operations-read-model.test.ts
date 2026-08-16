import { describe, expect, it } from "vitest";
import type { HermesExecutionEvent, LoopRunTrace } from "../core";
import {
  buildAgentOperationsTraceDetail,
  type AgentOperationsActivityRow
} from "./agent-operations-read-model";
import type { EventRoutingOperationsRow } from "./event-routing-read-model";

describe("agent operations trace detail", () => {
  it("projects an ordered operational trace without raw tool, artifact, evidence, review, or error content", () => {
    const detail = buildAgentOperationsTraceDetail({
      activity: activity(),
      routing: routing(),
      executionEvents: [executionEvent(2, "outcome.observed"), executionEvent(1, "tool.completed")],
      trace: trace(),
      generatedAt: "2026-08-15T12:05:00.000Z"
    });

    expect(detail.execution.timeline.map((event) => event.sequence)).toEqual([1, 2]);
    expect(detail.execution.timeline[0]).toMatchObject({
      eventType: "tool.completed",
      tool: { callId: "call_1", toolKey: "crm.account.read" }
    });
    expect(detail.execution.timeline[1]).toMatchObject({
      eventType: "outcome.observed",
      outcome: { metricKey: "qualified_pipeline", value: 12, unit: "usd" }
    });
    expect(detail.routing.selectedRoutes[0]).toMatchObject({
      loopId: "deal_risk",
      evidenceRefCount: 2
    });
    expect(detail.execution.toolCalls).toEqual([expect.objectContaining({ toolKey: "crm.account.read", status: "completed" })]);
    expect(detail.execution.outputs).toEqual([{ id: "output_1", type: "decision_memo" }]);
    expect(detail.execution.approvals).toEqual([expect.objectContaining({ id: "review_1", status: "approved", role: "owner" })]);

    const serialized = JSON.stringify(detail);
    expect(serialized).not.toContain("provider-secret-input");
    expect(serialized).not.toContain("provider-secret-output");
    expect(serialized).not.toContain("s3://private-artifact");
    expect(serialized).not.toContain("vault://evidence-location");
    expect(serialized).not.toContain("private review comment");
    expect(serialized).not.toContain("provider returned a private record");
  });
});

function activity(): AgentOperationsActivityRow {
  return {
    id: "evt_1:job_1",
    eventId: "evt_1",
    source: "Salesforce",
    eventType: "opportunity.stalled",
    problemId: "problem_1",
    problemSummary: "A qualified opportunity has no next step.",
    department: "Sales",
    loopId: "deal_risk",
    loopLabel: "Deal Risk Recovery",
    routeJobId: "job_1",
    executionRuntime: "hermes",
    jobStatus: "completed",
    agentInstanceId: "hermes_1",
    agentName: "Hermes Production",
    runId: "run_1",
    traceStatus: "COMPLETED",
    taskCount: 1,
    completedTaskCount: 1,
    toolCallCount: 1,
    approvalCount: 1,
    outputCount: 1,
    observedOutcomeCount: 1,
    latestEventType: "outcome.observed",
    latestSummary: "Pipeline outcome returned.",
    receivedAt: "2026-08-15T12:00:00.000Z",
    updatedAt: "2026-08-15T12:04:00.000Z",
    latencyMs: 240_000,
    needsAttention: false
  };
}

function routing(): EventRoutingOperationsRow {
  return {
    id: "evt_1:attempt_1",
    eventId: "evt_1",
    receiptId: "receipt_1",
    routeAttemptId: "attempt_1",
    receivedAt: "2026-08-15T12:00:00.000Z",
    source: "Salesforce",
    eventType: "opportunity.stalled",
    subject: "opportunity:opp_1",
    correlationId: "correlation_1",
    receiptStatus: "received",
    action: "route",
    problemId: "problem_1",
    problemSummary: "A qualified opportunity has no next step.",
    problemType: "deal_risk",
    problemStatus: "resolved",
    selectedLoopIds: ["deal_risk"],
    selectedLoopLabels: ["Deal Risk Recovery"],
    alternativeLoopIds: [],
    confidence: 0.94,
    validationState: "valid",
    validationErrors: [],
    queueStatus: "completed",
    runId: "run_1",
    owner: "Sales",
    corrections: [],
    evaluation: { count: 1, passedCount: 1, failedCount: 0, latestPassed: true },
    needsHumanChoice: false,
    needsCorrection: false,
    timeline: [],
    correlationTimeline: [{
      id: "timeline_1",
      at: "2026-08-15T12:00:02.000Z",
      stage: "hermes_decision",
      label: "Hermes selected Deal Risk Recovery",
      detail: "One eligible route matched.",
      status: "valid"
    }],
    decisionDetail: {
      routeAttemptId: "attempt_1",
      action: "route",
      catalogVersion: "catalog_1",
      policyVersion: "policy_1",
      modelMetadata: [{ key: "private-model-field", value: "do-not-project" }],
      selectedRoutes: [{
        loopId: "deal_risk",
        loopLabel: "Deal Risk Recovery",
        role: "primary",
        confidence: 0.94,
        reasonSummary: "The stalled opportunity matched the active loop.",
        evidenceRefs: ["vault://evidence-location", "event://evt_1"],
        priority: 100
      }],
      alternatives: [],
      routeCommits: [{ id: "commit_1", loopId: "deal_risk", loopLabel: "Deal Risk Recovery", status: "committed", runId: "run_1", committedAt: "2026-08-15T12:00:03.000Z" }],
      routeJobs: [{ id: "job_1", status: "completed", runId: "run_1", attemptCount: 1, maxAttempts: 3, nextRunAt: "2026-08-15T12:00:03.000Z", updatedAt: "2026-08-15T12:04:00.000Z", executionTarget: { runtime: "hermes", agentInstanceId: "hermes_1", requiredCapabilities: [] } }]
    }
  } as unknown as EventRoutingOperationsRow;
}

function executionEvent(sequence: number, eventType: HermesExecutionEvent["eventType"]): HermesExecutionEvent {
  return {
    schemaVersion: "hermes-execution-event/v1alpha1",
    id: `execution_${sequence}`,
    idempotencyKey: `execution_${sequence}`,
    workspaceId: "workspace_1",
    organizationId: "organization_1",
    companyId: "company_1",
    agentInstanceId: "hermes_1",
    eventType,
    routeJobId: "job_1",
    routeCommitId: "commit_1",
    routeAttemptId: "attempt_1",
    eventId: "evt_1",
    problemId: "problem_1",
    loopId: "deal_risk",
    loopSpecHash: "hash_1",
    runId: "run_1",
    correlationId: "correlation_1",
    sequence,
    ...(eventType === "tool.completed" ? { tool: { callId: "call_1", toolKey: "crm.account.read", inputRef: "provider-secret-input", outputRef: "provider-secret-output" } } : {}),
    ...(eventType === "outcome.observed" ? { outcome: { metricKey: "qualified_pipeline", value: 12, unit: "usd", evidenceRef: "vault://evidence-location" } } : {}),
    summary: "Bounded operational summary.",
    occurredAt: `2026-08-15T12:0${sequence}:00.000Z`,
    recordedAt: `2026-08-15T12:0${sequence}:01.000Z`
  } as HermesExecutionEvent;
}

function trace(): LoopRunTrace {
  return {
    id: "run_1",
    loopId: "deal_risk",
    loopSpecVersion: "1.0.0",
    loopSpecHash: "hash_1",
    mode: "execute",
    status: "COMPLETED",
    trigger: { type: "event", source: "hermes", event: "opportunity.stalled", eventId: "evt_1", receivedAt: "2026-08-15T12:00:00.000Z" },
    idempotencyKey: "run_1",
    contextSnapshot: { compiledAt: "2026-08-15T12:00:01.000Z", items: [] },
    inputs: [],
    proposedActions: [],
    preparedActions: [],
    taskRuns: [{ id: "task_1", label: "Assess deal risk", status: "completed", summary: "Prepared a bounded recovery plan." }],
    toolCalls: [{ id: "call_1", toolKey: "crm.account.read", input: { token: "provider-secret-input" }, output: "provider-secret-output", status: "completed", startedAt: "2026-08-15T12:01:00.000Z", completedAt: "2026-08-15T12:02:00.000Z" }],
    policyDecisions: [],
    verificationResults: [{ verifierId: "outcome", passed: true, summary: "Observed evidence is complete.", checks: [] }],
    escalationCases: [],
    humanReviews: [{ id: "review_1", runId: "run_1", status: "approved", reviewerId: "person@example.com", role: "owner", approvedFingerprints: [], rejectedFingerprints: [], comment: "private review comment", createdAt: "2026-08-15T12:02:00.000Z", decidedAt: "2026-08-15T12:03:00.000Z" }],
    outputs: [{ id: "output_1", type: "decision_memo", content: { url: "s3://private-artifact" } }],
    metrics: [{ name: "qualified_pipeline", value: 12, unit: "usd", observed: true }],
    errors: [{ code: "PROVIDER_RECORD_ERROR", message: "provider returned a private record", at: "2026-08-15T12:02:30.000Z" }],
    startedAt: "2026-08-15T12:00:04.000Z",
    completedAt: "2026-08-15T12:04:00.000Z"
  } as unknown as LoopRunTrace;
}
