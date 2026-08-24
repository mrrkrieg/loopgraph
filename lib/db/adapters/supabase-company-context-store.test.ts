import type { SupabaseClient } from "@supabase/supabase-js";
import type { CompanyContext } from "loopgraph/core";
import { describe, expect, it, vi } from "vitest";
import { SupabaseCompanyContextStore } from "./supabase-company-context-store";

const scope = {
  organizationId: "123e4567-e89b-12d3-a456-426614174000",
  projectKey: "main",
  workspaceId: "acme",
  companyId: "acme-company"
};
const now = new Date("2026-08-21T16:00:00.000Z");

describe("Supabase company context store", () => {
  it("persists only approved context through revision-bound commits", async () => {
    const fake = new ContextSupabase();
    const store = new SupabaseCompanyContextStore(fake.client, scope);
    expect(await store.get(scope.workspaceId, scope.companyId)).toMatchObject({ revision: 0, values: [] });

    const approved = await store.approveValue({
      workspaceId: scope.workspaceId,
      companyId: scope.companyId,
      proposal: {
        key: "sales.icp",
        type: "object",
        value: { industries: ["software"] },
        provenance: { source: "hermes_inference", sourceRef: "discovery.session-1", observedAt: now.toISOString() },
        confidence: 0.9,
        owner: "revenue-operations",
        visibility: "workspace",
        explanation: "Derived from the reviewed discovery session."
      },
      approvedBy: "admin@example.com",
      expectedRevision: 0,
      now
    });

    expect(approved).toMatchObject({ revision: 1, updatedBy: "admin@example.com" });
    expect(approved.values[0]).toMatchObject({ key: "sales.icp", verified: true, confirmedBy: "admin@example.com" });
    expect(fake.rpc).toHaveBeenCalledWith("commit_loopgraph_company_context", expect.objectContaining({
      p_expected_revision: 0,
      p_action: "approve",
      p_reference: "sales.icp"
    }));
  });

  it("tracks consumers and blocks secret-like business context before the database call", async () => {
    const fake = new ContextSupabase();
    const store = new SupabaseCompanyContextStore(fake.client, scope);
    await store.approveValue({
      workspaceId: scope.workspaceId,
      companyId: scope.companyId,
      proposal: {
        key: "support.escalationPolicy",
        type: "object",
        value: { severity: "high" },
        provenance: { source: "user", observedAt: now.toISOString() },
        confidence: 1,
        owner: "support-operations",
        visibility: "workspace",
        explanation: "Approved support policy."
      },
      approvedBy: "admin@example.com",
      expectedRevision: 0,
      now
    });
    const attached = await store.attachConsumer({
      workspaceId: scope.workspaceId,
      companyId: scope.companyId,
      contextKeys: ["support.escalationPolicy"],
      installationId: "install.support",
      expectedRevision: 1,
      actor: "admin@example.com",
      now
    });
    expect(attached.values[0]?.consumerInstallationIds).toEqual(["install.support"]);
    const detached = await store.detachConsumer({
      workspaceId: scope.workspaceId,
      companyId: scope.companyId,
      installationId: "install.support",
      actor: "admin@example.com",
      now
    });
    expect(detached.values[0]?.consumerInstallationIds).toEqual([]);

    const rpcCount = fake.rpc.mock.calls.length;
    await expect(store.approveValue({
      workspaceId: scope.workspaceId,
      companyId: scope.companyId,
      proposal: {
        key: "finance.system",
        type: "object",
        value: { api_key: "sk_live_1234567890123456" },
        provenance: { source: "user", observedAt: now.toISOString() },
        confidence: 1,
        owner: "finance",
        visibility: "private",
        explanation: "Must never persist."
      },
      approvedBy: "admin@example.com",
      expectedRevision: 3,
      now
    })).rejects.toThrow(/Secret-like material was blocked/);
    expect(fake.rpc).toHaveBeenCalledTimes(rpcCount);
  });

  it("rejects cross-scope reads before querying", async () => {
    const fake = new ContextSupabase();
    const store = new SupabaseCompanyContextStore(fake.client, scope);
    await expect(store.get("other", scope.companyId)).rejects.toThrow(/hosted store scope/);
    expect(fake.from).not.toHaveBeenCalled();
  });
});

class ContextSupabase {
  row: { payload: CompanyContext } | undefined;
  from = vi.fn(() => {
    const query = {
      select: () => query,
      eq: () => query,
      maybeSingle: async () => ({ data: this.row, error: null })
    };
    return query;
  });
  rpc = vi.fn(async (name: string, args: Record<string, unknown>) => {
    if (name !== "commit_loopgraph_company_context") return { data: null, error: { message: `unknown RPC ${name}` } };
    const context = args.p_context as CompanyContext;
    const currentRevision = this.row?.payload.revision ?? 0;
    if (currentRevision !== args.p_expected_revision) return { data: null, error: { message: "revision conflict" } };
    this.row = { payload: context };
    return { data: context.revision, error: null };
  });
  client = { from: this.from, rpc: this.rpc } as unknown as SupabaseClient;
}
