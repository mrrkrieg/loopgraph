import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  BusinessDiscoverySessionSchema,
  contentHash,
  designRunSchema,
  evidenceGapSetSchema,
  loopDesignContextSchema,
  loopDesignProposalSetSchema,
  type BusinessDiscoverySession,
  type DesignRun,
  type EvidenceGapSet,
  type LoopDesignContext,
  type LoopDesignProposalSet
} from "loopgraph/core";
import type {
  DesignSubmissionCreateInput,
  DesignSubmissionCreateResult,
  DiscoveryDesignStore,
  DiscoverySessionCreateResult,
  DiscoverySessionUpdateInput
} from "loopgraph/runtime";
import { createSupabaseAdminClient } from "@/lib/db/supabase-admin";

const PAGE_SIZE = 500;
const PROJECT_KEY_PATTERN = /^[a-z0-9][a-z0-9_-]{0,63}$/;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type SessionRow = {
  payload: unknown;
  revision: number | string;
};

type SessionCreateResult = {
  session: unknown;
  created: boolean;
  revision: number | string;
  conflict_reason?: string | null;
};

type SessionUpdateResult = {
  updated: boolean;
  session: unknown | null;
  revision: number | string | null;
  conflict_reason: string | null;
};

type DesignArtifactRow = {
  design_context: unknown;
  design_run: unknown;
  proposal_set: unknown;
};

type DesignArtifactCreateResult = DesignArtifactRow & {
  session: unknown;
  created: boolean;
  conflict_reason?: string | null;
};

type EvidenceGapSetResult = {
  gap_set: unknown;
  revision: number | string;
  stored: boolean;
};

export type SupabaseDiscoveryDesignStoreScope = {
  organizationId: string;
  projectKey: string;
};

/**
 * Server-only tenant-scoped persistence for discovery evidence and immutable
 * loop-design artifacts. Mutations use bounded database functions; browser
 * roles cannot read or write the underlying records.
 */
export class SupabaseDiscoveryDesignStore implements DiscoveryDesignStore {
  readonly persistence = "distributed" as const;

  constructor(
    private readonly supabase: SupabaseClient,
    private readonly scope: SupabaseDiscoveryDesignStoreScope
  ) {
    assertScope(scope);
  }

  async createSessionAtomically(
    session: BusinessDiscoverySession
  ): Promise<DiscoverySessionCreateResult> {
    const parsed = BusinessDiscoverySessionSchema.parse(session);
    const { data, error } = await this.supabase.rpc(
      "create_discovery_session",
      {
        p_organization_id: this.scope.organizationId,
        p_project_key: this.scope.projectKey,
        p_session: parsed
      }
    );
    if (error) {
      throw new Error(`Failed to create discovery session: ${error.message}`);
    }
    const result = firstRow<SessionCreateResult>(data);
    if (!result || typeof result.created !== "boolean") {
      throw new Error(
        "Discovery session creation did not return an atomic result"
      );
    }
    const saved = BusinessDiscoverySessionSchema.parse(result.session);
    if (!result.created && contentHash(saved) !== contentHash(parsed)) {
      throw new Error(
        `Discovery session already exists with conflicting content: ${parsed.id}`
      );
    }
    return {
      session: saved,
      created: result.created
    };
  }

  async getSession(
    sessionId: string
  ): Promise<BusinessDiscoverySession | undefined> {
    const { data, error } = await this.supabase
      .from("discovery_sessions")
      .select("payload, revision")
      .eq("organization_id", this.scope.organizationId)
      .eq("project_key", this.scope.projectKey)
      .eq("session_id", sessionId)
      .maybeSingle();
    if (error) {
      throw new Error(`Failed to read discovery session: ${error.message}`);
    }
    const row = data as SessionRow | null;
    if (!row) return undefined;
    const session = BusinessDiscoverySessionSchema.parse(row.payload);
    if (session.revision !== numericRevision(row.revision)) {
      throw new Error(
        `Discovery session revision is inconsistent: ${sessionId}`
      );
    }
    return session;
  }

  async listSessions(): Promise<BusinessDiscoverySession[]> {
    const sessions: BusinessDiscoverySession[] = [];
    for (let offset = 0; ; offset += PAGE_SIZE) {
      const { data, error } = await this.supabase
        .from("discovery_sessions")
        .select("payload, revision")
        .eq("organization_id", this.scope.organizationId)
        .eq("project_key", this.scope.projectKey)
        .order("updated_at", { ascending: false })
        .order("session_id", { ascending: true })
        .range(offset, offset + PAGE_SIZE - 1);
      if (error) {
        throw new Error(`Failed to list discovery sessions: ${error.message}`);
      }
      const page = (data ?? []) as SessionRow[];
      for (const row of page) {
        const session = BusinessDiscoverySessionSchema.parse(row.payload);
        if (session.revision !== numericRevision(row.revision)) {
          throw new Error(
            `Discovery session revision is inconsistent: ${session.id}`
          );
        }
        sessions.push(session);
      }
      if (page.length < PAGE_SIZE) return sessions;
    }
  }

  async updateSessionAtomically(
    input: DiscoverySessionUpdateInput
  ): Promise<BusinessDiscoverySession> {
    const parsed = BusinessDiscoverySessionSchema.parse(input.session);
    const { data, error } = await this.supabase.rpc(
      "compare_and_swap_discovery_session",
      {
        p_organization_id: this.scope.organizationId,
        p_project_key: this.scope.projectKey,
        p_session_id: input.sessionId,
        p_expected_revision: input.expectedRevision,
        p_session: parsed
      }
    );
    if (error) {
      throw new Error(`Failed to update discovery session: ${error.message}`);
    }
    const result = firstRow<SessionUpdateResult>(data);
    if (!result) {
      throw new Error("Discovery session update did not return a result");
    }
    if (result.updated) {
      return BusinessDiscoverySessionSchema.parse(result.session);
    }
    if (result.conflict_reason === "not_found") {
      throw new Error(`Discovery session not found: ${input.sessionId}`);
    }
    if (result.conflict_reason === "revision_conflict") {
      throw new Error(
        `Discovery session revision mismatch: expected ${input.expectedRevision}, found ${result.revision ?? "unknown"}`
      );
    }
    throw new Error(
      `Discovery session update failed: ${result.conflict_reason ?? "unknown conflict"}`
    );
  }

  async createDesignSubmissionAtomically(
    input: DesignSubmissionCreateInput
  ): Promise<DesignSubmissionCreateResult> {
    const context = loopDesignContextSchema.parse(input.context);
    const designRun = designRunSchema.parse(input.designRun);
    const proposalSet = loopDesignProposalSetSchema.parse(input.proposalSet);
    const idempotencyKey = stringMetadata(
      designRun.metadata,
      "submissionIdempotencyKey"
    );
    const { data, error } = await this.supabase.rpc(
      "create_loop_design_artifact",
      {
        p_organization_id: this.scope.organizationId,
        p_project_key: this.scope.projectKey,
        p_design_context: context,
        p_design_run: designRun,
        p_proposal_set: proposalSet,
        p_submission_idempotency_key: idempotencyKey ?? null
      }
    );
    if (error) {
      throw new Error(`Failed to create loop design artifact: ${error.message}`);
    }
    const result = firstRow<DesignArtifactCreateResult>(data);
    if (!result || typeof result.created !== "boolean") {
      throw new Error(
        "Loop design artifact creation did not return an atomic result"
      );
    }
    const saved = parseDesignArtifact(result);
    assertSameSubmission(input, saved);
    const session = BusinessDiscoverySessionSchema.parse(result.session);
    if (saved.context.companyId !== session.companyId) {
      throw new Error(
        "Stored loop design artifact does not match its discovery company"
      );
    }
    return {
      ...saved,
      session,
      created: result.created,
      contextRef: this.recordRef("design-contexts", saved.designRun.id),
      designRunRef: this.recordRef("design-runs", saved.designRun.id),
      proposalSetRef: this.recordRef("proposal-sets", saved.designRun.id)
    };
  }

  async getDesignContext(
    designRunId: string
  ): Promise<LoopDesignContext | undefined> {
    return (await this.getDesignArtifact(designRunId))?.context;
  }

  async getDesignRun(designRunId: string): Promise<DesignRun | undefined> {
    return (await this.getDesignArtifact(designRunId))?.designRun;
  }

  async getProposalSet(
    designRunId: string
  ): Promise<LoopDesignProposalSet | undefined> {
    return (await this.getDesignArtifact(designRunId))?.proposalSet;
  }

  async getEvidenceGapSet(
    sessionId: string
  ): Promise<EvidenceGapSet | undefined> {
    const { data, error } = await this.supabase
      .from("discovery_evidence_gap_sets")
      .select("payload, revision")
      .eq("organization_id", this.scope.organizationId)
      .eq("project_key", this.scope.projectKey)
      .eq("session_id", sessionId)
      .maybeSingle();
    if (error) {
      throw new Error(`Failed to read discovery evidence gaps: ${error.message}`);
    }
    if (!data) return undefined;
    const parsed = evidenceGapSetSchema.parse(data.payload);
    if (parsed.revision !== numericRevision(data.revision)) {
      throw new Error(
        `Discovery evidence gap revision is inconsistent: ${sessionId}`
      );
    }
    return parsed;
  }

  async putEvidenceGapSetAtomically(set: EvidenceGapSet): Promise<EvidenceGapSet> {
    const parsed = evidenceGapSetSchema.parse(set);
    const { data, error } = await this.supabase.rpc(
      "put_discovery_evidence_gap_set",
      {
        p_organization_id: this.scope.organizationId,
        p_project_key: this.scope.projectKey,
        p_gap_set: parsed
      }
    );
    if (error) {
      throw new Error(`Failed to store discovery evidence gaps: ${error.message}`);
    }
    const result = firstRow<EvidenceGapSetResult>(data);
    if (!result) {
      throw new Error("Discovery evidence gap write did not return a result");
    }
    const saved = evidenceGapSetSchema.parse(result.gap_set);
    if (saved.revision !== numericRevision(result.revision)) {
      throw new Error(
        `Discovery evidence gap revision is inconsistent: ${saved.sessionId}`
      );
    }
    return saved;
  }

  private async getDesignArtifact(
    designRunId: string
  ): Promise<
    | {
        context: LoopDesignContext;
        designRun: DesignRun;
        proposalSet: LoopDesignProposalSet;
      }
    | undefined
  > {
    const { data, error } = await this.supabase
      .from("loop_design_artifacts")
      .select("design_context, design_run, proposal_set")
      .eq("organization_id", this.scope.organizationId)
      .eq("project_key", this.scope.projectKey)
      .eq("design_run_id", designRunId)
      .maybeSingle();
    if (error) {
      throw new Error(`Failed to read loop design artifact: ${error.message}`);
    }
    return data ? parseDesignArtifact(data as DesignArtifactRow) : undefined;
  }

  private recordRef(collection: string, recordId: string): string {
    return `supabase://${this.scope.organizationId}/${this.scope.projectKey}/${collection}/${encodeURIComponent(recordId)}`;
  }
}

export function isSupabaseDiscoveryDesignStoreEnabled(
  env: NodeJS.ProcessEnv = process.env
): boolean {
  return Boolean(
    env.NEXT_PUBLIC_SUPABASE_URL &&
      env.SUPABASE_SERVICE_ROLE_KEY &&
      env.LOOPGRAPH_HOSTED_ORGANIZATION_ID
  );
}

export function createSupabaseDiscoveryDesignStore(): DiscoveryDesignStore {
  const supabase = createSupabaseAdminClient();
  const organizationId =
    process.env.LOOPGRAPH_HOSTED_ORGANIZATION_ID?.trim();
  const projectKey =
    process.env.LOOPGRAPH_HOSTED_PROJECT_KEY?.trim() || "default";
  if (!supabase || !organizationId) {
    throw new Error(
      "Supabase discovery design storage requires NEXT_PUBLIC_SUPABASE_URL, " +
        "SUPABASE_SERVICE_ROLE_KEY, and LOOPGRAPH_HOSTED_ORGANIZATION_ID"
    );
  }
  return new SupabaseDiscoveryDesignStore(supabase, {
    organizationId,
    projectKey
  });
}

function parseDesignArtifact(row: DesignArtifactRow): {
  context: LoopDesignContext;
  designRun: DesignRun;
  proposalSet: LoopDesignProposalSet;
} {
  const context = loopDesignContextSchema.parse(row.design_context);
  const designRun = designRunSchema.parse(row.design_run);
  const proposalSet = loopDesignProposalSetSchema.parse(row.proposal_set);
  if (
    context.sessionId !== designRun.sessionId ||
    proposalSet.sessionId !== designRun.sessionId ||
    context.departmentType !== designRun.departmentType ||
    proposalSet.departmentType !== designRun.departmentType ||
    context.contextHash !== designRun.inputHash ||
    designRun.outputHash !== `out_${contentHash(proposalSet)}`
  ) {
    throw new Error("Stored loop design artifact failed integrity validation");
  }
  return { context, designRun, proposalSet };
}

function assertSameSubmission(
  expected: DesignSubmissionCreateInput,
  actual: {
    context: LoopDesignContext;
    designRun: DesignRun;
    proposalSet: LoopDesignProposalSet;
  }
): void {
  if (
    expected.designRun.id !== actual.designRun.id ||
    expected.designRun.inputHash !== actual.designRun.inputHash ||
    expected.designRun.outputHash !== actual.designRun.outputHash ||
    contentHash(expected.context) !== contentHash(actual.context) ||
    contentHash(expected.proposalSet) !== contentHash(actual.proposalSet)
  ) {
    throw new Error(
      "Idempotent loop design artifact resolved to conflicting content"
    );
  }
}

function assertScope(scope: SupabaseDiscoveryDesignStoreScope): void {
  if (!UUID_PATTERN.test(scope.organizationId)) {
    throw new Error("Discovery design organization ID must be a UUID");
  }
  if (!PROJECT_KEY_PATTERN.test(scope.projectKey)) {
    throw new Error("Discovery design project key is invalid");
  }
}

function numericRevision(value: number | string): number {
  const revision = Number(value);
  if (!Number.isSafeInteger(revision) || revision < 0) {
    throw new Error("Discovery design revision is invalid");
  }
  return revision;
}

function stringMetadata(
  metadata: Record<string, unknown>,
  key: string
): string | undefined {
  const value = metadata[key];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function firstRow<T>(data: unknown): T | undefined {
  if (Array.isArray(data)) return data[0] as T | undefined;
  return data && typeof data === "object" ? (data as T) : undefined;
}
