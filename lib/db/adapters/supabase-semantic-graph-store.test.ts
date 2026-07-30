import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";
import {
  graphSnapshotSchema,
  graphTransactionSchema
} from "loopgraph/core";
import {
  SupabaseSemanticGraphStore,
  isSupabaseSemanticGraphStoreEnabled
} from "./supabase-semantic-graph-store";

const scope = {
  organizationId: "123e4567-e89b-12d3-a456-426614174000",
  projectKey: "main"
};

describe("Supabase semantic graph store", () => {
  it("requires service storage and rejects unsafe tenant scopes", () => {
    expect(isSupabaseSemanticGraphStoreEnabled({
      NEXT_PUBLIC_SUPABASE_URL: "https://example.supabase.co",
      SUPABASE_SERVICE_ROLE_KEY: "service",
      LOOPGRAPH_HOSTED_ORGANIZATION_ID: ""
    })).toBe(false);
    expect(isSupabaseSemanticGraphStoreEnabled({
      NEXT_PUBLIC_SUPABASE_URL: "https://example.supabase.co",
      SUPABASE_SERVICE_ROLE_KEY: "service",
      LOOPGRAPH_HOSTED_ORGANIZATION_ID: scope.organizationId
    })).toBe(true);

    const client = {
      rpc: vi.fn(),
      from: vi.fn()
    } as unknown as SupabaseClient;
    expect(() => new SupabaseSemanticGraphStore(client, {
      organizationId: "../other",
      projectKey: "main"
    })).toThrow("organization ID");
    expect(() => new SupabaseSemanticGraphStore(client, {
      organizationId: scope.organizationId,
      projectKey: "../../escape"
    })).toThrow("project key");
  });

  it("uses the tenant-scoped record RPC for approvals", async () => {
    const rpc = vi.fn(async () => ({
      data: { id: "approval_1" },
      error: null
    }));
    const store = new SupabaseSemanticGraphStore(
      { rpc, from: vi.fn() } as unknown as SupabaseClient,
      scope
    );

    await store.saveApproval({
      schemaVersion: "graph-change-approval-receipt/v1alpha1",
      id: "approval_1",
      projectRootId: "project_1",
      subjectType: "graph_change",
      changeSetId: "change_1",
      changeSetHash: "aaaaaaaaaaaaaaaa",
      baseGraphHash: "bbbbbbbbbbbbbbbb",
      decision: "approved",
      approvedChangeIds: ["operation_1"],
      actorId: "owner_1",
      actorRole: "owner",
      policyVersion: "policy_1",
      reason: "Reviewed",
      evidenceRefs: [],
      decidedAt: "2026-07-30T12:00:00.000Z"
    });

    expect(rpc).toHaveBeenCalledWith("save_semantic_graph_record", {
      p_organization_id: scope.organizationId,
      p_project_key: scope.projectKey,
      p_record_type: "approval",
      p_payload: expect.objectContaining({ id: "approval_1" })
    });
  });

  it("uses the fenced atomic commit RPC and validates its receipt", async () => {
    const transaction = graphTransactionSchema.parse({
      id: "transaction_1",
      projectRootId: "project_1",
      kind: "change_set",
      status: "committed",
      changeSetId: "change_1",
      approvalReceiptId: "approval_1",
      initiatedBy: "owner_1",
      baseSnapshotId: "snapshot_0",
      resultSnapshotId: "snapshot_1",
      baseGraphHash: "aaaaaaaaaaaaaaaa",
      resultGraphHash: "bbbbbbbbbbbbbbbb",
      operationReceipts: [],
      createdAt: "2026-07-30T12:00:00.000Z",
      committedAt: "2026-07-30T12:00:00.000Z"
    });
    const snapshot = (id: string, graphHash: string, sequence: number) =>
      graphSnapshotSchema.parse({
        id,
        projectRootId: "project_1",
        graphHash,
        sequence,
        reason: "Adapter test",
        transactionId: transaction.id,
        entries: [],
        createdAt: "2026-07-30T12:00:00.000Z",
        createdBy: "owner_1"
      });
    const rpc = vi.fn(async (
      name: string,
      args: Record<string, unknown>
    ) => {
      expect(name).toBe("commit_semantic_graph_transaction");
      return {
        data: [{
          workspace_revision: 4,
          transaction: args.p_transaction,
          promotion: null,
          created: true
        }],
        error: null
      };
    });
    const store = new SupabaseSemanticGraphStore(
      { rpc, from: vi.fn() } as unknown as SupabaseClient,
      scope
    );

    const result = await store.commitGraphMutationAtomically({
      commitId: transaction.id,
      idempotencyKey: transaction.id,
      projectRoot: "/runtime/project",
      expectedWorkspaceRevision: 3,
      expectedArtifacts: [],
      committedAt: "2026-07-30T12:00:00.000Z",
      workspace: {
        version: 1,
        schemaVersion: "workspace/v1alpha1",
        projectRoot: "/runtime/project",
        projectRootId: "project_1",
        displayName: "Test",
        demoCatalogEnabled: false,
        registeredSpecs: [],
        initializedAt: "2026-07-30T11:00:00.000Z",
        updatedAt: "2026-07-30T12:00:00.000Z"
      },
      artifacts: [],
      baseSnapshot: snapshot(
        "snapshot_0",
        "aaaaaaaaaaaaaaaa",
        0
      ),
      resultSnapshot: snapshot(
        "snapshot_1",
        "bbbbbbbbbbbbbbbb",
        1
      ),
      transaction
    });

    expect(result).toMatchObject({
      workspaceRevision: 4,
      created: true,
      transaction: { id: "transaction_1" }
    });
    expect(rpc).toHaveBeenCalledWith(
      "commit_semantic_graph_transaction",
      expect.objectContaining({
        p_expected_workspace_revision: 3,
        p_expected_artifact_bindings: [],
        p_artifacts: []
      })
    );
  });
});
