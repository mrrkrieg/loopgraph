import path from "node:path";
import {
  LOOP_CONTROLLER_CHECKPOINT_SCHEMA_VERSION,
  LOOP_CONTROLLER_POLICY_SCHEMA_VERSION,
  LOOP_CONTROLLER_RUN_SCHEMA_VERSION,
  contentHash,
  loopControllerCheckpointSchema,
  loopControllerDecisionSchema,
  loopControllerPolicySchema,
  loopControllerRunSchema,
  loopControllerTriggerSchema,
  type LoopControllerDecision,
  type LoopControllerPolicy,
  type LoopControllerPolicyRule,
  type LoopControllerRun,
  type LoopControllerTrigger,
  type LoopDesignProposal,
  type LoopOpportunity,
  type ObservedOutcome
} from "../core";
import { readConnectionInstances } from "./connector-registry";
import { readLoopDesignProposalSet } from "./design-service";
import type { DiscoveryDesignStore } from "./discovery-design-store";
import { getHermesDesignTask } from "./hermes-design-bridge";
import type { HermesDesignStore } from "./hermes-design-store";
import {
  FileLoopControllerStore,
  type LoopControllerStore
} from "./loop-controller-store";
import {
  getGraphChangeSet,
  scanLoopOpportunities,
  type ScanLoopOpportunitiesResult
} from "./loop-opportunity-engine";
import type { LoopOpportunityStore } from "./loop-opportunity-store";
import type { LoopSpecRegistryStore } from "./loop-spec-store";
import {
  applyGraphChangeSet,
  approveGraphChangeSet
} from "./semantic-graph-transactions";
import type { SemanticGraphStore } from "./semantic-graph-store";
import { evaluateObservedOutcome } from "./outcome-service";
import { FileOutcomeStore, type OutcomeStore } from "./outcome-store";
import type { RoutingStore } from "./routing-store";
import { readProjectMetricDefinitions } from "./outcome-tools";
import { getLoopgraphRoot } from "./storage-resolver";
import { readLoopgraphWorkspace } from "./workspace";

export type RunLoopControllerInput = {
  projectRoot?: string;
  trigger?: Partial<LoopControllerTrigger>;
  policy?: Partial<LoopControllerPolicy>;
  now?: Date;
};

export type RunLoopControllerResult = {
  run: LoopControllerRun;
  duplicate: boolean;
};

export type LoopControllerRuntimeOptions = {
  store?: LoopControllerStore;
  outcomeStore?: OutcomeStore;
  routingStore?: RoutingStore;
  designStore?: HermesDesignStore;
  discoveryDesignStore?: DiscoveryDesignStore;
  opportunityStore?: LoopOpportunityStore;
  loopSpecStore?: LoopSpecRegistryStore;
  semanticGraphStore?: SemanticGraphStore;
  allowAutoShadowMaterialization?: boolean;
};

type DueOutcomeEvaluation = {
  records: ObservedOutcome[];
  errors: Array<{ code: string; message: string; evidenceRefs: string[] }>;
};

const SENSITIVE_USER_REQUIREMENT_TYPES = new Set([
  "approval",
  "policy",
  "owner"
]);

export async function runLoopController(
  input: RunLoopControllerInput = {},
  options: LoopControllerRuntimeOptions = {}
): Promise<RunLoopControllerResult> {
  const projectRoot = path.resolve(input.projectRoot ?? process.cwd());
  const now = input.now ?? new Date();
  const nowIso = now.toISOString();
  const workspace = options.loopSpecStore
    ? (await options.loopSpecStore.getWorkspace(projectRoot)).workspace
    : await readLoopgraphWorkspace(projectRoot);
  const store = options.store ?? new FileLoopControllerStore(getLoopgraphRoot(projectRoot));
  const outcomeStore = options.outcomeStore ?? new FileOutcomeStore(getLoopgraphRoot(projectRoot));
  const savedPolicy = await store.readPolicy();
  const policy = loopControllerPolicySchema.parse({
    ...(savedPolicy ?? {}),
    ...(input.policy ?? {}),
    schemaVersion: LOOP_CONTROLLER_POLICY_SCHEMA_VERSION
  });
  if (!savedPolicy || contentHash(savedPolicy) !== contentHash(policy)) {
    await store.savePolicy(policy);
  }
  const trigger = normalizeControllerTrigger(input.trigger, now);
  const idempotencyKey = `controller_${contentHash({
    projectRootId: workspace.projectRootId,
    triggerType: trigger.type,
    triggerId: trigger.id
  })}`;

  return store.withControllerLock(async () => {
    const existing = await store.findRunByIdempotencyKey(idempotencyKey);
    if (existing && ["completed", "failed", "disabled"].includes(existing.status)) {
      return { run: existing, duplicate: true };
    }

    const runId = existing?.id ?? `controller_run_${contentHash({ idempotencyKey })}`;
    let running = loopControllerRunSchema.parse({
      schemaVersion: LOOP_CONTROLLER_RUN_SCHEMA_VERSION,
      id: runId,
      idempotencyKey,
      projectRootId: workspace.projectRootId,
      trigger,
      status: policy.enabled ? "running" : "disabled",
      policyHash: contentHash(policy),
      evidenceFingerprint: existing?.evidenceFingerprint ?? `pending_${contentHash(trigger)}`,
      evidence: existing?.evidence ?? {
        opportunitySignalCount: 0,
        opportunityIds: [],
        graphChangeSetIds: [],
        designTaskIds: [],
        evaluatedOutcomeIds: [],
        outcomeTruth: { observed: 0, modeled: 0, incomplete: 0 }
      },
      decisions: existing?.decisions ?? [],
      errors: existing?.errors ?? [],
      startedAt: existing?.startedAt ?? nowIso,
      ...(policy.enabled ? {} : { completedAt: nowIso })
    });
    await store.saveRun(running);

    if (!policy.enabled) {
      return { run: running, duplicate: false };
    }

    try {
      const outcomeEvaluation = policy.autoEvaluateOutcomes
        ? await evaluateDueProjectOutcomes({
            projectRoot,
            outcomeStore,
            projectRootId: workspace.projectRootId,
            now
          })
        : { records: [], errors: [] };
      const scan = await scanLoopOpportunities({
        projectRoot,
        thresholds: {
          qualify: policy.qualifyThreshold,
          autoDesign: policy.autoDesignThreshold
        },
        autoStartDesign: policy.autoStartDesign,
        now
      }, {
        routingStore: options.routingStore,
        outcomeStore,
        designStore: options.designStore,
        opportunityStore: options.opportunityStore
      });
      const allOutcomes = await outcomeStore.listObservedOutcomes({
        workspaceId: workspace.projectRootId
      });
      const evidenceFingerprint = controllerEvidenceFingerprint(scan, allOutcomes);
      const checkpoint = await store.readCheckpoint();
      const cooldownActive = Boolean(
        checkpoint &&
        checkpoint.lastEvidenceFingerprint === evidenceFingerprint &&
        Date.parse(checkpoint.lastCompletedAt) + policy.cooldownSeconds * 1000 > now.getTime()
      );
      const decisions = cooldownActive
        ? [noActionDecision({
            now,
            reason: "The durable evidence fingerprint has not changed and the controller cooldown is still active.",
            evidenceRefs: [checkpoint!.lastRunId]
          })]
        : await decideControllerActions({
            projectRoot,
            now,
            policy,
            scan,
            designStore: options.designStore,
            discoveryDesignStore: options.discoveryDesignStore,
            opportunityStore: options.opportunityStore,
            loopSpecStore: options.loopSpecStore,
            semanticGraphStore: options.semanticGraphStore,
            allowAutoShadowMaterialization:
              options.allowAutoShadowMaterialization !== false
          });
      const limitedDecisions = decisions.slice(0, policy.maxDecisionsPerRun);
      const completedAt = now.toISOString();
      running = loopControllerRunSchema.parse({
        ...running,
        status: "completed",
        evidenceFingerprint,
        evidence: {
          opportunitySignalCount: scan.signalCount,
          opportunityIds: scan.opportunities.map((item) => item.id),
          graphChangeSetIds: scan.graphChangeSets.map((item) => item.id),
          designTaskIds: scan.designDispatches.map((item) => item.task.id),
          evaluatedOutcomeIds: outcomeEvaluation.records.map((item) => item.id),
          outcomeTruth: countOutcomeTruth(allOutcomes)
        },
        decisions: limitedDecisions,
        errors: outcomeEvaluation.errors,
        completedAt,
        nextEligibleAt: new Date(now.getTime() + policy.cooldownSeconds * 1000).toISOString()
      });
      await store.saveRun(running);
      await store.saveCheckpoint(loopControllerCheckpointSchema.parse({
        schemaVersion: LOOP_CONTROLLER_CHECKPOINT_SCHEMA_VERSION,
        projectRootId: workspace.projectRootId,
        lastRunId: running.id,
        lastCompletedAt: completedAt,
        lastEvidenceFingerprint: evidenceFingerprint,
        lastTriggerId: trigger.id,
        opportunityWatermarks: Object.fromEntries(scan.opportunities.map((opportunity) => [
          opportunity.id,
          opportunity.lastObservedAt
        ])),
        updatedAt: completedAt
      }));
      return { run: running, duplicate: false };
    } catch (error) {
      running = loopControllerRunSchema.parse({
        ...running,
        status: "failed",
        errors: [{
          code: "CONTROLLER_RUN_FAILED",
          message: error instanceof Error ? error.message : String(error),
          evidenceRefs: []
        }],
        completedAt: now.toISOString()
      });
      await store.saveRun(running);
      return { run: running, duplicate: false };
    }
  });
}

export async function evaluateAutoShadowPolicy(input: {
  projectRoot: string;
  opportunity: LoopOpportunity;
  proposals: LoopDesignProposal[];
  policy: LoopControllerPolicy;
  opportunityStore?: LoopOpportunityStore;
}): Promise<{ passed: boolean; rules: LoopControllerPolicyRule[] }> {
  const changeSet = input.opportunity.graphChangeSetId
    ? await getGraphChangeSet(
        input.opportunity.graphChangeSetId,
        input.projectRoot,
        input.opportunityStore
      )
    : undefined;
  const instances = await readConnectionInstances(input.projectRoot);
  const readyCapabilities = new Set(instances
    .filter((instance) => ["connected", "manual_fallback"].includes(instance.status))
    .flatMap((instance) => instance.capabilityKeys));
  const maximumSeverity = maximumSignalSeverity(input.opportunity);
  const maximumAllowedSeverity = input.policy.maximumSignalSeverityForAutoShadow;
  const routingCapabilities = input.proposals.flatMap((proposal) =>
    proposal.connectorRequirements
      .filter((requirement) => ["routing", "simulation"].includes(requirement.requiredFor))
      .map((requirement) => requirement.capability)
  );
  const missingRoutingCapabilities = unique(routingCapabilities)
    .filter((capability) => !readyCapabilities.has(capability));
  const sensitiveUserRequirements = input.proposals.flatMap((proposal) =>
    proposal.requiredFromUser.filter((item) => SENSITIVE_USER_REQUIREMENT_TYPES.has(item.type))
  );
  const rules: LoopControllerPolicyRule[] = [
    rule(
      "auto-shadow-enabled",
      input.policy.autoShadowMaterialization,
      input.policy.autoShadowMaterialization
        ? "Automatic shadow materialization is enabled."
        : "Automatic shadow materialization is disabled."
    ),
    rule(
      "score-threshold",
      input.opportunity.score.total >= input.policy.autoShadowThreshold,
      `Opportunity score ${input.opportunity.score.total} must meet ${input.policy.autoShadowThreshold}.`
    ),
    rule(
      "department-boundary",
      !input.policy.blockedAutoShadowDepartments.includes(input.opportunity.department),
      input.policy.blockedAutoShadowDepartments.includes(input.opportunity.department)
        ? `${input.opportunity.department} requires accountable review before any automatic graph change.`
        : `${input.opportunity.department} is eligible for strict shadow policy evaluation.`
    ),
    rule(
      "change-operation",
      Boolean(changeSet) && Boolean(changeSet?.changes.every((change) =>
        input.policy.allowedAutoShadowChangeOperations.includes(change.operation as "add" | "update")
      )),
      changeSet
        ? `Change operations are ${changeSet.changes.map((change) => change.operation).join(", ")}.`
        : "A versioned graph change set is required."
    ),
    rule(
      "signal-severity",
      severityRank(maximumSeverity) <= severityRank(maximumAllowedSeverity),
      `Maximum signal severity ${maximumSeverity} must not exceed ${maximumAllowedSeverity}.`
    ),
    rule(
      "shadow-rollout",
      input.proposals.length > 0 && input.proposals.every((proposal) =>
        proposal.rolloutStage === "shadow" && proposal.routing.activationMode === "shadow"
      ),
      "Every proposal must remain in shadow rollout and shadow routing mode."
    ),
    rule(
      "read-only-low-risk-actions",
      input.proposals.every((proposal) => proposal.proposedActions.every((action) =>
        action.riskLevel === "low" &&
        !action.requiresApproval &&
        !action.customerFacing
      )),
      "Automatic shadow proposals may contain only low-risk, non-customer-facing actions without approval authority."
    ),
    rule(
      "open-questions",
      !input.policy.requireNoOpenQuestions ||
        input.proposals.every((proposal) => proposal.openQuestions.length === 0),
      "Blocking open questions must be resolved before automatic materialization."
    ),
    rule(
      "user-approval-items",
      !input.policy.requireNoUserApprovalItems || sensitiveUserRequirements.length === 0,
      sensitiveUserRequirements.length === 0
        ? "No owner, policy, or approval item remains unresolved."
        : `${sensitiveUserRequirements.length} accountable user item(s) remain unresolved.`
    ),
    rule(
      "routing-connections",
      !input.policy.requireRoutingConnectionsReady || missingRoutingCapabilities.length === 0,
      missingRoutingCapabilities.length === 0
        ? "Routing and simulation capabilities are ready or not required."
        : `Missing routing/simulation capabilities: ${missingRoutingCapabilities.join(", ")}.`
    )
  ];
  return {
    passed: rules.every((item) => item.passed),
    rules
  };
}

async function decideControllerActions(input: {
  projectRoot: string;
  now: Date;
  policy: LoopControllerPolicy;
  scan: ScanLoopOpportunitiesResult;
  designStore?: HermesDesignStore;
  discoveryDesignStore?: DiscoveryDesignStore;
  opportunityStore?: LoopOpportunityStore;
  loopSpecStore?: LoopSpecRegistryStore;
  semanticGraphStore?: SemanticGraphStore;
  allowAutoShadowMaterialization: boolean;
}): Promise<LoopControllerDecision[]> {
  if (input.scan.opportunities.length === 0) {
    return [noActionDecision({
      now: input.now,
      reason: "No durable business signal currently qualifies as a loop opportunity.",
      evidenceRefs: []
    })];
  }
  const decisions: LoopControllerDecision[] = [];
  const dispatchedTaskIds = new Set(input.scan.designDispatches.map((item) => item.task.id));

  for (const opportunity of input.scan.opportunities) {
    const base = {
      opportunityId: opportunity.id,
      graphChangeSetId: opportunity.graphChangeSetId,
      designTaskId: opportunity.designTaskId,
      department: opportunity.department,
      targetLoopIds: opportunity.targetLoopIds,
      score: opportunity.score.total,
      evidenceRefs: unique(opportunity.signals.flatMap((signal) => [
        signal.sourceRef,
        ...signal.evidenceRefs
      ])),
      createdAt: input.now.toISOString()
    };
    if (["dismissed", "implemented"].includes(opportunity.status)) {
      decisions.push(decision({
        ...base,
        action: "no_action",
        summary: `${opportunity.title}: no controller action`,
        reason: `Opportunity is already ${opportunity.status}.`,
        policy: { passed: true, rules: [] }
      }));
      continue;
    }
    if (opportunity.kind === "retire_loop") {
      decisions.push(decision({
        ...base,
        action: "propose_retire",
        summary: opportunity.title,
        reason: "Negative observed value can justify a retirement proposal, but the controller cannot retire a loop without accountable review.",
        policy: { passed: false, rules: [
          rule("retirement-human-owned", false, "Pausing or retiring an operating loop requires accountable approval.")
        ] }
      }));
      continue;
    }
    if (opportunity.score.total < input.policy.qualifyThreshold) {
      decisions.push(decision({
        ...base,
        action: "no_action",
        summary: `${opportunity.title}: continue observing`,
        reason: `Score ${opportunity.score.total} is below qualification threshold ${input.policy.qualifyThreshold}.`,
        policy: { passed: true, rules: [] }
      }));
      continue;
    }
    const task = opportunity.designTaskId
      ? await getHermesDesignTask(
          opportunity.designTaskId,
          input.projectRoot,
          input.designStore
        )
      : undefined;
    if (task?.status === "needs_input") {
      decisions.push(decision({
        ...base,
        action: "request_evidence",
        summary: `Hermes needs focused evidence for ${opportunity.title}`,
        reason: `${task.blockingGapIds.length} blocking evidence gap(s) remain.`,
        policy: { passed: false, rules: [
          rule("design-evidence-complete", false, "Hermes must collect the unresolved design evidence before a proposal can be materialized.")
        ] }
      }));
      continue;
    }
    if (task && ["queued", "awaiting_hermes", "designing", "needs_repair"].includes(task.status)) {
      decisions.push(decision({
        ...base,
        action: dispatchedTaskIds.has(task.id) ? "start_design" : "wait_for_design",
        summary: `${opportunity.title}: Hermes design is ${task.status}`,
        reason: "The durable Hermes task owns the next design step.",
        policy: { passed: true, rules: [] }
      }));
      continue;
    }
    if (task?.status === "completed") {
      const designRunId = task.designRunIds.at(-1);
      const proposalSet = designRunId
        ? await readLoopDesignProposalSet(
            input.projectRoot,
            designRunId,
            input.discoveryDesignStore
          )
        : undefined;
      if (!designRunId || !proposalSet?.validationSummary.valid) {
        decisions.push(decision({
          ...base,
          action: "review_change",
          summary: `${opportunity.title}: proposal cannot be materialized`,
          reason: "The Hermes task completed without a valid proposal set.",
          policy: { passed: false, rules: [
            rule("valid-proposal-set", false, "A validated Hermes proposal set is required.")
          ] }
        }));
        continue;
      }
      if (!input.allowAutoShadowMaterialization) {
        decisions.push(decision({
          ...base,
          designRunId,
          action: "review_change",
          summary: `${opportunity.title}: distributed graph review required`,
          reason: "Automatic graph mutation is disabled until the hosted semantic graph transaction store is authoritative.",
          policy: {
            passed: false,
            rules: [
              rule(
                "distributed-graph-authority",
                false,
                "A shared semantic graph transaction store is required before automatic shadow materialization."
              )
            ]
          }
        }));
        continue;
      }
      const gate = await evaluateAutoShadowPolicy({
        projectRoot: input.projectRoot,
        opportunity,
        proposals: proposalSet.proposals,
        policy: input.policy,
        opportunityStore: input.opportunityStore
      });
      if (!gate.passed) {
        decisions.push(decision({
          ...base,
          designRunId,
          action: "review_change",
          summary: `${opportunity.title}: accountable review required`,
          reason: gate.rules.filter((item) => !item.passed).map((item) => item.summary).join(" "),
          policy: gate
        }));
        continue;
      }
      const changeSetId = opportunity.graphChangeSetId;
      if (!changeSetId) {
        decisions.push(decision({
          ...base,
          designRunId,
          action: "review_change",
          summary: `${opportunity.title}: graph change set is missing`,
          reason: "Automatic shadow materialization requires a versioned graph change set.",
          policy: {
            passed: false,
            rules: [...gate.rules, rule("graph-change-set", false, "A graph change set is required.")]
          }
        }));
        continue;
      }
      let applied;
      let approval;
      try {
        approval = await approveGraphChangeSet({
          projectRoot: input.projectRoot,
          changeSetId,
          decision: "approved",
          actorId: "loopgraph-controller",
          actorRole: "controller-policy",
          policyVersion: `${input.policy.schemaVersion}:${contentHash(input.policy)}`,
          reason: "Every strict automatic-shadow policy rule passed.",
          evidenceRefs: opportunity.signals.flatMap((signal) => [signal.sourceRef, ...signal.evidenceRefs]),
          now: input.now
        }, {
          store: input.semanticGraphStore,
          opportunityStore: input.opportunityStore,
          designStore: input.discoveryDesignStore,
          hermesDesignStore: input.designStore,
          loopSpecStore: input.loopSpecStore
        });
        applied = await applyGraphChangeSet({
          projectRoot: input.projectRoot,
          changeSetId,
          approvalReceiptId: approval.receipt.id,
          designRunId,
          acceptedProposalIds: proposalSet.proposals.map((proposal) => proposal.proposalId),
          initiatedBy: "loopgraph-controller",
          now: input.now
        }, {
          store: input.semanticGraphStore,
          opportunityStore: input.opportunityStore,
          designStore: input.discoveryDesignStore,
          hermesDesignStore: input.designStore,
          loopSpecStore: input.loopSpecStore
        });
      } catch (error) {
        decisions.push(decision({
          ...base,
          designRunId,
          graphApprovalReceiptId: approval?.receipt.id,
          action: "review_change",
          summary: `${opportunity.title}: shadow graph transaction failed`,
          reason: error instanceof Error ? error.message : String(error),
          policy: {
            passed: false,
            rules: [
              ...gate.rules,
              rule("semantic-graph-transaction", false, error instanceof Error ? error.message : String(error))
            ]
          }
        }));
        continue;
      }
      decisions.push(decision({
        ...base,
        designRunId,
        graphApprovalReceiptId: approval.receipt.id,
        graphTransactionId: applied.transaction.id,
        action: "shadow_materialize",
        summary: `${opportunity.title}: materialized in shadow mode`,
        reason: "Every strict automatic-shadow policy rule passed and the content-bound graph transaction committed.",
        policy: gate
      }));
      continue;
    }
    decisions.push(decision({
      ...base,
      action: dispatchedTaskIds.has(opportunity.designTaskId ?? "")
        ? "start_design"
        : "review_change",
      summary: opportunity.title,
      reason: dispatchedTaskIds.has(opportunity.designTaskId ?? "")
        ? "The opportunity crossed the automatic-design threshold and a durable Hermes task was started."
        : `The opportunity is qualified but has not crossed the automatic-design threshold ${input.policy.autoDesignThreshold}.`,
      policy: { passed: true, rules: [] }
    }));
  }
  return decisions;
}

async function evaluateDueProjectOutcomes(input: {
  projectRoot: string;
  projectRootId: string;
  outcomeStore: OutcomeStore;
  now: Date;
}): Promise<DueOutcomeEvaluation> {
  const definitions = await readProjectMetricDefinitions(input.projectRoot);
  const records: ObservedOutcome[] = [];
  const errors: DueOutcomeEvaluation["errors"] = [];
  for (const definition of definitions.filter((item) => item.loopId)) {
    const samples = (await input.outcomeStore.listMetricSamples({
      workspaceId: input.projectRootId,
      companyId: definition.companyId,
      loopId: definition.loopId,
      metricDefinitionId: definition.id
    })).sort((left, right) => left.observedAt.localeCompare(right.observedAt));
    const latest = samples.at(-1);
    if (!latest || Date.parse(latest.window.end) > input.now.getTime()) continue;
    const windowDays = Math.max(1, definition.evaluationWindowDays ?? 7);
    const windowMilliseconds = windowDays * 86_400_000;
    const evaluationEnd = new Date(latest.window.end);
    const evaluationStart = new Date(evaluationEnd.getTime() - windowMilliseconds + 1);
    const baselineEnd = new Date(evaluationStart.getTime() - 1);
    const baselineStart = new Date(baselineEnd.getTime() - windowMilliseconds + 1);
    try {
      const result = await evaluateObservedOutcome({
        store: input.outcomeStore,
        workspaceId: input.projectRootId,
        companyId: definition.companyId,
        departmentId: definition.departmentId,
        loopId: definition.loopId!,
        metricDefinition: definition,
        baselineWindow: {
          start: baselineStart.toISOString(),
          end: baselineEnd.toISOString()
        },
        evaluationWindow: {
          start: evaluationStart.toISOString(),
          end: evaluationEnd.toISOString()
        },
        desiredDirection: definition.desiredDirection,
        now: input.now
      });
      records.push(result.record);
    } catch (error) {
      errors.push({
        code: "OUTCOME_EVALUATION_FAILED",
        message: error instanceof Error ? error.message : String(error),
        evidenceRefs: [definition.id]
      });
    }
  }
  return { records, errors };
}

function normalizeControllerTrigger(
  input: Partial<LoopControllerTrigger> | undefined,
  now: Date
): LoopControllerTrigger {
  const type = input?.type ?? "manual";
  const occurredAt = input?.occurredAt ?? now.toISOString();
  const bucket = Math.floor(now.getTime() / (15 * 60 * 1000));
  return loopControllerTriggerSchema.parse({
    type,
    id: input?.id ?? `${type}_${bucket}`,
    occurredAt,
    sourceRef: input?.sourceRef ?? `loopgraph-controller:${type}`,
    requestedBy: input?.requestedBy,
    evidenceRefs: input?.evidenceRefs ?? []
  });
}

function controllerEvidenceFingerprint(
  scan: ScanLoopOpportunitiesResult,
  outcomes: ObservedOutcome[]
) {
  return contentHash({
    opportunities: scan.opportunities.map((item) => ({
      id: item.id,
      generation: item.generation,
      status: item.status,
      score: item.score.total,
      signalIds: [...item.signalIds].sort(),
      designTaskId: item.designTaskId
    })).sort((left, right) => left.id.localeCompare(right.id)),
    outcomes: outcomes.map((item) => ({
      id: item.id,
      status: item.status,
      truthStatus: item.truthStatus,
      evaluatedAt: item.evaluatedAt
    })).sort((left, right) => left.id.localeCompare(right.id))
  });
}

function countOutcomeTruth(outcomes: ObservedOutcome[]) {
  return outcomes.reduce((counts, outcome) => {
    counts[outcome.truthStatus] += 1;
    return counts;
  }, { observed: 0, modeled: 0, incomplete: 0 });
}

function decision(input: Omit<LoopControllerDecision, "id">): LoopControllerDecision {
  return loopControllerDecisionSchema.parse({
    ...input,
    id: `controller_decision_${contentHash({
      action: input.action,
      opportunityId: input.opportunityId,
      designRunId: input.designRunId,
      materializationId: input.materializationId,
      createdAt: input.createdAt
    })}`
  });
}

function noActionDecision(input: {
  now: Date;
  reason: string;
  evidenceRefs: string[];
}): LoopControllerDecision {
  return decision({
    action: "no_action",
    targetLoopIds: [],
    summary: "No controller action",
    reason: input.reason,
    evidenceRefs: input.evidenceRefs,
    policy: { passed: true, rules: [] },
    createdAt: input.now.toISOString()
  });
}

function rule(
  id: string,
  passed: boolean,
  summary: string,
  evidenceRefs: string[] = []
): LoopControllerPolicyRule {
  return { id, passed, summary, evidenceRefs };
}

function maximumSignalSeverity(opportunity: LoopOpportunity): "low" | "medium" | "high" | "critical" {
  return opportunity.signals
    .map((signal) => signal.severity)
    .sort((left, right) => severityRank(right) - severityRank(left))[0] ?? "low";
}

function severityRank(severity: "low" | "medium" | "high" | "critical") {
  return { low: 0, medium: 1, high: 2, critical: 3 }[severity];
}

function unique(values: string[]) {
  return [...new Set(values)];
}
