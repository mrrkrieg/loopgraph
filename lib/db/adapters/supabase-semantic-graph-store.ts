import "server-only";

import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  graphChangeApprovalReceiptSchema,
  graphSnapshotSchema,
  graphTransactionSchema,
  loopPromotionReceiptSchema,
  loopSpecVersionHash,
  promotionRehearsalReportSchema,
  type GraphChangeApprovalReceipt,
  type GraphSnapshot,
  type GraphTransaction,
  type LoopPromotionReceipt,
  type PromotionRehearsalReport
} from "loopgraph/core";
import type {
  SemanticGraphMutationCommitInput,
  SemanticGraphMutationCommitResult,
  SemanticGraphStore,
  StoredLoopSpecArtifact
} from "loopgraph/runtime";
import { createSupabaseAdminClient } from "@/lib/db/supabase-admin";

const PAGE_SIZE = 500;
const GRAPH_LEASE_SECONDS = 300;
const GRAPH_RENEW_INTERVAL_MS = 60_000;
const PROJECT_KEY_PATTERN = /^[a-z0-9][a-z0-9_-]{0,63}$/;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type Scope = {
  organizationId: string;
  projectKey: string;
};

type CommitResult = {
  workspace_revision: number | string;
  transaction: unknown;
  promotion?: unknown | null;
  created: boolean;
};

export class SupabaseSemanticGraphStore implements SemanticGraphStore {
  readonly persistence = "distributed" as const;

  constructor(
    private readonly supabase: SupabaseClient,
    private readonly scope: Scope
  ) {
    assertScope(scope);
  }

  normalizeArtifacts(
    artifacts: StoredLoopSpecArtifact[]
  ): StoredLoopSpecArtifact[] {
    return artifacts
      .map((artifact) => {
        const versionHash = loopSpecVersionHash(artifact.spec);
        if (artifact.versionHash !== versionHash) {
          throw new Error(
            `Semantic graph LoopSpec hash is inconsistent: ${artifact.loopId}`
          );
        }
        const sourceRef = this.artifactRef(artifact.loopId, versionHash);
        return {
          ...structuredClone(artifact),
          entry: {
            ...artifact.entry,
            path: sourceRef
          },
          source: "semantic_graph" as const,
          sourceRef
        };
      })
      .sort((left, right) => left.loopId.localeCompare(right.loopId));
  }

  async saveSnapshot(snapshot: GraphSnapshot): Promise<void> {
    await this.saveRecord("snapshot", graphSnapshotSchema.parse(snapshot));
  }

  async getSnapshot(snapshotId: string): Promise<GraphSnapshot | undefined> {
    return this.getPayload(
      "semantic_graph_snapshots",
      "snapshot_id",
      snapshotId,
      graphSnapshotSchema
    );
  }

  async listSnapshots(): Promise<GraphSnapshot[]> {
    return this.listPayloads(
      "semantic_graph_snapshots",
      "sequence",
      true,
      graphSnapshotSchema
    );
  }

  async saveApproval(receipt: GraphChangeApprovalReceipt): Promise<void> {
    await this.saveRecord(
      "approval",
      graphChangeApprovalReceiptSchema.parse(receipt)
    );
  }

  async getApproval(
    receiptId: string
  ): Promise<GraphChangeApprovalReceipt | undefined> {
    return this.getPayload(
      "semantic_graph_approvals",
      "approval_id",
      receiptId,
      graphChangeApprovalReceiptSchema
    );
  }

  async listApprovals(
    changeSetId?: string
  ): Promise<GraphChangeApprovalReceipt[]> {
    return this.listPayloads(
      "semantic_graph_approvals",
      "decided_at",
      true,
      graphChangeApprovalReceiptSchema,
      changeSetId ? { field: "change_set_id", value: changeSetId } : undefined
    );
  }

  async saveTransaction(transaction: GraphTransaction): Promise<void> {
    await this.saveRecord(
      "transaction",
      graphTransactionSchema.parse(transaction)
    );
  }

  async getTransaction(
    transactionId: string
  ): Promise<GraphTransaction | undefined> {
    return this.getPayload(
      "semantic_graph_transactions",
      "transaction_id",
      transactionId,
      graphTransactionSchema
    );
  }

  async listTransactions(): Promise<GraphTransaction[]> {
    return this.listPayloads(
      "semantic_graph_transactions",
      "created_at",
      false,
      graphTransactionSchema
    );
  }

  async savePromotion(receipt: LoopPromotionReceipt): Promise<void> {
    await this.saveRecord(
      "promotion",
      loopPromotionReceiptSchema.parse(receipt)
    );
  }

  async getPromotion(
    receiptId: string
  ): Promise<LoopPromotionReceipt | undefined> {
    return this.getPayload(
      "semantic_graph_promotions",
      "promotion_id",
      receiptId,
      loopPromotionReceiptSchema
    );
  }

  async listPromotions(loopId?: string): Promise<LoopPromotionReceipt[]> {
    return this.listPayloads(
      "semantic_graph_promotions",
      "promoted_at",
      false,
      loopPromotionReceiptSchema,
      loopId ? { field: "loop_id", value: loopId } : undefined
    );
  }

  async savePromotionRehearsal(
    report: PromotionRehearsalReport
  ): Promise<void> {
    await this.saveRecord(
      "rehearsal",
      promotionRehearsalReportSchema.parse(report)
    );
  }

  async getPromotionRehearsal(
    reportId: string
  ): Promise<PromotionRehearsalReport | undefined> {
    return this.getPayload(
      "semantic_graph_rehearsals",
      "rehearsal_id",
      reportId,
      promotionRehearsalReportSchema
    );
  }

  async listPromotionRehearsals(
    loopId?: string
  ): Promise<PromotionRehearsalReport[]> {
    return this.listPayloads(
      "semantic_graph_rehearsals",
      "created_at",
      false,
      promotionRehearsalReportSchema,
      loopId ? { field: "loop_id", value: loopId } : undefined
    );
  }

  async withTransactionLock<T>(operation: () => Promise<T>): Promise<T> {
    const leaseId = randomUUID();
    const acquired = await this.leaseRpc(
      "acquire_loop_controller_lease",
      leaseId
    );
    if (!acquired) {
      throw new Error("Semantic graph transaction lease is already owned");
    }
    let leaseError: Error | undefined;
    const timer = setInterval(() => {
      void this.leaseRpc(
        "renew_loop_controller_lease",
        leaseId
      ).then((renewed) => {
        if (!renewed) {
          leaseError = new Error(
            "Semantic graph transaction lease was lost during execution"
          );
        }
      }).catch((error: unknown) => {
        leaseError =
          error instanceof Error ? error : new Error(String(error));
      });
    }, GRAPH_RENEW_INTERVAL_MS);
    timer.unref();
    try {
      const result = await operation();
      if (leaseError) throw leaseError;
      return result;
    } finally {
      clearInterval(timer);
      await this.releaseLease(leaseId).catch(() => undefined);
    }
  }

  async commitGraphMutationAtomically(
    input: SemanticGraphMutationCommitInput
  ): Promise<SemanticGraphMutationCommitResult> {
    const artifacts = this.normalizeArtifacts(input.artifacts);
    const expectedArtifacts = [...input.expectedArtifacts]
      .sort((left, right) => left.loopId.localeCompare(right.loopId));
    const { data, error } = await this.supabase.rpc(
      "commit_semantic_graph_transaction",
      {
        p_organization_id: this.scope.organizationId,
        p_project_key: this.scope.projectKey,
        p_project_root: input.projectRoot,
        p_commit_id: input.commitId,
        p_idempotency_key: input.idempotencyKey,
        p_expected_workspace_revision: input.expectedWorkspaceRevision,
        p_expected_artifact_bindings: expectedArtifacts,
        p_committed_at: input.committedAt,
        p_workspace: {
          ...input.workspace,
          registeredSpecs: artifacts.map((artifact) => artifact.entry)
        },
        p_artifacts: artifacts,
        p_base_snapshot: input.baseSnapshot,
        p_result_snapshot: input.resultSnapshot,
        p_transaction: input.transaction,
        p_change_set: input.changeSet ?? null,
        p_promotion: input.promotion ?? null,
        p_transaction_updates: input.transactionUpdates ?? [],
        p_promotion_updates: input.promotionUpdates ?? []
      }
    );
    if (error) {
      throw new Error(
        `Failed to commit semantic graph transaction: ${error.message}`
      );
    }
    const result = firstRow<CommitResult>(data);
    if (!result || typeof result.created !== "boolean") {
      throw new Error(
        "Semantic graph transaction did not return an atomic result"
      );
    }
    const transaction = graphTransactionSchema.parse(result.transaction);
    if (
      transaction.id !== input.transaction.id ||
      transaction.resultGraphHash !== input.transaction.resultGraphHash
    ) {
      throw new Error(
        `Semantic graph commit returned inconsistent transaction: ${input.transaction.id}`
      );
    }
    const workspaceRevision = numericRevision(result.workspace_revision);
    if (
      result.created &&
      workspaceRevision !== input.expectedWorkspaceRevision + 1
    ) {
      throw new Error(
        `Semantic graph workspace revision is inconsistent: ${workspaceRevision}`
      );
    }
    const promotion = result.promotion
      ? loopPromotionReceiptSchema.parse(result.promotion)
      : undefined;
    if (
      input.promotion &&
      (!promotion || promotion.id !== input.promotion.id)
    ) {
      throw new Error("Semantic graph commit returned inconsistent promotion");
    }
    return {
      workspaceRevision,
      transaction,
      ...(promotion ? { promotion } : {}),
      created: result.created
    };
  }

  private async saveRecord(
    recordType:
      | "snapshot"
      | "approval"
      | "transaction"
      | "promotion"
      | "rehearsal",
    payload: unknown
  ): Promise<void> {
    const { data, error } = await this.supabase.rpc(
      "save_semantic_graph_record",
      {
        p_organization_id: this.scope.organizationId,
        p_project_key: this.scope.projectKey,
        p_record_type: recordType,
        p_payload: payload
      }
    );
    if (error) {
      throw new Error(
        `Failed to save semantic graph ${recordType}: ${error.message}`
      );
    }
    if (!data || typeof data !== "object") {
      throw new Error(
        `Semantic graph ${recordType} write returned an invalid result`
      );
    }
  }

  private async getPayload<T>(
    table: string,
    identityField: string,
    identity: string,
    schema: { parse(value: unknown): T }
  ): Promise<T | undefined> {
    const { data, error } = await this.supabase
      .from(table)
      .select("payload")
      .eq("organization_id", this.scope.organizationId)
      .eq("project_key", this.scope.projectKey)
      .eq(identityField, identity)
      .maybeSingle();
    if (error) {
      throw new Error(`Failed to read ${table}: ${error.message}`);
    }
    return data
      ? schema.parse((data as { payload: unknown }).payload)
      : undefined;
  }

  private async listPayloads<T>(
    table: string,
    orderColumn: string,
    ascending: boolean,
    schema: { parse(value: unknown): T },
    filter?: { field: string; value: string }
  ): Promise<T[]> {
    const values: T[] = [];
    for (let offset = 0; ; offset += PAGE_SIZE) {
      let query = this.supabase
        .from(table)
        .select("payload")
        .eq("organization_id", this.scope.organizationId)
        .eq("project_key", this.scope.projectKey);
      if (filter) query = query.eq(filter.field, filter.value);
      const { data, error } = await query
        .order(orderColumn, { ascending })
        .range(offset, offset + PAGE_SIZE - 1);
      if (error) {
        throw new Error(`Failed to list ${table}: ${error.message}`);
      }
      const page = (data ?? []) as Array<{ payload: unknown }>;
      values.push(...page.map((row) => schema.parse(row.payload)));
      if (page.length < PAGE_SIZE) return values;
    }
  }

  private async leaseRpc(
    functionName:
      | "acquire_loop_controller_lease"
      | "renew_loop_controller_lease",
    leaseId: string
  ): Promise<boolean> {
    const { data, error } = await this.supabase.rpc(functionName, {
      p_organization_id: this.scope.organizationId,
      p_project_key: this.scope.projectKey,
      p_lock_name: "semantic_graph",
      p_lease_id: leaseId,
      p_lease_seconds: GRAPH_LEASE_SECONDS,
      p_now: new Date().toISOString()
    });
    if (error) {
      throw new Error(`Failed to ${functionName}: ${error.message}`);
    }
    return data === true;
  }

  private async releaseLease(leaseId: string): Promise<void> {
    const { error } = await this.supabase.rpc(
      "release_loop_controller_lease",
      {
        p_organization_id: this.scope.organizationId,
        p_project_key: this.scope.projectKey,
        p_lock_name: "semantic_graph",
        p_lease_id: leaseId
      }
    );
    if (error) {
      throw new Error(
        `Failed to release semantic graph lease: ${error.message}`
      );
    }
  }

  private artifactRef(loopId: string, versionHash: string): string {
    return `supabase://${this.scope.organizationId}/${this.scope.projectKey}/loop-specs/${encodeURIComponent(loopId)}/versions/${versionHash}`;
  }
}

export function isSupabaseSemanticGraphStoreEnabled(
  env: Record<string, string | undefined> = process.env
): boolean {
  return Boolean(
    env.NEXT_PUBLIC_SUPABASE_URL &&
      env.SUPABASE_SERVICE_ROLE_KEY &&
      env.LOOPGRAPH_HOSTED_ORGANIZATION_ID
  );
}

export function createSupabaseSemanticGraphStore(): SemanticGraphStore {
  const supabase = createSupabaseAdminClient();
  const organizationId =
    process.env.LOOPGRAPH_HOSTED_ORGANIZATION_ID?.trim();
  const projectKey =
    process.env.LOOPGRAPH_HOSTED_PROJECT_KEY?.trim() || "default";
  if (!supabase || !organizationId) {
    throw new Error(
      "Supabase semantic graph storage requires NEXT_PUBLIC_SUPABASE_URL, " +
        "SUPABASE_SERVICE_ROLE_KEY, and LOOPGRAPH_HOSTED_ORGANIZATION_ID"
    );
  }
  return new SupabaseSemanticGraphStore(supabase, {
    organizationId,
    projectKey
  });
}

function firstRow<T>(value: unknown): T | undefined {
  if (Array.isArray(value)) return value[0] as T | undefined;
  return value && typeof value === "object" ? value as T : undefined;
}

function numericRevision(value: number | string): number {
  const revision = Number(value);
  if (!Number.isSafeInteger(revision) || revision < 0) {
    throw new Error("Semantic graph workspace revision is invalid");
  }
  return revision;
}

function assertScope(scope: Scope) {
  if (!UUID_PATTERN.test(scope.organizationId)) {
    throw new Error("Semantic graph organization ID must be a UUID");
  }
  if (!PROJECT_KEY_PATTERN.test(scope.projectKey)) {
    throw new Error("Semantic graph project key is invalid");
  }
}
