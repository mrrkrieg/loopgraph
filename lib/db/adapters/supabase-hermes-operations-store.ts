import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  hermesAgentInstanceSchema,
  hermesExecutionEventSchema,
  type HermesAgentInstance,
  type HermesExecutionEvent
} from "loopgraph/core";
import type {
  HermesAgentListFilters,
  HermesExecutionEventAppendResult,
  HermesExecutionEventListFilters,
  HermesOperationsStore
} from "loopgraph/runtime";
import { createSupabaseAdminClient } from "@/lib/db/supabase-admin";

const PAGE_SIZE = 500;
const PROJECT_KEY_PATTERN = /^[a-z0-9][a-z0-9_-]{0,63}$/;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type SupabaseHermesOperationsScope = {
  organizationId: string;
  projectKey: string;
};

export class SupabaseHermesOperationsStore implements HermesOperationsStore {
  readonly persistence = "distributed" as const;

  constructor(
    private readonly supabase: SupabaseClient,
    private readonly scope: SupabaseHermesOperationsScope
  ) {
    assertScope(scope);
  }

  async saveAgentInstance(agent: HermesAgentInstance): Promise<void> {
    const parsed = hermesAgentInstanceSchema.parse(agent);
    assertOrganization(parsed.organizationId, this.scope.organizationId);
    const { data, error } = await this.supabase.rpc("upsert_hermes_agent_instance", {
      p_organization_id: this.scope.organizationId,
      p_project_key: this.scope.projectKey,
      p_payload: parsed
    });
    if (error) throw new Error(`Failed to save Hermes agent: ${error.message}`);
    const saved = hermesAgentInstanceSchema.parse(data);
    if (saved.id !== parsed.id || saved.workspaceId !== parsed.workspaceId) {
      throw new Error(`Hermes agent write returned inconsistent identity: ${parsed.id}`);
    }
  }

  async getAgentInstance(agentInstanceId: string): Promise<HermesAgentInstance | null> {
    const { data, error } = await this.supabase
      .from("hermes_agent_instances")
      .select("payload")
      .eq("organization_id", this.scope.organizationId)
      .eq("project_key", this.scope.projectKey)
      .eq("agent_instance_id", agentInstanceId)
      .maybeSingle();
    if (error) throw new Error(`Failed to read Hermes agent: ${error.message}`);
    return data ? hermesAgentInstanceSchema.parse((data as { payload: unknown }).payload) : null;
  }

  async listAgentInstances(filters: HermesAgentListFilters = {}): Promise<HermesAgentInstance[]> {
    const values: HermesAgentInstance[] = [];
    for (let offset = 0; ; offset += PAGE_SIZE) {
      let query = this.supabase
        .from("hermes_agent_instances")
        .select("payload")
        .eq("organization_id", this.scope.organizationId)
        .eq("project_key", this.scope.projectKey);
      if (filters.workspaceId) query = query.eq("workspace_id", filters.workspaceId);
      if (filters.environment) query = query.eq("environment", filters.environment);
      if (filters.status) query = query.eq("status", filters.status);
      const { data, error } = await query
        .order("last_heartbeat_at", { ascending: false })
        .range(offset, offset + PAGE_SIZE - 1);
      if (error) throw new Error(`Failed to list Hermes agents: ${error.message}`);
      const page = (data ?? []) as Array<{ payload: unknown }>;
      values.push(...page.map((row) => hermesAgentInstanceSchema.parse(row.payload)));
      if (page.length < PAGE_SIZE) return values;
    }
  }

  async appendExecutionEvent(event: HermesExecutionEvent): Promise<HermesExecutionEventAppendResult> {
    const parsed = hermesExecutionEventSchema.parse(event);
    assertOrganization(parsed.organizationId, this.scope.organizationId);
    const { data, error } = await this.supabase.rpc("append_hermes_execution_event", {
      p_organization_id: this.scope.organizationId,
      p_project_key: this.scope.projectKey,
      p_payload: parsed
    });
    if (error) throw new Error(`Failed to append Hermes execution event: ${error.message}`);
    const result = firstRow<{ event: unknown; created: boolean }>(data);
    if (!result || typeof result.created !== "boolean") {
      throw new Error("Hermes execution event append did not return an atomic result");
    }
    return { event: hermesExecutionEventSchema.parse(result.event), created: result.created };
  }

  async getExecutionEventByIdempotencyKey(idempotencyKey: string): Promise<HermesExecutionEvent | null> {
    const { data, error } = await this.supabase
      .from("hermes_execution_events")
      .select("payload")
      .eq("organization_id", this.scope.organizationId)
      .eq("project_key", this.scope.projectKey)
      .eq("idempotency_key", idempotencyKey)
      .maybeSingle();
    if (error) throw new Error(`Failed to read Hermes execution event: ${error.message}`);
    return data ? hermesExecutionEventSchema.parse((data as { payload: unknown }).payload) : null;
  }

  async listExecutionEvents(filters: HermesExecutionEventListFilters = {}): Promise<HermesExecutionEvent[]> {
    const values: HermesExecutionEvent[] = [];
    const requestedLimit = Math.max(0, filters.limit ?? Number.POSITIVE_INFINITY);
    for (let offset = 0; offset < requestedLimit; offset += PAGE_SIZE) {
      let query = this.supabase
        .from("hermes_execution_events")
        .select("payload")
        .eq("organization_id", this.scope.organizationId)
        .eq("project_key", this.scope.projectKey);
      if (filters.workspaceId) query = query.eq("workspace_id", filters.workspaceId);
      if (filters.companyId) query = query.eq("company_id", filters.companyId);
      if (filters.agentInstanceId) query = query.eq("agent_instance_id", filters.agentInstanceId);
      if (filters.routeJobId) query = query.eq("route_job_id", filters.routeJobId);
      if (filters.runId) query = query.eq("run_id", filters.runId);
      if (filters.correlationId) query = query.eq("correlation_id", filters.correlationId);
      if (filters.eventType) query = query.eq("event_type", filters.eventType);
      const pageSize = Number.isFinite(requestedLimit)
        ? Math.min(PAGE_SIZE, requestedLimit - offset)
        : PAGE_SIZE;
      const { data, error } = await query
        .order("occurred_at", { ascending: false })
        .order("execution_event_id", { ascending: true })
        .range(offset, offset + pageSize - 1);
      if (error) throw new Error(`Failed to list Hermes execution events: ${error.message}`);
      const page = (data ?? []) as Array<{ payload: unknown }>;
      values.push(...page.map((row) => hermesExecutionEventSchema.parse(row.payload)));
      if (page.length < pageSize) break;
    }
    return values.sort((left, right) => left.occurredAt.localeCompare(right.occurredAt) || left.sequence - right.sequence);
  }
}

export function isSupabaseHermesOperationsStoreEnabled(
  env: Record<string, string | undefined> = process.env
): boolean {
  return Boolean(env.NEXT_PUBLIC_SUPABASE_URL && env.SUPABASE_SERVICE_ROLE_KEY && env.LOOPGRAPH_HOSTED_ORGANIZATION_ID);
}

export function createSupabaseHermesOperationsStore(): HermesOperationsStore {
  const supabase = createSupabaseAdminClient();
  const organizationId = process.env.LOOPGRAPH_HOSTED_ORGANIZATION_ID?.trim();
  const projectKey = process.env.LOOPGRAPH_HOSTED_PROJECT_KEY?.trim() || "default";
  if (!supabase || !organizationId) throw new Error("Supabase Hermes operations storage requires LOOPGRAPH_HOSTED_ORGANIZATION_ID");
  return new SupabaseHermesOperationsStore(supabase, { organizationId, projectKey });
}

function assertScope(scope: SupabaseHermesOperationsScope): void {
  if (!UUID_PATTERN.test(scope.organizationId)) throw new Error("Hermes operations organization ID must be a UUID");
  if (!PROJECT_KEY_PATTERN.test(scope.projectKey)) throw new Error("Hermes operations project key is invalid");
}

function assertOrganization(value: string | undefined, expected: string): void {
  if (value !== expected) throw new Error("Hermes operations payload is not bound to the configured organization");
}

function firstRow<T>(data: unknown): T | null {
  if (Array.isArray(data)) return (data[0] as T | undefined) ?? null;
  return data && typeof data === "object" ? data as T : null;
}
