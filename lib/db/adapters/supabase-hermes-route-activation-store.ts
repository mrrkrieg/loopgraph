import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  validateHermesRouteActivationRecord,
  type HermesRouteActivationStore
} from "loopgraph/runtime";
import type { HermesRouteActivationRecord } from "loopgraph/core";
import { createSupabaseAdminClient } from "@/lib/db/supabase-admin";

const PROJECT_KEY_PATTERN = /^[a-z0-9][a-z0-9_-]{0,63}$/;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type SupabaseHermesRouteActivationScope = {
  organizationId: string;
  projectKey: string;
  workspaceId: string;
};

/** Tenant-scoped, append-only proof of the Hermes route contract applied by the controller. */
export class SupabaseHermesRouteActivationStore implements HermesRouteActivationStore {
  readonly persistence = "distributed" as const;
  readonly reference = "supabase:hermes-route-activation";

  constructor(
    private readonly supabase: SupabaseClient,
    private readonly scope: SupabaseHermesRouteActivationScope
  ) {
    if (!UUID_PATTERN.test(scope.organizationId)) throw new Error("Hermes route activation store organization ID must be a UUID");
    if (!PROJECT_KEY_PATTERN.test(scope.projectKey)) throw new Error("Hermes route activation store project key is invalid");
    if (scope.workspaceId.length < 1 || scope.workspaceId.length > 160) {
      throw new Error("Hermes route activation store workspace ID is invalid");
    }
  }

  async read(): Promise<HermesRouteActivationRecord | null> {
    const { data, error } = await this.supabase
      .from("loopgraph_hermes_route_activation_records")
      .select("record_payload")
      .eq("organization_id", this.scope.organizationId)
      .eq("project_key", this.scope.projectKey)
      .eq("workspace_id", this.scope.workspaceId)
      .order("activated_at", { ascending: false })
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) throw new Error(`Failed to read Hermes route activation record: ${error.message}`);
    if (!data) return null;
    const row = data as { record_payload?: unknown };
    if (row.record_payload === undefined) throw new Error("Hosted Hermes route activation returned an invalid row");
    return validateHermesRouteActivationRecord(row.record_payload);
  }

  async write(input: HermesRouteActivationRecord): Promise<void> {
    const record = validateHermesRouteActivationRecord(input);
    const { data, error } = await this.supabase.rpc("record_loopgraph_hermes_route_activation", {
      p_organization_id: this.scope.organizationId,
      p_project_key: this.scope.projectKey,
      p_workspace_id: this.scope.workspaceId,
      p_record: record
    });
    if (error) throw new Error(`Failed to record Hermes route activation: ${error.message}`);
    validateHermesRouteActivationRecord(data);
  }
}

export function isSupabaseHermesRouteActivationStoreEnabled(
  env: NodeJS.ProcessEnv = process.env
): boolean {
  return Boolean(
    env.NEXT_PUBLIC_SUPABASE_URL &&
    env.SUPABASE_SERVICE_ROLE_KEY &&
    env.LOOPGRAPH_HOSTED_ORGANIZATION_ID
  );
}

export function createSupabaseHermesRouteActivationStore(
  workspaceId: string
): SupabaseHermesRouteActivationStore {
  const supabase = createSupabaseAdminClient();
  const organizationId = process.env.LOOPGRAPH_HOSTED_ORGANIZATION_ID?.trim();
  const projectKey = process.env.LOOPGRAPH_HOSTED_PROJECT_KEY?.trim() || "default";
  if (!supabase || !organizationId) {
    throw new Error("Supabase Hermes route activation storage requires a hosted organization");
  }
  return new SupabaseHermesRouteActivationStore(supabase, {
    organizationId,
    projectKey,
    workspaceId
  });
}
