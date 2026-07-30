import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  GRAPH_CHANGE_SET_SCHEMA_VERSION,
  graphChangeSetSchema,
  type GraphChangeOperation
} from "../core";
import {
  editLoopDesignProposal,
  generateDeterministicLoopDesign
} from "./design-service";
import {
  selectDiscoveryDepartments,
  startHermesDiscoverySession,
  submitDiscoveryAnswers
} from "./discovery-session";
import { loadLoopSpecFromPath } from "./loader";
import { saveGraphChangeSet } from "./loop-opportunity-engine";
import { readWorkspaceGraphState } from "./semantic-graph-state";
import { FileSemanticGraphStore } from "./semantic-graph-store";
import {
  applyGraphChangeSet,
  approveGraphChangeSet,
  approveGraphRollback,
  approveLoopLifecycleChange,
  approveLoopPromotion,
  promoteLoop,
  rollbackGraphTransaction,
  setLoopLifecycleStatus
} from "./semantic-graph-transactions";
import { getLoopgraphRoot } from "./storage-resolver";
import { loadRoutingCardsFromProject } from "./routing-tools";
import { readLoopgraphWorkspace } from "./workspace";

describe("semantic graph transactions", () => {
  it("applies an approved add against an exact graph hash and rejects a stale change", async () => {
    const fixture = await marketingDesignFixture();
    const changeSet = await createChangeSet({
      projectRoot: fixture.projectRoot,
      operation: "add",
      targetLoopIds: [],
      proposedLoopCount: 2,
      designRunId: fixture.designRunId,
      id: "change_set_add"
    });
    const approval = await approveGraphChangeSet({
      projectRoot: fixture.projectRoot,
      changeSetId: changeSet.id,
      decision: "approved",
      actorId: "owner_1",
      actorRole: "company_owner",
      policyVersion: "graph-policy/v1",
      reason: "Approve the two shadow-only marketing loops.",
      evidenceRefs: ["review:add-marketing"],
      now: new Date("2026-07-29T12:20:00.000Z")
    });
    const applied = await applyGraphChangeSet({
      projectRoot: fixture.projectRoot,
      changeSetId: changeSet.id,
      approvalReceiptId: approval.receipt.id,
      designRunId: fixture.designRunId,
      acceptedProposalIds: [
        "proposal_marketing_ads",
        "proposal_marketing_content_creation"
      ],
      initiatedBy: "owner_1",
      now: new Date("2026-07-29T12:21:00.000Z")
    });

    expect(applied.transaction).toMatchObject({
      status: "committed",
      baseGraphHash: changeSet.baseGraphHash,
      operationReceipts: [{
        operation: "add",
        resultLoopIds: ["marketing_ads", "marketing_content_creation"],
        retiredLoopIds: []
      }]
    });
    expect(applied.changeSet).toMatchObject({
      status: "applied",
      appliedTransactionId: applied.transaction.id,
      resultGraphHash: applied.transaction.resultGraphHash
    });
    expect((await readLoopgraphWorkspace(fixture.projectRoot)).registeredSpecs.map((entry) => entry.id))
      .toEqual(["marketing_ads", "marketing_content_creation"]);

    const stale = await createChangeSet({
      projectRoot: fixture.projectRoot,
      operation: "retire",
      targetLoopIds: ["marketing_ads"],
      proposedLoopCount: 0,
      id: "change_set_stale"
    });
    const adsEntry = (await readLoopgraphWorkspace(fixture.projectRoot)).registeredSpecs
      .find((entry) => entry.id === "marketing_ads")!;
    const adsPath = path.resolve(fixture.projectRoot, adsEntry.path);
    const loaded = await loadLoopSpecFromPath(adsPath);
    if (!loaded.ok) throw new Error("expected marketing ads LoopSpec");
    const source = await import("node:fs/promises");
    const YAML = await import("yaml");
    await source.writeFile(adsPath, YAML.stringify({
      ...loaded.spec,
      metadata: { ...loaded.spec.metadata, description: "Changed after proposal." }
    }));

    await expect(approveGraphChangeSet({
      projectRoot: fixture.projectRoot,
      changeSetId: stale.id,
      decision: "approved",
      actorId: "owner_1",
      actorRole: "company_owner",
      policyVersion: "graph-policy/v1",
      reason: "This approval must fail because the graph changed.",
      now: new Date("2026-07-29T12:22:00.000Z")
    })).rejects.toThrow(/stale/);
  });

  it("merges, retires, promotes, and restores exact graph snapshots through approved rollback", async () => {
    const fixture = await marketingDesignFixture();
    await applyDesignAdd(fixture);
    const merge = await createChangeSet({
      projectRoot: fixture.projectRoot,
      operation: "merge",
      targetLoopIds: ["marketing_ads", "marketing_content_creation"],
      proposedLoopCount: 1,
      designRunId: fixture.designRunId,
      id: "change_set_merge"
    });
    const mergeApproval = await approveGraphChangeSet({
      projectRoot: fixture.projectRoot,
      changeSetId: merge.id,
      decision: "approved",
      actorId: "growth_owner",
      actorRole: "department_owner",
      policyVersion: "graph-policy/v1",
      reason: "Use the Ads loop as the combined owner and retire the duplicate content route.",
      evidenceRefs: ["review:merge"],
      now: new Date("2026-07-29T13:00:00.000Z")
    });
    const merged = await applyGraphChangeSet({
      projectRoot: fixture.projectRoot,
      changeSetId: merge.id,
      approvalReceiptId: mergeApproval.receipt.id,
      designRunId: fixture.designRunId,
      acceptedProposalIds: ["proposal_marketing_ads"],
      initiatedBy: "growth_owner",
      now: new Date("2026-07-29T13:01:00.000Z")
    });
    expect((await readLoopgraphWorkspace(fixture.projectRoot)).registeredSpecs.map((entry) => entry.id))
      .toEqual(["marketing_ads"]);
    expect(merged.transaction.operationReceipts[0]).toMatchObject({
      operation: "merge",
      resultLoopIds: ["marketing_ads"],
      retiredLoopIds: ["marketing_content_creation"]
    });

    const mergeRollbackApproval = await approveGraphRollback({
      projectRoot: fixture.projectRoot,
      transactionId: merged.transaction.id,
      actorId: "growth_owner",
      actorRole: "department_owner",
      policyVersion: "graph-policy/v1",
      reason: "Restore the independent content loop.",
      evidenceRefs: ["review:rollback-merge"],
      now: new Date("2026-07-29T13:02:00.000Z")
    });
    await rollbackGraphTransaction({
      projectRoot: fixture.projectRoot,
      transactionId: merged.transaction.id,
      approvalReceiptId: mergeRollbackApproval.id,
      initiatedBy: "growth_owner",
      now: new Date("2026-07-29T13:03:00.000Z")
    });
    expect((await readLoopgraphWorkspace(fixture.projectRoot)).registeredSpecs.map((entry) => entry.id))
      .toEqual(["marketing_ads", "marketing_content_creation"]);

    const promotionApproval = await approveLoopPromotion({
      projectRoot: fixture.projectRoot,
      loopId: "marketing_ads",
      nextMode: "recommend",
      actorId: "growth_owner",
      actorRole: "department_owner",
      policyVersion: "promotion-policy/v1",
      reason: "The shadow route passed accountable review.",
      evidenceRefs: ["routing-evaluation:marketing-ads"],
      now: new Date("2026-07-29T13:04:00.000Z")
    });
    const promotion = await promoteLoop({
      projectRoot: fixture.projectRoot,
      loopId: "marketing_ads",
      nextMode: "recommend",
      approvalReceiptId: promotionApproval.id,
      gateEvidenceRefs: ["routing-evaluation:marketing-ads"],
      initiatedBy: "growth_owner",
      now: new Date("2026-07-29T13:05:00.000Z")
    });
    expect(promotion.promotion).toMatchObject({
      previousMode: "shadow",
      nextMode: "recommend",
      status: "applied"
    });

    const promotionRollbackApproval = await approveGraphRollback({
      projectRoot: fixture.projectRoot,
      transactionId: promotion.transaction.id,
      actorId: "growth_owner",
      actorRole: "department_owner",
      policyVersion: "promotion-policy/v1",
      reason: "Return to shadow after a guardrail regression.",
      evidenceRefs: ["outcome:guardrail-regression"],
      now: new Date("2026-07-29T13:06:00.000Z")
    });
    await rollbackGraphTransaction({
      projectRoot: fixture.projectRoot,
      transactionId: promotion.transaction.id,
      approvalReceiptId: promotionRollbackApproval.id,
      initiatedBy: "growth_owner",
      now: new Date("2026-07-29T13:07:00.000Z")
    });
    const ads = await registeredSpec(fixture.projectRoot, "marketing_ads");
    expect(ads.routing?.activationMode).toBe("shadow");
    expect((await new FileSemanticGraphStore(getLoopgraphRoot(fixture.projectRoot))
      .getPromotion(promotion.promotion.id))?.status).toBe("rolled_back");

    const pauseApproval = await approveLoopLifecycleChange({
      projectRoot: fixture.projectRoot,
      loopId: "marketing_ads",
      nextStatus: "paused",
      actorId: "growth_owner",
      actorRole: "department_owner",
      policyVersion: "lifecycle-policy/v1",
      reason: "Pause routing while the guardrail regression is investigated.",
      evidenceRefs: ["outcome:guardrail-regression"],
      now: new Date("2026-07-29T13:07:30.000Z")
    });
    await setLoopLifecycleStatus({
      projectRoot: fixture.projectRoot,
      loopId: "marketing_ads",
      nextStatus: "paused",
      approvalReceiptId: pauseApproval.id,
      initiatedBy: "growth_owner",
      now: new Date("2026-07-29T13:07:40.000Z")
    });
    expect((await loadRoutingCardsFromProject({ projectRoot: fixture.projectRoot }))
      .find((card) => card.loopId === "marketing_ads")?.loopStatus).toBe("disabled");

    const retire = await createChangeSet({
      projectRoot: fixture.projectRoot,
      operation: "retire",
      targetLoopIds: ["marketing_content_creation"],
      proposedLoopCount: 0,
      id: "change_set_retire"
    });
    const retireApproval = await approveGraphChangeSet({
      projectRoot: fixture.projectRoot,
      changeSetId: retire.id,
      decision: "approved",
      actorId: "growth_owner",
      actorRole: "department_owner",
      policyVersion: "graph-policy/v1",
      reason: "Observed evidence shows the content loop should be retired.",
      evidenceRefs: ["value-ledger:content-negative"],
      now: new Date("2026-07-29T13:08:00.000Z")
    });
    const retired = await applyGraphChangeSet({
      projectRoot: fixture.projectRoot,
      changeSetId: retire.id,
      approvalReceiptId: retireApproval.receipt.id,
      initiatedBy: "growth_owner",
      now: new Date("2026-07-29T13:09:00.000Z")
    });
    expect(retired.transaction.operationReceipts[0]).toMatchObject({
      operation: "retire",
      retiredLoopIds: ["marketing_content_creation"],
      resultLoopIds: []
    });
    expect((await readLoopgraphWorkspace(fixture.projectRoot)).registeredSpecs.map((entry) => entry.id))
      .toEqual(["marketing_ads"]);
  });

  it("commits content-bound update and split operations instead of treating them as labels", async () => {
    const fixture = await marketingDesignFixture();
    await applyDesignAdd(fixture);
    const edited = await editLoopDesignProposal({
      projectRoot: fixture.projectRoot,
      designRunId: fixture.designRunId,
      proposalId: "proposal_marketing_ads",
      updates: {
        shortName: "Ads Optimization",
        goal: "Continuously improve qualified acquisition efficiency."
      },
      editedBy: "growth_owner",
      now: new Date("2026-07-29T14:00:00.000Z")
    });
    const update = await createChangeSet({
      projectRoot: fixture.projectRoot,
      operation: "update",
      targetLoopIds: ["marketing_ads"],
      proposedLoopCount: 1,
      designRunId: edited.designRun.id,
      id: "change_set_update"
    });
    const updateApproval = await approveGraphChangeSet({
      projectRoot: fixture.projectRoot,
      changeSetId: update.id,
      decision: "approved",
      actorId: "growth_owner",
      actorRole: "department_owner",
      policyVersion: "graph-policy/v1",
      reason: "Apply the reviewed Ads loop revision.",
      evidenceRefs: ["review:update"],
      now: new Date("2026-07-29T14:01:00.000Z")
    });
    const updated = await applyGraphChangeSet({
      projectRoot: fixture.projectRoot,
      changeSetId: update.id,
      approvalReceiptId: updateApproval.receipt.id,
      designRunId: edited.designRun.id,
      acceptedProposalIds: ["proposal_marketing_ads"],
      initiatedBy: "growth_owner",
      now: new Date("2026-07-29T14:02:00.000Z")
    });
    expect(updated.transaction.operationReceipts[0]).toMatchObject({
      operation: "update",
      targetLoopIds: ["marketing_ads"],
      resultLoopIds: ["marketing_ads"],
      retiredLoopIds: []
    });
    expect((await registeredSpec(fixture.projectRoot, "marketing_ads")).metadata.name)
      .toBe("Ads Optimization");

    const split = await createChangeSet({
      projectRoot: fixture.projectRoot,
      operation: "split",
      targetLoopIds: ["marketing_ads"],
      proposedLoopCount: 2,
      designRunId: fixture.designRunId,
      id: "change_set_split"
    });
    const splitApproval = await approveGraphChangeSet({
      projectRoot: fixture.projectRoot,
      changeSetId: split.id,
      decision: "approved",
      actorId: "growth_owner",
      actorRole: "department_owner",
      policyVersion: "graph-policy/v1",
      reason: "Split acquisition monitoring from content creation.",
      evidenceRefs: ["review:split"],
      now: new Date("2026-07-29T14:03:00.000Z")
    });
    const splitResult = await applyGraphChangeSet({
      projectRoot: fixture.projectRoot,
      changeSetId: split.id,
      approvalReceiptId: splitApproval.receipt.id,
      designRunId: fixture.designRunId,
      acceptedProposalIds: [
        "proposal_marketing_ads",
        "proposal_marketing_content_creation"
      ],
      initiatedBy: "growth_owner",
      now: new Date("2026-07-29T14:04:00.000Z")
    });
    expect(splitResult.transaction.operationReceipts[0]).toMatchObject({
      operation: "split",
      targetLoopIds: ["marketing_ads"],
      resultLoopIds: ["marketing_ads", "marketing_content_creation"],
      retiredLoopIds: []
    });
    expect((await readLoopgraphWorkspace(fixture.projectRoot)).registeredSpecs.map((entry) => entry.id))
      .toEqual(["marketing_ads", "marketing_content_creation"]);
  });
});

async function applyDesignAdd(fixture: Awaited<ReturnType<typeof marketingDesignFixture>>) {
  const changeSet = await createChangeSet({
    projectRoot: fixture.projectRoot,
    operation: "add",
    targetLoopIds: [],
    proposedLoopCount: 2,
    designRunId: fixture.designRunId,
    id: "change_set_initial_add"
  });
  const approval = await approveGraphChangeSet({
    projectRoot: fixture.projectRoot,
    changeSetId: changeSet.id,
    decision: "approved",
    actorId: "owner_1",
    actorRole: "company_owner",
    policyVersion: "graph-policy/v1",
    reason: "Approve initial shadow graph.",
    evidenceRefs: ["review:initial"],
    now: new Date("2026-07-29T12:20:00.000Z")
  });
  return applyGraphChangeSet({
    projectRoot: fixture.projectRoot,
    changeSetId: changeSet.id,
    approvalReceiptId: approval.receipt.id,
    designRunId: fixture.designRunId,
    acceptedProposalIds: [
      "proposal_marketing_ads",
      "proposal_marketing_content_creation"
    ],
    initiatedBy: "owner_1",
    now: new Date("2026-07-29T12:21:00.000Z")
  });
}

async function createChangeSet(input: {
  projectRoot: string;
  operation: GraphChangeOperation;
  targetLoopIds: string[];
  proposedLoopCount: number;
  designRunId?: string;
  id: string;
}) {
  const state = await readWorkspaceGraphState(input.projectRoot);
  const now = "2026-07-29T12:15:00.000Z";
  const changeSet = graphChangeSetSchema.parse({
    schemaVersion: GRAPH_CHANGE_SET_SCHEMA_VERSION,
    id: input.id,
    version: 1,
    workspaceId: state.workspace.projectRootId,
    companyId: "company_1",
    baseGraphHash: state.graphHash,
    opportunityId: `opportunity_${input.id}`,
    status: "proposed",
    changes: [{
      id: `change_${input.id}`,
      operation: input.operation,
      department: "marketing",
      targetLoopIds: input.targetLoopIds,
      proposedLoopCount: input.proposedLoopCount,
      title: `${input.operation} marketing loops`,
      rationale: "Accountable semantic graph test.",
      expectedOutcome: "The graph matches the approved operating model.",
      evidenceRefs: [`evidence:${input.id}`],
      requiresExplicitApproval: true
    }],
    designRunId: input.designRunId,
    createdAt: now,
    updatedAt: now
  });
  await saveGraphChangeSet(changeSet, input.projectRoot);
  return changeSet;
}

async function marketingDesignFixture() {
  const projectRoot = await mkdtemp(path.join(tmpdir(), "loopgraph-semantic-graph-"));
  const started = await startHermesDiscoverySession({
    projectRoot,
    sessionId: "session_semantic_graph",
    companyId: "company_1",
    companyName: "Acme"
  });
  let session = await selectDiscoveryDepartments({
    projectRoot,
    sessionId: started.id,
    departments: ["marketing"],
    expectedRevision: 0
  });
  for (const item of marketingAnswers()) {
    session = await submitDiscoveryAnswers({
      projectRoot,
      sessionId: started.id,
      bundleId: item.bundleId,
      answers: item.answers,
      expectedRevision: session.revision
    });
  }
  const design = await generateDeterministicLoopDesign({
    projectRoot,
    sessionId: started.id,
    now: new Date("2026-07-29T12:10:00.000Z")
  });
  return { projectRoot, designRunId: design.designRun.id };
}

function marketingAnswers() {
  return [
    {
      bundleId: "current_stack_sources",
      answers: {
        systems: ["Google Ads", "HubSpot", "Notion"],
        source_of_truth: "HubSpot defines qualified customers.",
        event_sources_subjects: "Hermes receives campaign events keyed by campaign ID.",
        safe_reads: ["campaign performance", "qualified lead status", "approved briefs"],
        manual_fallbacks: ["weekly ads CSV", "approved briefs Markdown"],
        existing_automations: []
      }
    },
    {
      bundleId: "biggest_recurring_problem",
      answers: {
        processes: ["paid ads review", "content draft creation"],
        trigger_or_cadence: "Campaign anomalies and approved briefs.",
        problem_signal: "Spend rises while qualified conversion drops.",
        required_evidence: ["spend delta", "qualified conversion delta"],
        weekly_volume: 12,
        current_owner: "Growth lead",
        current_steps: ["collect metrics", "draft content"],
        pain_type_severity: "High manual context gathering.",
        baseline: "6 hours per week"
      }
    },
    {
      bundleId: "automation_boundaries",
      answers: {
        desired_automation_mode: "monitor, recommend, and draft",
        candidate_outputs_actions: ["campaign recommendation", "content draft"],
        read_write_boundary: "Read data and write drafts only.",
        customer_facing_status: true,
        forbidden_actions: ["no unapproved budget changes", "no unapproved publishing"],
        ignore_conditions: ["test campaigns"],
        ambiguity_policy: "request_human",
        fanout_policy: "independent_only"
      }
    },
    {
      bundleId: "ideal_outcome_proof",
      answers: {
        primary_outcome_metric: "cost per qualified customer",
        leading_indicator: "qualified lead rate",
        guardrail_metric: "brand safety must not decline",
        baseline_target: "Reduce preparation from 6 hours to 2 hours.",
        verification_rules: ["recommendations cite source metrics"],
        completion_signal: ["approved recommendation recorded"],
        failure_signal: ["review rejected"]
      }
    },
    {
      bundleId: "ownership_rollout",
      answers: {
        loop_owner_role: "Growth lead",
        reviewer_roles: ["Marketing lead"],
        escalation_conditions: ["spend change above threshold"],
        initial_autonomy_level: "shadow",
        repeat_policy: "append_evidence",
        urgency_priority: "Campaign anomalies win.",
        pilot_scope: "two campaigns",
        management_summary: "weekly learning summary"
      }
    }
  ];
}

async function registeredSpec(projectRoot: string, loopId: string) {
  const entry = (await readLoopgraphWorkspace(projectRoot)).registeredSpecs
    .find((candidate) => candidate.id === loopId);
  if (!entry) throw new Error(`missing loop ${loopId}`);
  const loaded = await loadLoopSpecFromPath(path.resolve(projectRoot, entry.path));
  if (!loaded.ok) throw new Error(`invalid loop ${loopId}`);
  return loaded.spec;
}
