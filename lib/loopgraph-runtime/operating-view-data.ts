import {
  FileMeasurementStore,
  FileOutcomeStore,
  listGraphChangeSets,
  listLoopOpportunities
} from "loopgraph/runtime";
import { isHostedPreview } from "@/lib/hosted-preview";
import {
  getActiveLoopgraphProjectRoot,
  getHermesDesignStore,
  getLoopControllerStore,
  getLoopOpportunityStore,
  getLoopgraphRoot,
  getSemanticGraphStore
} from "@/lib/loopgraph-runtime/storage-resolver";

export type OpportunityView = {
  id: string;
  title: string;
  summary: string;
  department: string;
  kind: string;
  status: string;
  score: number;
  scoreReasons: string[];
  signalCount: number;
  highestSeverity: string;
  lastObservedAt: string;
  graphChangeSetId?: string;
};

export type ChangeReviewView = {
  id: string;
  changeSetId: string;
  changeId: string;
  primaryChange: boolean;
  changeCount: number;
  opportunityId: string;
  status: string;
  version: number;
  operation: string;
  department: string;
  title: string;
  rationale: string;
  expectedOutcome: string;
  evidenceCount: number;
  requiresExplicitApproval: boolean;
  designStatus?: string;
  canApprove: boolean;
  approvalBlockedReason?: string;
  approvalDecision?: string;
  approvalActor?: string;
  transactionStatus?: string;
  transactionId?: string;
  updatedAt: string;
};

export type ControllerRunView = {
  id: string;
  status: string;
  triggerType: string;
  triggerSource: string;
  startedAt: string;
  completedAt?: string;
  decisionCount: number;
  decisions: Array<{
    action: string;
    summary: string;
    reason: string;
    passed: boolean;
    failedRules: string[];
  }>;
  errors: string[];
};

export type LearningBindingView = {
  id: string;
  loopId: string;
  metricKey: string;
  role: string;
  connectorInstanceId: string;
  capabilityKey: string;
  cadenceSeconds: number;
  completedJobs: number;
  pendingJobs: number;
  failedJobs: number;
  sampleCount: number;
  latestValue?: number;
  unit: string;
  latestQuality?: string;
  latestObservedAt?: string;
};

export type OutcomeView = {
  id: string;
  loopId: string;
  metricKey: string;
  status: string;
  truthStatus: "observed" | "modeled" | "incomplete";
  baseline?: number;
  observed?: number;
  relativeDeltaPct?: number;
  confidence: number;
  guardrailsPassed: number;
  guardrailCount: number;
  missingReasons: string[];
  evaluatedAt: string;
};

export type ValueEntryView = {
  id: string;
  loopId: string;
  truthStatus: "observed" | "modeled" | "incomplete";
  grossSavedMinutes: number;
  observedCostMinutes: number;
  netSavedMinutes: number;
  hiddenCosts: {
    review: number;
    rework: number;
    botsitting: number;
    escalation: number;
    governance: number;
  };
  monetaryValue?: {
    currency: string;
    netAmount: number;
  };
  recordedAt: string;
};

export type OperatingViewData = {
  mode: "preview" | "local";
  opportunities: OpportunityView[];
  changes: ChangeReviewView[];
  controller: {
    policySource: "default" | "saved";
    enabled: boolean;
    autoStartDesign: boolean;
    autoEvaluateOutcomes: boolean;
    autoShadowMaterialization: boolean;
    qualifyThreshold: number;
    autoDesignThreshold: number;
    autoShadowThreshold: number;
    blockedDepartments: string[];
    pendingTriggers: number;
    failedTriggers: number;
    lastCheckpointAt?: string;
    runs: ControllerRunView[];
  };
  learning: {
    bindings: LearningBindingView[];
    outcomes: OutcomeView[];
    reconciliation?: {
      status: string;
      checkedAt: string;
      issues: Array<{
        severity: string;
        summary: string;
        repairAction: string;
      }>;
    };
    deadLetterJobs: number;
  };
  value: {
    entries: ValueEntryView[];
    observedNetMinutes: number;
    modeledNetMinutes: number;
    incompleteNetMinutes: number;
    observedCostMinutes: number;
    truthCounts: {
      observed: number;
      modeled: number;
      incomplete: number;
    };
  };
};

export async function getOperatingViewData(): Promise<OperatingViewData> {
  if (isHostedPreview()) return buildHostedOperatingPreview();

  const projectRoot = getActiveLoopgraphProjectRoot();
  const loopgraphRoot = getLoopgraphRoot(projectRoot);
  const graphStore = getSemanticGraphStore({ projectRoot });
  const hermesDesignStore = getHermesDesignStore();
  const controllerStore = getLoopControllerStore({ projectRoot });
  const opportunityStore = getLoopOpportunityStore({ projectRoot });
  const outcomeStore = new FileOutcomeStore(loopgraphRoot);
  const measurementStore = new FileMeasurementStore(loopgraphRoot);

  const [
    opportunities,
    changeSets,
    designTasks,
    approvals,
    transactions,
    policy,
    triggers,
    controllerRuns,
    checkpoint,
    bindings,
    jobs,
    reconciliationReports,
    samples,
    outcomes,
    valueEntries
  ] = await Promise.all([
    listLoopOpportunities(projectRoot, {}, opportunityStore),
    listGraphChangeSets(projectRoot, undefined, opportunityStore),
    hermesDesignStore.listTasks(),
    graphStore.listApprovals(),
    graphStore.listTransactions(),
    controllerStore.readPolicy(),
    controllerStore.listTriggers(),
    controllerStore.listRuns(),
    controllerStore.readCheckpoint(),
    measurementStore.listMetricBindings(),
    measurementStore.listMeasurementJobs(),
    measurementStore.listReconciliationReports(),
    outcomeStore.listMetricSamples(),
    outcomeStore.listObservedOutcomes(),
    outcomeStore.listValueLedgerEntries()
  ]);

  const mappedOpportunities: OpportunityView[] = opportunities.map((item) => ({
    id: item.id,
    title: item.title,
    summary: item.summary,
    department: humanize(item.department),
    kind: humanize(item.kind),
    status: humanize(item.status),
    score: item.score.total,
    scoreReasons: item.score.explanation,
    signalCount: item.signals.length,
    highestSeverity: highestSeverity(item.signals.map((signal) => signal.severity)),
    lastObservedAt: item.lastObservedAt,
    graphChangeSetId: item.graphChangeSetId
  }));

  const latestApprovalByChangeSet = new Map<string, (typeof approvals)[number]>();
  for (const approval of approvals) {
    if (!approval.changeSetId) continue;
    const current = latestApprovalByChangeSet.get(approval.changeSetId);
    if (!current || approval.decidedAt > current.decidedAt) {
      latestApprovalByChangeSet.set(approval.changeSetId, approval);
    }
  }
  const opportunityById = new Map(opportunities.map((item) => [item.id, item]));
  const designTaskById = new Map(designTasks.map((task) => [task.id, task]));
  const transactionById = new Map(transactions.map((transaction) => [transaction.id, transaction]));
  const transactionByChangeSet = new Map<string, (typeof transactions)[number]>();
  for (const transaction of transactions) {
    if (transaction.changeSetId && !transactionByChangeSet.has(transaction.changeSetId)) {
      transactionByChangeSet.set(transaction.changeSetId, transaction);
    }
  }
  const mappedChanges: ChangeReviewView[] = changeSets.flatMap((set) =>
    set.changes.map((change, index) => {
      const approval = latestApprovalByChangeSet.get(set.id);
      const opportunity = opportunityById.get(set.opportunityId);
      const taskId = set.designTaskId ?? opportunity?.designTaskId;
      const task = taskId ? designTaskById.get(taskId) : undefined;
      const designRunId = task?.designRunIds.at(-1) ?? set.designRunId;
      const canApprove = set.status === "proposed" &&
        task?.status === "completed" &&
        Boolean(designRunId);
      const transaction = (set.appliedTransactionId
        ? transactionById.get(set.appliedTransactionId)
        : undefined) ?? transactionByChangeSet.get(set.id);
      return {
        id: `${set.id}:${change.id}`,
        changeSetId: set.id,
        changeId: change.id,
        primaryChange: index === 0,
        changeCount: set.changes.length,
        opportunityId: set.opportunityId,
        status: humanize(set.status),
        version: set.version,
        operation: humanize(change.operation),
        department: humanize(change.department),
        title: change.title,
        rationale: change.rationale,
        expectedOutcome: change.expectedOutcome,
        evidenceCount: change.evidenceRefs.length,
        requiresExplicitApproval: change.requiresExplicitApproval,
        designStatus: task ? humanize(task.status) : undefined,
        canApprove,
        approvalBlockedReason: approvalBlockedReason({
          changeSetStatus: set.status,
          taskStatus: task?.status,
          designRunId
        }),
        approvalDecision: approval ? humanize(approval.decision) : undefined,
        approvalActor: approval?.actorId,
        transactionStatus: transaction ? humanize(transaction.status) : undefined,
        transactionId: transaction?.id,
        updatedAt: set.updatedAt
      };
    })
  );

  const latestReconciliation = reconciliationReports[0];
  const jobsByBinding = groupBy(jobs, (job) => job.bindingId);
  const samplesByLoopMetric = groupBy(
    samples,
    (sample) => `${sample.loopId ?? ""}:${sample.metricKey}`
  );
  return {
    mode: "local",
    opportunities: mappedOpportunities,
    changes: mappedChanges,
    controller: {
      policySource: policy ? "saved" : "default",
      enabled: policy?.enabled ?? true,
      autoStartDesign: policy?.autoStartDesign ?? true,
      autoEvaluateOutcomes: policy?.autoEvaluateOutcomes ?? true,
      autoShadowMaterialization: policy?.autoShadowMaterialization ?? true,
      qualifyThreshold: policy?.qualifyThreshold ?? 45,
      autoDesignThreshold: policy?.autoDesignThreshold ?? 65,
      autoShadowThreshold: policy?.autoShadowThreshold ?? 80,
      blockedDepartments: (policy?.blockedAutoShadowDepartments ?? [
        "ops_finance",
        "hr_talent",
        "legal_compliance"
      ]).map(humanize),
      pendingTriggers: triggers.filter((item) => item.status === "pending" || item.status === "processing").length,
      failedTriggers: triggers.filter((item) => item.status === "failed").length,
      lastCheckpointAt: checkpoint?.lastCompletedAt,
      runs: controllerRuns.map((run) => ({
        id: run.id,
        status: humanize(run.status),
        triggerType: humanize(run.trigger.type),
        triggerSource: run.trigger.sourceRef,
        startedAt: run.startedAt,
        completedAt: run.completedAt,
        decisionCount: run.decisions.length,
        decisions: run.decisions.map((decision) => ({
          action: humanize(decision.action),
          summary: decision.summary,
          reason: decision.reason,
          passed: decision.policy.passed,
          failedRules: decision.policy.rules
            .filter((rule) => !rule.passed)
            .map((rule) => rule.summary)
        })),
        errors: run.errors.map((error) => error.message)
      }))
    },
    learning: {
      bindings: bindings.map((binding) => {
        const bindingJobs = jobsByBinding.get(binding.id) ?? [];
        const bindingSamples = samplesByLoopMetric.get(`${binding.loopId}:${binding.metricKey}`) ?? [];
        const latest = bindingSamples[0];
        return {
          id: binding.id,
          loopId: binding.loopId,
          metricKey: binding.metricKey,
          role: humanize(binding.role),
          connectorInstanceId: binding.connectorInstanceId,
          capabilityKey: binding.capabilityKey,
          cadenceSeconds: binding.schedule.cadenceSeconds,
          completedJobs: bindingJobs.filter((job) => job.status === "completed").length,
          pendingJobs: bindingJobs.filter((job) => job.status === "pending" || job.status === "claimed").length,
          failedJobs: bindingJobs.filter((job) => job.status === "failed" || job.status === "dead_letter").length,
          sampleCount: bindingSamples.length,
          latestValue: latest?.value,
          unit: binding.unit,
          latestQuality: latest ? humanize(latest.quality.status) : undefined,
          latestObservedAt: latest?.observedAt
        };
      }),
      outcomes: outcomes.map((outcome) => ({
        id: outcome.id,
        loopId: outcome.loopId,
        metricKey: outcome.metricKey,
        status: humanize(outcome.status),
        truthStatus: outcome.truthStatus,
        baseline: outcome.baseline?.value,
        observed: outcome.observed?.value,
        relativeDeltaPct: outcome.relativeDeltaPct,
        confidence: outcome.confidence,
        guardrailsPassed: outcome.guardrails.filter((guardrail) => guardrail.passed).length,
        guardrailCount: outcome.guardrails.length,
        missingReasons: outcome.evidenceSufficiency.reasons,
        evaluatedAt: outcome.evaluatedAt
      })),
      reconciliation: latestReconciliation
        ? {
            status: humanize(latestReconciliation.status),
            checkedAt: latestReconciliation.checkedAt,
            issues: latestReconciliation.issues.map((issue) => ({
              severity: humanize(issue.severity),
              summary: issue.summary,
              repairAction: issue.repairAction
            }))
          }
        : undefined,
      deadLetterJobs: jobs.filter((job) => job.status === "dead_letter").length
    },
    value: summarizeValue(valueEntries.map((entry) => ({
      id: entry.id,
      loopId: entry.loopId,
      truthStatus: entry.truthStatus,
      grossSavedMinutes: entry.grossSavedMinutes,
      observedCostMinutes: entry.observedCostMinutes,
      netSavedMinutes: entry.netSavedMinutes,
      hiddenCosts: entry.hiddenCostMinutes,
      monetaryValue: entry.monetaryValue
        ? {
            currency: entry.monetaryValue.currency,
            netAmount: entry.monetaryValue.netAmount
          }
        : undefined,
      recordedAt: entry.recordedAt
    })))
  };
}

export function summarizeValue(entries: ValueEntryView[]): OperatingViewData["value"] {
  const total = (truthStatus: ValueEntryView["truthStatus"]) =>
    entries
      .filter((entry) => entry.truthStatus === truthStatus)
      .reduce((sum, entry) => sum + entry.netSavedMinutes, 0);

  return {
    entries,
    observedNetMinutes: total("observed"),
    modeledNetMinutes: total("modeled"),
    incompleteNetMinutes: total("incomplete"),
    observedCostMinutes: entries
      .filter((entry) => entry.truthStatus === "observed")
      .reduce((sum, entry) => sum + entry.observedCostMinutes, 0),
    truthCounts: {
      observed: entries.filter((entry) => entry.truthStatus === "observed").length,
      modeled: entries.filter((entry) => entry.truthStatus === "modeled").length,
      incomplete: entries.filter((entry) => entry.truthStatus === "incomplete").length
    }
  };
}

export function buildHostedOperatingPreview(): OperatingViewData {
  const opportunities: OpportunityView[] = [
    {
      id: "preview-opportunity-product-activation",
      title: "Recover stalled onboarding accounts",
      summary: "Repeated activation stalls have no loop that joins product telemetry, CRM context, and customer outreach.",
      department: "Product",
      kind: "Create loop",
      status: "Proposal Ready",
      score: 88,
      scoreReasons: [
        "The same activation gap appeared in 14 accounts.",
        "Qualified expansion revenue is exposed.",
        "Product and CRM evidence agree."
      ],
      signalCount: 31,
      highestSeverity: "High",
      lastObservedAt: "2026-07-28T17:35:00.000Z",
      graphChangeSetId: "preview-change-product-activation"
    },
    {
      id: "preview-opportunity-support-escalation",
      title: "Split urgent support from routine triage",
      summary: "One support loop handles incompatible response windows and creates avoidable human route corrections.",
      department: "Customer success",
      kind: "Split loop",
      status: "Qualified",
      score: 73,
      scoreReasons: [
        "Priority corrections recur every week.",
        "Escalation response time regressed.",
        "The proposed split remains in shadow mode."
      ],
      signalCount: 18,
      highestSeverity: "Medium",
      lastObservedAt: "2026-07-28T15:10:00.000Z"
    },
    {
      id: "preview-opportunity-ads",
      title: "Improve campaign anomaly evidence",
      summary: "The Ads loop routes correctly but waits too long for qualified-pipeline evidence before recommending a budget change.",
      department: "Marketing",
      kind: "Improve loop",
      status: "Designing",
      score: 69,
      scoreReasons: [
        "Review latency is above the department target.",
        "No guardrail failures were observed.",
        "A faster CRM measurement is available."
      ],
      signalCount: 22,
      highestSeverity: "Medium",
      lastObservedAt: "2026-07-28T13:48:00.000Z"
    }
  ];

  const entries: ValueEntryView[] = [
    {
      id: "preview-value-product-activation",
      loopId: "product_activation_recovery",
      truthStatus: "observed",
      grossSavedMinutes: 720,
      observedCostMinutes: 118,
      netSavedMinutes: 602,
      hiddenCosts: {
        review: 54,
        rework: 22,
        botsitting: 28,
        escalation: 8,
        governance: 6
      },
      monetaryValue: { currency: "USD", netAmount: 3840 },
      recordedAt: "2026-07-28T18:00:00.000Z"
    },
    {
      id: "preview-value-support",
      loopId: "support_priority_triage",
      truthStatus: "observed",
      grossSavedMinutes: 410,
      observedCostMinutes: 96,
      netSavedMinutes: 314,
      hiddenCosts: {
        review: 38,
        rework: 20,
        botsitting: 19,
        escalation: 14,
        governance: 5
      },
      recordedAt: "2026-07-27T18:00:00.000Z"
    },
    {
      id: "preview-value-ads",
      loopId: "marketing_ads",
      truthStatus: "modeled",
      grossSavedMinutes: 300,
      observedCostMinutes: 45,
      netSavedMinutes: 255,
      hiddenCosts: {
        review: 25,
        rework: 8,
        botsitting: 6,
        escalation: 0,
        governance: 6
      },
      recordedAt: "2026-07-28T12:00:00.000Z"
    },
    {
      id: "preview-value-content",
      loopId: "marketing_content_creation",
      truthStatus: "incomplete",
      grossSavedMinutes: 0,
      observedCostMinutes: 32,
      netSavedMinutes: -32,
      hiddenCosts: {
        review: 18,
        rework: 9,
        botsitting: 5,
        escalation: 0,
        governance: 0
      },
      recordedAt: "2026-07-28T12:00:00.000Z"
    }
  ];

  return {
    mode: "preview",
    opportunities,
    changes: [
      {
        id: "preview-change-product-activation:add-product-activation",
        changeSetId: "preview-change-product-activation",
        changeId: "add-product-activation",
        primaryChange: true,
        changeCount: 1,
        opportunityId: "preview-opportunity-product-activation",
        status: "Proposed",
        version: 1,
        operation: "Add",
        department: "Product",
        title: "Add activation recovery loop",
        rationale: "Join verified product inactivity with CRM ownership before drafting customer outreach.",
        expectedOutcome: "Reduce qualified-account activation stalls without increasing unwanted outreach.",
        evidenceCount: 9,
        requiresExplicitApproval: true,
        designStatus: "Completed",
        canApprove: false,
        approvalBlockedReason: "The public preview is read-only.",
        updatedAt: "2026-07-28T17:42:00.000Z"
      },
      {
        id: "preview-change-support:split-support",
        changeSetId: "preview-change-support",
        changeId: "split-support",
        primaryChange: true,
        changeCount: 1,
        opportunityId: "preview-opportunity-support-escalation",
        status: "Approved",
        version: 2,
        operation: "Split",
        department: "Customer success",
        title: "Split urgent escalation from routine triage",
        rationale: "Different risk, owner, and response-time contracts require independently governed loops.",
        expectedOutcome: "Cut urgent-ticket response time while preserving routine triage precision.",
        evidenceCount: 14,
        requiresExplicitApproval: true,
        designStatus: "Completed",
        canApprove: false,
        approvalDecision: "Approved",
        approvalActor: "support-director",
        updatedAt: "2026-07-28T16:02:00.000Z"
      },
      {
        id: "preview-change-ads:update-ads",
        changeSetId: "preview-change-ads",
        changeId: "update-ads",
        primaryChange: true,
        changeCount: 1,
        opportunityId: "preview-opportunity-ads",
        status: "Applied",
        version: 1,
        operation: "Update",
        department: "Marketing",
        title: "Add qualified-pipeline measurement to Ads",
        rationale: "Budget recommendations need downstream business evidence, not click efficiency alone.",
        expectedOutcome: "Faster decisions with no increase in false budget alerts.",
        evidenceCount: 11,
        requiresExplicitApproval: true,
        designStatus: "Completed",
        canApprove: false,
        approvalDecision: "Approved",
        approvalActor: "growth-lead",
        transactionStatus: "Committed",
        transactionId: "preview-transaction-ads",
        updatedAt: "2026-07-28T14:20:00.000Z"
      }
    ],
    controller: {
      policySource: "saved",
      enabled: true,
      autoStartDesign: true,
      autoEvaluateOutcomes: true,
      autoShadowMaterialization: true,
      qualifyThreshold: 45,
      autoDesignThreshold: 65,
      autoShadowThreshold: 80,
      blockedDepartments: ["Operations finance", "HR talent", "Legal compliance"],
      pendingTriggers: 2,
      failedTriggers: 0,
      lastCheckpointAt: "2026-07-28T17:45:00.000Z",
      runs: [
        {
          id: "preview-controller-run-activation",
          status: "Completed",
          triggerType: "Outcome window",
          triggerSource: "measurement:activation_7d",
          startedAt: "2026-07-28T17:40:00.000Z",
          completedAt: "2026-07-28T17:40:03.000Z",
          decisionCount: 2,
          decisions: [
            {
              action: "Start design",
              summary: "Design a Product activation recovery loop.",
              reason: "The opportunity score exceeded the auto-design threshold with sufficient product and CRM evidence.",
              passed: true,
              failedRules: []
            },
            {
              action: "Review change",
              summary: "Wait for product-owner approval before graph mutation.",
              reason: "Every graph change requires an accountable approval receipt.",
              passed: false,
              failedRules: ["Explicit graph approval has not been recorded."]
            }
          ],
          errors: []
        },
        {
          id: "preview-controller-run-content",
          status: "Completed",
          triggerType: "Connector health",
          triggerSource: "connection:notion-content",
          startedAt: "2026-07-28T15:30:00.000Z",
          completedAt: "2026-07-28T15:30:02.000Z",
          decisionCount: 1,
          decisions: [
            {
              action: "Request evidence",
              summary: "Keep Content Creation in shadow mode.",
              reason: "Publishing evidence is stale and the primary outcome window is incomplete.",
              passed: false,
              failedRules: ["Primary metric evidence is incomplete.", "Connection health is stale."]
            }
          ],
          errors: []
        }
      ]
    },
    learning: {
      bindings: [
        {
          id: "preview-binding-activation",
          loopId: "product_activation_recovery",
          metricKey: "qualified_activation_rate",
          role: "Primary",
          connectorInstanceId: "posthog-production",
          capabilityKey: "product.analytics.read",
          cadenceSeconds: 3600,
          completedJobs: 14,
          pendingJobs: 1,
          failedJobs: 0,
          sampleCount: 14,
          latestValue: 68.4,
          unit: "%",
          latestQuality: "Verified",
          latestObservedAt: "2026-07-28T17:00:00.000Z"
        },
        {
          id: "preview-binding-support",
          loopId: "support_priority_triage",
          metricKey: "urgent_first_response_minutes",
          role: "Primary",
          connectorInstanceId: "support-production",
          capabilityKey: "support.tickets.read",
          cadenceSeconds: 1800,
          completedJobs: 28,
          pendingJobs: 0,
          failedJobs: 0,
          sampleCount: 28,
          latestValue: 8.7,
          unit: "minutes",
          latestQuality: "Verified",
          latestObservedAt: "2026-07-28T17:30:00.000Z"
        },
        {
          id: "preview-binding-ads",
          loopId: "marketing_ads",
          metricKey: "qualified_pipeline_per_dollar",
          role: "Primary",
          connectorInstanceId: "hubspot-production",
          capabilityKey: "crm.pipeline.read",
          cadenceSeconds: 3600,
          completedJobs: 11,
          pendingJobs: 1,
          failedJobs: 0,
          sampleCount: 11,
          latestValue: 1.42,
          unit: "ratio",
          latestQuality: "Verified",
          latestObservedAt: "2026-07-28T17:00:00.000Z"
        },
        {
          id: "preview-binding-content",
          loopId: "marketing_content_creation",
          metricKey: "qualified_content_assists",
          role: "Primary",
          connectorInstanceId: "notion-content",
          capabilityKey: "content.analytics.read",
          cadenceSeconds: 3600,
          completedJobs: 7,
          pendingJobs: 0,
          failedJobs: 1,
          sampleCount: 7,
          unit: "assists",
          latestQuality: "Stale",
          latestObservedAt: "2026-07-27T10:00:00.000Z"
        }
      ],
      outcomes: [
        {
          id: "preview-outcome-activation",
          loopId: "product_activation_recovery",
          metricKey: "qualified_activation_rate",
          status: "Improved",
          truthStatus: "observed",
          baseline: 51.2,
          observed: 68.4,
          relativeDeltaPct: 33.59,
          confidence: 0.94,
          guardrailsPassed: 2,
          guardrailCount: 2,
          missingReasons: [],
          evaluatedAt: "2026-07-28T17:05:00.000Z"
        },
        {
          id: "preview-outcome-support",
          loopId: "support_priority_triage",
          metricKey: "urgent_first_response_minutes",
          status: "Target met",
          truthStatus: "observed",
          baseline: 18.5,
          observed: 8.7,
          relativeDeltaPct: -52.97,
          confidence: 0.91,
          guardrailsPassed: 1,
          guardrailCount: 1,
          missingReasons: [],
          evaluatedAt: "2026-07-28T17:35:00.000Z"
        },
        {
          id: "preview-outcome-ads",
          loopId: "marketing_ads",
          metricKey: "qualified_pipeline_per_dollar",
          status: "Improved",
          truthStatus: "modeled",
          baseline: 1.1,
          observed: 1.42,
          relativeDeltaPct: 29.09,
          confidence: 0.64,
          guardrailsPassed: 1,
          guardrailCount: 1,
          missingReasons: ["The preview uses modeled attribution until a warehouse source is connected."],
          evaluatedAt: "2026-07-28T17:05:00.000Z"
        },
        {
          id: "preview-outcome-content",
          loopId: "marketing_content_creation",
          metricKey: "qualified_content_assists",
          status: "Incomplete",
          truthStatus: "incomplete",
          confidence: 0.28,
          guardrailsPassed: 0,
          guardrailCount: 1,
          missingReasons: ["The latest content analytics sample is stale.", "No complete comparison window exists."],
          evaluatedAt: "2026-07-28T17:05:00.000Z"
        }
      ],
      reconciliation: {
        status: "Degraded",
        checkedAt: "2026-07-28T17:32:00.000Z",
        issues: [
          {
            severity: "Warning",
            summary: "The Notion content connection has not reported health within its freshness window.",
            repairAction: "Refresh the Hermes-managed credential and run connection reconciliation again."
          }
        ]
      },
      deadLetterJobs: 0
    },
    value: summarizeValue(entries)
  };
}

function humanize(value: string): string {
  return value
    .replaceAll("_", " ")
    .replace(/\b\w/g, (character) => character.toUpperCase());
}

function approvalBlockedReason(input: {
  changeSetStatus: string;
  taskStatus?: string;
  designRunId?: string;
}): string | undefined {
  if (input.changeSetStatus !== "proposed") {
    return `This change set is already ${humanize(input.changeSetStatus).toLowerCase()}.`;
  }
  if (!input.taskStatus) {
    return "Hermes has not created the governed design task yet.";
  }
  if (input.taskStatus !== "completed") {
    return `Hermes design is ${humanize(input.taskStatus).toLowerCase()}; finish the requested evidence or repair work before approval.`;
  }
  if (!input.designRunId) {
    return "The completed Hermes task is missing its immutable design run.";
  }
  return undefined;
}

function highestSeverity(severities: string[]): string {
  const order = ["low", "medium", "high", "critical"];
  return humanize(severities.reduce((highest, value) =>
    order.indexOf(value) > order.indexOf(highest) ? value : highest
  , "low"));
}

function groupBy<T>(items: T[], keyFor: (item: T) => string): Map<string, T[]> {
  const grouped = new Map<string, T[]>();
  for (const item of items) {
    const key = keyFor(item);
    const values = grouped.get(key);
    if (values) values.push(item);
    else grouped.set(key, [item]);
  }
  return grouped;
}
