import type { SupabaseClient } from "@supabase/supabase-js";
import {
  APP_OPERATION_ACTION_SCHEMA_VERSION,
  canonicalAppDigest,
  type AppOperationAction
} from "loopgraph/core";
import { describe, expect, it, vi } from "vitest";
import { SupabaseAppOperationActionStore } from "./supabase-app-operation-action-store";

const scope = {
  organizationId: "123e4567-e89b-12d3-a456-426614174000",
  projectKey: "main",
  workspaceId: "acme"
};

describe("Supabase App operation action store", () => {
  it("records through the audited RPC and reads only its exact tenant scope", async () => {
    const fake = new ActionSupabase();
    const store = new SupabaseAppOperationActionStore(fake.client, scope);
    const action = preparedAction();

    expect(await store.recordPrepared(action)).toEqual(action);
    expect(fake.rpc).toHaveBeenCalledWith("record_loopgraph_app_operation_action", {
      p_organization_id: scope.organizationId,
      p_project_key: scope.projectKey,
      p_workspace_id: scope.workspaceId,
      p_action: action
    });
    expect(await store.get(scope.workspaceId, action.id)).toEqual(action);
    expect(await store.get("other", action.id)).toBeUndefined();
    expect(await store.list({ workspaceId: scope.workspaceId, installationId: action.installationId })).toEqual([action]);
  });

  it("rejects invalid tenant scope and propagates a durable record failure", async () => {
    const fake = new ActionSupabase();
    expect(() => new SupabaseAppOperationActionStore(fake.client, { ...scope, organizationId: "../escape" })).toThrow(/organization ID/);
    expect(() => new SupabaseAppOperationActionStore(fake.client, { ...scope, projectKey: "../escape" })).toThrow(/project key/);

    fake.failRecord = true;
    const store = new SupabaseAppOperationActionStore(fake.client, scope);
    await expect(store.recordPrepared(preparedAction())).rejects.toThrow(/durable record failure/);
  });
});

class ActionSupabase {
  rows: Array<Record<string, unknown>> = [];
  failRecord = false;
  rpc = vi.fn(async (name: string, args: Record<string, unknown>) => {
    if (name !== "record_loopgraph_app_operation_action") return { data: null, error: { message: "unknown RPC" } };
    if (this.failRecord) return { data: null, error: { message: "durable record failure" } };
    const action = args.p_action as AppOperationAction;
    const existing = this.rows.find((row) => row.action_id === action.id);
    if (existing && (existing.action_payload as AppOperationAction).recordDigest !== action.recordDigest) {
      return { data: null, error: { message: "identity conflict" } };
    }
    if (!existing) {
      this.rows.push({
        organization_id: args.p_organization_id,
        project_key: args.p_project_key,
        workspace_id: args.p_workspace_id,
        action_id: action.id,
        installation_id: action.installationId,
        loop_id: action.loopId,
        route_job_id: action.routeJobId,
        status: action.status,
        prepared_at: action.preparedAt,
        action_payload: action
      });
    }
    return { data: action, error: null };
  });

  client = {
    rpc: this.rpc,
    from: () => new FakeQuery(this.rows)
  } as unknown as SupabaseClient;
}

class FakeQuery {
  private filters: Array<[string, unknown]> = [];

  constructor(private readonly rows: Array<Record<string, unknown>>) {}
  select() { return this; }
  eq(column: string, value: unknown) { this.filters.push([column, value]); return this; }
  order() { return this; }
  async limit(value: number) { return { data: this.matches().slice(0, value).map(project), error: null }; }
  async maybeSingle() { return { data: this.matches()[0] ? project(this.matches()[0]!) : null, error: null }; }
  private matches() { return this.rows.filter((row) => this.filters.every(([column, value]) => row[column] === value)); }
}

function project(row: Record<string, unknown>) {
  return { action_payload: row.action_payload };
}

function preparedAction(): AppOperationAction {
  const base = {
    schemaVersion: APP_OPERATION_ACTION_SCHEMA_VERSION,
    id: "appact_12345678",
    workspaceId: scope.workspaceId,
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
      brokerCapability: "provider.action.execute" as const,
      operation: "crm.contacts.update"
    },
    companyObject: { type: "lead", identityDigest: digest("lead-42") },
    environment: "production" as const,
    brokerPreparedActionId: "broker-action-12345678",
    brokerPreparedActionFingerprint: "f".repeat(64),
    brokerPrepareReceiptId: "broker-receipt-12345678",
    approvalRequired: true,
    riskClass: "write" as const,
    status: "prepared" as const,
    preparedAt: "2026-08-08T12:00:00.000Z",
    expiresAt: "2026-08-08T13:00:00.000Z",
    updatedAt: "2026-08-08T12:00:00.000Z"
  };
  return { ...base, recordDigest: canonicalAppDigest({ ...base, recordDigest: undefined }) };
}

function digest(value: string) { return canonicalAppDigest(value); }
