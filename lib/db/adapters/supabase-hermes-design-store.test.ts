import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";
import {
  hermesDesignTaskSchema,
  type HermesDesignTask
} from "loopgraph/core";
import {
  SupabaseHermesDesignStore,
  isSupabaseHermesDesignStoreEnabled
} from "./supabase-hermes-design-store";

const scope = {
  organizationId: "123e4567-e89b-12d3-a456-426614174000",
  projectKey: "main"
};

describe("Supabase Hermes design store", () => {
  it("requires a service credential and explicit tenant binding", () => {
    expect(isSupabaseHermesDesignStoreEnabled({
      NODE_ENV: "test",
      NEXT_PUBLIC_SUPABASE_URL: "https://example.supabase.co",
      SUPABASE_SERVICE_ROLE_KEY: "service",
      LOOPGRAPH_HOSTED_ORGANIZATION_ID: ""
    } as NodeJS.ProcessEnv)).toBe(false);
    expect(isSupabaseHermesDesignStoreEnabled({
      NODE_ENV: "test",
      NEXT_PUBLIC_SUPABASE_URL: "https://example.supabase.co",
      SUPABASE_SERVICE_ROLE_KEY: "service",
      LOOPGRAPH_HOSTED_ORGANIZATION_ID: scope.organizationId
    } as NodeJS.ProcessEnv)).toBe(true);
  });

  it("rejects unsafe organization and project scopes", () => {
    const client = { rpc: vi.fn(), from: vi.fn() } as unknown as SupabaseClient;
    expect(() => new SupabaseHermesDesignStore(client, {
      organizationId: "../other",
      projectKey: "main"
    })).toThrow("organization ID");
    expect(() => new SupabaseHermesDesignStore(client, {
      organizationId: scope.organizationId,
      projectKey: "../../escape"
    })).toThrow("project key");
  });

  it("creates design tasks with a database idempotency boundary", async () => {
    const task = designTask();
    const rpc = vi.fn().mockResolvedValue({
      data: [{ task, created: false, revision: 3 }],
      error: null
    });
    const store = new SupabaseHermesDesignStore(
      { rpc, from: vi.fn() } as unknown as SupabaseClient,
      scope
    );

    const result = await store.createTaskAtomically(task);

    expect(result).toEqual({ task, created: false });
    expect(rpc).toHaveBeenCalledWith("create_hermes_design_task", {
      p_organization_id: scope.organizationId,
      p_project_key: scope.projectKey,
      p_task: task
    });
  });

  it("retries a callback CAS conflict and preserves the callback identity", async () => {
    const initial = designTask();
    const refreshed = hermesDesignTaskSchema.parse({
      ...initial,
      delivery: {
        ...initial.delivery,
        acknowledgedAt: "2026-07-30T12:00:30.000Z"
      },
      updatedAt: "2026-07-30T12:00:30.000Z"
    });
    const query = taskQuery([
      { payload: initial, revision: 1 },
      { payload: refreshed, revision: 2 }
    ]);
    const rpc = vi.fn()
      .mockResolvedValueOnce({
        data: [{
          applied: false,
          duplicate: false,
          updated: false,
          task: refreshed,
          revision: 2,
          conflict_reason: "revision_conflict"
        }],
        error: null
      })
      .mockImplementationOnce(async (_name, args: { p_task: HermesDesignTask }) => ({
        data: [{
          applied: true,
          duplicate: false,
          updated: true,
          task: args.p_task,
          revision: 3,
          conflict_reason: null
        }],
        error: null
      }));
    const store = new SupabaseHermesDesignStore(
      { rpc, from: vi.fn(() => query) } as unknown as SupabaseClient,
      scope
    );
    const callback = {
      schemaVersion: "hermes-design-callback/v1alpha1" as const,
      callbackId: "callback_1",
      taskId: initial.id,
      occurredAt: "2026-07-30T12:01:00.000Z",
      type: "task.acknowledged" as const
    };

    const result = await store.applyCallbackAtomically({
      taskId: initial.id,
      callback,
      update: (current) => hermesDesignTaskSchema.parse({
        ...current,
        callbackIds: [...current.callbackIds, callback.callbackId],
        updatedAt: callback.occurredAt
      })
    });

    expect(result.duplicate).toBe(false);
    expect(result.task.callbackIds).toEqual(["callback_1"]);
    expect(result.task.delivery.acknowledgedAt).toBe(
      refreshed.delivery.acknowledgedAt
    );
    expect(rpc).toHaveBeenCalledTimes(2);
    expect(rpc.mock.calls[0][1]).toMatchObject({ p_expected_revision: 1 });
    expect(rpc.mock.calls[1][1]).toMatchObject({ p_expected_revision: 2 });
  });
});

function designTask(): HermesDesignTask {
  return hermesDesignTaskSchema.parse({
    id: "task_1",
    idempotencyKey: "design_key_1",
    sessionId: "session_1",
    companyId: "company_1",
    department: "product",
    status: "queued",
    reason: "user_requested",
    createdAt: "2026-07-30T12:00:00.000Z",
    updatedAt: "2026-07-30T12:00:00.000Z"
  });
}

function taskQuery(rows: Array<{ payload: HermesDesignTask; revision: number }>) {
  const query = {
    select: vi.fn(() => query),
    eq: vi.fn(() => query),
    maybeSingle: vi.fn(async () => ({
      data: rows.shift() ?? null,
      error: null
    }))
  };
  return query;
}
