import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  businessProblemSchema,
  eventReceiptSchema,
  hermesAgentInstanceSchema,
  hermesExecutionEventSchema,
  routeCommitSchema,
  routeJobSchema,
  type HermesExecutionEvent
} from "../core";
import { FileStorageAdapter } from "../sdk/storage";
import { ingestHermesExecutionEvent } from "./hermes-execution-service";
import { FileHermesOperationsStore } from "./hermes-operations-store";
import { FileRoutingStore } from "./routing-store";

describe("Hermes execution projection", () => {
  it("records a Salesforce problem through tasks, approval, output, outcome, and completion", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "loopgraph-hermes-golden-"));
    const routingStore = new FileRoutingStore(root);
    const operationsStore = new FileHermesOperationsStore(root);
    const storage = new FileStorageAdapter(root);
    await seedGoldenFlow(routingStore, operationsStore);

    const events: HermesExecutionEvent[] = [
      event(0, "assignment.received", { summary: "Hermes accepted the stalled-opportunity assignment." }),
      event(1, "run.started", { summary: "Hermes joined CRM, product, and support evidence." }),
      event(2, "task.started", { task: { id: "task_assess", label: "Assess deal risk", owner: "Hermes Sales" } }),
      event(3, "tool.started", { tool: { callId: "call_crm", toolKey: "salesforce.read", inputRef: "ref://salesforce/opportunity/opp_42" } }),
      event(4, "tool.completed", { tool: { callId: "call_crm", toolKey: "salesforce.read", inputRef: "ref://salesforce/opportunity/opp_42", outputRef: "ref://evidence/crm_42" } }),
      event(5, "approval.requested", { approval: { id: "approval_outreach", status: "requested", requestedRole: "owner", reason: "Customer-facing executive outreach" } }),
      event(6, "approval.resolved", { approval: { id: "approval_outreach", status: "approved", requestedRole: "owner", resolvedBy: "sales_vp" } }),
      event(7, "task.completed", { task: { id: "task_assess", label: "Assess deal risk", owner: "Hermes Sales", summary: "Risk evidence confirmed and intervention selected." } }),
      event(8, "output.created", { output: { id: "output_plan", type: "recovery_plan", label: "Approved deal recovery plan", artifactRef: "ref://outputs/recovery_42" } }),
      event(9, "outcome.observed", { outcome: { metricKey: "stalled_opportunity_recovered", value: 1, unit: "opportunity", evidenceRef: "ref://salesforce/opportunity/opp_42" } }),
      event(10, "run.completed", { summary: "Opportunity returned to an active stage with an accountable owner." })
    ];
    for (const executionEvent of events) {
      await ingestHermesExecutionEvent({ event: executionEvent, routingStore, operationsStore, storage });
    }

    const [job, problem, trace] = await Promise.all([
      routingStore.getRouteJob("job_sales"),
      routingStore.getBusinessProblem("problem_sales"),
      storage.getRun("run_sales")
    ]);
    expect(job).toMatchObject({ status: "completed", executionTarget: { runtime: "hermes" } });
    expect(problem).toMatchObject({ status: "resolved" });
    expect(trace).toMatchObject({
      status: "COMPLETED",
      provenance: { invocation: { actor: "hermes_sales", source: "hermes.execution" } },
      taskRuns: [{ id: "task_assess", status: "completed" }],
      toolCalls: [{ id: "call_crm", status: "completed", input: { ref: "ref://salesforce/opportunity/opp_42" } }],
      humanReviews: [{ id: "approval_outreach", status: "approved", reviewerId: "sales_vp" }],
      outputs: [{ id: "output_plan" }],
      metrics: [{ name: "stalled_opportunity_recovered", value: 1, observed: true }]
    });
    expect(JSON.stringify(trace)).not.toContain("access_token");

    const duplicate = await ingestHermesExecutionEvent({ event: events[10], routingStore, operationsStore, storage });
    expect(duplicate.created).toBe(false);
    await expect(ingestHermesExecutionEvent({
      event: { ...events[10], idempotencyKey: "sales-run:conflict", sequence: 10 },
      routingStore,
      operationsStore,
      storage
    })).rejects.toThrow(/sequence 10/);
  });
});

async function seedGoldenFlow(routingStore: FileRoutingStore, operationsStore: FileHermesOperationsStore) {
  await operationsStore.saveAgentInstance(hermesAgentInstanceSchema.parse({
    id: "hermes_sales",
    workspaceId: "workspace_sales",
    organizationId: "00000000-0000-4000-8000-000000000001",
    name: "Hermes Sales",
    environment: "production",
    status: "online",
    runtimeVersion: "2.4.0",
    capabilities: ["crm.read", "messaging.notify"],
    assignedLoopIds: ["sales_stalled_opportunity"],
    defaultRouter: true,
    labels: {},
    lastHeartbeatAt: "2026-07-31T12:00:00.000Z",
    registeredAt: "2026-07-31T11:00:00.000Z",
    updatedAt: "2026-07-31T12:00:00.000Z"
  }));
  await routingStore.saveEventReceipt(eventReceiptSchema.parse({
    id: "receipt_sales",
    eventId: "event_sales",
    event: {
      id: "event_sales",
      workspaceId: "workspace_sales",
      companyId: "company_acme",
      source: "salesforce",
      sourceRoute: "hermes.salesforce",
      sourceDeliveryId: "sf_opp_42_stalled",
      eventType: "opportunity.stalled",
      occurredAt: "2026-07-31T11:59:00.000Z",
      receivedAt: "2026-07-31T12:00:00.000Z",
      subject: { type: "opportunity", id: "opp_42" },
      correlationId: "corr_sales",
      normalizedPayload: { stage: "proposal", stalledDays: 18 },
      evidenceRefs: ["salesforce:opp_42"],
      trust: { signatureVerified: true, signer: "salesforce", untrustedFields: [] }
    },
    eventHash: "event_hash_sales",
    status: "received",
    firstSeenAt: "2026-07-31T12:00:00.000Z",
    lastSeenAt: "2026-07-31T12:00:00.000Z"
  }));
  await routingStore.saveBusinessProblem(businessProblemSchema.parse({
    id: "problem_sales",
    workspaceId: "workspace_sales",
    companyId: "company_acme",
    problemType: "sales.pipeline_risk",
    subject: { type: "opportunity", id: "opp_42" },
    summary: "Qualified opportunity has stalled in proposal stage.",
    severity: "high",
    status: "routed",
    correlationId: "corr_sales",
    dedupeKey: "opp_42:stalled",
    evidenceEventIds: ["event_sales"],
    primaryLoopId: "sales_stalled_opportunity",
    supportingLoopIds: [],
    routeCommitIds: ["commit_sales"],
    outcomeRefs: [],
    openedAt: "2026-07-31T12:00:00.000Z",
    updatedAt: "2026-07-31T12:00:01.000Z"
  }));
  await routingStore.saveRouteCommit(routeCommitSchema.parse({
    id: "commit_sales",
    eventId: "event_sales",
    problemId: "problem_sales",
    loopId: "sales_stalled_opportunity",
    loopSpecHash: "hash_sales",
    routeAttemptId: "attempt_sales",
    runId: "run_sales",
    status: "queued",
    inputMapping: { opportunityId: "opp_42" },
    committedAt: "2026-07-31T12:00:01.000Z"
  }));
  await routingStore.saveRouteJob(routeJobSchema.parse({
    id: "job_sales",
    idempotencyKey: "job-sales-idempotency",
    eventId: "event_sales",
    problemId: "problem_sales",
    routeCommitId: "commit_sales",
    routeAttemptId: "attempt_sales",
    loopId: "sales_stalled_opportunity",
    loopSpecHash: "hash_sales",
    runId: "run_sales",
    activationMode: "execute_with_approval",
    executionTarget: { runtime: "hermes", environment: "production", requiredCapabilities: ["crm.read"] },
    status: "dispatched",
    correlationId: "corr_sales",
    attemptCount: 1,
    maxAttempts: 3,
    nextRunAt: "2026-07-31T12:00:01.000Z",
    createdAt: "2026-07-31T12:00:01.000Z",
    updatedAt: "2026-07-31T12:00:01.000Z"
  }));
}

function event(sequence: number, eventType: HermesExecutionEvent["eventType"], extra: Record<string, unknown>): HermesExecutionEvent {
  return hermesExecutionEventSchema.parse({
    id: `execution_sales_${sequence}`,
    idempotencyKey: `sales-run:${sequence}`,
    workspaceId: "workspace_sales",
    organizationId: "00000000-0000-4000-8000-000000000001",
    companyId: "company_acme",
    agentInstanceId: "hermes_sales",
    eventType,
    routeJobId: "job_sales",
    routeCommitId: "commit_sales",
    routeAttemptId: "attempt_sales",
    eventId: "event_sales",
    problemId: "problem_sales",
    loopId: "sales_stalled_opportunity",
    loopSpecHash: "hash_sales",
    runId: "run_sales",
    correlationId: "corr_sales",
    sequence,
    occurredAt: `2026-07-31T12:00:${String(10 + sequence).padStart(2, "0")}.000Z`,
    recordedAt: `2026-07-31T12:00:${String(11 + sequence).padStart(2, "0")}.000Z`,
    ...extra
  });
}
