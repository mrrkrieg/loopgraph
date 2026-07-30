import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  hermesDesignCallbackSchema,
  hermesDesignTaskSchema,
  type HermesDesignTask
} from "loopgraph/core";
import type {
  HermesDesignCallbackApplyInput,
  HermesDesignCallbackApplyResult,
  HermesDesignStore,
  HermesDesignTaskCreateResult,
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
    task: HermesDesignTask
  ): Promise<HermesDesignTaskCreateResult> {
    const parsed = hermesDesignTaskSchema.parse(task);
    const { data, error } = await this.supabase.rpc("create_hermes_design_task", {
      p_organization_id: this.scope.organizationId,
      p_project_key: this.scope.projectKey,
      p_task: parsed
    });
    if (error) throw new Error(`Failed to create Hermes design task: ${error.message}`);
    const result = firstRow<TaskCreateResult>(data);
    if (!result || typeof result.created !== "boolean") {
      throw new Error("Hermes design task creation did not return an atomic result");
    }
    return {
      task: hermesDesignTaskSchema.parse(result.task),
      created: result.created
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
