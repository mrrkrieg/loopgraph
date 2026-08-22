import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  APP_OPERATION_ACTION_EVENT_SCHEMA_VERSION,
  APP_OPERATION_ACTION_SCHEMA_VERSION,
  canonicalAppDigest,
  type AppOperationAction,
  type AppOperationActionEvent
} from "../core";
import { FileAppOperationActionStore } from "./app-operation-action-store";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("File App operation action store", () => {
  it("records an idempotent, secret-free App ownership proof with private file permissions", async () => {
    const root = await temporaryRoot();
    const store = new FileAppOperationActionStore(root, "acme");
    const action = preparedAction();

    expect(await store.recordPrepared(action)).toEqual(action);
    expect(await store.recordPrepared(action)).toEqual(action);
    expect(await store.list({ workspaceId: "acme" })).toEqual([action]);
    expect(await store.get("another-workspace", action.id)).toBeUndefined();

    const file = path.join(root, "operation-actions.json");
    expect((await stat(file)).mode & 0o777).toBe(0o600);
    const serialized = await readFile(file, "utf8");
    expect(serialized).not.toContain("canonicalInput");
    expect(serialized).not.toContain("lead@example.com");
  });

  it("rejects identity conflicts, non-prepared states, and secret-shaped metadata", async () => {
    const root = await temporaryRoot();
    const store = new FileAppOperationActionStore(root, "acme");
    const action = preparedAction();
    await store.recordPrepared(action);

    const changed = withDigest({ ...action, capability: "crm.contact.write" });
    await expect(store.recordPrepared(changed)).rejects.toThrow(/identity conflict/i);
    const nonPrepared = withDigest({ ...action, id: "appact_other123" }) as unknown as Record<string, unknown>;
    nonPrepared.status = "approved";
    await expect(store.recordPrepared(nonPrepared as unknown as AppOperationAction))
      .rejects.toThrow(/prepared|invalid/i);
    await expect(store.recordPrepared(withDigest({ ...action, id: "appact_secret123", callId: "Bearer abcdefghijklmnopqrstuvwxyz" })))
      .rejects.toThrow(/secret/i);
  });

  it("filters by exact App, loop, route, and status boundaries", async () => {
    const root = await temporaryRoot();
    const store = new FileAppOperationActionStore(root, "acme");
    const first = preparedAction();
    const second = withDigest({
      ...first,
      id: "appact_second123",
      installationId: "installed-support",
      loopId: "support-triage",
      routeJobId: "route-job-2",
      preparedAt: "2026-08-08T12:01:00.000Z",
      updatedAt: "2026-08-08T12:01:00.000Z"
    });
    await store.recordPrepared(first);
    await store.recordPrepared(second);

    expect(await store.list({ workspaceId: "acme", installationId: "installed-support" })).toEqual([second]);
    expect(await store.list({ workspaceId: "acme", loopId: first.loopId, routeJobId: first.routeJobId })).toEqual([first]);
    expect(await store.list({ workspaceId: "other" })).toEqual([]);
    await expect(store.list({ workspaceId: "acme", limit: 1_001 })).rejects.toThrow(/limit/i);
  });

  it("appends receipt-bound lifecycle evidence without mutating the prepared action", async () => {
    const root = await temporaryRoot();
    const store = new FileAppOperationActionStore(root, "acme");
    const action = preparedAction();
    await store.recordPrepared(action);
    const event = approvalEvent(action);

    expect(await store.recordEvent(event)).toEqual(event);
    expect(await store.recordEvent(event)).toEqual(event);
    expect(await store.listEvents({ workspaceId: "acme", actionId: action.id })).toEqual([event]);
    expect(await store.get("acme", action.id)).toEqual(action);
    await expect(store.recordEvent(withEventDigest({ ...event, id: "appactevt_wrongparent", actionRecordDigest: digest("wrong") })))
      .rejects.toThrow(/immutable prepared action/i);
  });
});

function approvalEvent(action: AppOperationAction): AppOperationActionEvent {
  return withEventDigest({
    schemaVersion: APP_OPERATION_ACTION_EVENT_SCHEMA_VERSION,
    id: "appactevt_12345678",
    workspaceId: action.workspaceId,
    installationId: action.installationId,
    actionId: action.id,
    actionRecordDigest: action.recordDigest,
    eventType: "approval_granted",
    actor: { type: "user", subject: "reviewer-1" },
    approval: {
      connectorApprovalReceiptId: "connector-approval-12345678",
      reasonDigest: digest("approved for customer follow-up"),
      expiresAt: "2026-08-08T12:05:00.000Z"
    },
    occurredAt: "2026-08-08T12:01:00.000Z"
  });
}

function withEventDigest(input: Omit<AppOperationActionEvent, "eventDigest"> | AppOperationActionEvent): AppOperationActionEvent {
  const base = { ...input, eventDigest: undefined };
  return { ...input, eventDigest: canonicalAppDigest(base) } as AppOperationActionEvent;
}

function preparedAction(): AppOperationAction {
  return withDigest({
    schemaVersion: APP_OPERATION_ACTION_SCHEMA_VERSION,
    id: "appact_12345678",
    workspaceId: "acme",
    companyId: "acme-company",
    installationId: "installed-sales",
    appId: "loopgraph.sales.inbound-leads",
    artifactDigest: digest("artifact"),
    loopId: "sales-inbound-lead-intake",
    loopVersionHash: digest("loop"),
    capability: "crm.lead.write",
    routeJobId: "route-job-1",
    agentInstanceId: "hermes-sales",
    callId: "call-1",
    requestId: "request-12345678",
    idempotencyKey: "idempotency-12345678",
    resolutionDigest: digest("resolution"),
    executionDigest: digest("execution"),
    providerBinding: {
      providerId: "hubspot",
      connectionId: "hubspot-production",
      brokerCapability: "provider.action.execute",
      operation: "crm.contacts.update"
    },
    companyObject: { type: "lead", identityDigest: digest("lead-42") },
    environment: "production",
    brokerPreparedActionId: "broker-action-12345678",
    brokerPreparedActionFingerprint: "f".repeat(64),
    brokerPrepareReceiptId: "broker-receipt-12345678",
    approvalRequired: true,
    riskClass: "write",
    status: "prepared",
    preparedAt: "2026-08-08T12:00:00.000Z",
    expiresAt: "2026-08-08T13:00:00.000Z",
    updatedAt: "2026-08-08T12:00:00.000Z"
  });
}

function withDigest(input: Omit<AppOperationAction, "recordDigest"> | AppOperationAction): AppOperationAction {
  const base = { ...input, recordDigest: undefined };
  return { ...input, recordDigest: canonicalAppDigest(base) } as AppOperationAction;
}

function digest(value: string) {
  return canonicalAppDigest(value);
}

async function temporaryRoot() {
  const root = await mkdtemp(path.join(os.tmpdir(), "loopgraph-app-actions-"));
  roots.push(root);
  return root;
}
