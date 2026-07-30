import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  businessProblemSchema,
  eventReceiptSchema,
  routeCommitSchema,
  routeJobSchema,
  routerEvaluationSchema,
  routingAttemptSchema,
  routingCorrectionSchema,
  type BusinessProblem,
  type EventReceipt,
  type RouteCommit,
  type RouteJob,
  type RouterEvaluation,
  type RoutingAttempt,
  type RoutingCorrection
} from "loopgraph/core";
import type {
  RouteJobAtomicUpdateInput,
  RouteJobClaimInput,
  RouteJobListFilters,
  RoutingStore
} from "loopgraph/runtime";
import { createSupabaseAdminClient } from "@/lib/db/supabase-admin";

const PAGE_SIZE = 500;
const MAX_ATOMIC_UPDATE_RETRIES = 8;
const PROJECT_KEY_PATTERN = /^[a-z0-9][a-z0-9_-]{0,63}$/;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type RoutingRecordType =
  | "event_receipt"
  | "business_problem"
  | "routing_attempt"
  | "route_commit"
  | "routing_correction"
  | "router_evaluation";

type RoutingRecordIndexes = {
  eventId?: string;
  eventPrimary?: boolean;
  problemId?: string;
  routeCommitId?: string;
};

type RouteJobRow = {
  payload: unknown;
  revision: number | string;
};

type CompareAndSwapResult = {
  updated: boolean;
  job: unknown | null;
  revision: number | string | null;
  conflict_reason: string | null;
};

export type SupabaseRoutingStoreScope = {
  organizationId: string;
  projectKey: string;
};

/**
 * Shared hosted routing state. Browser clients never receive this adapter: it
 * requires the service-role client and every query is pinned to one deployment
 * organization/project scope.
 */
export class SupabaseRoutingStore implements RoutingStore {
  constructor(
    private readonly supabase: SupabaseClient,
    private readonly scope: SupabaseRoutingStoreScope
  ) {
    assertRoutingScope(scope);
  }

  async saveEventReceipt(receipt: EventReceipt): Promise<void> {
    const parsed = eventReceiptSchema.parse(receipt);
    await this.saveRecord("event_receipt", parsed.id, parsed, {
      eventId: parsed.eventId,
      eventPrimary: !["duplicate", "replayed"].includes(parsed.status)
    });
  }

  async createEventReceiptAtomically(
    receipt: EventReceipt
  ): Promise<{ receipt: EventReceipt; created: boolean }> {
    const parsed = eventReceiptSchema.parse(receipt);
    if (["duplicate", "replayed"].includes(parsed.status)) {
      throw new Error("Only a primary event receipt can be created atomically");
    }
    const { data, error } = await this.supabase.rpc("create_routing_event_receipt", {
      p_organization_id: this.scope.organizationId,
      p_project_key: this.scope.projectKey,
      p_record_id: parsed.id,
      p_event_id: parsed.eventId,
      p_payload: parsed
    });
    if (error) {
      throw new Error(`Failed to create routing event receipt: ${error.message}`);
    }
    const result = firstRow<{ receipt: unknown; created: boolean }>(data);
    if (!result || typeof result.created !== "boolean") {
      throw new Error("Routing event receipt did not return an atomic result");
    }
    return {
      receipt: eventReceiptSchema.parse(result.receipt),
      created: result.created
    };
  }

  async getEventReceipt(eventId: string): Promise<EventReceipt | null> {
    const records = await this.listRecords("event_receipt", { eventId });
    return records
      .map((value) => eventReceiptSchema.parse(value))
      .find((receipt) => !["duplicate", "replayed"].includes(receipt.status)) ?? null;
  }

  async listEventReceipts(): Promise<EventReceipt[]> {
    return (await this.listRecords("event_receipt"))
      .map((value) => eventReceiptSchema.parse(value));
  }

  async saveBusinessProblem(problem: BusinessProblem): Promise<void> {
    const parsed = businessProblemSchema.parse(problem);
    await this.saveRecord("business_problem", parsed.id, parsed, {
      problemId: parsed.id
    });
  }

  async getBusinessProblem(problemId: string): Promise<BusinessProblem | null> {
    const value = await this.getRecord("business_problem", problemId);
    return value ? businessProblemSchema.parse(value) : null;
  }

  async listBusinessProblems(): Promise<BusinessProblem[]> {
    return (await this.listRecords("business_problem"))
      .map((value) => businessProblemSchema.parse(value));
  }

  async saveRoutingAttempt(attempt: RoutingAttempt): Promise<void> {
    const parsed = routingAttemptSchema.parse(attempt);
    await this.saveRecord("routing_attempt", parsed.id, parsed, {
      eventId: parsed.eventId
    });
  }

  async listRoutingAttempts(eventId?: string): Promise<RoutingAttempt[]> {
    return (await this.listRecords("routing_attempt", { eventId }))
      .map((value) => routingAttemptSchema.parse(value));
  }

  async saveRouteCommit(commit: RouteCommit): Promise<void> {
    const parsed = routeCommitSchema.parse(commit);
    await this.saveRecord("route_commit", parsed.id, parsed, {
      eventId: parsed.eventId,
      problemId: parsed.problemId,
      routeCommitId: parsed.id
    });
  }

  async listRouteCommits(problemId?: string): Promise<RouteCommit[]> {
    return (await this.listRecords("route_commit", { problemId }))
      .map((value) => routeCommitSchema.parse(value));
  }

  async saveRouteJob(job: RouteJob): Promise<void> {
    const parsed = routeJobSchema.parse(job);
    const { data, error } = await this.supabase.rpc("enqueue_route_job", {
      p_organization_id: this.scope.organizationId,
      p_project_key: this.scope.projectKey,
      p_job: parsed
    });
    if (error) throw new Error(`Failed to enqueue route job: ${error.message}`);
    const row = firstRow<{ job: unknown }>(data);
    if (!row) throw new Error("Route-job enqueue did not return a durable record");
    routeJobSchema.parse(row.job);
  }

  async getRouteJob(jobId: string): Promise<RouteJob | null> {
    const row = await this.getRouteJobRow(jobId);
    return row ? routeJobSchema.parse(row.payload) : null;
  }

  async listRouteJobs(filters: RouteJobListFilters = {}): Promise<RouteJob[]> {
    const values: RouteJob[] = [];
    for (let offset = 0; ; offset += PAGE_SIZE) {
      let query = this.supabase
        .from("route_jobs")
        .select("payload")
        .eq("organization_id", this.scope.organizationId)
        .eq("project_key", this.scope.projectKey);
      if (filters.eventId) query = query.eq("event_id", filters.eventId);
      if (filters.problemId) query = query.eq("problem_id", filters.problemId);
      if (filters.routeCommitId) query = query.eq("route_commit_id", filters.routeCommitId);
      if (filters.loopId) query = query.eq("loop_id", filters.loopId);
      if (filters.status) query = query.eq("status", filters.status);
      const { data, error } = await query
        .order("created_at", { ascending: true })
        .order("job_id", { ascending: true })
        .range(offset, offset + PAGE_SIZE - 1);
      if (error) throw new Error(`Failed to list route jobs: ${error.message}`);
      const page = (data ?? []) as Array<{ payload: unknown }>;
      values.push(...page.map((row) => routeJobSchema.parse(row.payload)));
      if (page.length < PAGE_SIZE) return values;
    }
  }

  async claimDueRouteJobsAtomically(input: RouteJobClaimInput): Promise<RouteJob[]> {
    return this.claimJobs("claim_due_route_jobs", input);
  }

  async claimWaitingReviewRouteJobsAtomically(
    input: RouteJobClaimInput
  ): Promise<RouteJob[]> {
    return this.claimJobs("claim_waiting_review_route_jobs", input);
  }

  async updateRouteJobAtomically(input: RouteJobAtomicUpdateInput): Promise<RouteJob> {
    for (let attempt = 0; attempt < MAX_ATOMIC_UPDATE_RETRIES; attempt += 1) {
      const current = await this.getRouteJobRow(input.jobId);
      if (!current) throw new Error(`Route job not found: ${input.jobId}`);
      const parsedCurrent = routeJobSchema.parse(current.payload);
      if (
        input.expectedLeaseToken &&
        parsedCurrent.lease?.leaseToken !== input.expectedLeaseToken
      ) {
        throw new Error(`Route job lease lost: ${input.jobId}`);
      }
      const updated = routeJobSchema.parse(input.update(parsedCurrent));
      const { data, error } = await this.supabase.rpc("compare_and_swap_route_job", {
        p_organization_id: this.scope.organizationId,
        p_project_key: this.scope.projectKey,
        p_job_id: input.jobId,
        p_expected_revision: numericRevision(current.revision),
        p_expected_lease_token: input.expectedLeaseToken ?? null,
        p_job: updated
      });
      if (error) throw new Error(`Failed to update route job: ${error.message}`);
      const result = firstRow<CompareAndSwapResult>(data);
      if (!result) throw new Error("Route-job update did not return a result");
      if (result.updated) return routeJobSchema.parse(result.job);
      if (result.conflict_reason === "lease_lost") {
        throw new Error(`Route job lease lost: ${input.jobId}`);
      }
      if (result.conflict_reason === "not_found") {
        throw new Error(`Route job not found: ${input.jobId}`);
      }
      if (result.conflict_reason !== "revision_conflict") {
        throw new Error(
          `Route-job update failed: ${result.conflict_reason ?? "unknown conflict"}`
        );
      }
    }
    throw new Error(
      `Route job ${input.jobId} changed too many times during atomic update`
    );
  }

  async saveRoutingCorrection(correction: RoutingCorrection): Promise<void> {
    const parsed = routingCorrectionSchema.parse(correction);
    await this.saveRecord("routing_correction", parsed.id, parsed, {
      eventId: parsed.eventId
    });
  }

  async listRoutingCorrections(eventId?: string): Promise<RoutingCorrection[]> {
    return (await this.listRecords("routing_correction", { eventId }))
      .map((value) => routingCorrectionSchema.parse(value));
  }

  async saveRouterEvaluation(evaluation: RouterEvaluation): Promise<void> {
    const parsed = routerEvaluationSchema.parse(evaluation);
    await this.saveRecord("router_evaluation", parsed.id, parsed, {
      eventId: parsed.eventId
    });
  }

  async listRouterEvaluations(): Promise<RouterEvaluation[]> {
    return (await this.listRecords("router_evaluation"))
      .map((value) => routerEvaluationSchema.parse(value));
  }

  private async saveRecord(
    recordType: RoutingRecordType,
    recordId: string,
    payload: object,
    indexes: RoutingRecordIndexes
  ): Promise<void> {
    const { data, error } = await this.supabase.rpc("upsert_routing_state_record", {
      p_organization_id: this.scope.organizationId,
      p_project_key: this.scope.projectKey,
      p_record_type: recordType,
      p_record_id: recordId,
      p_event_id: indexes.eventId ?? null,
      p_event_primary: indexes.eventPrimary ?? false,
      p_problem_id: indexes.problemId ?? null,
      p_route_commit_id: indexes.routeCommitId ?? null,
      p_payload: payload
    });
    if (error) throw new Error(`Failed to persist ${recordType}: ${error.message}`);
    if (!firstRow<{ record: unknown }>(data)) {
      throw new Error(`Persisting ${recordType} did not return a durable record`);
    }
  }

  private async getRecord(
    recordType: RoutingRecordType,
    recordId: string
  ): Promise<unknown | null> {
    const { data, error } = await this.supabase
      .from("routing_state_records")
      .select("payload")
      .eq("organization_id", this.scope.organizationId)
      .eq("project_key", this.scope.projectKey)
      .eq("record_type", recordType)
      .eq("record_id", recordId)
      .maybeSingle();
    if (error) throw new Error(`Failed to load ${recordType}: ${error.message}`);
    return (data as { payload?: unknown } | null)?.payload ?? null;
  }

  private async listRecords(
    recordType: RoutingRecordType,
    filters: RoutingRecordIndexes = {}
  ): Promise<unknown[]> {
    const values: unknown[] = [];
    for (let offset = 0; ; offset += PAGE_SIZE) {
      let query = this.supabase
        .from("routing_state_records")
        .select("payload")
        .eq("organization_id", this.scope.organizationId)
        .eq("project_key", this.scope.projectKey)
        .eq("record_type", recordType);
      if (filters.eventId) query = query.eq("event_id", filters.eventId);
      if (filters.problemId) query = query.eq("problem_id", filters.problemId);
      if (filters.routeCommitId) {
        query = query.eq("route_commit_id", filters.routeCommitId);
      }
      const { data, error } = await query
        .order("created_at", { ascending: true })
        .order("record_id", { ascending: true })
        .range(offset, offset + PAGE_SIZE - 1);
      if (error) throw new Error(`Failed to list ${recordType}: ${error.message}`);
      const page = (data ?? []) as Array<{ payload: unknown }>;
      values.push(...page.map((row) => row.payload));
      if (page.length < PAGE_SIZE) return values;
    }
  }

  private async getRouteJobRow(jobId: string): Promise<RouteJobRow | null> {
    const { data, error } = await this.supabase
      .from("route_jobs")
      .select("payload, revision")
      .eq("organization_id", this.scope.organizationId)
      .eq("project_key", this.scope.projectKey)
      .eq("job_id", jobId)
      .maybeSingle();
    if (error) throw new Error(`Failed to load route job: ${error.message}`);
    return data ? data as RouteJobRow : null;
  }

  private async claimJobs(
    functionName:
      | "claim_due_route_jobs"
      | "claim_waiting_review_route_jobs",
    input: RouteJobClaimInput
  ): Promise<RouteJob[]> {
    const { data, error } = await this.supabase.rpc(functionName, {
      p_organization_id: this.scope.organizationId,
      p_project_key: this.scope.projectKey,
      p_claimed_by: input.claimedBy,
      p_now: input.now.toISOString(),
      p_lease_seconds: input.leaseSeconds,
      p_limit: input.limit
    });
    if (error) throw new Error(`Failed to claim route jobs: ${error.message}`);
    return rows<{ job: unknown }>(data)
      .map((row) => routeJobSchema.parse(row.job));
  }
}

export function isSupabaseRoutingStoreEnabled(
  env: NodeJS.ProcessEnv = process.env
): boolean {
  return Boolean(
    env.NEXT_PUBLIC_SUPABASE_URL &&
    env.SUPABASE_SERVICE_ROLE_KEY &&
    env.LOOPGRAPH_HOSTED_ORGANIZATION_ID
  );
}

export function createSupabaseRoutingStore(
  env: NodeJS.ProcessEnv = process.env
): SupabaseRoutingStore {
  const supabase = createSupabaseAdminClient();
  const organizationId = env.LOOPGRAPH_HOSTED_ORGANIZATION_ID?.trim();
  const projectKey = env.LOOPGRAPH_HOSTED_PROJECT_KEY?.trim() || "default";
  if (!supabase || !organizationId) {
    throw new Error(
      "Supabase routing storage requires NEXT_PUBLIC_SUPABASE_URL, " +
      "SUPABASE_SERVICE_ROLE_KEY, and LOOPGRAPH_HOSTED_ORGANIZATION_ID"
    );
  }
  return new SupabaseRoutingStore(supabase, { organizationId, projectKey });
}

function assertRoutingScope(scope: SupabaseRoutingStoreScope): void {
  if (!UUID_PATTERN.test(scope.organizationId)) {
    throw new Error("Hosted routing organization ID must be a UUID");
  }
  if (!PROJECT_KEY_PATTERN.test(scope.projectKey)) {
    throw new Error("Hosted routing project key is invalid");
  }
}

function rows<T>(value: unknown): T[] {
  if (Array.isArray(value)) return value as T[];
  return value ? [value as T] : [];
}

function firstRow<T>(value: unknown): T | undefined {
  return rows<T>(value)[0];
}

function numericRevision(value: number | string): number {
  const revision = Number(value);
  if (!Number.isSafeInteger(revision) || revision < 1) {
    throw new Error("Route-job revision is invalid");
  }
  return revision;
}
