import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";
import {
  graphChangeSetSchema,
  loopOpportunitySchema
} from "loopgraph/core";
import {
  SupabaseLoopOpportunityStore,
  isSupabaseLoopOpportunityStoreEnabled
} from "./supabase-loop-opportunity-store";

const scope = {
  organizationId: "123e4567-e89b-12d3-a456-426614174000",
  projectKey: "main"
};

describe("Supabase loop opportunity store", () => {
  it("requires service storage and rejects unsafe tenant scopes", () => {
    expect(isSupabaseLoopOpportunityStoreEnabled({
      NEXT_PUBLIC_SUPABASE_URL: "https://example.supabase.co",
      SUPABASE_SERVICE_ROLE_KEY: "service",
      LOOPGRAPH_HOSTED_ORGANIZATION_ID: scope.organizationId
    })).toBe(true);
    const client = { rpc: vi.fn(), from: vi.fn() } as unknown as SupabaseClient;
    expect(() => new SupabaseLoopOpportunityStore(client, {
      organizationId: "../other",
      projectKey: "main"
    })).toThrow("organization ID");
    expect(() => new SupabaseLoopOpportunityStore(client, {
      organizationId: scope.organizationId,
      projectKey: "../../escape"
    })).toThrow("project key");
  });

  it("validates opportunity and graph-change identities returned by RPCs", async () => {
    const opportunity = testOpportunity();
    const changeSet = testChangeSet();
    const rpc = vi.fn(async (name: string) => ({
      data: name === "upsert_loop_opportunity" ? opportunity : changeSet,
      error: null
    }));
    const store = new SupabaseLoopOpportunityStore(
      { rpc, from: vi.fn() } as unknown as SupabaseClient,
      scope
    );

    await store.saveOpportunity(opportunity);
    await store.saveGraphChangeSet(changeSet);

    expect(rpc).toHaveBeenNthCalledWith(1, "upsert_loop_opportunity", {
      p_organization_id: scope.organizationId,
      p_project_key: scope.projectKey,
      p_payload: opportunity
    });
    expect(rpc).toHaveBeenNthCalledWith(2, "upsert_loop_graph_change_set", {
      p_organization_id: scope.organizationId,
      p_project_key: scope.projectKey,
      p_payload: changeSet
    });
  });

  it("pushes opportunity filters into the tenant-scoped query", async () => {
    const opportunity = testOpportunity();
    const query = paginatedQuery([{ payload: opportunity }]);
    const store = new SupabaseLoopOpportunityStore(
      {
        rpc: vi.fn(),
        from: vi.fn((table: string) => {
          expect(table).toBe("loop_opportunities");
          return query;
        })
      } as unknown as SupabaseClient,
      scope
    );

    await expect(store.listOpportunities({
      status: "qualified",
      department: "product",
      minimumScore: 60
    })).resolves.toEqual([opportunity]);
    expect(query.eq).toHaveBeenCalledWith("organization_id", scope.organizationId);
    expect(query.eq).toHaveBeenCalledWith("project_key", scope.projectKey);
    expect(query.eq).toHaveBeenCalledWith("status", "qualified");
    expect(query.eq).toHaveBeenCalledWith("department", "product");
    expect(query.gte).toHaveBeenCalledWith("score", 60);
  });
});

function paginatedQuery(rows: unknown[]) {
  const query = {
    select: vi.fn(() => query),
    eq: vi.fn(() => query),
    gte: vi.fn(() => query),
    order: vi.fn(() => query),
    range: vi.fn(async () => ({ data: rows, error: null }))
  };
  return query;
}

function testOpportunity() {
  return loopOpportunitySchema.parse({
    id: "opportunity_product_feedback",
    fingerprint: "feedback_unowned",
    generation: 1,
    workspaceId: "workspace_1",
    companyId: "company_1",
    department: "product",
    kind: "create_loop",
    status: "qualified",
    problemType: "product_feedback_unowned",
    title: "Create a feedback loop",
    summary: "Feedback has no owner.",
    signals: [{
      id: "signal_1",
      type: "unhandled_problem",
      sourceRef: "problem:1",
      occurredAt: "2026-07-30T12:00:00.000Z",
      summary: "Feedback has no owner.",
      severity: "high"
    }],
    score: {
      total: 75,
      recurrence: 20,
      businessImpact: 20,
      coverageGap: 25,
      evidenceConfidence: 10,
      humanFriction: 5,
      riskPenalty: 5,
      explanation: ["Recurring feedback lacks a loop."]
    },
    thresholds: { qualify: 45, autoDesign: 65 },
    firstObservedAt: "2026-07-30T12:00:00.000Z",
    lastObservedAt: "2026-07-30T12:00:00.000Z",
    createdAt: "2026-07-30T12:01:00.000Z",
    updatedAt: "2026-07-30T12:01:00.000Z"
  });
}

function testChangeSet() {
  return graphChangeSetSchema.parse({
    id: "graph_change_1",
    version: 1,
    workspaceId: "workspace_1",
    companyId: "company_1",
    baseGraphHash: "graph_hash_1",
    opportunityId: "opportunity_product_feedback",
    status: "proposed",
    changes: [{
      id: "change_1",
      operation: "add",
      department: "product",
      proposedLoopCount: 1,
      title: "Create a feedback loop",
      rationale: "Feedback has no owner.",
      expectedOutcome: "Reduce unowned feedback.",
      requiresExplicitApproval: true
    }],
    createdAt: "2026-07-30T12:01:00.000Z",
    updatedAt: "2026-07-30T12:01:00.000Z"
  });
}
