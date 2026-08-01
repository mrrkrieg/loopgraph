import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { hermesAgentInstanceSchema, hermesExecutionEventSchema } from "../core";
import { FileHermesOperationsStore, selectHermesAgentForExecution } from "./hermes-operations-store";

describe("Hermes operations store", () => {
  it("selects a healthy capability-matching router and preserves event idempotency", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "loopgraph-hermes-operations-"));
    const store = new FileHermesOperationsStore(root);
    const agent = hermesAgentInstanceSchema.parse({
      id: "hermes_sales",
      workspaceId: "workspace_sales",
      name: "Hermes Sales",
      environment: "production",
      status: "online",
      runtimeVersion: "2.4.0",
      capabilities: ["crm.read", "messaging.notify"],
      assignedLoopIds: [],
      defaultRouter: true,
      labels: {},
      lastHeartbeatAt: "2026-07-31T12:00:00.000Z",
      registeredAt: "2026-07-31T11:00:00.000Z",
      updatedAt: "2026-07-31T12:00:00.000Z"
    });
    await store.saveAgentInstance(agent);
    await expect(selectHermesAgentForExecution({
      store,
      workspaceId: "workspace_sales",
      environment: "production",
      requiredCapabilities: ["crm.read"],
      now: new Date("2026-07-31T12:01:00.000Z")
    })).resolves.toMatchObject({ id: "hermes_sales" });
    await expect(selectHermesAgentForExecution({
      store,
      workspaceId: "workspace_sales",
      environment: "production",
      requiredCapabilities: ["billing.write"],
      now: new Date("2026-07-31T12:01:00.000Z")
    })).resolves.toBeNull();

    const event = executionEvent();
    await expect(store.appendExecutionEvent(event)).resolves.toMatchObject({ created: true });
    await expect(store.appendExecutionEvent(event)).resolves.toMatchObject({ created: false });
    await expect(store.appendExecutionEvent({ ...event, summary: "mutated retry" })).rejects.toThrow(/idempotency conflict/);
  });
});

function executionEvent() {
  return hermesExecutionEventSchema.parse({
    id: "exec_assignment_received",
    idempotencyKey: "sales-run:0",
    workspaceId: "workspace_sales",
    organizationId: "00000000-0000-4000-8000-000000000001",
    companyId: "company_acme",
    agentInstanceId: "hermes_sales",
    eventType: "assignment.received",
    routeJobId: "job_sales",
    routeCommitId: "commit_sales",
    routeAttemptId: "attempt_sales",
    eventId: "event_sales",
    problemId: "problem_sales",
    loopId: "sales_stalled_opportunity",
    loopSpecHash: "hash_sales",
    runId: "run_sales",
    correlationId: "corr_sales",
    sequence: 0,
    summary: "Assignment accepted",
    occurredAt: "2026-07-31T12:00:10.000Z",
    recordedAt: "2026-07-31T12:00:11.000Z"
  });
}
