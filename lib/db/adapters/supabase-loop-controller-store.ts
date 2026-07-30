import "server-only";

import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  loopControllerCheckpointSchema,
  loopControllerPolicySchema,
  loopControllerRunSchema,
  loopControllerTriggerRecordSchema,
  type LoopControllerCheckpoint,
  type LoopControllerPolicy,
  type LoopControllerRun,
  type LoopControllerTriggerRecord
} from "loopgraph/core";
import type {
  ClaimControllerTriggersInput,
  ControllerRunSaveResult,
  LoopControllerStore
} from "loopgraph/runtime";
import { createSupabaseAdminClient } from "@/lib/db/supabase-admin";

const PAGE_SIZE = 500;
const CONTROLLER_LEASE_SECONDS = 300;
const CONTROLLER_RENEW_INTERVAL_MS = 60_000;
const PROJECT_KEY_PATTERN = /^[a-z0-9][a-z0-9_-]{0,63}$/;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type SupabaseLoopControllerScope = {
  organizationId: string;
  projectKey: string;
};

export class SupabaseLoopControllerStore implements LoopControllerStore {
  readonly persistence = "distributed" as const;

  constructor(
    private readonly supabase: SupabaseClient,
    private readonly scope: SupabaseLoopControllerScope
  ) {
    assertScope(scope);
  }

  async saveRun(run: LoopControllerRun): Promise<ControllerRunSaveResult> {
    const payload = loopControllerRunSchema.parse(run);
    const { data, error } = await this.supabase.rpc(
      "save_loop_controller_run",
      {
        p_organization_id: this.scope.organizationId,
        p_project_key: this.scope.projectKey,
        p_payload: payload
      }
    );
    if (error) {
      throw new Error(`Failed to save controller run: ${error.message}`);
    }
    const result = firstRow<{ run: unknown; duplicate: boolean }>(data);
    if (!result || typeof result.duplicate !== "boolean") {
      throw new Error("Controller run save returned an invalid result");
    }
    const saved = loopControllerRunSchema.parse(result.run);
    if (saved.id !== payload.id || saved.idempotencyKey !== payload.idempotencyKey) {
      throw new Error(`Controller run write returned inconsistent identity: ${payload.id}`);
    }
    return { run: saved, duplicate: result.duplicate };
  }

  async getRun(runId: string): Promise<LoopControllerRun | undefined> {
    return this.getRunBy("run_id", runId);
  }

  async findRunByIdempotencyKey(
    idempotencyKey: string
  ): Promise<LoopControllerRun | undefined> {
    return this.getRunBy("idempotency_key", idempotencyKey);
  }

  async listRuns(): Promise<LoopControllerRun[]> {
    return this.listPayloads(
      "loop_controller_runs",
      "started_at",
      loopControllerRunSchema
    );
  }

  async readCheckpoint(): Promise<LoopControllerCheckpoint | undefined> {
    return this.readState("checkpoint", loopControllerCheckpointSchema);
  }

  async saveCheckpoint(checkpoint: LoopControllerCheckpoint): Promise<void> {
    await this.saveState(
      "checkpoint",
      loopControllerCheckpointSchema.parse(checkpoint),
      loopControllerCheckpointSchema
    );
  }

  async readPolicy(): Promise<LoopControllerPolicy | undefined> {
    return this.readState("policy", loopControllerPolicySchema);
  }

  async savePolicy(policy: LoopControllerPolicy): Promise<void> {
    await this.saveState(
      "policy",
      loopControllerPolicySchema.parse(policy),
      loopControllerPolicySchema
    );
  }

  async saveTrigger(record: LoopControllerTriggerRecord): Promise<void> {
    const parsed = loopControllerTriggerRecordSchema.parse(record);
    if (parsed.status !== "pending") {
      throw new Error(
        "Distributed controller triggers must be claimed and settled through lease-safe operations"
      );
    }
    await this.enqueueTrigger(parsed);
  }

  async enqueueTrigger(record: LoopControllerTriggerRecord): Promise<{
    record: LoopControllerTriggerRecord;
    duplicate: boolean;
  }> {
    const payload = loopControllerTriggerRecordSchema.parse(record);
    const { data, error } = await this.supabase.rpc(
      "enqueue_loop_controller_trigger",
      {
        p_organization_id: this.scope.organizationId,
        p_project_key: this.scope.projectKey,
        p_payload: payload
      }
    );
    if (error) {
      throw new Error(`Failed to enqueue controller trigger: ${error.message}`);
    }
    const result = firstRow<{ record: unknown; duplicate: boolean }>(data);
    if (!result || typeof result.duplicate !== "boolean") {
      throw new Error("Controller trigger enqueue returned an invalid result");
    }
    const saved = loopControllerTriggerRecordSchema.parse(result.record);
    if (
      saved.id !== payload.id ||
      saved.projectRootId !== payload.projectRootId ||
      saved.trigger.type !== payload.trigger.type ||
      saved.trigger.id !== payload.trigger.id
    ) {
      throw new Error(`Controller trigger write returned inconsistent identity: ${payload.id}`);
    }
    return { record: saved, duplicate: result.duplicate };
  }

  async claimTriggers(
    input: ClaimControllerTriggersInput
  ): Promise<LoopControllerTriggerRecord[]> {
    const { data, error } = await this.supabase.rpc(
      "claim_loop_controller_triggers",
      {
        p_organization_id: this.scope.organizationId,
        p_project_key: this.scope.projectKey,
        p_limit: input.limit,
        p_max_attempts: input.maxAttempts,
        p_lease_seconds: input.leaseSeconds,
        p_now: input.now.toISOString()
      }
    );
    if (error) {
      throw new Error(`Failed to claim controller triggers: ${error.message}`);
    }
    if (!Array.isArray(data)) {
      throw new Error("Controller trigger claim returned an invalid result");
    }
    return data.map((value) => loopControllerTriggerRecordSchema.parse(value));
  }

  async settleTrigger(
    record: LoopControllerTriggerRecord,
    expectedLeaseId: string
  ): Promise<void> {
    const payload = loopControllerTriggerRecordSchema.parse(record);
    const { data, error } = await this.supabase.rpc(
      "settle_loop_controller_trigger",
      {
        p_organization_id: this.scope.organizationId,
        p_project_key: this.scope.projectKey,
        p_trigger_record_id: payload.id,
        p_expected_lease_id: expectedLeaseId,
        p_payload: payload
      }
    );
    if (error) {
      throw new Error(`Failed to settle controller trigger: ${error.message}`);
    }
    const saved = loopControllerTriggerRecordSchema.parse(data);
    if (saved.id !== payload.id || saved.status !== payload.status) {
      throw new Error(`Controller trigger settlement returned inconsistent state: ${payload.id}`);
    }
  }

  async getTrigger(
    triggerRecordId: string
  ): Promise<LoopControllerTriggerRecord | undefined> {
    const { data, error } = await this.supabase
      .from("loop_controller_triggers")
      .select("payload")
      .eq("organization_id", this.scope.organizationId)
      .eq("project_key", this.scope.projectKey)
      .eq("trigger_record_id", triggerRecordId)
      .maybeSingle();
    if (error) {
      throw new Error(`Failed to read controller trigger: ${error.message}`);
    }
    return data
      ? loopControllerTriggerRecordSchema.parse(
          (data as { payload: unknown }).payload
        )
      : undefined;
  }

  async listTriggers(
    status?: LoopControllerTriggerRecord["status"]
  ): Promise<LoopControllerTriggerRecord[]> {
    const values: LoopControllerTriggerRecord[] = [];
    for (let offset = 0; ; offset += PAGE_SIZE) {
      let query = this.supabase
        .from("loop_controller_triggers")
        .select("payload")
        .eq("organization_id", this.scope.organizationId)
        .eq("project_key", this.scope.projectKey);
      if (status) query = query.eq("status", status);
      const { data, error } = await query
        .order("created_at", { ascending: true })
        .order("trigger_record_id", { ascending: true })
        .range(offset, offset + PAGE_SIZE - 1);
      if (error) {
        throw new Error(`Failed to list controller triggers: ${error.message}`);
      }
      const page = (data ?? []) as Array<{ payload: unknown }>;
      values.push(
        ...page.map((row) => loopControllerTriggerRecordSchema.parse(row.payload))
      );
      if (page.length < PAGE_SIZE) return values;
    }
  }

  async withControllerLock<T>(operation: () => Promise<T>): Promise<T> {
    return this.withLease("controller", operation);
  }

  async withTriggerLock<T>(operation: () => Promise<T>): Promise<T> {
    return this.withLease("triggers", operation);
  }

  private async getRunBy(
    field: "run_id" | "idempotency_key",
    value: string
  ): Promise<LoopControllerRun | undefined> {
    const { data, error } = await this.supabase
      .from("loop_controller_runs")
      .select("payload")
      .eq("organization_id", this.scope.organizationId)
      .eq("project_key", this.scope.projectKey)
      .eq(field, value)
      .maybeSingle();
    if (error) {
      throw new Error(`Failed to read controller run: ${error.message}`);
    }
    return data
      ? loopControllerRunSchema.parse((data as { payload: unknown }).payload)
      : undefined;
  }

  private async readState<T>(
    stateType: "policy" | "checkpoint",
    schema: { parse(value: unknown): T }
  ): Promise<T | undefined> {
    const { data, error } = await this.supabase
      .from("loop_controller_state")
      .select("payload")
      .eq("organization_id", this.scope.organizationId)
      .eq("project_key", this.scope.projectKey)
      .eq("state_type", stateType)
      .maybeSingle();
    if (error) {
      throw new Error(`Failed to read controller ${stateType}: ${error.message}`);
    }
    return data
      ? schema.parse((data as { payload: unknown }).payload)
      : undefined;
  }

  private async saveState<T>(
    stateType: "policy" | "checkpoint",
    payload: T,
    schema: { parse(value: unknown): T }
  ): Promise<void> {
    const { data, error } = await this.supabase.rpc(
      "save_loop_controller_state",
      {
        p_organization_id: this.scope.organizationId,
        p_project_key: this.scope.projectKey,
        p_state_type: stateType,
        p_payload: payload
      }
    );
    if (error) {
      throw new Error(`Failed to save controller ${stateType}: ${error.message}`);
    }
    schema.parse(data);
  }

  private async listPayloads<T>(
    table: string,
    orderColumn: string,
    schema: { parse(value: unknown): T }
  ): Promise<T[]> {
    const values: T[] = [];
    for (let offset = 0; ; offset += PAGE_SIZE) {
      const { data, error } = await this.supabase
        .from(table)
        .select("payload")
        .eq("organization_id", this.scope.organizationId)
        .eq("project_key", this.scope.projectKey)
        .order(orderColumn, { ascending: false })
        .range(offset, offset + PAGE_SIZE - 1);
      if (error) {
        throw new Error(`Failed to list ${table}: ${error.message}`);
      }
      const page = (data ?? []) as Array<{ payload: unknown }>;
      values.push(...page.map((row) => schema.parse(row.payload)));
      if (page.length < PAGE_SIZE) return values;
    }
  }

  private async withLease<T>(
    lockName: string,
    operation: () => Promise<T>
  ): Promise<T> {
    const leaseId = randomUUID();
    const acquired = await this.leaseRpc(
      "acquire_loop_controller_lease",
      lockName,
      leaseId
    );
    if (!acquired) {
      throw new Error(`Loop controller ${lockName} lease is already owned`);
    }
    let leaseError: Error | undefined;
    const timer = setInterval(() => {
      void this.leaseRpc(
        "renew_loop_controller_lease",
        lockName,
        leaseId
      ).then((renewed) => {
        if (!renewed) {
          leaseError = new Error(
            `Loop controller ${lockName} lease was lost during execution`
          );
        }
      }).catch((error: unknown) => {
        leaseError = error instanceof Error ? error : new Error(String(error));
      });
    }, CONTROLLER_RENEW_INTERVAL_MS);
    timer.unref();
    try {
      const result = await operation();
      if (leaseError) throw leaseError;
      return result;
    } finally {
      clearInterval(timer);
      await this.releaseLease(lockName, leaseId).catch(() => undefined);
    }
  }

  private async leaseRpc(
    functionName:
      | "acquire_loop_controller_lease"
      | "renew_loop_controller_lease",
    lockName: string,
    leaseId: string
  ): Promise<boolean> {
    const { data, error } = await this.supabase.rpc(functionName, {
      p_organization_id: this.scope.organizationId,
      p_project_key: this.scope.projectKey,
      p_lock_name: lockName,
      p_lease_id: leaseId,
      p_lease_seconds: CONTROLLER_LEASE_SECONDS,
      p_now: new Date().toISOString()
    });
    if (error) {
      throw new Error(`Failed to ${functionName}: ${error.message}`);
    }
    return data === true;
  }

  private async releaseLease(
    lockName: string,
    leaseId: string
  ): Promise<void> {
    const { error } = await this.supabase.rpc(
      "release_loop_controller_lease",
      {
        p_organization_id: this.scope.organizationId,
        p_project_key: this.scope.projectKey,
        p_lock_name: lockName,
        p_lease_id: leaseId
      }
    );
    if (error) {
      throw new Error(`Failed to release controller lease: ${error.message}`);
    }
  }
}

export function isSupabaseLoopControllerStoreEnabled(
  env: Record<string, string | undefined> = process.env
): boolean {
  return Boolean(
    env.NEXT_PUBLIC_SUPABASE_URL &&
      env.SUPABASE_SERVICE_ROLE_KEY &&
      env.LOOPGRAPH_HOSTED_ORGANIZATION_ID
  );
}

export function createSupabaseLoopControllerStore(): LoopControllerStore {
  const supabase = createSupabaseAdminClient();
  const organizationId =
    process.env.LOOPGRAPH_HOSTED_ORGANIZATION_ID?.trim();
  const projectKey =
    process.env.LOOPGRAPH_HOSTED_PROJECT_KEY?.trim() || "default";
  if (!supabase || !organizationId) {
    throw new Error(
      "Supabase loop controller storage requires LOOPGRAPH_HOSTED_ORGANIZATION_ID"
    );
  }
  return new SupabaseLoopControllerStore(supabase, {
    organizationId,
    projectKey
  });
}

function firstRow<T>(value: unknown): T | undefined {
  if (Array.isArray(value)) return value[0] as T | undefined;
  return value && typeof value === "object" ? value as T : undefined;
}

function assertScope(scope: SupabaseLoopControllerScope) {
  if (!UUID_PATTERN.test(scope.organizationId)) {
    throw new Error("Loop controller organization ID must be a UUID");
  }
  if (!PROJECT_KEY_PATTERN.test(scope.projectKey)) {
    throw new Error("Loop controller project key is invalid");
  }
}
