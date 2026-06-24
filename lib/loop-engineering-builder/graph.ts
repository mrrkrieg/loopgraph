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
import { getDepartmentTemplate } from "./templates";

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
}): LoopGraph {
  const reviews = input.reviews ?? [];
  const improvements = input.improvements ?? [];
  const departments = Array.from(new Set(input.loops.map((loop) => loop.department)));
  const health = input.loops.map((loop) => {
    const loopReviews = reviews.filter((review) => review.loopId === loop.id && review.status === "pending");
    const loopImprovements = improvements.filter((item) => item.loopId === loop.id && item.status !== "done");
    return calculateHiddenLaborSummary(
      loop.id,
      loop.status,
      mergeHiddenLabor(loopReviews),
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
    ...reviewNodes(reviews),
    ...improvementNodes(improvements)
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
    ...input.loops.flatMap((loop) => loopEdges(loop, reviews, improvements))
  ];

  return {
    nodes,
    edges,
    health,
    view: getDefaultGraphView(input.selectedNodeId ?? `loop:${input.loops[0]?.id ?? "management"}`)
  };
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
      autonomyLevel: loop.autonomyLevel,
      cadence: loop.cadence,
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
  const owners = Array.from(new Set(loops.map((loop) => loop.owner).filter(Boolean)));
  return owners.map((owner) => ({
    id: `owner:${slug(owner)}`,
    kind: "human_owner",
    label: owner,
    subtitle: "Human owner"
  }));
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
        loopId: review.loopId
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
    .filter((review) => review.loopId === loop.id && review.status === "pending")
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
