import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";
import { SupabaseGraphAuthoringStore } from "./supabase-graph-authoring-store";

const scope = {
  organizationId: "123e4567-e89b-12d3-a456-426614174000",
  projectKey: "main",
  actorId: "123e4567-e89b-12d3-a456-426614174001"
};

describe("Supabase graph authoring store", () => {
  it("rejects unsafe or mismatched tenant scope", async () => {
    const client = { rpc: vi.fn(), from: vi.fn() } as unknown as SupabaseClient;
    expect(() => new SupabaseGraphAuthoringStore(client, {
      ...scope,
      projectKey: "../../escape"
    })).toThrow("project key");

    const store = new SupabaseGraphAuthoringStore(client, scope);
    await expect(store.submit({
      workspaceId: "other",
      companyId: scope.organizationId,
      actorId: scope.actorId,
      expectedTopologyHash: "aaaaaaaaaaaaaaaa",
      operations: [{ kind: "move_node", nodeId: "brain", x: 10, y: 20 }]
    })).rejects.toThrow("scope does not match");
  });

  it("submits a bounded authenticated layout transaction through the RPC", async () => {
    const rpc = vi.fn(async (_name: string, parameters: { p_payload: unknown }) => ({
      data: parameters.p_payload,
      error: null
    }));
    const store = new SupabaseGraphAuthoringStore(
      { rpc, from: vi.fn() } as unknown as SupabaseClient,
      scope
    );
    const transaction = await store.submit({
      workspaceId: scope.projectKey,
      companyId: scope.organizationId,
      actorId: scope.actorId,
      expectedTopologyHash: "aaaaaaaaaaaaaaaa",
      operations: [{ kind: "move_node", nodeId: "brain", x: 10, y: 20 }],
      now: new Date("2026-08-15T12:00:00.000Z")
    });

    expect(transaction).toMatchObject({
      status: "layout_applied",
      workspaceId: scope.projectKey,
      companyId: scope.organizationId,
      actorId: scope.actorId
    });
    expect(rpc).toHaveBeenCalledWith("submit_graph_editor_transaction", {
      p_organization_id: scope.organizationId,
      p_project_key: scope.projectKey,
      p_payload: transaction
    });
  });

  it("keeps semantic edits pending instead of changing runnable topology", async () => {
    const rpc = vi.fn(async (_name: string, parameters: { p_payload: unknown }) => ({
      data: parameters.p_payload,
      error: null
    }));
    const store = new SupabaseGraphAuthoringStore(
      { rpc, from: vi.fn() } as unknown as SupabaseClient,
      scope
    );
    await expect(store.submit({
      workspaceId: scope.projectKey,
      companyId: scope.organizationId,
      actorId: scope.actorId,
      expectedTopologyHash: "bbbbbbbbbbbbbbbb",
      operations: [{
        kind: "propose_edge",
        sourceId: "hermes-brain",
        targetId: "loop:product_activation",
        relation: "brain_routes_to",
        reason: "Hermes should evaluate this route under the existing approval policy."
      }],
      now: new Date("2026-08-15T12:00:00.000Z")
    })).resolves.toMatchObject({ status: "proposal_pending" });
  });
});
