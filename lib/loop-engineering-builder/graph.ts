import type {
  DepartmentKey,
  HiddenLaborMetrics,
  HumanReview,
  ImprovementItem,
  LoopGraph,
  LoopGraphEdge,
  LoopGraphNode,
  LoopGraphViewState,
  LoopHealthSummary,
  LoopRecord,
  WorkspaceData
} from "./types";
import { getDepartmentTemplate, getTemplateById, getTemplateCatalog } from "./templates";
import type { LoadedRegisteredLoopSpec } from "./local-workspace";
import { loopIdsMatch } from "../loopgraph-runtime/run-filters";

const defaultView: LoopGraphViewState = {
  mode: "topology",
  filters: {
    department: "all",
    status: "all",
    attentionOnly: false
  },
  inspectorTab: "overview"
};

const defaultHiddenLabor: HiddenLaborMetrics = {
  baselineMinutes: 450,
  loopExecutionMinutes: 186,
  reviewMinutes: 48,
  reworkMinutes: 34,
  botsittingMinutes: 22,
  escalationMinutes: 18,
  governanceMinutes: 12,
  relationshipRedeploymentMinutes: 96,
  qualityScore: 84,
  businessOutcomeNotes:
    "Qualified conversion improved while downstream activation stayed within the target band."
};

export function getDefaultGraphView(selectedNodeId?: string): LoopGraphViewState {
  return {
    ...defaultView,
    selectedNodeId
  };
}

export function calculateHiddenLaborSummary(
  loopId: string,
  status: string,
  hiddenLabor: Partial<HiddenLaborMetrics> = {},
  openReviews = 0,
  openImprovements = 0
): LoopHealthSummary {
  const metrics = {
    ...defaultHiddenLabor,
    ...hiddenLabor
  };
  const overhead =
    metrics.loopExecutionMinutes +
    metrics.reviewMinutes +
    metrics.reworkMinutes +
    metrics.botsittingMinutes +
    metrics.escalationMinutes +
    metrics.governanceMinutes;
  const netTimeSavedMinutes = Math.max(metrics.baselineMinutes - overhead, 0);
  const overheadRatio = overhead / Math.max(metrics.baselineMinutes, 1);
  const reviewPenalty = openReviews * 4;
  const improvementPenalty = openImprovements * 2;
  const quality = metrics.qualityScore ?? 80;

  return {
    loopId,
    status,
    openReviews,
    openImprovements,
    netTimeSavedMinutes,
    botsittingMinutes: metrics.botsittingMinutes,
    relationshipRedeploymentMinutes: Math.min(
      metrics.relationshipRedeploymentMinutes,
      netTimeSavedMinutes
    ),
    qualityScore: quality,
    healthScore: clamp(Math.round(quality - overheadRatio * 18 - reviewPenalty - improvementPenalty), 0, 100)
  };
}

export function buildLoopGraph(input: {
  organization: WorkspaceData["organization"];
  loops: LoopRecord[];
  reviews?: HumanReview[];
  improvements?: ImprovementItem[];
  selectedNodeId?: string;
  sourceLabel?: string;
  hiddenLaborByLoopId?: Record<string, Partial<HiddenLaborMetrics>>;
  runs?: Array<{ id: string; loopId: string; status: string }>;
  cases?: Array<{ id: string; sourceLoopId: string; severity: string; status: string; summary?: string }>;
}): LoopGraph {
  const reviews = input.reviews ?? [];
  const improvements = input.improvements ?? [];
  const runs = input.runs ?? [];
  const cases = input.cases ?? [];
  const runtimeReviews = reviewsFromRuns(runs, input.loops);
  const mergedReviews = mergeReviewsById(reviews, runtimeReviews);
  const departments = Array.from(new Set(input.loops.map((loop) => loop.department)));
  const health = input.loops.map((loop) => {
    const loopReviews = mergedReviews.filter(
      (review) => loopIdsMatch(review.loopId, loop.id) && review.status === "pending"
    );
    const loopImprovements = improvements.filter((item) => item.loopId === loop.id && item.status !== "done");
    const template = getTemplateById(loop.templateId);
    const traceLabor = input.hiddenLaborByLoopId?.[loop.id];
    const laborSource =
      traceLabor ??
      (loopReviews.length > 0 ? mergeHiddenLabor(loopReviews) : template?.defaultHiddenLabor);
    return calculateHiddenLaborSummary(
      loop.id,
      loop.status,
      laborSource,
      loop.openReviews || loopReviews.length,
      loop.improvementItems || loopImprovements.length
    );
  });

  const nodes: LoopGraphNode[] = [
    {
      id: `org:${input.organization.id}`,
      kind: "organization",
      label: input.organization.name,
      subtitle: "Workspace",
      count: input.loops.length
    },
    {
      id: "loop:management",
      kind: "management_loop",
      label: "Management Loop",
      subtitle: "Rolls up health, decisions, and trace learning",
      health: managementHealth(health),
      count: input.loops.length
    },
    ...departments.map((department) => departmentNode(department, input.loops)),
    ...input.loops.map((loop) => loopNode(loop, health.find((item) => item.loopId === loop.id))),
    ...dataSourceNodes(input.loops),
    ...ownerNodes(input.loops),
    ...metricNodes(input.loops),
    ...reviewNodes(mergedReviews),
    ...improvementNodes(improvements),
    ...caseNodes(cases, input.loops),
    ...traceNodes(runs, input.loops)
  ];

  const edges: LoopGraphEdge[] = [
    {
      id: `edge:${input.organization.id}:management`,
      source: `org:${input.organization.id}`,
      target: "loop:management",
      kind: "rolls_up_to",
      label: "operating cadence"
    },
    ...departments.map((department) => ({
      id: `edge:department:${department}:management`,
      source: `department:${department}`,
      target: "loop:management",
      kind: "rolls_up_to" as const,
      label: "department rollup"
    })),
    ...input.loops.flatMap((loop) => loopEdges(loop, mergedReviews, improvements)),
    ...caseEdges(cases, input.loops),
    ...traceEdges(runs, input.loops)
  ];

  return {
    nodes,
    edges,
    health,
    view: getDefaultGraphView(input.selectedNodeId ?? `loop:${input.loops[0]?.id ?? "management"}`),
    sourceLabel: input.sourceLabel
  };
}

export function buildGraphFromCatalog(input: {
  organization?: WorkspaceData["organization"];
  selectedNodeId?: string;
} = {}): LoopGraph {
  const organization = input.organization ?? { id: "org_demo", name: "Acme Loops" };
  const loops = createCatalogLoopRecords(organization.id);

  return buildLoopGraph({
    organization,
    loops,
    improvements: createCatalogImprovementItems(loops),
    selectedNodeId: input.selectedNodeId,
    sourceLabel: "Demo catalog"
  });
}

export function buildGraphFromRegisteredSpecs(input: {
  organization?: WorkspaceData["organization"];
  specs: LoadedRegisteredLoopSpec[];
  selectedNodeId?: string;
}): LoopGraph {
  const organization = input.organization ?? { id: "local_workspace", name: "Local Loopgraph workspace" };
  return buildLoopGraph({
    organization,
    loops: input.specs.map((item) => loopRecordFromRegisteredSpec(item, organization.id)),
    selectedNodeId: input.selectedNodeId,
    sourceLabel: "Local LoopSpec"
  });
}

export function createCatalogLoopRecords(organizationId = "org_demo"): LoopRecord[] {
  return getTemplateCatalog().map((template) => {
    const operationalState = catalogOperationalState(template);

    return {
      id: catalogLoopId(template.id),
      organizationId,
      templateId: template.id,
      name: template.name,
      department: template.department,
      loopType: template.loopType,
      status: operationalState.status,
      autonomyLevel: template.runtimeLevel === "runnable" ? "execute_with_approval" : "draft_for_review",
      owner: template.defaultOwners?.[0] ?? "Department owner",
      goal: template.goal ?? `${template.name} improves ${template.primaryMetric?.toLowerCase() ?? "quality-adjusted output"} with reviewable evidence.`,
      targetMetric: template.primaryMetric ?? template.defaultMetrics?.[0] ?? "Quality-adjusted output",
      businessOutcome: template.businessOutcome ?? "A measurable business outcome improves while hidden labor remains visible.",
      cadence: template.department === "management" ? "Weekly review" : "Weekly",
      specGenerated: template.runtimeLevel !== "catalog",
      implementationGenerated: template.runtimeLevel === "runnable",
      lastRunAt: operationalState.lastRunAt,
      openReviews: operationalState.openReviews,
      improvementItems: operationalState.improvementItems,
      source: "demo_catalog",
      runtimeLevel: template.runtimeLevel
    };
  });
}

function departmentNode(department: DepartmentKey, loops: LoopRecord[]): LoopGraphNode {
  const departmentTemplate = getDepartmentTemplate(department);
  const departmentLoops = loops.filter((loop) => loop.department === department);
  return {
    id: `department:${department}`,
    kind: "department",
    label: departmentTemplate?.name ?? titleCase(department),
    subtitle: "Department loops",
    department,
    count: departmentLoops.length,
    metadata: {
      loopIds: departmentLoops.map((loop) => loop.id)
    }
  };
}

function loopNode(loop: LoopRecord, health?: LoopHealthSummary): LoopGraphNode {
  const template = getTemplateById(loop.templateId);
  return {
    id: `loop:${loop.id}`,
    kind: loop.department === "management" ? "management_loop" : "loop",
    label: loop.name,
    subtitle: loop.targetMetric,
    department: loop.department,
    status: loop.status,
    health: health?.healthScore,
    metadata: {
      loopId: loop.id,
      templateId: loop.templateId,
      runtimeLevel: loop.runtimeLevel ?? template?.runtimeLevel,
      source: loop.source ?? "supabase",
      sourcePath: loop.sourcePath ?? template?.examplePath,
      autonomyLevel: loop.autonomyLevel,
      cadence: loop.cadence,
      purpose: template?.description,
      dataSources: inferredDataSources(loop),
      owners: template?.defaultOwners ?? [loop.owner],
      metrics: inferredMetrics(loop),
      openReviews: health?.openReviews ?? loop.openReviews,
      openImprovements: health?.openImprovements ?? loop.improvementItems,
      netTimeSavedMinutes: health?.netTimeSavedMinutes ?? 0,
      botsittingMinutes: health?.botsittingMinutes ?? 0
    }
  };
}

function dataSourceNodes(loops: LoopRecord[]): LoopGraphNode[] {
  const sources = Array.from(new Set(loops.flatMap((loop) => inferredDataSources(loop))));
  return sources.map((source) => ({
    id: `data:${slug(source)}`,
    kind: "data_source",
    label: source,
    subtitle: "Signal source"
  }));
}

function ownerNodes(loops: LoopRecord[]): LoopGraphNode[] {
  const owners = Array.from(new Set(loops.flatMap((loop) => {
    const template = getTemplateById(loop.templateId);
    return template?.defaultOwners?.length ? template.defaultOwners : [loop.owner];
  }).filter(Boolean)));
  return owners.map((owner) => ({
    id: `owner:${slug(owner)}`,
    kind: "human_owner",
    label: owner,
    subtitle: "Human owner"
  }));
}

function metricNodes(loops: LoopRecord[]): LoopGraphNode[] {
  const metrics = Array.from(new Set(loops.flatMap((loop) => inferredMetrics(loop))));
  return metrics.map((metric) => ({
    id: `metric:${slug(metric)}`,
    kind: "metric",
    label: metric,
    subtitle: "Metric"
  }));
}

function findWorkspaceLoopId(externalLoopId: string, loops: LoopRecord[]): string | undefined {
  return loops.find((loop) => loopIdsMatch(loop.id, externalLoopId))?.id;
}

function reviewsFromRuns(
  runs: Array<{ id: string; loopId: string; status: string }>,
  loops: LoopRecord[]
): HumanReview[] {
  return runs
    .filter((run) => run.status === "WAITING_FOR_REVIEW")
    .map((run) => {
      const workspaceLoopId = findWorkspaceLoopId(run.loopId, loops) ?? run.loopId;
      return {
        id: `runtime_review_${run.id}`,
        loopRunId: run.id,
        loopId: workspaceLoopId,
        reviewer: "Pending reviewer",
        status: "pending" as const,
        reason: "Run waiting for human review",
        recommendation: "Open the review packet and approve or reject prepared actions.",
        createdAt: new Date().toISOString()
      };
    });
}

function mergeReviewsById(reviews: HumanReview[], runtimeReviews: HumanReview[]): HumanReview[] {
  const merged = new Map<string, HumanReview>();
  for (const review of [...reviews, ...runtimeReviews]) {
    merged.set(review.id, review);
  }
  return Array.from(merged.values());
}

function caseNodes(
  cases: Array<{ id: string; sourceLoopId: string; severity: string; status: string; summary?: string }>,
  loops: LoopRecord[]
): LoopGraphNode[] {
  return cases.map((caseItem) => ({
    id: `case:${caseItem.id}`,
    kind: "escalation_case",
    label: caseItem.summary ?? caseItem.id,
    subtitle: `${caseItem.severity} · ${caseItem.status}`,
    status: caseItem.status,
    metadata: {
      caseId: caseItem.id,
      sourceLoopId: findWorkspaceLoopId(caseItem.sourceLoopId, loops) ?? caseItem.sourceLoopId,
      severity: caseItem.severity
    }
  }));
}

function traceNodes(
  runs: Array<{ id: string; loopId: string; status: string }>,
  loops: LoopRecord[]
): LoopGraphNode[] {
  return runs.map((run) => ({
    id: `trace:${run.id}`,
    kind: "trace",
    label: run.id,
    subtitle: run.status,
    status: run.status,
    metadata: {
      runId: run.id,
      loopId: findWorkspaceLoopId(run.loopId, loops) ?? run.loopId
    }
  }));
}

function caseEdges(
  cases: Array<{ id: string; sourceLoopId: string; severity: string; status: string }>,
  loops: LoopRecord[]
): LoopGraphEdge[] {
  return cases.flatMap((caseItem) => {
    const workspaceLoopId = findWorkspaceLoopId(caseItem.sourceLoopId, loops) ?? caseItem.sourceLoopId;
    return [
      {
        id: `edge:loop:${workspaceLoopId}:case:${caseItem.id}`,
        source: `loop:${workspaceLoopId}`,
        target: `case:${caseItem.id}`,
        kind: "escalates_to" as const,
        label: "escalation case",
        metadata: { semantic: true }
      },
      {
        id: `edge:case:${caseItem.id}:management`,
        source: `case:${caseItem.id}`,
        target: "loop:management",
        kind: "reports_to" as const,
        label: "management handoff",
        metadata: { semantic: false }
      }
    ];
  });
}

function traceEdges(
  runs: Array<{ id: string; loopId: string; status: string }>,
  loops: LoopRecord[]
): LoopGraphEdge[] {
  return runs.map((run) => {
    const workspaceLoopId = findWorkspaceLoopId(run.loopId, loops) ?? run.loopId;
    return {
      id: `edge:loop:${workspaceLoopId}:trace:${run.id}`,
      source: `loop:${workspaceLoopId}`,
      target: `trace:${run.id}`,
      kind: "writes_trace_to" as const,
      label: "run trace",
      metadata: { semantic: true }
    };
  });
}

function reviewNodes(reviews: HumanReview[]): LoopGraphNode[] {
  return reviews
    .filter((review) => review.status === "pending")
    .map((review) => ({
      id: `review:${review.id}`,
      kind: "review",
      label: "Human Review",
      subtitle: review.reason,
      status: review.status,
      metadata: {
        reviewId: review.id,
        loopId: review.loopId,
        runId: review.loopRunId
      }
    }));
}

function improvementNodes(improvements: ImprovementItem[]): LoopGraphNode[] {
  return improvements
    .filter((item) => item.status !== "done")
    .map((item) => ({
      id: `improvement:${item.id}`,
      kind: "improvement",
      label: item.title,
      subtitle: item.failureMode,
      status: item.status,
      metadata: {
        improvementId: item.id,
        loopId: item.loopId
      }
    }));
}

function loopEdges(
  loop: LoopRecord,
  reviews: HumanReview[],
  improvements: ImprovementItem[]
): LoopGraphEdge[] {
  const sourceEdges = inferredDataSources(loop).map((source) => ({
    id: `edge:data:${slug(source)}:${loop.id}`,
    source: `data:${slug(source)}`,
    target: `loop:${loop.id}`,
    kind: "data_flow" as const,
    label: "data flow"
  }));

  const pendingReviewEdges = reviews
    .filter((review) => loopIdsMatch(review.loopId, loop.id) && review.status === "pending")
    .map((review) => ({
      id: `edge:${loop.id}:review:${review.id}`,
      source: `loop:${loop.id}`,
      target: `review:${review.id}`,
      kind: "escalates_to" as const,
      label: "requires judgment"
    }));

  const improvementEdges = improvements
    .filter((item) => item.loopId === loop.id && item.status !== "done")
    .map((item) => ({
      id: `edge:${loop.id}:improvement:${item.id}`,
      source: `improvement:${item.id}`,
      target: `loop:${loop.id}`,
      kind: "improves" as const,
      label: "trace learning"
    }));

  const metricEdges = inferredMetrics(loop).map((metric) => ({
    id: `edge:${loop.id}:metric:${slug(metric)}`,
    source: `loop:${loop.id}`,
    target: `metric:${slug(metric)}`,
    kind: "measured_by" as const,
    label: "measured by"
  }));

  return [
    {
      id: `edge:department:${loop.department}:${loop.id}`,
      source: `department:${loop.department}`,
      target: `loop:${loop.id}`,
      kind: "rolls_up_to",
      label: "contains"
    },
    {
      id: `edge:${loop.id}:management`,
      source: `loop:${loop.id}`,
      target: "loop:management",
      kind: "rolls_up_to",
      label: "management review"
    },
    {
      id: `edge:${loop.id}:owner:${slug(loop.owner)}`,
      source: `loop:${loop.id}`,
      target: `owner:${slug(loop.owner)}`,
      kind: "owned_by",
      label: "owned by"
    },
    ...sourceEdges,
    ...metricEdges,
    ...pendingReviewEdges,
    ...improvementEdges
  ];
}

function mergeHiddenLabor(reviews: HumanReview[]): Partial<HiddenLaborMetrics> {
  return reviews.reduce<Partial<HiddenLaborMetrics>>((total, review) => {
    if (!review.hiddenLabor) {
      return total;
    }

    for (const key of [
      "baselineMinutes",
      "loopExecutionMinutes",
      "reviewMinutes",
      "reworkMinutes",
      "botsittingMinutes",
      "escalationMinutes",
      "governanceMinutes",
      "relationshipRedeploymentMinutes"
    ] as const) {
      total[key] = (total[key] ?? 0) + (review.hiddenLabor[key] ?? 0);
    }

    total.qualityScore = review.hiddenLabor.qualityScore ?? total.qualityScore;
    total.businessOutcomeNotes =
      review.hiddenLabor.businessOutcomeNotes ?? total.businessOutcomeNotes;
    return total;
  }, {});
}

function managementHealth(health: LoopHealthSummary[]) {
  if (health.length === 0) {
    return 72;
  }

  return Math.round(health.reduce((sum, item) => sum + item.healthScore, 0) / health.length);
}

function inferredDataSources(loop: LoopRecord) {
  const template = getTemplateById(loop.templateId);
  if (template?.requiredDataSources?.length) {
    return template.requiredDataSources;
  }
  const connectionSources = template?.connections
    ?.filter((connection) => connection.kind === "data_source")
    .map((connection) => connection.target);
  if (connectionSources?.length) {
    return connectionSources;
  }
  const dataSources = loop.department === "marketing"
    ? ["Ad Platforms", "Web Analytics", "CRM"]
    : loop.department === "customer_success"
      ? ["Ticketing", "NPS"]
      : loop.department === "engineering"
        ? ["GitHub", "CI/CD"]
        : loop.department === "operations_finance"
          ? ["ERP", "Billing"]
          : loop.department === "legal_security"
            ? ["Audit Logs", "Policy DB"]
            : ["Workspace Signals"];

  return dataSources;
}

function inferredMetrics(loop: LoopRecord) {
  const template = getTemplateById(loop.templateId);
  return Array.from(new Set([
    loop.targetMetric,
    ...(template?.defaultMetrics ?? template?.secondaryMetrics ?? [])
  ].filter(Boolean))).slice(0, 4);
}

export function loopRecordFromRegisteredSpec(
  item: LoadedRegisteredLoopSpec,
  organizationId: string
): LoopRecord {
  const template = getTemplateById(item.templateId);
  const extension = item.spec.studioExtension as Record<string, unknown> | undefined;
  const metrics = Array.isArray(extension?.metrics) ? extension.metrics.map(String) : [];

  return {
    id: item.spec.metadata.id,
    organizationId,
    templateId: item.templateId,
    name: item.spec.metadata.name,
    department: item.department,
    loopType: template?.loopType ?? String(item.spec.topology?.tags?.[1] ?? "custom_loop"),
    status: "active",
    autonomyLevel: "draft_for_review",
    owner: item.spec.metadata.owner?.role ?? template?.defaultOwners?.[0] ?? "Loop owner",
    goal: String(extension?.goal ?? item.spec.metadata.description ?? `${item.spec.metadata.name} runs from a registered LoopSpec.`),
    targetMetric: metrics[0] ?? template?.primaryMetric ?? "Quality-adjusted output",
    businessOutcome: String(extension?.businessOutcome ?? template?.businessOutcome ?? "Registered LoopSpec is visible in the operating map."),
    cadence: item.spec.trigger.type === "schedule" ? item.spec.trigger.schedule ?? "Scheduled" : "Manual",
    specGenerated: true,
    implementationGenerated: item.spec.metadata.labels?.runtimeLevel === "runnable",
    openReviews: item.spec.policy.allowedActions.some((action) => action.requiresApproval) ? 1 : 0,
    improvementItems: 0,
    source: "local_spec",
    sourcePath: item.sourcePath,
    runtimeLevel: template?.runtimeLevel ?? "spec_stub"
  };
}

export function createCatalogImprovementItems(loops: LoopRecord[]): ImprovementItem[] {
  return loops
    .filter((loop) => loop.improvementItems > 0)
    .slice(0, 12)
    .map((loop, index) => ({
      id: `catalog_improvement_${index + 1}`,
      loopId: loop.id,
      title: "Tighten verification rubric",
      description: `${loop.name} needs trace-backed rubric improvements before autonomy increases.`,
      failureMode: getDepartmentTemplate(loop.department)?.failureModes[0] ?? "review burden",
      recommendation: "Review the latest traces, add deterministic checks, and reduce repeated human correction.",
      status: "open",
      owner: loop.owner,
      createdAt: "2026-06-22T16:00:00.000Z"
    }));
}

function catalogOperationalState(template: ReturnType<typeof getTemplateCatalog>[number]) {
  const reviewHeavyTemplateIds = new Set([
    "github-issue-triage",
    "strategic-account-escalation",
    "customer_success-renewal_risk",
    "engineering-release_readiness",
    "operations_finance-approval_bottleneck",
    "operations_finance-forecast_variance",
    "hr-retention_signal",
    "hr-performance_review_prep",
    "legal_security-contract_triage",
    "legal_security-policy_drift",
    "legal_security-access_review",
    "legal_security-incident_evidence",
    "management-review",
    "management-decision_memo",
    "management-resource_allocation"
  ]);
  const improvementTemplateIds = new Set([
    "marketing-channel_allocation",
    "marketing-landing_page_conversion",
    "product-feedback_to_problem",
    "product-bug_cluster_to_problem",
    "customer_success-support_triage",
    "sales-crm_hygiene",
    "engineering-qa_checklist",
    "engineering-incident_learning",
    "operations_finance-vendor_review",
    "hr-manager_coaching",
    "legal_security-security_questionnaire",
    "management-department_loop_review",
    "management-improvement"
  ]);
  const attentionTemplateIds = new Set([
    "customer_success-renewal_risk",
    "engineering-release_readiness",
    "operations_finance-forecast_variance",
    "hr-retention_signal",
    "legal_security-policy_drift",
    "management-department_loop_review"
  ]);

  return {
    status: attentionTemplateIds.has(template.id) ? "needs_attention" : "active",
    lastRunAt: template.runtimeLevel === "catalog" ? undefined : "2026-06-22T17:00:00.000Z",
    openReviews: reviewHeavyTemplateIds.has(template.id) ? 1 : 0,
    improvementItems: improvementTemplateIds.has(template.id) ? 1 : 0
  };
}

function catalogLoopId(templateId: string) {
  const legacyIds: Record<string, string> = {
    "marketing-campaign_learning": "loop_demo_marketing_campaign",
    "sales-follow_up": "loop_demo_sales_pipeline",
    "product-feedback_to_problem": "loop_demo_product_discovery",
    "customer_success-customer_health_risk": "loop_demo_customer_health",
    "engineering-qa_checklist": "loop_demo_engineering_quality",
    "operations_finance-approval_bottleneck": "loop_demo_ops_efficiency",
    "hr-manager_coaching": "loop_demo_people_engagement",
    "legal_security-policy_drift": "loop_demo_risk_compliance"
  };
  return legacyIds[templateId] ?? `catalog_${slug(templateId)}`;
}

function titleCase(value: string) {
  return value
    .replace(/_/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function slug(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}
