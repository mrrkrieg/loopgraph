import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { canonicalEntitySchema, type CanonicalEntity } from "loopgraph/core";
import type { EntityResolutionStore } from "loopgraph/runtime";
import { createSupabaseAdminClient } from "@/lib/db/supabase-admin";
const PROJECT_KEY_PATTERN = /^[a-z0-9][a-z0-9_-]{0,63}$/;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export class SupabaseEntityResolutionStore implements EntityResolutionStore {
  readonly persistence = "distributed" as const;
  constructor(private readonly supabase: SupabaseClient, private readonly scope: { organizationId: string; projectKey: string }) {
    if (!UUID_PATTERN.test(scope.organizationId)) throw new Error("Entity resolution organization ID must be a UUID");
    if (!PROJECT_KEY_PATTERN.test(scope.projectKey)) throw new Error("Entity resolution project key is invalid");
  }
  async list(workspaceId: string, companyId: string): Promise<CanonicalEntity[]> {
    const { data, error } = await this.supabase.from("canonical_company_entities").select("payload").eq("organization_id", this.scope.organizationId).eq("project_key", this.scope.projectKey).eq("workspace_id", workspaceId).eq("company_id", companyId).order("updated_at", { ascending: false }).limit(5000);
    if (error) throw new Error(`Failed to list canonical entities: ${error.message}`);
    return (data ?? []).map((row) => canonicalEntitySchema.parse((row as { payload: unknown }).payload));
  }
  async save(entity: CanonicalEntity, expectedRevision?: number) {
    const payload = canonicalEntitySchema.parse(entity);
    const { data, error } = await this.supabase.rpc("upsert_canonical_company_entity", { p_organization_id: this.scope.organizationId, p_project_key: this.scope.projectKey, p_payload: payload, p_expected_revision: expectedRevision });
    if (error) throw new Error(`Failed to save canonical entity: ${error.message}`);
    return canonicalEntitySchema.parse(data);
  }
}
export function isSupabaseEntityResolutionStoreEnabled(env: NodeJS.ProcessEnv = process.env) { return Boolean(env.NEXT_PUBLIC_SUPABASE_URL && env.SUPABASE_SERVICE_ROLE_KEY && env.LOOPGRAPH_HOSTED_ORGANIZATION_ID); }
export function createSupabaseEntityResolutionStore() {
  const client = createSupabaseAdminClient(); const organizationId = process.env.LOOPGRAPH_HOSTED_ORGANIZATION_ID?.trim(); const projectKey = process.env.LOOPGRAPH_HOSTED_PROJECT_KEY?.trim() || "default";
  if (!client || !organizationId) throw new Error("Supabase entity resolution requires a hosted organization");
  return new SupabaseEntityResolutionStore(client, { organizationId, projectKey });
}
