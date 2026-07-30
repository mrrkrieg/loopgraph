import { access, mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  LOOPGRAPH_API_VERSION,
  LOOP_KIND,
  validateLoopSpec
} from "../core";
import {
  createStoredLoopSpecArtifact,
  FileLoopSpecRegistryStore
} from "./loop-spec-store";

describe("FileLoopSpecRegistryStore", () => {
  it("commits a version, active workspace entry, fixtures, and receipt", async () => {
    const projectRoot = await temporaryProjectRoot();
    const store = new FileLoopSpecRegistryStore(projectRoot);
    const artifact = testArtifact("marketing_ads");
    const input = {
      commitId: "commit_1",
      idempotencyKey: "materialization_1",
      expectedRevision: 0,
      projectRoot,
      committedAt: "2026-07-30T12:00:00.000Z",
      artifacts: [artifact]
    };

    const first = await store.commitMaterializationAtomically(input);
    const replay = await store.commitMaterializationAtomically(input);

    expect(first.created).toBe(true);
    expect(first.workspaceRevision).toBe(1);
    expect(first.workspace.registeredSpecs).toEqual([
      expect.objectContaining({
        id: "marketing_ads",
        path: ".loopgraph/generated/marketing_ads/loopgraph.yaml"
      })
    ]);
    expect(replay).toMatchObject({
      created: false,
      workspaceRevision: 1,
      commitRef: first.commitRef
    });
    expect((await store.getWorkspace(projectRoot)).revision).toBe(1);
    expect(await store.getActiveLoopSpec(projectRoot, "marketing_ads"))
      .toMatchObject({
        loopId: "marketing_ads",
        versionHash: artifact.versionHash
      });
    await access(
      path.join(
        projectRoot,
        ".loopgraph/generated/marketing_ads/fixtures/happy-path.json"
      )
    );
    expect(
      JSON.parse(
        await readFile(
          path.join(
            projectRoot,
            ".loopgraph/generated/marketing_ads/fixtures/happy-path.json"
          ),
          "utf8"
        )
      )
    ).toEqual({ synthetic: true });
  });

  it("rejects stale revisions, conflicting replays, and escaped paths", async () => {
    const projectRoot = await temporaryProjectRoot();
    const store = new FileLoopSpecRegistryStore(projectRoot);
    const artifact = testArtifact("product_feedback");
    const input = {
      commitId: "commit_2",
      idempotencyKey: "materialization_2",
      expectedRevision: 0,
      projectRoot,
      committedAt: "2026-07-30T12:00:00.000Z",
      artifacts: [artifact]
    };
    await store.commitMaterializationAtomically(input);

    await expect(
      store.commitMaterializationAtomically({
        ...input,
        commitId: "commit_stale",
        idempotencyKey: "materialization_stale"
      })
    ).rejects.toThrow("revision mismatch");
    await expect(
      store.commitMaterializationAtomically({
        ...input,
        artifacts: [testArtifact("product_feedback", "Changed")]
      })
    ).rejects.toThrow("conflicting content");
    await expect(
      new FileLoopSpecRegistryStore(projectRoot)
        .commitMaterializationAtomically({
          commitId: "commit_escape",
          idempotencyKey: "materialization_escape",
          expectedRevision: 1,
          projectRoot,
          committedAt: "2026-07-30T12:01:00.000Z",
          artifacts: [{
            ...testArtifact("escaped_loop"),
            entry: {
              ...testArtifact("escaped_loop").entry,
              path: "../escaped.yaml"
            }
          }]
        })
    ).rejects.toThrow("escapes the project root");
  });
});

async function temporaryProjectRoot(): Promise<string> {
  return mkdtemp(path.join(tmpdir(), "loop-spec-registry-"));
}

function testArtifact(loopId: string, name = "Test Loop") {
  const spec = validateLoopSpec({
    apiVersion: LOOPGRAPH_API_VERSION,
    kind: LOOP_KIND,
    metadata: {
      id: loopId,
      name,
      version: "1.0.0",
      labels: { source: "hermes-design" }
    },
    trigger: {
      type: "event",
      source: "hermes",
      event: "business.problem"
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
        id: "review",
        name: "Review",
        stepType: "review",
        actor: "agent",
        description: "Review the business problem."
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
    topology: { department: "marketing" },
    routing: {
      schemaVersion: "routing-contract/v1alpha1",
      problemTypes: ["business_problem"],
      accepts: [{
        sourcePattern: "*",
        eventTypePattern: "business.*",
        subjectTypes: ["business_problem"],
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
      id: loopId,
      name,
      path: `.loopgraph/generated/${loopId}/loopgraph.yaml`,
      templateId: "hermes-design",
      department: "marketing",
      addedAt: "2026-07-30T12:00:00.000Z"
    },
    fixtures: {
      "fixtures/happy-path.json": { synthetic: true }
    },
    source: "hermes_design",
    createdAt: "2026-07-30T12:00:00.000Z"
  });
}
