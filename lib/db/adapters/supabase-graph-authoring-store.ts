import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  graphEditorTransactionSchema,
  type GraphEditorTransaction
} from "loopgraph/core";
import {
  createGraphEditorTransaction,
  type GraphAuthoringStore,
  type GraphLayoutOverrides,
  type SubmitGraphEditorTransactionInput
} from "loopgraph/runtime";

const PROJECT_KEY_PATTERN = /^[a-z0-9][a-z0-9_-]{0,63}$/;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type Scope = {
  organizationId: string;
  projectKey: string;
  actorId: string;
};

export class SupabaseGraphAuthoringStore implements GraphAuthoringStore {
  readonly persistence = "distributed" as const;

  constructor(
    private readonly supabase: SupabaseClient,
    private readonly scope: Scope
  ) {
    assertScope(scope);
  }

  async submit(
    input: SubmitGraphEditorTransactionInput
  ): Promise<GraphEditorTransaction> {
    if (
      input.workspaceId !== this.scope.projectKey ||
      input.companyId !== this.scope.organizationId ||
      input.actorId !== this.scope.actorId
    ) {
      throw new Error("Graph authoring transaction scope does not match the authenticated workspace");
    }
    const transaction = createGraphEditorTransaction(input);
    const { data, error } = await this.supabase.rpc(
      "submit_graph_editor_transaction",
      {
        p_organization_id: this.scope.organizationId,
        p_project_key: this.scope.projectKey,
        p_payload: transaction
      }
    );
    if (error) {
      throw new Error(`Failed to submit graph editor transaction: ${error.message}`);
    }
    const saved = graphEditorTransactionSchema.parse(data);
    if (
      saved.id !== transaction.id ||
      saved.actorId !== transaction.actorId ||
      saved.expectedTopologyHash !== transaction.expectedTopologyHash
    ) {
      throw new Error("Graph authoring transaction returned an inconsistent identity");
    }
    return saved;
  }

  async getLayout(): Promise<GraphLayoutOverrides> {
    const { data, error } = await this.supabase
      .from("graph_editor_layouts")
      .select("positions")
      .eq("organization_id", this.scope.organizationId)
      .eq("project_key", this.scope.projectKey)
      .maybeSingle();
    if (error) {
      throw new Error(`Failed to read graph layout: ${error.message}`);
    }
    return parseLayout(data?.positions);
  }

  async list(): Promise<GraphEditorTransaction[]> {
    const { data, error } = await this.supabase
      .from("graph_editor_transactions")
      .select("payload")
      .eq("organization_id", this.scope.organizationId)
      .eq("project_key", this.scope.projectKey)
      .order("created_at", { ascending: false })
      .limit(200);
    if (error) {
      throw new Error(`Failed to list graph editor transactions: ${error.message}`);
    }
    return (data ?? []).map((row) =>
      graphEditorTransactionSchema.parse((row as { payload: unknown }).payload)
    );
  }
}

function parseLayout(value: unknown): GraphLayoutOverrides {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const result: GraphLayoutOverrides = {};
  for (const [nodeId, candidate] of Object.entries(value)) {
    if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) continue;
    const position = candidate as { x?: unknown; y?: unknown };
    if (
      typeof position.x === "number" &&
      Number.isFinite(position.x) &&
      typeof position.y === "number" &&
      Number.isFinite(position.y)
    ) {
      result[nodeId] = { x: position.x, y: position.y };
    }
  }
  return result;
}

function assertScope(scope: Scope) {
  if (!UUID_PATTERN.test(scope.organizationId)) {
    throw new Error("Graph authoring organization ID must be a UUID");
  }
  if (!UUID_PATTERN.test(scope.actorId)) {
    throw new Error("Graph authoring actor ID must be a UUID");
  }
  if (!PROJECT_KEY_PATTERN.test(scope.projectKey)) {
    throw new Error("Graph authoring project key is invalid");
  }
}
