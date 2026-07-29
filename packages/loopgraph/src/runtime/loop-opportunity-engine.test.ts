import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  businessProblemSchema,
  routingCorrectionSchema
} from "../core";
import {
  dismissLoopOpportunity,
  getGraphChangeSet,
  getLoopOpportunity,
  markLoopOpportunityImplemented,
  scanLoopOpportunities
} from "./loop-opportunity-engine";
import { FileRoutingStore } from "./routing-store";
import { loopgraph_graph_get } from "./routing-ops-tools";
import {
  initLoopgraphWorkspace,
  writeLoopgraphWorkspace
} from "./workspace";

describe("loop opportunity engine", () => {
  it("turns recurring unhandled problems into one idempotent Hermes design task and graph addition", async () => {
    const projectRoot = await temporaryProjectRoot();
    await initLoopgraphWorkspace({
      projectRoot,
      displayName: "Product Company",
      now: new Date("2026-07-29T14:00:00.000Z")
    });
    const store = new FileRoutingStore(path.join(projectRoot, ".loopgraph"));
    for (let index = 1; index <= 3; index += 1) {
      await store.saveBusinessProblem(problem({
        id: `problem_feedback_${index}`,
        problemType: "product_feedback_cluster_missing",
        summary: `Product feedback cluster ${index} has no owning loop`,
        subjectId: `feedback_${index}`,
        updatedAt: `2026-07-29T14:0${index}:00.000Z`
      }));
    }

    const first = await scanLoopOpportunities({
      projectRoot,
      autoStartDesign: true,
      now: new Date("2026-07-29T14:10:00.000Z")
    }, { routingStore: store });
    const second = await scanLoopOpportunities({
      projectRoot,
      autoStartDesign: true,
      now: new Date("2026-07-29T14:11:00.000Z")
    }, { routingStore: store });

    expect(first.opportunities).toHaveLength(1);
    expect(first.opportunities[0]).toMatchObject({
      department: "product",
      kind: "create_loop",
      status: "design_requested",
      problemType: "product_feedback_cluster_missing",
      score: {
        coverageGap: 25
      }
    });
    expect(first.opportunities[0]!.score.total).toBeGreaterThanOrEqual(65);
    expect(first.designDispatches).toHaveLength(1);
    expect(first.designDispatches[0]?.task).toMatchObject({
      reason: "loop_opportunity",
      originOpportunityId: first.opportunities[0]!.id,
      originProblemIds: [
        "problem_feedback_1",
        "problem_feedback_2",
        "problem_feedback_3"
      ],
      delivery: { status: "not_configured" }
    });
    expect(first.graphChangeSets[0]).toMatchObject({
      status: "proposed",
      changes: [{
        operation: "add",
        department: "product",
        proposedLoopCount: 1,
        requiresExplicitApproval: true
      }]
    });
    const graph = await loopgraph_graph_get({
      projectRoot,
      projection: "design",
      includeConnections: false,
      includeOpportunities: true
    }, {
      now: new Date("2026-07-29T14:10:30.000Z")
    });
    expect(graph.graphProjection.nodes).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: `opportunity:${first.opportunities[0]!.id}`, type: "opportunity" }),
      expect.objectContaining({ id: `graph-change:${first.graphChangeSets[0]!.id}`, type: "graph_change" })
    ]));
    expect(second.opportunities[0]?.id).toBe(first.opportunities[0]?.id);
    expect(second.opportunities[0]?.designTaskId).toBe(first.opportunities[0]?.designTaskId);
    expect(second.graphChangeSets[0]?.id).toBe(first.graphChangeSets[0]?.id);

    await store.saveBusinessProblem(problem({
      id: "problem_feedback_4",
      problemType: "product_feedback_cluster_missing",
      summary: "A fourth feedback cluster has no owning loop",
      subjectId: "feedback_4",
      updatedAt: "2026-07-29T14:12:00.000Z"
    }));
    const changed = await scanLoopOpportunities({
      projectRoot,
      autoStartDesign: false,
      now: new Date("2026-07-29T14:13:00.000Z")
    }, { routingStore: store });
    expect(changed.graphChangeSets[0]).toMatchObject({
      version: 2,
      supersedesId: first.graphChangeSets[0]!.id
    });
    expect(await getGraphChangeSet(first.graphChangeSets[0]!.id, projectRoot)).toMatchObject({
      status: "superseded"
    });

    const task = first.designDispatches[0]!.task;
    await writeFile(
      path.join(
        projectRoot,
        ".loopgraph",
        "hermes",
        "design-tasks",
        `${encodeURIComponent(task.id)}.json`
      ),
      `${JSON.stringify({
        ...task,
        status: "completed",
        designRunIds: ["design_run_product_feedback"],
        completedAt: "2026-07-29T14:14:00.000Z",
        updatedAt: "2026-07-29T14:14:00.000Z"
      }, null, 2)}\n`
    );
    const implemented = await markLoopOpportunityImplemented({
      projectRoot,
      designRunId: "design_run_product_feedback",
      now: new Date("2026-07-29T14:15:00.000Z")
    });
    expect(implemented.opportunities).toEqual([
      expect.objectContaining({ status: "implemented" })
    ]);
    expect(implemented.graphChangeSets).toEqual([
      expect.objectContaining({
        id: changed.graphChangeSets[0]!.id,
        status: "applied",
        designRunId: "design_run_product_feedback"
      })
    ]);

    await store.saveBusinessProblem(problem({
      id: "problem_feedback_5",
      problemType: "product_feedback_cluster_missing",
      summary: "New feedback failures appeared after the first loop was materialized",
      subjectId: "feedback_5",
      updatedAt: "2026-07-29T14:16:00.000Z"
    }));
    const nextGeneration = await scanLoopOpportunities({
      projectRoot,
      autoStartDesign: false,
      now: new Date("2026-07-29T14:17:00.000Z")
    }, { routingStore: store });
    expect(nextGeneration.opportunities[0]).toMatchObject({
      generation: 2,
      supersedesOpportunityId: implemented.opportunities[0]!.id,
      status: "qualified"
    });
    expect(nextGeneration.opportunities[0]!.id).not.toBe(implemented.opportunities[0]!.id);
  });

  it("proposes a versioned split when repeated human corrections show one loop owns multiple routes", async () => {
    const projectRoot = await temporaryProjectRoot();
    const workspace = await initLoopgraphWorkspace({
      projectRoot,
      displayName: "Support Company",
      now: new Date("2026-07-29T15:00:00.000Z")
    });
    await mkdir(path.join(projectRoot, ".loopgraph", "generated", "support"), { recursive: true });
    await writeLoopgraphWorkspace({
      ...workspace,
      registeredSpecs: [{
        id: "support-triage",
        name: "Support Triage",
        path: ".loopgraph/generated/support/loop.yaml",
        department: "customer_success",
        addedAt: "2026-07-29T15:00:00.000Z"
      }]
    }, projectRoot);
    const store = new FileRoutingStore(path.join(projectRoot, ".loopgraph"));
    const sourceProblem = problem({
      id: "problem_support_routing",
      problemType: "support_ticket_misroute",
      summary: "Support tickets repeatedly reach the wrong queue",
      subjectId: "ticket_42",
      status: "routed",
      primaryLoopId: "support-triage",
      updatedAt: "2026-07-29T15:01:00.000Z"
    });
    await store.saveBusinessProblem(businessProblemSchema.parse({
      ...sourceProblem,
      evidenceEventIds: [
        "event_support_1",
        "event_support_2",
        "event_support_3"
      ]
    }));
    for (let index = 1; index <= 3; index += 1) {
      await store.saveRoutingCorrection(routingCorrectionSchema.parse({
        id: `correction_${index}`,
        eventId: `event_support_${index}`,
        expectedAction: "route",
        expectedLoopIds: ["support-triage"],
        reason: `Ticket class ${index} needs a distinct routing contract`,
        correctedBy: "support_lead",
        correctedAt: `2026-07-29T15:0${index}:00.000Z`
      }));
    }

    const result = await scanLoopOpportunities({
      projectRoot,
      autoStartDesign: false,
      now: new Date("2026-07-29T15:10:00.000Z")
    }, { routingStore: store });

    expect(result.opportunities).toHaveLength(1);
    expect(result.opportunities[0]).toMatchObject({
      department: "customer_success",
      kind: "split_loop",
      status: "qualified",
      targetLoopIds: ["support-triage"]
    });
    expect(result.graphChangeSets[0]).toMatchObject({
      version: 1,
      changes: [{
        operation: "split",
        targetLoopIds: ["support-triage"],
        proposedLoopCount: 2
      }]
    });
  });

  it("persists dismissal and suppresses automatic redesign on later scans", async () => {
    const projectRoot = await temporaryProjectRoot();
    await initLoopgraphWorkspace({ projectRoot });
    const store = new FileRoutingStore(path.join(projectRoot, ".loopgraph"));
    await store.saveBusinessProblem(problem({
      id: "problem_ads_noise",
      problemType: "ads_expected_variance",
      summary: "Ad variance is expected during a planned experiment",
      subjectId: "campaign_1",
      severity: "critical",
      updatedAt: "2026-07-29T16:00:00.000Z"
    }));
    const detected = await scanLoopOpportunities({
      projectRoot,
      autoStartDesign: false,
      now: new Date("2026-07-29T16:01:00.000Z")
    }, { routingStore: store });
    const dismissed = await dismissLoopOpportunity({
      projectRoot,
      opportunityId: detected.opportunities[0]!.id,
      reason: "This is a time-bounded experiment and should not become a loop.",
      now: new Date("2026-07-29T16:02:00.000Z")
    });
    const rescanned = await scanLoopOpportunities({
      projectRoot,
      autoStartDesign: true,
      now: new Date("2026-07-29T16:03:00.000Z")
    }, { routingStore: store });

    expect(dismissed.status).toBe("dismissed");
    expect(rescanned.opportunities[0]).toMatchObject({
      id: dismissed.id,
      status: "dismissed",
      dismissalReason: "This is a time-bounded experiment and should not become a loop."
    });
    expect(rescanned.designDispatches).toEqual([]);
    expect(await getLoopOpportunity(dismissed.id, projectRoot)).toEqual(dismissed);
    expect(await getGraphChangeSet(dismissed.graphChangeSetId!, projectRoot)).toBeTruthy();
  });
});

function problem(input: {
  id: string;
  problemType: string;
  summary: string;
  subjectId: string;
  updatedAt: string;
  status?: "unhandled" | "routed";
  primaryLoopId?: string;
  severity?: "low" | "medium" | "high" | "critical";
}) {
  return businessProblemSchema.parse({
    id: input.id,
    workspaceId: "workspace_test",
    companyId: "company_test",
    problemType: input.problemType,
    subject: {
      type: input.problemType.includes("feedback") ? "product_feedback" : "business_object",
      id: input.subjectId
    },
    summary: input.summary,
    severity: input.severity ?? "medium",
    status: input.status ?? "unhandled",
    correlationId: `correlation_${input.id}`,
    dedupeKey: `dedupe_${input.id}`,
    evidenceEventIds: [],
    primaryLoopId: input.primaryLoopId,
    supportingLoopIds: [],
    routeCommitIds: [],
    outcomeRefs: [],
    openedAt: input.updatedAt,
    updatedAt: input.updatedAt
  });
}

async function temporaryProjectRoot() {
  const projectRoot = await mkdtemp(path.join(tmpdir(), "loopgraph-opportunity-engine-"));
  await writeFile(path.join(projectRoot, "package.json"), JSON.stringify({
    name: "loop-opportunity-test-project"
  }));
  return projectRoot;
}
