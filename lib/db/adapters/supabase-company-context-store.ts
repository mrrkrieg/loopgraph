import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { appIdSchema, companyContextSchema, type CompanyContext } from "loopgraph/core";
import {
  approveCompanyContextValue,
  assertSecretFree,
  attachCompanyContextConsumer,
  detachCompanyContextConsumer,
  emptyCompanyContext,
  type ApproveCompanyContextValueInput,
  type AttachCompanyContextConsumerInput,
  type CompanyContextStore,
  type DetachCompanyContextConsumerInput
} from "loopgraph/runtime";
import { createSupabaseAdminClient } from "@/lib/db/supabase-admin";

const PROJECT_KEY_PATTERN = /^[a-z0-9][a-z0-9_-]{0,63}$/;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type Scope = {
  organizationId: string;
  projectKey: string;
  workspaceId: string;
  companyId: string;
};

export class SupabaseCompanyContextStore implements CompanyContextStore {
  readonly persistence = "distributed" as const;

  constructor(private readonly supabase: SupabaseClient, private readonly scope: Scope) {
    assertScope(scope);
  }

  async get(workspaceId: string, companyId: string): Promise<CompanyContext> {
    this.assertIdentity(workspaceId, companyId);
    const { data, error } = await this.supabase
      .from("loopgraph_company_contexts")
      .select("payload")
      .eq("organization_id", this.scope.organizationId)
      .eq("project_key", this.scope.projectKey)
      .eq("workspace_id", workspaceId)
      .eq("company_id", companyId)
      .maybeSingle();
    if (error) throw new Error(`Failed to read hosted company context: ${error.message}`);
    if (!data) return emptyCompanyContext(workspaceId, companyId);
    const context = companyContextSchema.parse((data as { payload: unknown }).payload);
    this.assertIdentity(context.workspaceId, context.companyId);
    return context;
  }

  async approveValue(input: ApproveCompanyContextValueInput): Promise<CompanyContext> {
    const current = await this.get(input.workspaceId, input.companyId);
    const next = approveCompanyContextValue(current, input);
    await this.commit(current.revision, next, "approve", input.approvedBy, input.proposal.key);
    return next;
  }

  async attachConsumer(input: AttachCompanyContextConsumerInput): Promise<CompanyContext> {
    const current = await this.get(input.workspaceId, input.companyId);
    const next = attachCompanyContextConsumer(current, input);
    await this.commit(current.revision, next, "attach", input.actor, input.installationId);
    return next;
  }

  async detachConsumer(input: DetachCompanyContextConsumerInput): Promise<CompanyContext> {
    const current = await this.get(input.workspaceId, input.companyId);
    const next = detachCompanyContextConsumer(current, input);
    await this.commit(current.revision, next, "detach", input.actor, input.installationId);
    return next;
  }

  private async commit(
    expectedRevision: number,
    context: CompanyContext,
    action: "approve" | "attach" | "detach",
    actor: string,
    reference: string
  ): Promise<void> {
    assertSecretFree(context, "hosted_company_context");
    const { error } = await this.supabase.rpc("commit_loopgraph_company_context", {
      p_organization_id: this.scope.organizationId,
      p_project_key: this.scope.projectKey,
      p_workspace_id: this.scope.workspaceId,
      p_company_id: this.scope.companyId,
      p_expected_revision: expectedRevision,
      p_context: context,
      p_action: action,
      p_actor: actor,
      p_reference: reference
    });
    if (error) throw new Error(`Failed to commit hosted company context: ${error.message}`);
  }

  private assertIdentity(workspaceId: string, companyId: string): void {
    if (workspaceId !== this.scope.workspaceId || companyId !== this.scope.companyId) {
      throw new Error("Company context tenant identity does not match the hosted store scope");
    }
  }
}

function assertScope(scope: Scope): void {
  if (!UUID_PATTERN.test(scope.organizationId)) throw new Error("Company context organization ID must be a UUID");
  if (!PROJECT_KEY_PATTERN.test(scope.projectKey)) throw new Error("Company context project key is invalid");
  appIdSchema.parse(scope.workspaceId);
  appIdSchema.parse(scope.companyId);
}

export function isSupabaseCompanyContextStoreEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return Boolean(env.NEXT_PUBLIC_SUPABASE_URL && env.SUPABASE_SERVICE_ROLE_KEY && env.LOOPGRAPH_HOSTED_ORGANIZATION_ID);
}

export function createSupabaseCompanyContextStore(workspaceId: string, companyId: string): SupabaseCompanyContextStore {
  const organizationId = process.env.LOOPGRAPH_HOSTED_ORGANIZATION_ID?.trim();
  if (!organizationId) throw new Error("Supabase company context storage requires a hosted organization");
  const supabase = createSupabaseAdminClient();
  if (!supabase) throw new Error("Supabase company context storage requires a hosted database");
  return new SupabaseCompanyContextStore(supabase, {
    organizationId,
    projectKey: process.env.LOOPGRAPH_HOSTED_PROJECT_KEY?.trim() || "default",
    workspaceId,
    companyId
  });
}
