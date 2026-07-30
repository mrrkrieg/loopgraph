import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  graphChangeSetSchema,
  loopOpportunitySchema,
  type GraphChangeSet,
  type LoopOpportunity
} from "loopgraph/core";
import type {
  LoopOpportunityFilters,
  LoopOpportunityStore
} from "loopgraph/runtime";
import { createSupabaseAdminClient } from "@/lib/db/supabase-admin";

const PAGE_SIZE = 500;
const PROJECT_KEY_PATTERN = /^[a-z0-9][a-z0-9_-]{0,63}$/;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type SupabaseLoopOpportunityScope = {
  organizationId: string;
  projectKey: string;
};

export class SupabaseLoopOpportunityStore implements LoopOpportunityStore {
  readonly persistence = "distributed" as const;

  constructor(
    private readonly supabase: SupabaseClient,
    private readonly scope: SupabaseLoopOpportunityScope
  ) {
    assertScope(scope);
  }

  async saveOpportunity(opportunity: LoopOpportunity): Promise<void> {
    const payload = loopOpportunitySchema.parse(opportunity);
    const { data, error } = await this.supabase.rpc(
      "upsert_loop_opportunity",
      {
        p_organization_id: this.scope.organizationId,
        p_project_key: this.scope.projectKey,
        p_payload: payload
      }
    );
    if (error) {
      throw new Error(`Failed to save loop opportunity: ${error.message}`);
    }
    const saved = loopOpportunitySchema.parse(data);
    if (
      saved.id !== payload.id ||
      saved.fingerprint !== payload.fingerprint ||
      saved.generation !== payload.generation
    ) {
      throw new Error(`Loop opportunity write returned inconsistent identity: ${payload.id}`);
    }
  }

  async getOpportunity(
    opportunityId: string
  ): Promise<LoopOpportunity | undefined> {
    const { data, error } = await this.supabase
      .from("loop_opportunities")
      .select("payload")
      .eq("organization_id", this.scope.organizationId)
      .eq("project_key", this.scope.projectKey)
      .eq("opportunity_id", opportunityId)
      .maybeSingle();
    if (error) {
      throw new Error(`Failed to read loop opportunity: ${error.message}`);
    }
    return data
      ? loopOpportunitySchema.parse((data as { payload: unknown }).payload)
      : undefined;
  }

  async listOpportunities(
    filters: LoopOpportunityFilters = {}
  ): Promise<LoopOpportunity[]> {
    const values: LoopOpportunity[] = [];
    for (let offset = 0; ; offset += PAGE_SIZE) {
      let query = this.supabase
        .from("loop_opportunities")
        .select("payload")
        .eq("organization_id", this.scope.organizationId)
        .eq("project_key", this.scope.projectKey);
      if (filters.status) query = query.eq("status", filters.status);
      if (filters.department) query = query.eq("department", filters.department);
      if (filters.minimumScore !== undefined) {
        query = query.gte("score", filters.minimumScore);
      }
      const { data, error } = await query
        .order("score", { ascending: false })
        .order("updated_at", { ascending: false })
        .range(offset, offset + PAGE_SIZE - 1);
      if (error) {
        throw new Error(`Failed to list loop opportunities: ${error.message}`);
      }
      const page = (data ?? []) as Array<{ payload: unknown }>;
      values.push(...page.map((row) => loopOpportunitySchema.parse(row.payload)));
      if (page.length < PAGE_SIZE) return values;
    }
  }

  async saveGraphChangeSet(changeSet: GraphChangeSet): Promise<void> {
    const payload = graphChangeSetSchema.parse(changeSet);
    const { data, error } = await this.supabase.rpc(
      "upsert_loop_graph_change_set",
      {
        p_organization_id: this.scope.organizationId,
        p_project_key: this.scope.projectKey,
        p_payload: payload
      }
    );
    if (error) {
      throw new Error(`Failed to save graph change set: ${error.message}`);
    }
    const saved = graphChangeSetSchema.parse(data);
    if (
      saved.id !== payload.id ||
      saved.opportunityId !== payload.opportunityId ||
      saved.version !== payload.version
    ) {
      throw new Error(`Graph change-set write returned inconsistent identity: ${payload.id}`);
    }
  }

  async getGraphChangeSet(
    changeSetId: string
  ): Promise<GraphChangeSet | undefined> {
    const { data, error } = await this.supabase
      .from("loop_graph_change_sets")
      .select("payload")
      .eq("organization_id", this.scope.organizationId)
      .eq("project_key", this.scope.projectKey)
      .eq("change_set_id", changeSetId)
      .maybeSingle();
    if (error) {
      throw new Error(`Failed to read graph change set: ${error.message}`);
    }
    return data
      ? graphChangeSetSchema.parse((data as { payload: unknown }).payload)
      : undefined;
  }

  async listGraphChangeSets(opportunityId?: string): Promise<GraphChangeSet[]> {
    const values: GraphChangeSet[] = [];
    for (let offset = 0; ; offset += PAGE_SIZE) {
      let query = this.supabase
        .from("loop_graph_change_sets")
        .select("payload")
        .eq("organization_id", this.scope.organizationId)
        .eq("project_key", this.scope.projectKey);
      if (opportunityId) {
        query = query.eq("opportunity_id", opportunityId);
      }
      const { data, error } = await query
        .order("version", { ascending: false })
        .order("updated_at", { ascending: false })
        .range(offset, offset + PAGE_SIZE - 1);
      if (error) {
        throw new Error(`Failed to list graph change sets: ${error.message}`);
      }
      const page = (data ?? []) as Array<{ payload: unknown }>;
      values.push(...page.map((row) => graphChangeSetSchema.parse(row.payload)));
      if (page.length < PAGE_SIZE) return values;
    }
  }
}

export function isSupabaseLoopOpportunityStoreEnabled(
  env: Record<string, string | undefined> = process.env
): boolean {
  return Boolean(
    env.NEXT_PUBLIC_SUPABASE_URL &&
      env.SUPABASE_SERVICE_ROLE_KEY &&
      env.LOOPGRAPH_HOSTED_ORGANIZATION_ID
  );
}

export function createSupabaseLoopOpportunityStore(): LoopOpportunityStore {
  const supabase = createSupabaseAdminClient();
  const organizationId =
    process.env.LOOPGRAPH_HOSTED_ORGANIZATION_ID?.trim();
  const projectKey =
    process.env.LOOPGRAPH_HOSTED_PROJECT_KEY?.trim() || "default";
  if (!supabase || !organizationId) {
    throw new Error(
      "Supabase loop opportunity storage requires LOOPGRAPH_HOSTED_ORGANIZATION_ID"
    );
  }
  return new SupabaseLoopOpportunityStore(supabase, {
    organizationId,
    projectKey
  });
}

function assertScope(scope: SupabaseLoopOpportunityScope) {
  if (!UUID_PATTERN.test(scope.organizationId)) {
    throw new Error("Loop opportunity organization ID must be a UUID");
  }
  if (!PROJECT_KEY_PATTERN.test(scope.projectKey)) {
    throw new Error("Loop opportunity project key is invalid");
  }
}
