import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";
import {
  LOOPGRAPH_API_VERSION,
  LOOP_KIND,
  validateLoopSpec
} from "loopgraph/core";
import {
  createStoredLoopSpecArtifact
} from "loopgraph/runtime";
import {
  SupabaseLoopSpecRegistryStore,
  isSupabaseLoopSpecRegistryStoreEnabled
} from "./supabase-loop-spec-registry-store";

const scope = {
  organizationId: "123e4567-e89b-12d3-a456-426614174000",
  projectKey: "main"
};

describe("Supabase LoopSpec registry store", () => {
  it("requires service storage and rejects unsafe tenant scopes", () => {
    expect(isSupabaseLoopSpecRegistryStoreEnabled({
      NEXT_PUBLIC_SUPABASE_URL: "https://example.supabase.co",
      SUPABASE_SERVICE_ROLE_KEY: "service",
      LOOPGRAPH_HOSTED_ORGANIZATION_ID: ""
    })).toBe(false);
    expect(isSupabaseLoopSpecRegistryStoreEnabled({
      NEXT_PUBLIC_SUPABASE_URL: "https://example.supabase.co",
      SUPABASE_SERVICE_ROLE_KEY: "service",
      LOOPGRAPH_HOSTED_ORGANIZATION_ID: scope.organizationId
    })).toBe(true);

    const client = { rpc: vi.fn(), from: vi.fn() } as unknown as SupabaseClient;
    expect(() => new SupabaseLoopSpecRegistryStore(client, {
      organizationId: "../other",
      projectKey: "main"
    })).toThrow("organization ID");
    expect(() => new SupabaseLoopSpecRegistryStore(client, {
      organizationId: scope.organizationId,
      projectKey: "../../escape"
    })).toThrow("project key");
  });

  it("normalizes hosted artifact references and uses the atomic commit RPC", async () => {
    const artifact = testArtifact();
    const rpc = vi.fn().mockImplementation(
      async (
        name: string,
        args: Record<string, unknown> & {
          p_artifacts: typeof artifact[];
          p_workspace_seed: Record<string, unknown>;
        }
      ) => {
        expect(name).toBe("commit_loop_spec_registry");
        const savedArtifact = args.p_artifacts[0]!;
        return {
          data: [{
            workspace: {
              ...args.p_workspace_seed,
              registeredSpecs: [savedArtifact.entry],
              updatedAt: "2026-07-30T12:00:00.000Z"
            },
            workspace_revision: 1,
            artifacts: [savedArtifact],
            discovery_session: null,
            created: true
          }],
          error: null
        };
      }
    );
    const store = new SupabaseLoopSpecRegistryStore(
      { rpc, from: vi.fn() } as unknown as SupabaseClient,
      scope
    );

    const result = await store.commitMaterializationAtomically({
      commitId: "commit_1",
      idempotencyKey: "materialization_1",
      expectedRevision: 0,
      projectRoot: "/runtime/project",
      committedAt: "2026-07-30T12:00:00.000Z",
      artifacts: [artifact]
    });

    expect(result).toMatchObject({
      created: true,
      workspaceRevision: 1,
      commitRef:
        `supabase://${scope.organizationId}/main/loop-spec-commits/commit_1`
    });
    const rpcArgs = rpc.mock.calls[0]![1] as {
      p_artifacts: Array<{
        sourceRef: string;
        entry: { path: string };
      }>;
    };
    expect(rpcArgs.p_artifacts[0]!.sourceRef).toContain(
      "/loop-specs/product_feedback/versions/"
    );
    expect(rpcArgs.p_artifacts[0]!.entry.path)
      .toBe(rpcArgs.p_artifacts[0]!.sourceRef);
    expect(result.artifacts[0]!.entry.path)
      .toBe(result.artifacts[0]!.sourceRef);
  });

  it("validates active registry rows before returning them", async () => {
    const artifact = testArtifact();
    const sourceRef =
      `supabase://${scope.organizationId}/main/loop-specs/${artifact.loopId}/versions/${artifact.versionHash}`;
    const query = paginatedQuery([{
      loop_id: artifact.loopId,
      active_version_hash: artifact.versionHash,
      spec: artifact.spec,
      entry: { ...artifact.entry, path: sourceRef },
      fixtures: artifact.fixtures,
      source: artifact.source,
      source_ref: sourceRef,
      activated_at: artifact.createdAt
    }]);
    const store = new SupabaseLoopSpecRegistryStore(
      { rpc: vi.fn(), from: vi.fn(() => query) } as unknown as SupabaseClient,
      scope
    );

    await expect(store.listActiveLoopSpecs("/runtime/project"))
      .resolves.toEqual([
        expect.objectContaining({
          loopId: "product_feedback",
          sourceRef
        })
      ]);
  });
});

function paginatedQuery(rows: unknown[]) {
  const query = {
    select: vi.fn(() => query),
    eq: vi.fn(() => query),
    order: vi.fn(() => query),
    range: vi.fn(async () => ({ data: rows, error: null }))
  };
  return query;
}

function testArtifact() {
  const spec = validateLoopSpec({
    apiVersion: LOOPGRAPH_API_VERSION,
    kind: LOOP_KIND,
    metadata: {
      id: "product_feedback",
      name: "Product Feedback",
      version: "1.0.0",
      labels: { source: "hermes-design" }
    },
    trigger: {
      type: "event",
      source: "hermes",
      event: "feedback.received"
    },
    input: { schema: { type: "object" } },
    output: {
      schema: {
        type: "object",
        properties: {
          evidence: { type: "array", items: { type: "object" } }
        }
      }
    },
    context: { sources: [], precedence: [] },
    routine: {
      steps: [{
        id: "cluster",
        name: "Cluster",
        stepType: "cluster",
        actor: "agent",
        description: "Cluster product feedback."
      }]
    },
    tools: [],
    policy: {
      allowedActions: [],
      forbiddenActions: [],
      escalationRules: []
    },
    verification: [],
    approval: {
      requireFingerprintMatch: true,
      separateCustomerFacingApproval: true,
      allowedRoles: ["owner"]
    },
    persistence: { idempotency: { enabled: true } },
    trace: {
      captureContextSnapshot: true,
      captureToolInputOutput: true,
      evidenceRequired: true
    },
    topology: { department: "product" },
    routing: {
      schemaVersion: "routing-contract/v1alpha1",
      problemTypes: ["product_feedback"],
      accepts: [{
        sourcePattern: "product_events",
        eventTypePattern: "feedback.*",
        subjectTypes: ["feedback"],
        requiredFields: []
      }],
      inputMapping: {},
      minimumConfidence: 0.8,
      activationMode: "shadow"
    }
  });
  return createStoredLoopSpecArtifact({
    spec,
    entry: {
      id: spec.metadata.id,
      name: spec.metadata.name,
      path: ".loopgraph/generated/product_feedback/loopgraph.yaml",
      templateId: "hermes-design",
      department: "product",
      addedAt: "2026-07-30T12:00:00.000Z"
    },
    fixtures: {},
    source: "hermes_design",
    createdAt: "2026-07-30T12:00:00.000Z"
  });
}
