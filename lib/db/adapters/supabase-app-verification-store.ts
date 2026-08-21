import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  appIndependentVerificationReceiptSchema,
  appVerifierTrustKeySchema,
  type AppIndependentVerificationReceipt,
  type AppVerifierTrustKey
} from "loopgraph/core";
import {
  APP_VERIFICATION_REGISTRY_SCHEMA_VERSION,
  validateAppVerifierPublicKey,
  verifyAppIndependentVerificationReceipt,
  type AppVerificationImportContext,
  type AppVerificationRegistry,
  type AppVerificationStore
} from "loopgraph/runtime";
import { z } from "zod";
import { createSupabaseAdminClient } from "@/lib/db/supabase-admin";

const PAGE_SIZE = 500;
const PROJECT_KEY_PATTERN = /^[a-z0-9][a-z0-9_-]{0,63}$/;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type Scope = { organizationId: string; projectKey: string; workspaceId: string };

const revocationInputSchema = z.object({
  verifierId: z.string().min(1).max(300),
  keyId: z.string().min(1).max(160),
  revokedBy: z.string().min(1).max(300),
  revocationRef: z.string().min(1).max(1000),
  revokedAt: z.string().datetime()
}).strict();

const importContextSchema = z.object({
  importedBy: z.string().min(1).max(300),
  importRef: z.string().min(1).max(1000),
  importedAt: z.string().datetime()
}).strict();

/** Tenant-isolated hosted App verifier trust and receipt persistence. */
export class SupabaseAppVerificationStore implements AppVerificationStore {
  readonly persistence = "distributed" as const;

  constructor(private readonly supabase: SupabaseClient, private readonly scope: Scope) {
    if (!UUID_PATTERN.test(scope.organizationId)) throw new Error("App verification store organization ID must be a UUID");
    if (!PROJECT_KEY_PATTERN.test(scope.projectKey)) throw new Error("App verification store project key is invalid");
    if (scope.workspaceId.length < 1 || scope.workspaceId.length > 160) throw new Error("App verification store workspace ID is invalid");
  }

  async read(): Promise<AppVerificationRegistry> {
    const [state, trustedVerifierKeys, receipts] = await Promise.all([
      this.readState(),
      this.listPayloads("loopgraph_app_verifier_keys", appVerifierTrustKeySchema),
      this.listPayloads("loopgraph_app_verification_receipts", appIndependentVerificationReceiptSchema)
    ]);
    return {
      schemaVersion: APP_VERIFICATION_REGISTRY_SCHEMA_VERSION,
      workspaceId: this.scope.workspaceId,
      revision: state?.revision ?? 0,
      trustedVerifierKeys: trustedVerifierKeys.sort((left, right) => `${left.verifierId}/${left.keyId}`.localeCompare(`${right.verifierId}/${right.keyId}`)),
      receipts: receipts.sort((left, right) => left.verifiedAt.localeCompare(right.verifiedAt)),
      updatedAt: state?.updatedAt ?? new Date(0).toISOString()
    };
  }

  async trustVerifierKey(input: AppVerifierTrustKey): Promise<AppVerificationRegistry> {
    const key = appVerifierTrustKeySchema.parse(input);
    if (!validateAppVerifierPublicKey(key)) throw new Error("Verifier public key must be a valid Ed25519 public key");
    const { error } = await this.supabase.rpc("trust_loopgraph_app_verifier_key", {
      p_organization_id: this.scope.organizationId,
      p_project_key: this.scope.projectKey,
      p_workspace_id: this.scope.workspaceId,
      p_key: key
    });
    if (error) throw new Error(`Failed to trust App verifier key: ${error.message}`);
    return this.read();
  }

  async revokeVerifierKey(input: {
    verifierId: string;
    keyId: string;
    revokedBy: string;
    revocationRef: string;
    revokedAt: string;
  }): Promise<AppVerificationRegistry> {
    const parsed = revocationInputSchema.parse(input);
    const { error } = await this.supabase.rpc("revoke_loopgraph_app_verifier_key", {
      p_organization_id: this.scope.organizationId,
      p_project_key: this.scope.projectKey,
      p_workspace_id: this.scope.workspaceId,
      p_verifier_id: parsed.verifierId,
      p_key_id: parsed.keyId,
      p_revoked_by: parsed.revokedBy,
      p_revocation_ref: parsed.revocationRef,
      p_revoked_at: parsed.revokedAt
    });
    if (error) throw new Error(`Failed to revoke App verifier key: ${error.message}`);
    return this.read();
  }

  async importReceipt(
    receiptInput: AppIndependentVerificationReceipt,
    contextInput: AppVerificationImportContext
  ): Promise<AppVerificationRegistry> {
    const receipt = appIndependentVerificationReceiptSchema.parse(receiptInput);
    const context = importContextSchema.parse(contextInput);
    const registry = await this.read();
    const key = registry.trustedVerifierKeys.find((candidate) =>
      candidate.verifierId === receipt.verifierId && candidate.keyId === receipt.signature.keyId);
    if (!key || !verifyAppIndependentVerificationReceipt(receipt, key)) {
      throw new Error("Independent App verification receipt is not signed by an active trusted verifier key");
    }
    const { error } = await this.supabase.rpc("import_loopgraph_app_verification_receipt", {
      p_organization_id: this.scope.organizationId,
      p_project_key: this.scope.projectKey,
      p_workspace_id: this.scope.workspaceId,
      p_receipt: receipt,
      p_imported_by: context.importedBy,
      p_import_ref: context.importRef,
      p_imported_at: context.importedAt
    });
    if (error) throw new Error(`Failed to import App verification receipt: ${error.message}`);
    return this.read();
  }

  private async readState(): Promise<{ revision: number; updatedAt: string } | undefined> {
    const { data, error } = await this.supabase
      .from("loopgraph_app_verification_registries")
      .select("revision,updated_at")
      .eq("organization_id", this.scope.organizationId)
      .eq("project_key", this.scope.projectKey)
      .eq("workspace_id", this.scope.workspaceId)
      .maybeSingle();
    if (error) throw new Error(`Failed to read App verification registry: ${error.message}`);
    if (!data) return undefined;
    const row = data as { revision: number | string; updated_at: string };
    const revision = Number(row.revision);
    if (!Number.isSafeInteger(revision) || revision < 0) throw new Error("App verification registry revision is invalid");
    return { revision, updatedAt: new Date(row.updated_at).toISOString() };
  }

  private async listPayloads<T>(table: string, schema: { parse(value: unknown): T }): Promise<T[]> {
    const values: T[] = [];
    for (let offset = 0; ; offset += PAGE_SIZE) {
      const { data, error } = await this.supabase
        .from(table)
        .select("payload")
        .eq("organization_id", this.scope.organizationId)
        .eq("project_key", this.scope.projectKey)
        .eq("workspace_id", this.scope.workspaceId)
        .order("created_at", { ascending: true })
        .range(offset, offset + PAGE_SIZE - 1);
      if (error) throw new Error(`Failed to list App verification records: ${error.message}`);
      const page = (data ?? []) as Array<{ payload: unknown }>;
      values.push(...page.map((row) => schema.parse(row.payload)));
      if (page.length < PAGE_SIZE) return values;
    }
  }
}

export function isSupabaseAppVerificationStoreEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return Boolean(env.NEXT_PUBLIC_SUPABASE_URL && env.SUPABASE_SERVICE_ROLE_KEY && env.LOOPGRAPH_HOSTED_ORGANIZATION_ID);
}

export function createSupabaseAppVerificationStore(workspaceId: string): SupabaseAppVerificationStore {
  const supabase = createSupabaseAdminClient();
  const organizationId = process.env.LOOPGRAPH_HOSTED_ORGANIZATION_ID?.trim();
  const projectKey = process.env.LOOPGRAPH_HOSTED_PROJECT_KEY?.trim() || "default";
  if (!supabase || !organizationId) throw new Error("Supabase App verification storage requires a hosted organization");
  return new SupabaseAppVerificationStore(supabase, { organizationId, projectKey, workspaceId });
}
