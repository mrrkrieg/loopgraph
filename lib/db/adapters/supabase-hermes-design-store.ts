import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  hermesDesignCallbackSchema,
  hermesDesignCallbackJobSchema,
  hermesDesignDispatchJobSchema,
  hermesDesignTaskSchema,
  type HermesDesignCallbackJob,
  type HermesDesignDispatchJob,
  type HermesDesignTask
} from "loopgraph/core";
import type {
  HermesDesignCallbackApplyInput,
  HermesDesignCallbackApplyResult,
  HermesDesignCallbackJobAcceptInput,
  HermesDesignCallbackJobAcceptResult,
  HermesDesignCallbackJobClaimInput,
  HermesDesignCallbackJobFilters,
  HermesDesignCallbackJobUpdateInput,
  HermesDesignDispatchJobClaimInput,
  HermesDesignDispatchJobCreateResult,
  HermesDesignDispatchJobFilters,
  HermesDesignDispatchJobUpdateInput,
  HermesDesignStore,
  HermesDesignTaskDispatchUpdateInput,
  HermesDesignTaskDispatchUpdateResult,
  HermesDesignTaskCreateResult,
  HermesDesignTaskCreateOptions,
  HermesDesignTaskFilters,
  HermesDesignTaskUpdateInput
} from "loopgraph/runtime";
import { createSupabaseAdminClient } from "@/lib/db/supabase-admin";

const PAGE_SIZE = 500;
const MAX_ATOMIC_UPDATE_RETRIES = 8;
const PROJECT_KEY_PATTERN = /^[a-z0-9][a-z0-9_-]{0,63}$/;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type DesignTaskRow = {
  payload: unknown;
  revision: number | string;
};

type TaskCreateResult = {
  task: unknown;
  created: boolean;
  revision: number | string;
  dispatch_job?: unknown | null;
  dispatch_created?: boolean | null;
};

type TaskUpdateResult = {
  updated: boolean;
  task: unknown | null;
  revision: number | string | null;
  conflict_reason: string | null;
};

type CallbackApplyResult = TaskUpdateResult & {
  applied: boolean;
  duplicate: boolean;
};

type DispatchJobRow = {
  payload: unknown;
  revision: number | string;
};

type CallbackJobRow = {
  payload: unknown;
  revision: number | string;
};

type CallbackJobAcceptResult = {
  authorized: boolean;
  reason: string;
  retry_after_seconds?: number | null;
  job?: unknown | null;
  created?: boolean | null;
  revision?: number | string | null;
};

type CallbackJobUpdateResult = {
  updated: boolean;
  job: unknown | null;
  revision: number | string | null;
  conflict_reason: string | null;
};

type DispatchCreateResult = {
  job: unknown;
  created: boolean;
  revision: number | string;
};

type DispatchUpdateResult = {
  updated: boolean;
  job: unknown | null;
  revision: number | string | null;
  conflict_reason: string | null;
};

type TaskDispatchUpdateResult = TaskUpdateResult & {
  dispatch_job: unknown | null;
  dispatch_created: boolean | null;
};

export type SupabaseHermesDesignStoreScope = {
  organizationId: string;
  projectKey: string;
};

/**
 * Tenant-scoped hosted Hermes design state. The adapter is server-only and
 * mutates through bounded database functions; browser roles cannot access the
 * underlying task or callback records.
 */
export class SupabaseHermesDesignStore implements HermesDesignStore {
  constructor(
    private readonly supabase: SupabaseClient,
    private readonly scope: SupabaseHermesDesignStoreScope
  ) {
    assertScope(scope);
  }

  async createTaskAtomically(
    task: HermesDesignTask,
    options: HermesDesignTaskCreateOptions = {}
  ): Promise<HermesDesignTaskCreateResult> {
    const parsed = hermesDesignTaskSchema.parse(task);
    const dispatchJob = options.dispatchJob
      ? hermesDesignDispatchJobSchema.parse(options.dispatchJob)
      : undefined;
    if (dispatchJob && dispatchJob.taskId !== parsed.id) {
      throw new Error("Hermes design dispatch job does not belong to the task");
    }
    const functionName = dispatchJob
      ? "create_hermes_design_task_with_dispatch"
      : "create_hermes_design_task";
    const { data, error } = await this.supabase.rpc(functionName, {
      p_organization_id: this.scope.organizationId,
      p_project_key: this.scope.projectKey,
      p_task: parsed,
      ...(dispatchJob ? { p_dispatch_job: dispatchJob } : {})
    });
    if (error) throw new Error(`Failed to create Hermes design task: ${error.message}`);
    const result = firstRow<TaskCreateResult>(data);
    if (!result || typeof result.created !== "boolean") {
      throw new Error("Hermes design task creation did not return an atomic result");
    }
    return {
      task: hermesDesignTaskSchema.parse(result.task),
      created: result.created,
      ...(result.dispatch_job
        ? { dispatchJob: hermesDesignDispatchJobSchema.parse(result.dispatch_job) }
        : {})
    };
  }

  async getTask(taskId: string): Promise<HermesDesignTask | undefined> {
    const row = await this.getTaskRow(taskId);
    return row ? hermesDesignTaskSchema.parse(row.payload) : undefined;
  }

  async listTasks(
    filters: HermesDesignTaskFilters = {}
  ): Promise<HermesDesignTask[]> {
    const tasks: HermesDesignTask[] = [];
    for (let offset = 0; ; offset += PAGE_SIZE) {
      let query = this.supabase
        .from("hermes_design_tasks")
        .select("payload")
        .eq("organization_id", this.scope.organizationId)
        .eq("project_key", this.scope.projectKey);
      if (filters.sessionId) query = query.eq("session_id", filters.sessionId);
      if (filters.status) query = query.eq("status", filters.status);
      const { data, error } = await query
        .order("created_at", { ascending: false })
        .order("task_id", { ascending: true })
        .range(offset, offset + PAGE_SIZE - 1);
      if (error) throw new Error(`Failed to list Hermes design tasks: ${error.message}`);
      const page = (data ?? []) as Array<{ payload: unknown }>;
      tasks.push(...page.map((row) => hermesDesignTaskSchema.parse(row.payload)));
      if (page.length < PAGE_SIZE) return tasks;
    }
  }

  async updateTaskAtomically(
    input: HermesDesignTaskUpdateInput
  ): Promise<HermesDesignTask> {
    for (let attempt = 0; attempt < MAX_ATOMIC_UPDATE_RETRIES; attempt += 1) {
      const current = await this.getTaskRow(input.taskId);
      if (!current) throw new Error(`Hermes design task not found: ${input.taskId}`);
      const parsedCurrent = hermesDesignTaskSchema.parse(current.payload);
      const updated = hermesDesignTaskSchema.parse(input.update(parsedCurrent));
      assertTaskIdentity(parsedCurrent, updated);
      const { data, error } = await this.supabase.rpc("compare_and_swap_hermes_design_task", {
        p_organization_id: this.scope.organizationId,
        p_project_key: this.scope.projectKey,
        p_task_id: input.taskId,
        p_expected_revision: numericRevision(current.revision),
        p_task: updated
      });
      if (error) throw new Error(`Failed to update Hermes design task: ${error.message}`);
      const result = firstRow<TaskUpdateResult>(data);
      if (!result) throw new Error("Hermes design task update did not return a result");
      if (result.updated) return hermesDesignTaskSchema.parse(result.task);
      if (result.conflict_reason === "not_found") {
        throw new Error(`Hermes design task not found: ${input.taskId}`);
      }
      if (result.conflict_reason !== "revision_conflict") {
        throw new Error(
          `Hermes design task update failed: ${result.conflict_reason ?? "unknown conflict"}`
        );
      }
    }
    throw new Error(
      `Hermes design task ${input.taskId} changed too many times during atomic update`
    );
  }

  async updateTaskAndEnqueueDispatchAtomically(
    input: HermesDesignTaskDispatchUpdateInput
  ): Promise<HermesDesignTaskDispatchUpdateResult> {
    for (let attempt = 0; attempt < MAX_ATOMIC_UPDATE_RETRIES; attempt += 1) {
      const current = await this.getTaskRow(input.taskId);
      if (!current) throw new Error(`Hermes design task not found: ${input.taskId}`);
      const parsedCurrent = hermesDesignTaskSchema.parse(current.payload);
      const candidate = input.update(parsedCurrent);
      const updated = hermesDesignTaskSchema.parse(candidate.task);
      const dispatchJob = hermesDesignDispatchJobSchema.parse(
        candidate.dispatchJob
      );
      assertTaskIdentity(parsedCurrent, updated);
      if (dispatchJob.taskId !== updated.id) {
        throw new Error("Hermes design dispatch job does not belong to the task");
      }
      const { data, error } = await this.supabase.rpc(
        "compare_and_swap_hermes_design_task_with_dispatch",
        {
          p_organization_id: this.scope.organizationId,
          p_project_key: this.scope.projectKey,
          p_task_id: input.taskId,
          p_expected_revision: numericRevision(current.revision),
          p_task: updated,
          p_dispatch_job: dispatchJob
        }
      );
      if (error) {
        throw new Error(
          `Failed to update Hermes task with dispatch: ${error.message}`
        );
      }
      const result = firstRow<TaskDispatchUpdateResult>(data);
      if (!result) {
        throw new Error("Hermes task and dispatch update did not return a result");
      }
      if (result.updated && result.dispatch_job) {
        return {
          task: hermesDesignTaskSchema.parse(result.task),
          dispatchJob: hermesDesignDispatchJobSchema.parse(result.dispatch_job),
          dispatchCreated: result.dispatch_created === true
        };
      }
      if (result.conflict_reason === "not_found") {
        throw new Error(`Hermes design task not found: ${input.taskId}`);
      }
      if (result.conflict_reason !== "revision_conflict") {
        throw new Error(
          `Hermes task and dispatch update failed: ` +
          `${result.conflict_reason ?? "unknown conflict"}`
        );
      }
    }
    throw new Error(
      `Hermes design task ${input.taskId} changed too many times during dispatch update`
    );
  }

  async applyCallbackAtomically(
    input: HermesDesignCallbackApplyInput
  ): Promise<HermesDesignCallbackApplyResult> {
    const callback = hermesDesignCallbackSchema.parse(input.callback);
    for (let attempt = 0; attempt < MAX_ATOMIC_UPDATE_RETRIES; attempt += 1) {
      const current = await this.getTaskRow(input.taskId);
      if (!current) throw new Error(`Hermes design task not found: ${input.taskId}`);
      const parsedCurrent = hermesDesignTaskSchema.parse(current.payload);
      if (parsedCurrent.callbackIds.includes(callback.callbackId)) {
        return { task: parsedCurrent, duplicate: true };
      }
      const updated = hermesDesignTaskSchema.parse(input.update(parsedCurrent));
      assertTaskIdentity(parsedCurrent, updated);
      if (!updated.callbackIds.includes(callback.callbackId)) {
        throw new Error("Hermes callback update must persist the callback identity");
      }
      const { data, error } = await this.supabase.rpc("apply_hermes_design_callback", {
        p_organization_id: this.scope.organizationId,
        p_project_key: this.scope.projectKey,
        p_task_id: input.taskId,
        p_callback_id: callback.callbackId,
        p_expected_revision: numericRevision(current.revision),
        p_task: updated,
        p_callback: callback
      });
      if (error) throw new Error(`Failed to apply Hermes design callback: ${error.message}`);
      const result = firstRow<CallbackApplyResult>(data);
      if (!result) throw new Error("Hermes design callback did not return a result");
      if (result.duplicate) {
        return {
          task: hermesDesignTaskSchema.parse(result.task),
          duplicate: true
        };
      }
      if (result.applied) {
        return {
          task: hermesDesignTaskSchema.parse(result.task),
          duplicate: false
        };
      }
      if (result.conflict_reason === "not_found") {
        throw new Error(`Hermes design task not found: ${input.taskId}`);
      }
      if (result.conflict_reason !== "revision_conflict") {
        throw new Error(
          `Hermes design callback failed: ${result.conflict_reason ?? "unknown conflict"}`
        );
      }
    }
    throw new Error(
      `Hermes design task ${input.taskId} changed too many times during callback`
    );
  }

  async acceptCallbackJobAtomically(
    input: HermesDesignCallbackJobAcceptInput
  ): Promise<HermesDesignCallbackJobAcceptResult> {
    const job = hermesDesignCallbackJobSchema.parse(input.job);
    if (input.machineRequest) {
      if (
        input.machineRequest.organizationId !== this.scope.organizationId ||
        input.machineRequest.projectKey !== this.scope.projectKey
      ) {
        throw new Error("Hermes callback machine scope does not match the design store");
      }
      if (input.machineRequest.requestHash !== job.requestHash) {
        throw new Error("Hermes callback machine request hash does not match the job");
      }
      const { data, error } = await this.supabase.rpc(
        "authorize_and_enqueue_hermes_design_callback",
        {
          p_organization_id: this.scope.organizationId,
          p_project_key: this.scope.projectKey,
          p_credential_id: input.machineRequest.credentialId,
          p_capability: input.machineRequest.capability,
          p_request_id: input.machineRequest.requestId,
          p_request_hash: input.machineRequest.requestHash,
          p_requested_at: input.machineRequest.requestedAt,
          p_rate_limit: input.machineRequest.rateLimit,
          p_job: job
        }
      );
      if (error) {
        throw new Error(
          `Failed to authorize and enqueue Hermes callback: ${error.message}`
        );
      }
      return parseCallbackAcceptance(data);
    }

    const { data, error } = await this.supabase.rpc(
      "enqueue_hermes_design_callback_job",
      {
        p_organization_id: this.scope.organizationId,
        p_project_key: this.scope.projectKey,
        p_job: job
      }
    );
    if (error) {
      throw new Error(`Failed to enqueue Hermes design callback: ${error.message}`);
    }
    const result = firstRow<{
      job: unknown;
      created: boolean;
      revision: number | string;
    }>(data);
    if (!result || typeof result.created !== "boolean") {
      throw new Error("Hermes callback enqueue did not return an atomic result");
    }
    return {
      authorized: true,
      reason: result.created ? "accepted" : "duplicate",
      created: result.created,
      job: hermesDesignCallbackJobSchema.parse(result.job)
    };
  }

  async getCallbackJob(
    jobId: string
  ): Promise<HermesDesignCallbackJob | undefined> {
    const row = await this.getCallbackJobRow(jobId);
    return row ? hermesDesignCallbackJobSchema.parse(row.payload) : undefined;
  }

  async listCallbackJobs(
    filters: HermesDesignCallbackJobFilters = {}
  ): Promise<HermesDesignCallbackJob[]> {
    const jobs: HermesDesignCallbackJob[] = [];
    for (let offset = 0; ; offset += PAGE_SIZE) {
      let query = this.supabase
        .from("hermes_design_callback_jobs")
        .select("payload")
        .eq("organization_id", this.scope.organizationId)
        .eq("project_key", this.scope.projectKey);
      if (filters.taskId) query = query.eq("task_id", filters.taskId);
      if (filters.callbackId) query = query.eq("callback_id", filters.callbackId);
      if (filters.status) query = query.eq("status", filters.status);
      const { data, error } = await query
        .order("next_run_at", { ascending: true })
        .order("created_at", { ascending: true })
        .range(offset, offset + PAGE_SIZE - 1);
      if (error) {
        throw new Error(`Failed to list Hermes design callback jobs: ${error.message}`);
      }
      const page = (data ?? []) as Array<{ payload: unknown }>;
      jobs.push(...page.map((row) =>
        hermesDesignCallbackJobSchema.parse(row.payload)
      ));
      if (page.length < PAGE_SIZE) return jobs;
    }
  }

  async claimDueCallbackJobsAtomically(
    input: HermesDesignCallbackJobClaimInput
  ): Promise<HermesDesignCallbackJob[]> {
    const { data, error } = await this.supabase.rpc(
      "claim_hermes_design_callback_jobs",
      {
        p_organization_id: this.scope.organizationId,
        p_project_key: this.scope.projectKey,
        p_claimed_by: input.claimedBy,
        p_now: input.now.toISOString(),
        p_lease_seconds: Math.min(3600, Math.max(30, input.leaseSeconds)),
        p_limit: Math.min(100, Math.max(1, input.limit))
      }
    );
    if (error) {
      throw new Error(`Failed to claim Hermes design callback jobs: ${error.message}`);
    }
    return (Array.isArray(data) ? data : []).map((row) =>
      hermesDesignCallbackJobSchema.parse(
        isRecord(row) && "job" in row ? row.job : row
      )
    );
  }

  async updateCallbackJobAtomically(
    input: HermesDesignCallbackJobUpdateInput
  ): Promise<HermesDesignCallbackJob> {
    for (let attempt = 0; attempt < MAX_ATOMIC_UPDATE_RETRIES; attempt += 1) {
      const current = await this.getCallbackJobRow(input.jobId);
      if (!current) {
        throw new Error(`Hermes design callback job not found: ${input.jobId}`);
      }
      const parsedCurrent = hermesDesignCallbackJobSchema.parse(current.payload);
      if (
        input.expectedLeaseToken &&
        parsedCurrent.lease?.leaseToken !== input.expectedLeaseToken
      ) {
        throw new Error(`Hermes design callback job lease lost: ${input.jobId}`);
      }
      const updated = hermesDesignCallbackJobSchema.parse(input.update(parsedCurrent));
      assertCallbackJobIdentity(parsedCurrent, updated);
      const { data, error } = await this.supabase.rpc(
        "compare_and_swap_hermes_design_callback_job",
        {
          p_organization_id: this.scope.organizationId,
          p_project_key: this.scope.projectKey,
          p_job_id: input.jobId,
          p_expected_revision: numericRevision(current.revision),
          p_expected_lease_token: input.expectedLeaseToken ?? null,
          p_job: updated
        }
      );
      if (error) {
        throw new Error(`Failed to update Hermes design callback job: ${error.message}`);
      }
      const result = firstRow<CallbackJobUpdateResult>(data);
      if (!result) throw new Error("Hermes callback job update did not return a result");
      if (result.updated) return hermesDesignCallbackJobSchema.parse(result.job);
      if (result.conflict_reason === "not_found") {
        throw new Error(`Hermes design callback job not found: ${input.jobId}`);
      }
      if (result.conflict_reason === "lease_lost") {
        throw new Error(`Hermes design callback job lease lost: ${input.jobId}`);
      }
      if (result.conflict_reason !== "revision_conflict") {
        throw new Error(
          `Hermes callback job update failed: ` +
          `${result.conflict_reason ?? "unknown conflict"}`
        );
      }
    }
    throw new Error(
      `Hermes callback job ${input.jobId} changed too many times during atomic update`
    );
  }

  async enqueueDispatchJobAtomically(
    job: HermesDesignDispatchJob
  ): Promise<HermesDesignDispatchJobCreateResult> {
    const parsed = hermesDesignDispatchJobSchema.parse(job);
    const { data, error } = await this.supabase.rpc(
      "enqueue_hermes_design_dispatch_job",
      {
        p_organization_id: this.scope.organizationId,
        p_project_key: this.scope.projectKey,
        p_job: parsed
      }
    );
    if (error) {
      throw new Error(`Failed to enqueue Hermes design dispatch job: ${error.message}`);
    }
    const result = firstRow<DispatchCreateResult>(data);
    if (!result || typeof result.created !== "boolean") {
      throw new Error("Hermes design dispatch enqueue did not return an atomic result");
    }
    return {
      job: hermesDesignDispatchJobSchema.parse(result.job),
      created: result.created
    };
  }

  async getDispatchJob(
    jobId: string
  ): Promise<HermesDesignDispatchJob | undefined> {
    const row = await this.getDispatchJobRow(jobId);
    return row ? hermesDesignDispatchJobSchema.parse(row.payload) : undefined;
  }

  async listDispatchJobs(
    filters: HermesDesignDispatchJobFilters = {}
  ): Promise<HermesDesignDispatchJob[]> {
    const jobs: HermesDesignDispatchJob[] = [];
    for (let offset = 0; ; offset += PAGE_SIZE) {
      let query = this.supabase
        .from("hermes_design_dispatch_jobs")
        .select("payload")
        .eq("organization_id", this.scope.organizationId)
        .eq("project_key", this.scope.projectKey);
      if (filters.taskId) query = query.eq("task_id", filters.taskId);
      if (filters.status) query = query.eq("status", filters.status);
      const { data, error } = await query
        .order("next_run_at", { ascending: true })
        .order("created_at", { ascending: true })
        .range(offset, offset + PAGE_SIZE - 1);
      if (error) {
        throw new Error(`Failed to list Hermes design dispatch jobs: ${error.message}`);
      }
      const page = (data ?? []) as Array<{ payload: unknown }>;
      jobs.push(...page.map((row) =>
        hermesDesignDispatchJobSchema.parse(row.payload)
      ));
      if (page.length < PAGE_SIZE) return jobs;
    }
  }

  async claimDueDispatchJobsAtomically(
    input: HermesDesignDispatchJobClaimInput
  ): Promise<HermesDesignDispatchJob[]> {
    const { data, error } = await this.supabase.rpc(
      "claim_hermes_design_dispatch_jobs",
      {
        p_organization_id: this.scope.organizationId,
        p_project_key: this.scope.projectKey,
        p_claimed_by: input.claimedBy,
        p_now: input.now.toISOString(),
        p_lease_seconds: Math.min(3600, Math.max(30, input.leaseSeconds)),
        p_limit: Math.min(100, Math.max(1, input.limit))
      }
    );
    if (error) {
      throw new Error(`Failed to claim Hermes design dispatch jobs: ${error.message}`);
    }
    return (Array.isArray(data) ? data : []).map((row) =>
      hermesDesignDispatchJobSchema.parse(
        isRecord(row) && "job" in row ? row.job : row
      )
    );
  }

  async updateDispatchJobAtomically(
    input: HermesDesignDispatchJobUpdateInput
  ): Promise<HermesDesignDispatchJob> {
    for (let attempt = 0; attempt < MAX_ATOMIC_UPDATE_RETRIES; attempt += 1) {
      const current = await this.getDispatchJobRow(input.jobId);
      if (!current) {
        throw new Error(`Hermes design dispatch job not found: ${input.jobId}`);
      }
      const parsedCurrent = hermesDesignDispatchJobSchema.parse(current.payload);
      if (
        input.expectedLeaseToken &&
        parsedCurrent.lease?.leaseToken !== input.expectedLeaseToken
      ) {
        throw new Error(`Hermes design dispatch job lease lost: ${input.jobId}`);
      }
      const updated = hermesDesignDispatchJobSchema.parse(input.update(parsedCurrent));
      assertDispatchJobIdentity(parsedCurrent, updated);
      const { data, error } = await this.supabase.rpc(
        "compare_and_swap_hermes_design_dispatch_job",
        {
          p_organization_id: this.scope.organizationId,
          p_project_key: this.scope.projectKey,
          p_job_id: input.jobId,
          p_expected_revision: numericRevision(current.revision),
          p_expected_lease_token: input.expectedLeaseToken ?? null,
          p_job: updated
        }
      );
      if (error) {
        throw new Error(`Failed to update Hermes design dispatch job: ${error.message}`);
      }
      const result = firstRow<DispatchUpdateResult>(data);
      if (!result) throw new Error("Hermes design dispatch update did not return a result");
      if (result.updated) return hermesDesignDispatchJobSchema.parse(result.job);
      if (result.conflict_reason === "not_found") {
        throw new Error(`Hermes design dispatch job not found: ${input.jobId}`);
      }
      if (result.conflict_reason === "lease_lost") {
        throw new Error(`Hermes design dispatch job lease lost: ${input.jobId}`);
      }
      if (result.conflict_reason !== "revision_conflict") {
        throw new Error(
          `Hermes design dispatch update failed: ${result.conflict_reason ?? "unknown conflict"}`
        );
      }
    }
    throw new Error(
      `Hermes design dispatch job ${input.jobId} changed too many times during atomic update`
    );
  }

  private async getTaskRow(taskId: string): Promise<DesignTaskRow | null> {
    const { data, error } = await this.supabase
      .from("hermes_design_tasks")
      .select("payload, revision")
      .eq("organization_id", this.scope.organizationId)
      .eq("project_key", this.scope.projectKey)
      .eq("task_id", taskId)
      .maybeSingle();
    if (error) throw new Error(`Failed to load Hermes design task: ${error.message}`);
    return data ? data as DesignTaskRow : null;
  }

  private async getDispatchJobRow(jobId: string): Promise<DispatchJobRow | null> {
    const { data, error } = await this.supabase
      .from("hermes_design_dispatch_jobs")
      .select("payload, revision")
      .eq("organization_id", this.scope.organizationId)
      .eq("project_key", this.scope.projectKey)
      .eq("job_id", jobId)
      .maybeSingle();
    if (error) {
      throw new Error(`Failed to load Hermes design dispatch job: ${error.message}`);
    }
    return data ? data as DispatchJobRow : null;
  }

  private async getCallbackJobRow(jobId: string): Promise<CallbackJobRow | null> {
    const { data, error } = await this.supabase
      .from("hermes_design_callback_jobs")
      .select("payload, revision")
      .eq("organization_id", this.scope.organizationId)
      .eq("project_key", this.scope.projectKey)
      .eq("job_id", jobId)
      .maybeSingle();
    if (error) {
      throw new Error(`Failed to load Hermes design callback job: ${error.message}`);
    }
    return data ? data as CallbackJobRow : null;
  }
}

export function isSupabaseHermesDesignStoreEnabled(
  env: NodeJS.ProcessEnv = process.env
): boolean {
  return Boolean(
    env.NEXT_PUBLIC_SUPABASE_URL &&
    env.SUPABASE_SERVICE_ROLE_KEY &&
    env.LOOPGRAPH_HOSTED_ORGANIZATION_ID
  );
}

export function createSupabaseHermesDesignStore(
  env: NodeJS.ProcessEnv = process.env
): SupabaseHermesDesignStore {
  const supabase = createSupabaseAdminClient();
  const organizationId = env.LOOPGRAPH_HOSTED_ORGANIZATION_ID?.trim();
  const projectKey = env.LOOPGRAPH_HOSTED_PROJECT_KEY?.trim() || "default";
  if (!supabase || !organizationId) {
    throw new Error(
      "Supabase Hermes design storage requires NEXT_PUBLIC_SUPABASE_URL, " +
      "SUPABASE_SERVICE_ROLE_KEY, and LOOPGRAPH_HOSTED_ORGANIZATION_ID"
    );
  }
  return new SupabaseHermesDesignStore(supabase, { organizationId, projectKey });
}

function assertScope(scope: SupabaseHermesDesignStoreScope): void {
  if (!UUID_PATTERN.test(scope.organizationId)) {
    throw new Error("Hosted Hermes design organization ID must be a UUID");
  }
  if (!PROJECT_KEY_PATTERN.test(scope.projectKey)) {
    throw new Error("Hosted Hermes design project key is invalid");
  }
}

function assertTaskIdentity(current: HermesDesignTask, updated: HermesDesignTask): void {
  if (
    updated.id !== current.id ||
    updated.idempotencyKey !== current.idempotencyKey ||
    updated.sessionId !== current.sessionId ||
    updated.companyId !== current.companyId
  ) {
    throw new Error("Hermes design task identity cannot change");
  }
}

function assertDispatchJobIdentity(
  current: HermesDesignDispatchJob,
  updated: HermesDesignDispatchJob
): void {
  if (
    updated.id !== current.id ||
    updated.idempotencyKey !== current.idempotencyKey ||
    updated.taskId !== current.taskId
  ) {
    throw new Error("Hermes design dispatch job identity cannot change");
  }
}

function assertCallbackJobIdentity(
  current: HermesDesignCallbackJob,
  updated: HermesDesignCallbackJob
): void {
  if (
    updated.id !== current.id ||
    updated.idempotencyKey !== current.idempotencyKey ||
    updated.taskId !== current.taskId ||
    updated.callbackId !== current.callbackId ||
    updated.requestHash !== current.requestHash
  ) {
    throw new Error("Hermes design callback job identity cannot change");
  }
}

function numericRevision(value: number | string): number {
  const revision = Number(value);
  if (!Number.isSafeInteger(revision) || revision < 1) {
    throw new Error("Hermes design task revision is invalid");
  }
  return revision;
}

function firstRow<T>(value: unknown): T | undefined {
  return Array.isArray(value) ? value[0] as T | undefined : undefined;
}

function parseCallbackAcceptance(
  value: unknown
): HermesDesignCallbackJobAcceptResult {
  const result = firstRow<CallbackJobAcceptResult>(value);
  if (!result || typeof result.authorized !== "boolean") {
    throw new Error("Hermes callback acceptance did not return an atomic result");
  }
  return {
    authorized: result.authorized,
    reason: typeof result.reason === "string" ? result.reason : "guard_rejected",
    created: result.created === true,
    ...(result.job
      ? { job: hermesDesignCallbackJobSchema.parse(result.job) }
      : {}),
    ...(typeof result.retry_after_seconds === "number"
      ? { retryAfterSeconds: result.retry_after_seconds }
      : {})
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
