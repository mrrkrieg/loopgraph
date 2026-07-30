import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  businessProblemSchema,
  loopControllerPolicySchema,
  type LoopDesignProposal,
  type LoopOpportunity
} from "../core";
import {
  evaluateAutoShadowPolicy,
  runLoopController
} from "./loop-controller";
import { FileLoopControllerStore } from "./loop-controller-store";
import { scanLoopOpportunities } from "./loop-opportunity-engine";
import { FileRoutingStore } from "./routing-store";
import { initLoopgraphWorkspace } from "./workspace";

describe("continuous loop controller", () => {
  it("records a no-op cycle for an empty project and deduplicates the same trigger", async () => {
    const projectRoot = await temporaryProjectRoot();
    await initLoopgraphWorkspace({ projectRoot });
    const input = {
      projectRoot,
      trigger: {
        type: "schedule" as const,
        id: "schedule_2026_07_29_1200",
        sourceRef: "test:schedule"
      },
      now: new Date("2026-07-29T12:00:00.000Z")
    };

    const first = await runLoopController(input);
    const duplicate = await runLoopController(input);

    expect(first).toMatchObject({
      duplicate: false,
      run: {
        status: "completed",
        evidence: { opportunitySignalCount: 0 },
        decisions: [{ action: "no_action" }]
      }
    });
    expect(duplicate).toMatchObject({
      duplicate: true,
      run: { id: first.run.id }
    });
  });

  it("starts one durable Hermes design task and requests only its missing evidence", async () => {
    const projectRoot = await temporaryProjectRoot();
    await initLoopgraphWorkspace({ projectRoot });
    const routingStore = new FileRoutingStore(path.join(projectRoot, ".loopgraph"));
    for (let index = 1; index <= 3; index += 1) {
      await routingStore.saveBusinessProblem(problem({
        id: `problem_product_${index}`,
        updatedAt: `2026-07-29T13:0${index}:00.000Z`
      }));
    }

    const result = await runLoopController({
      projectRoot,
      trigger: {
        type: "routing_event",
        id: "routing_batch_1",
        sourceRef: "test:routing"
      },
      now: new Date("2026-07-29T13:10:00.000Z")
    });
    const store = new FileLoopControllerStore(path.join(projectRoot, ".loopgraph"));
    const checkpoint = await store.readCheckpoint();

    expect(result.run).toMatchObject({
      status: "completed",
      evidence: {
        opportunitySignalCount: 3,
        designTaskIds: [expect.stringMatching(/^hermes_task_/)]
      },
      decisions: [{
        action: "request_evidence",
        department: "product"
      }]
    });
    expect(checkpoint).toMatchObject({
      lastRunId: result.run.id,
      lastTriggerId: "routing_batch_1"
    });
  });

  it("suppresses repeated controller work while unchanged evidence is cooling down", async () => {
    const projectRoot = await temporaryProjectRoot();
    await initLoopgraphWorkspace({ projectRoot });
    await runLoopController({
      projectRoot,
      trigger: { type: "schedule", id: "cycle_1", sourceRef: "test:schedule" },
      now: new Date("2026-07-29T14:00:00.000Z")
    });

    const next = await runLoopController({
      projectRoot,
      trigger: { type: "schedule", id: "cycle_2", sourceRef: "test:schedule" },
      now: new Date("2026-07-29T14:10:00.000Z")
    });

    expect(next.duplicate).toBe(false);
    expect(next.run.decisions).toEqual([
      expect.objectContaining({
        action: "no_action",
        reason: expect.stringContaining("cooldown")
      })
    ]);
  });

  it("permits only low-risk shadow proposals outside sensitive departments", async () => {
    const projectRoot = await temporaryProjectRoot();
    await initLoopgraphWorkspace({ projectRoot });
    const routingStore = new FileRoutingStore(path.join(projectRoot, ".loopgraph"));
    for (let index = 1; index <= 3; index += 1) {
      await routingStore.saveBusinessProblem(problem({
        id: `problem_policy_${index}`,
        updatedAt: `2026-07-29T15:0${index}:00.000Z`
      }));
    }
    const scan = await scanLoopOpportunities({
      projectRoot,
      autoStartDesign: false,
      now: new Date("2026-07-29T15:10:00.000Z")
    });
    const opportunity = scan.opportunities[0]!;
    const policy = loopControllerPolicySchema.parse({
      autoDesignThreshold: 60,
      autoShadowThreshold: 60
    });
    const safeProposal = {
      rolloutStage: "shadow",
      routing: { activationMode: "shadow" },
      proposedActions: [{
        key: "classify_feedback",
        label: "Classify feedback",
        riskLevel: "low",
        requiresApproval: false,
        customerFacing: false
      }],
      openQuestions: [],
      requiredFromUser: [],
      connectorRequirements: []
    } as unknown as LoopDesignProposal;

    const safe = await evaluateAutoShadowPolicy({
      projectRoot,
      opportunity,
      proposals: [safeProposal],
      policy
    });
    const unsafe = await evaluateAutoShadowPolicy({
      projectRoot,
      opportunity: {
        ...opportunity,
        department: "legal_compliance"
      } as LoopOpportunity,
      proposals: [{
        ...safeProposal,
        proposedActions: [{
          key: "publish_policy",
          label: "Publish policy",
          riskLevel: "high",
          requiresApproval: true,
          customerFacing: true
        }]
      }],
      policy
    });

    expect(safe.passed).toBe(true);
    expect(unsafe.passed).toBe(false);
    expect(unsafe.rules.filter((rule) => !rule.passed).map((rule) => rule.id)).toEqual(
      expect.arrayContaining(["department-boundary", "read-only-low-risk-actions"])
    );
  });
});

function problem(input: { id: string; updatedAt: string }) {
  return businessProblemSchema.parse({
    id: input.id,
    workspaceId: "workspace_controller",
    companyId: "company_controller",
    problemType: "product_feedback_cluster_missing",
    subject: {
      type: "product_feedback",
      id: input.id
    },
    summary: "Product feedback has no owning loop",
    severity: "medium",
    status: "unhandled",
    correlationId: `correlation_${input.id}`,
    dedupeKey: `dedupe_${input.id}`,
    evidenceEventIds: [],
    supportingLoopIds: [],
    routeCommitIds: [],
    outcomeRefs: [],
    openedAt: input.updatedAt,
    updatedAt: input.updatedAt
  });
}

async function temporaryProjectRoot() {
  const projectRoot = await mkdtemp(path.join(tmpdir(), "loopgraph-controller-"));
  await writeFile(path.join(projectRoot, "package.json"), JSON.stringify({
    name: "loop-controller-test-project"
  }));
  return projectRoot;
}
