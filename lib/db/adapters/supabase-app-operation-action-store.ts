import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  appOperationActionEventSchema,
  appOperationActionSchema,
  type AppOperationAction,
  type AppOperationActionEvent
} from "loopgraph/core";
import {
  assertActionEventBoundary,
  assertPreparedActionBoundary,
  type AppOperationActionEventQuery,
  type AppOperationActionReconciliationCandidate,
  type AppOperationActionQuery,
  type AppOperationActionStore
} from "loopgraph/runtime";
import { createSupabaseAdminClient } from "@/lib/db/supabase-admin";

const PROJECT_KEY_PATTERN = /^[a-z0-9][a-z0-9_-]{0,63}$/;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type Scope = { organizationId: string; projectKey: string; workspaceId: string };

export class SupabaseAppOperationActionStore implements AppOperationActionStore {
  readonly persistence = "distributed" as const;

  constructor(private readonly supabase: SupabaseClient, private readonly scope: Scope) {
    if (!UUID_PATTERN.test(scope.organizationId)) throw new Error("App operation action store organization ID must be a UUID");
    if (!PROJECT_KEY_PATTERN.test(scope.projectKey)) throw new Error("App operation action store project key is invalid");
    if (scope.workspaceId.length < 1 || scope.workspaceId.length > 160) throw new Error("App operation action store workspace ID is invalid");
  }

  async recordPrepared(input: AppOperationAction): Promise<AppOperationAction> {
    const action = appOperationActionSchema.parse(input);
    assertPreparedActionBoundary(action, this.scope.workspaceId);
    const { data, error } = await this.supabase.rpc("record_loopgraph_app_operation_action", {
      p_organization_id: this.scope.organizationId,
      p_project_key: this.scope.projectKey,
      p_workspace_id: this.scope.workspaceId,
      p_action: action
    });
    if (!error) return appOperationActionSchema.parse(data);
    throw new Error(`Failed to record prepared App action: ${error.message}`);
  }

  async get(workspaceId: string, actionId: string): Promise<AppOperationAction | undefined> {
    if (workspaceId !== this.scope.workspaceId) return undefined;
    const { data, error } = await this.scopedQuery()
      .eq("action_id", actionId)
      .maybeSingle();
    if (error) throw new Error(`Failed to read prepared App action: ${error.message}`);
    return data ? parseActionRow(data, this.scope.workspaceId) : undefined;
  }

  async recordEvent(input: AppOperationActionEvent): Promise<AppOperationActionEvent> {
    const event = appOperationActionEventSchema.parse(input);
    assertActionEventBoundary(event, this.scope.workspaceId);
    const { data, error } = await this.supabase.rpc("record_loopgraph_app_operation_action_event", {
      p_organization_id: this.scope.organizationId,
      p_project_key: this.scope.projectKey,
      p_workspace_id: this.scope.workspaceId,
      p_event: event
    });
    if (!error) return appOperationActionEventSchema.parse(data);
    throw new Error(`Failed to record App action lifecycle event: ${error.message}`);
  }

  async list(queryInput: AppOperationActionQuery): Promise<AppOperationAction[]> {
    if (queryInput.workspaceId !== this.scope.workspaceId) return [];
    const limit = boundedLimit(queryInput.limit);
    let query = this.scopedQuery();
    if (queryInput.installationId) query = query.eq("installation_id", queryInput.installationId);
    if (queryInput.loopId) query = query.eq("loop_id", queryInput.loopId);
    if (queryInput.routeJobId) query = query.eq("route_job_id", queryInput.routeJobId);
    if (queryInput.status) query = query.eq("status", queryInput.status);
    const { data, error } = await query.order("prepared_at", { ascending: false }).limit(limit);
    if (error) throw new Error(`Failed to list prepared App actions: ${error.message}`);
    return (data ?? []).map((row) => parseActionRow(row, this.scope.workspaceId));
  }

  async listEvents(queryInput: AppOperationActionEventQuery): Promise<AppOperationActionEvent[]> {
    if (queryInput.workspaceId !== this.scope.workspaceId) return [];
    const limit = boundedLimit(queryInput.limit);
    let query = this.supabase
      .from("loopgraph_app_operation_action_events")
      .select("event_payload")
      .eq("organization_id", this.scope.organizationId)
      .eq("project_key", this.scope.projectKey)
      .eq("workspace_id", this.scope.workspaceId);
    if (queryInput.installationId) query = query.eq("installation_id", queryInput.installationId);
    if (queryInput.actionId) query = query.eq("action_id", queryInput.actionId);
    if (queryInput.eventType) query = query.eq("event_type", queryInput.eventType);
    const { data, error } = await query.order("occurred_at", { ascending: false }).limit(limit);
    if (error) throw new Error(`Failed to list App action lifecycle events: ${error.message}`);
    return (data ?? []).map((row) => parseEventRow(row, this.scope.workspaceId));
  }

  async listReconciliationCandidates(query: {
    workspaceId: string;
    requestedBefore: string;
    limit: number;
  }): Promise<AppOperationActionReconciliationCandidate[]> {
    if (query.workspaceId !== this.scope.workspaceId) return [];
    const limit = boundedLimit(query.limit);
    if (!Number.isFinite(Date.parse(query.requestedBefore))) throw new Error("App action reconciliation cutoff is invalid");
    const { data, error } = await this.supabase.rpc("list_loopgraph_app_action_reconciliation_candidates", {
      p_organization_id: this.scope.organizationId,
      p_project_key: this.scope.projectKey,
      p_workspace_id: this.scope.workspaceId,
      p_requested_before: query.requestedBefore,
      p_limit: limit
    });
    if (error) throw new Error(`Failed to list App action reconciliation candidates: ${error.message}`);
    if (!Array.isArray(data)) throw new Error("Hosted App action reconciliation query returned an invalid result");
    return data.map((row) => {
      if (!row || typeof row !== "object" || !("action_payload" in row) || !("request_event_payload" in row)) {
        throw new Error("Hosted App action reconciliation query returned an invalid row");
      }
      const action = appOperationActionSchema.parse((row as { action_payload: unknown }).action_payload);
      const requestEvent = appOperationActionEventSchema.parse((row as { request_event_payload: unknown }).request_event_payload);
      if (action.workspaceId !== this.scope.workspaceId || requestEvent.workspaceId !== this.scope.workspaceId ||
        requestEvent.eventType !== "commit_requested" || !requestEvent.commit ||
        action.id !== requestEvent.actionId || action.installationId !== requestEvent.installationId) {
        throw new Error("Hosted App action reconciliation candidate is out of scope or malformed");
      }
      return { action, requestEvent } as AppOperationActionReconciliationCandidate;
    });
  }

  private scopedQuery() {
    return this.supabase
      .from("loopgraph_app_operation_actions")
      .select("action_payload")
      .eq("organization_id", this.scope.organizationId)
      .eq("project_key", this.scope.projectKey)
      .eq("workspace_id", this.scope.workspaceId);
  }
}

function parseEventRow(row: unknown, workspaceId: string): AppOperationActionEvent {
  if (!row || typeof row !== "object" || !("event_payload" in row)) {
    throw new Error("Hosted App operation action store returned an invalid lifecycle event row");
  }
  const event = appOperationActionEventSchema.parse((row as { event_payload: unknown }).event_payload);
  if (event.workspaceId !== workspaceId) throw new Error("App operation action event belongs to another workspace");
  return event;
}

function parseActionRow(row: unknown, workspaceId: string): AppOperationAction {
  if (!row || typeof row !== "object" || !("action_payload" in row)) {
    throw new Error("Hosted App operation action store returned an invalid row");
  }
  const action = appOperationActionSchema.parse((row as { action_payload: unknown }).action_payload);
  if (action.workspaceId !== workspaceId) throw new Error("Prepared App action belongs to another workspace");
  return action;
}

function boundedLimit(value: number | undefined): number {
  if (value === undefined) return 100;
  if (!Number.isInteger(value) || value < 1 || value > 1_000) {
    throw new Error("App operation action list limit must be an integer from 1 to 1000");
  }
  return value;
}

export function isSupabaseAppOperationActionStoreEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return Boolean(env.NEXT_PUBLIC_SUPABASE_URL && env.SUPABASE_SERVICE_ROLE_KEY && env.LOOPGRAPH_HOSTED_ORGANIZATION_ID);
}

export function createSupabaseAppOperationActionStore(workspaceId: string): SupabaseAppOperationActionStore {
  const supabase = createSupabaseAdminClient();
  const organizationId = process.env.LOOPGRAPH_HOSTED_ORGANIZATION_ID?.trim();
  const projectKey = process.env.LOOPGRAPH_HOSTED_PROJECT_KEY?.trim() || "default";
  if (!supabase || !organizationId) throw new Error("Supabase App operation action storage requires a hosted organization");
  return new SupabaseAppOperationActionStore(supabase, { organizationId, projectKey, workspaceId });
}
