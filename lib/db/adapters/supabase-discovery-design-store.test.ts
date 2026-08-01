import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";
import {
  BusinessDiscoverySessionSchema,
  contentHash,
  designRunSchema,
  evidenceGapSetSchema,
  loopDesignContextSchema,
  loopDesignProposalSetSchema
} from "loopgraph/core";
import {
  SupabaseDiscoveryDesignStore,
  isSupabaseDiscoveryDesignStoreEnabled
} from "./supabase-discovery-design-store";

const scope = {
  organizationId: "123e4567-e89b-12d3-a456-426614174000",
  projectKey: "main"
};

describe("Supabase discovery design store", () => {
  it("requires the service boundary and rejects unsafe scopes", () => {
    expect(
      isSupabaseDiscoveryDesignStoreEnabled({
        NODE_ENV: "test",
        NEXT_PUBLIC_SUPABASE_URL: "https://example.supabase.co",
        SUPABASE_SERVICE_ROLE_KEY: "service",
        LOOPGRAPH_HOSTED_ORGANIZATION_ID: ""
      } as NodeJS.ProcessEnv)
    ).toBe(false);
    expect(
      isSupabaseDiscoveryDesignStoreEnabled({
        NODE_ENV: "test",
        NEXT_PUBLIC_SUPABASE_URL: "https://example.supabase.co",
        SUPABASE_SERVICE_ROLE_KEY: "service",
        LOOPGRAPH_HOSTED_ORGANIZATION_ID: scope.organizationId
      } as NodeJS.ProcessEnv)
    ).toBe(true);

    const client = { rpc: vi.fn(), from: vi.fn() } as unknown as SupabaseClient;
    expect(
      () =>
        new SupabaseDiscoveryDesignStore(client, {
          organizationId: "../other",
          projectKey: "main"
        })
    ).toThrow("organization ID");
    expect(
      () =>
        new SupabaseDiscoveryDesignStore(client, {
          organizationId: scope.organizationId,
          projectKey: "../../escape"
        })
    ).toThrow("project key");
  });

  it("creates sessions through the tenant-scoped database function", async () => {
    const session = discoverySession();
    const rpc = vi.fn().mockResolvedValue({
      data: [{ session, created: true, revision: 0 }],
      error: null
    });
    const store = new SupabaseDiscoveryDesignStore(
      { rpc, from: vi.fn() } as unknown as SupabaseClient,
      scope
    );

    await expect(store.createSessionAtomically(session)).resolves.toEqual({
      session,
      created: true
    });
    expect(rpc).toHaveBeenCalledWith("create_discovery_session", {
      p_organization_id: scope.organizationId,
      p_project_key: scope.projectKey,
      p_session: session
    });
  });

  it("rejects a create retry that resolves to conflicting session content", async () => {
    const session = discoverySession();
    const conflicting = BusinessDiscoverySessionSchema.parse({
      ...session,
      companyId: "company_other"
    });
    const rpc = vi.fn().mockResolvedValue({
      data: [{ session: conflicting, created: false, revision: 0 }],
      error: null
    });
    const store = new SupabaseDiscoveryDesignStore(
      { rpc, from: vi.fn() } as unknown as SupabaseClient,
      scope
    );

    await expect(store.createSessionAtomically(session)).rejects.toThrow(
      "already exists with conflicting content"
    );
  });

  it("uses revision fencing for session updates", async () => {
    const current = discoverySession();
    const next = BusinessDiscoverySessionSchema.parse({
      ...current,
      revision: 1,
      activeStage: "department_selection",
      updatedAt: "2026-07-30T12:01:00.000Z"
    });
    const rpc = vi.fn().mockResolvedValue({
      data: [{
        updated: false,
        session: current,
        revision: 2,
        conflict_reason: "revision_conflict"
      }],
      error: null
    });
    const store = new SupabaseDiscoveryDesignStore(
      { rpc, from: vi.fn() } as unknown as SupabaseClient,
      scope
    );

    await expect(
      store.updateSessionAtomically({
        sessionId: current.id,
        expectedRevision: 0,
        session: next
      })
    ).rejects.toThrow("expected 0, found 2");
  });

  it("stores context, run, proposal, and session linkage atomically", async () => {
    const session = BusinessDiscoverySessionSchema.parse({
      ...discoverySession(),
      revision: 1,
      designRunIds: ["design_1"],
      activeStage: "proposal_review"
    });
    const artifact = designArtifact();
    const rpc = vi.fn().mockResolvedValue({
      data: [{
        design_context: artifact.context,
        design_run: artifact.designRun,
        proposal_set: artifact.proposalSet,
        session,
        created: true,
        conflict_reason: null
      }],
      error: null
    });
    const store = new SupabaseDiscoveryDesignStore(
      { rpc, from: vi.fn() } as unknown as SupabaseClient,
      scope
    );

    const result = await store.createDesignSubmissionAtomically(artifact);

    expect(result.created).toBe(true);
    expect(result.designRun.id).toBe("design_1");
    expect(result.session.designRunIds).toEqual(["design_1"]);
    expect(result.designRunRef).toContain("/design-runs/design_1");
    expect(rpc).toHaveBeenCalledWith("create_loop_design_artifact", {
      p_organization_id: scope.organizationId,
      p_project_key: scope.projectKey,
      p_design_context: artifact.context,
      p_design_run: artifact.designRun,
      p_proposal_set: artifact.proposalSet,
      p_submission_idempotency_key: "callback_1"
    });
  });

  it("rejects a design artifact linked to another discovery company", async () => {
    const session = BusinessDiscoverySessionSchema.parse({
      ...discoverySession(),
      companyId: "company_other",
      revision: 1,
      designRunIds: ["design_1"],
      activeStage: "proposal_review"
    });
    const artifact = designArtifact();
    const rpc = vi.fn().mockResolvedValue({
      data: [{
        design_context: artifact.context,
        design_run: artifact.designRun,
        proposal_set: artifact.proposalSet,
        session,
        created: true,
        conflict_reason: null
      }],
      error: null
    });
    const store = new SupabaseDiscoveryDesignStore(
      { rpc, from: vi.fn() } as unknown as SupabaseClient,
      scope
    );

    await expect(
      store.createDesignSubmissionAtomically(artifact)
    ).rejects.toThrow("does not match its discovery company");
  });

  it("writes evidence gaps through the monotonic revision function", async () => {
    const gapSet = evidenceGapSetSchema.parse({
      sessionId: "session_1",
      companyId: "company_1",
      revision: 3,
      generatedAt: "2026-07-30T12:03:00.000Z",
      gaps: []
    });
    const rpc = vi.fn().mockResolvedValue({
      data: [{ gap_set: gapSet, revision: 3, stored: true }],
      error: null
    });
    const store = new SupabaseDiscoveryDesignStore(
      { rpc, from: vi.fn() } as unknown as SupabaseClient,
      scope
    );

    await expect(store.putEvidenceGapSetAtomically(gapSet)).resolves.toEqual(
      gapSet
    );
    expect(rpc).toHaveBeenCalledWith("put_discovery_evidence_gap_set", {
      p_organization_id: scope.organizationId,
      p_project_key: scope.projectKey,
      p_gap_set: gapSet
    });
  });
});

function discoverySession() {
  return BusinessDiscoverySessionSchema.parse({
    id: "session_1",
    companyId: "company_1",
    status: "started",
    activeStage: "workspace",
    revision: 0,
    createdByActor: "api",
    lastActor: "api",
    companyProfile: {
      id: "company_1",
      departments: [],
      tools: [],
      bottlenecks: [],
      recurringWork: [],
      aiNeverActions: [],
      customerFacingOutputs: [],
      leadershipJudgment: []
    },
    createdAt: "2026-07-30T12:00:00.000Z",
    updatedAt: "2026-07-30T12:00:00.000Z"
  });
}

function designArtifact() {
  const context = loopDesignContextSchema.parse({
    sessionId: "session_1",
    companyId: "company_1",
    departmentType: "product",
    readiness: "ready_for_design",
    blockers: [],
    projectSummary: {
      projectRootId: "project_1",
      displayName: "Acme",
      registeredSpecCount: 0,
      registeredDepartments: [],
      routingReadySpecCount: 0
    },
    projectInspection: {
      projectRootId: "project_1",
      policy: {
        secretsRead: false,
        allowlistedManifestOnly: true,
        ignoredPaths: [],
        maxFileBytes: 1024
      },
      manifests: [],
      stack: {},
      env: {},
      evidence: [],
      warnings: []
    },
    confirmedAnswers: [],
    departmentBranchQuestions: [],
    deterministicCandidates: [],
    connectorStatus: [],
    existingLoops: [],
    companyBoundaries: [],
    contextHash: "ctx_1"
  });
  const proposalSet = loopDesignProposalSetSchema.parse({
    sessionId: "session_1",
    departmentType: "product",
    providerMode: "hermes_host",
    reasoningProfile: "high",
    proposals: [{
      proposalId: "proposal_1",
      loopSpecId: "product_feedback",
      shortName: "Feedback",
      department: "product",
      goal: "Cluster product feedback.",
      businessOutcome: "Product teams receive evidence-backed themes.",
      reasoningSummary: "Repeated feedback should be grouped into one loop.",
      trigger: {
        type: "event",
        description: "A feedback event arrives."
      },
      workItem: "One feedback item.",
      routineSteps: [{
        id: "observe",
        label: "Observe",
        actor: "agent",
        description: "Read the feedback."
      }],
      proposedActions: [],
      verifiers: [{
        type: "evidence",
        description: "Every theme cites source feedback."
      }],
      metrics: {
        primary: "reviewed feedback themes",
        guardrails: ["No unsupported claims"]
      },
      ownerRole: "Product lead",
      reviewerRoles: ["Product lead"],
      escalationConditions: [],
      forbiddenActions: [],
      connectorRequirements: [],
      manualFallbacks: ["Manual export"],
      topologyPreview: {
        nodes: [],
        edges: []
      },
      routing: {
        problemTypes: ["product_feedback_received"],
        accepts: [{
          sourcePattern: "*",
          eventTypePattern: "feedback.received"
        }]
      }
    }],
    validationSummary: {
      valid: true,
      errors: []
    }
  });
  const designRun = designRunSchema.parse({
    id: "design_1",
    sessionId: "session_1",
    departmentType: "product",
    providerMode: "hermes_host",
    providerName: "hermes",
    reasoningProfile: "high",
    promptVersion: "loop-design-prompt/v1alpha1",
    inputHash: context.contextHash,
    outputHash: `out_${contentHash(proposalSet)}`,
    startedAt: "2026-07-30T12:01:00.000Z",
    completedAt: "2026-07-30T12:01:00.000Z",
    validationAttempts: 1,
    validationErrors: [],
    finalProposalIds: ["proposal_1"],
    metadata: {
      submissionIdempotencyKey: "callback_1"
    }
  });
  return { context, designRun, proposalSet };
}
