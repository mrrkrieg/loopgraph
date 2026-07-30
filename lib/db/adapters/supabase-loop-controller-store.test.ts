import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";
import {
  loopControllerTriggerRecordSchema
} from "loopgraph/core";
import {
  SupabaseLoopControllerStore,
  isSupabaseLoopControllerStoreEnabled
} from "./supabase-loop-controller-store";

const scope = {
  organizationId: "123e4567-e89b-12d3-a456-426614174000",
  projectKey: "main"
};

describe("Supabase loop controller store", () => {
  it("requires service storage and validates tenant scope", () => {
    expect(isSupabaseLoopControllerStoreEnabled({
      NEXT_PUBLIC_SUPABASE_URL: "https://example.supabase.co",
      SUPABASE_SERVICE_ROLE_KEY: "service",
      LOOPGRAPH_HOSTED_ORGANIZATION_ID: scope.organizationId
    })).toBe(true);
    const client = { rpc: vi.fn(), from: vi.fn() } as unknown as SupabaseClient;
    expect(() => new SupabaseLoopControllerStore(client, {
      organizationId: "../other",
      projectKey: "main"
    })).toThrow("organization ID");
  });

  it("enqueues, claims, and settles through lease-safe RPCs", async () => {
    const pending = triggerRecord();
    const claimed = loopControllerTriggerRecordSchema.parse({
      ...pending,
      status: "processing",
      attempts: 1,
      leaseId: "123e4567-e89b-42d3-a456-426614174111",
      leaseExpiresAt: "2026-07-30T12:05:00.000Z",
      updatedAt: "2026-07-30T12:00:00.000Z"
    });
    const completed = loopControllerTriggerRecordSchema.parse({
      ...claimed,
      status: "completed",
      completedAt: "2026-07-30T12:01:00.000Z",
      updatedAt: "2026-07-30T12:01:00.000Z",
      leaseId: undefined,
      leaseExpiresAt: undefined
    });
    const rpc = vi.fn(async (name: string) => {
      if (name === "enqueue_loop_controller_trigger") {
        return { data: [{ record: pending, duplicate: false }], error: null };
      }
      if (name === "claim_loop_controller_triggers") {
        return { data: [claimed], error: null };
      }
      if (name === "settle_loop_controller_trigger") {
        return { data: completed, error: null };
      }
      return { data: true, error: null };
    });
    const store = new SupabaseLoopControllerStore(
      { rpc, from: vi.fn() } as unknown as SupabaseClient,
      scope
    );

    await expect(store.enqueueTrigger(pending)).resolves.toMatchObject({
      duplicate: false,
      record: { id: pending.id }
    });
    await expect(store.claimTriggers({
      limit: 10,
      maxAttempts: 3,
      leaseSeconds: 300,
      now: new Date("2026-07-30T12:00:00.000Z")
    })).resolves.toEqual([claimed]);
    await store.settleTrigger(completed, claimed.leaseId!);

    expect(rpc).toHaveBeenCalledWith("claim_loop_controller_triggers", {
      p_organization_id: scope.organizationId,
      p_project_key: scope.projectKey,
      p_limit: 10,
      p_max_attempts: 3,
      p_lease_seconds: 300,
      p_now: "2026-07-30T12:00:00.000Z"
    });
    expect(rpc).toHaveBeenCalledWith("settle_loop_controller_trigger", {
      p_organization_id: scope.organizationId,
      p_project_key: scope.projectKey,
      p_trigger_record_id: completed.id,
      p_expected_lease_id: claimed.leaseId,
      p_payload: completed
    });
  });

  it("uses a renewable database lease around controller execution", async () => {
    const rpc = vi.fn(async (name: string) => ({
      data: [
        "acquire_loop_controller_lease",
        "renew_loop_controller_lease",
        "release_loop_controller_lease"
      ].includes(name),
      error: null
    }));
    const store = new SupabaseLoopControllerStore(
      { rpc, from: vi.fn() } as unknown as SupabaseClient,
      scope
    );

    await expect(store.withControllerLock(async () => "done"))
      .resolves.toBe("done");
    expect(rpc.mock.calls.map((call) => call[0])).toEqual([
      "acquire_loop_controller_lease",
      "release_loop_controller_lease"
    ]);
  });
});

function triggerRecord() {
  return loopControllerTriggerRecordSchema.parse({
    id: "controller_trigger_1",
    projectRootId: "project_1",
    trigger: {
      type: "schedule",
      id: "schedule_1",
      occurredAt: "2026-07-30T12:00:00.000Z",
      sourceRef: "cron:controller"
    },
    status: "pending",
    attempts: 0,
    createdAt: "2026-07-30T12:00:00.000Z",
    updatedAt: "2026-07-30T12:00:00.000Z"
  });
}
