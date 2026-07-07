import type { DepartmentSkillPack, LoopBlueprint } from "../loopgraph-core/department-skills";
import type { BusinessDiscoverySession, DepartmentProfile } from "../loopgraph-core/discovery";
import { LoopRecommendationSchema, type LoopRecommendation } from "../loopgraph-core/loop-recommendation";
import type { ProcessInventoryItem, ProcessPainPoint } from "../loopgraph-core/process-inventory";
import { inferDepartments, buildProcessInventory, inferGoals } from "./process-classifier";

const recurrenceScore: Record<ProcessInventoryItem["recurrence"], number> = {
  daily: 1,
  event_driven: 1,
  weekly: 0.8,
  monthly: 0.5,
  ad_hoc: 0.2
};

const painWeights: ProcessPainPoint[] = [
  "manual_context_gathering",
  "rework",
  "missed_follow_up",
  "approval_bottleneck",
  "quality_variance",
  "missing_measurement"
];

const knownObservableSystems = [
  "crm",
  "ads",
  "analytics",
  "support",
  "github",
  "linear",
  "slack",
  "calendar",
  "spreadsheet",
  "manual_upload",
  "ticketing",
  "usage"
];

const blueprintHints: Record<string, string[]> = {
  campaign_learning: ["campaign", "cac", "ads", "qualified", "learning", "cost"],
  lead_qualification: ["lead", "qualification", "crm", "qualified"],
  follow_up_latency: ["follow", "latency", "slow", "crm", "email"],
  feedback_clustering: ["feedback", "support", "ticket", "noise", "cluster"],
  customer_health: ["health", "churn", "usage", "support", "renewal"],
  daily_operating_review: ["daily", "operating", "bottleneck", "review", "management"],
  approval_bottleneck: ["approval", "bottleneck"],
  invoice_variance: ["invoice", "variance"],
  candidate_pipeline: ["candidate", "pipeline"],
  spec_to_ticket: ["spec", "ticket"]
};

export function recommendLoopsForSession(
  session: BusinessDiscoverySession,
  skillPacks: DepartmentSkillPack[]
): LoopRecommendation[] {
  const departments = session.departmentProfiles.length > 0
    ? session.departmentProfiles
    : inferDepartments(session, skillPacks);
  const processes = session.processInventory.length > 0
    ? session.processInventory
    : buildProcessInventory({ ...session, departmentProfiles: departments });
  const goals = session.departmentGoals.length > 0 ? session.departmentGoals : inferGoals({ ...session, departmentProfiles: departments });
  const recommendations: LoopRecommendation[] = [];

  for (const process of processes) {
    const department = departments.find((item) => item.id === process.departmentId);
    const skillPack = department && skillPacks.find((pack) => pack.departmentType === department.departmentType);
    if (!department || !skillPack) continue;

    const candidates = skillPack.loopBlueprints
      .map((blueprint) => ({
        blueprint,
        score: calculateLoopCandidateScore({ process, blueprint, skillPack, department })
      }))
      .filter((candidate) => candidate.score >= 0.38 || blueprintAffinity(process, candidate.blueprint) >= 0.45)
      .sort((left, right) => right.score - left.score)
      .slice(0, process.departmentId.includes("sales") ? 2 : 1);

    for (const candidate of candidates) {
      const goal = goals.find((item) => item.departmentId === department.id)?.label ?? department.goal ?? "Improve operating leverage";
      recommendations.push(createRecommendation({
        session,
        department,
        process,
        skillPack,
        blueprint: candidate.blueprint,
        confidence: Math.max(0.35, Math.min(0.96, candidate.score)),
        goal
      }));
    }
  }

  const unique = new Map<string, LoopRecommendation>();
  for (const recommendation of recommendations) {
    const existing = unique.get(recommendation.blueprintId);
    if (!existing || existing.confidence < recommendation.confidence) {
      unique.set(recommendation.blueprintId, recommendation);
    }
  }
  return Array.from(unique.values()).sort((left, right) => right.confidence - left.confidence);
}

export function calculateLoopCandidateScore(input: {
  process: ProcessInventoryItem;
  blueprint: LoopBlueprint;
  skillPack: DepartmentSkillPack;
  department: DepartmentProfile;
}) {
  const { process, blueprint, skillPack, department } = input;
  const painScore = Math.min(1, process.painPoints.filter((pain) => painWeights.includes(pain)).length / 3);
  const observabilityScore = ratioMatch(process.systemsTouched, knownObservableSystems);
  const actionabilityScore = automationModeScore(process.candidateAutomationMode, blueprint.defaultRiskLevel);
  const verificationScore = blueprint.defaultVerifier.length > 0 ? 1 : 0.2;
  const metricScore = blueprint.defaultMetrics.some((metric) => skillPack.defaultMetrics.some((item) => item.key === metric)) ? 0.85 : 0.2;
  const riskFitScore = riskFit(process, blueprint, department);
  const integrationFitScore = ratioMatch(
    skillPack.requiredIntegrations
      .filter((item) => item.requiredForLoopBlueprints.includes(blueprint.id))
      .map((item) => item.integrationType),
    process.systemsTouched
  );
  const deterministicScore =
    recurrenceScore[process.recurrence] * 0.2 +
    painScore * 0.2 +
    observabilityScore * 0.15 +
    actionabilityScore * 0.15 +
    verificationScore * 0.1 +
    metricScore * 0.1 +
    riskFitScore * 0.05 +
    integrationFitScore * 0.05;
  return Math.min(1, deterministicScore * (0.72 + blueprintAffinity(process, blueprint) * 0.5));
}

function createRecommendation(input: {
  session: BusinessDiscoverySession;
  department: DepartmentProfile;
  process: ProcessInventoryItem;
  skillPack: DepartmentSkillPack;
  blueprint: LoopBlueprint;
  confidence: number;
  goal: string;
}): LoopRecommendation {
  const { session, department, process, skillPack, blueprint, confidence, goal } = input;
  const id = `${session.companyId}:${blueprint.id}`;
  const metricDrafts = skillPack.defaultMetrics
    .filter((metric) => blueprint.defaultMetrics.includes(metric.key))
    .map((metric) => ({
      id: `${id}:metric:${metric.key}`,
      companyId: session.companyId,
      departmentId: department.id,
      loopRecommendationId: id,
      key: metric.key,
      label: metric.label,
      description: metric.description,
      type: "composite" as const,
      source: metric.source,
      formula: metric.formula,
      baselineRequired: metric.baselineRequired,
      ownerRole: `${department.name} owner`,
      displayInDailySummary: true
    }));

  return LoopRecommendationSchema.parse({
    id,
    companyId: session.companyId,
    departmentId: department.id,
    sourceProcessIds: [process.id],
    skillPackId: skillPack.id,
    blueprintId: blueprint.id,
    name: blueprint.name,
    goal,
    whyRecommended: `${blueprint.name} matches ${process.name}: ${process.recurrence.replace("_", " ")} work, ${process.painPoints.length || 1} visible pain signal(s), and observable systems (${process.systemsTouched.join(", ") || "manual upload"}).`,
    confidence,
    trigger: {
      type: process.recurrence === "event_driven" ? "event" : "schedule",
      description: process.currentTrigger ?? blueprint.defaultTrigger,
      cadence: process.recurrence === "daily" ? "daily" : process.recurrence === "weekly" ? "weekly" : undefined
    },
    observes: createObservedSignals(process, skillPack, blueprint),
    allowedActions: createAllowedActions(blueprint),
    forbiddenActions: session.companyProfile?.aiNeverActions ?? [],
    verifierDraft: blueprint.defaultVerifier.map((description) => ({
      type: verifierType(description),
      description
    })),
    humanReviewDraft: [
      ...blueprint.defaultHumanReview.map((condition) => ({
        condition,
        reviewerRole: department.ownerRole ?? `${department.name} owner`,
        reason: "Configured by the department skill pack."
      })),
      ...skillPack.humanReviewRules.map((rule) => ({
        condition: rule.condition,
        reviewerRole: rule.reviewerRole,
        reason: rule.reason
      }))
    ],
    metricDrafts,
    readiness: {
      level: blueprint.defaultAutonomyLevel,
      score: Math.round(confidence * 100),
      blockers: [],
      warnings: []
    },
    estimatedValue: estimateValue(process, confidence),
    status: "recommended",
    validationErrors: []
  });
}

function createObservedSignals(
  process: ProcessInventoryItem,
  skillPack: DepartmentSkillPack,
  blueprint: LoopBlueprint
) {
  const required = skillPack.requiredIntegrations
    .filter((integration) => integration.requiredForLoopBlueprints.includes(blueprint.id));
  const sources = required.length > 0
    ? required.flatMap((integration) => integration.variables.map((variable) => ({
        key: variable.replace(/[^a-zA-Z0-9_]+/g, "_"),
        label: variable,
        source: integration.integrationType,
        required: true
      })))
    : process.systemsTouched.map((system) => ({
        key: `${system}_signal`.replace(/[^a-zA-Z0-9_]+/g, "_"),
        label: `${system} signal`,
        source: system,
        required: true
      }));
  return sources.length > 0 ? sources : [{
    key: "manual_signal",
    label: "Manual process update",
    source: "manual_upload",
    required: true
  }];
}

function createAllowedActions(blueprint: LoopBlueprint) {
  return blueprint.defaultRoutine.map((step, index) => {
    const lower = step.toLowerCase();
    const riskLevel = lower.includes("budget") || lower.includes("external")
      ? "high"
      : blueprint.defaultRiskLevel;
    return {
      key: `${blueprint.id}.step_${index + 1}`,
      label: step,
      riskLevel,
      requiresApproval: riskLevel === "high" || riskLevel === "critical" || lower.includes("approve")
    };
  });
}

function estimateValue(process: ProcessInventoryItem, confidence: number) {
  const gross = Math.round((process.baseline?.activeMinutesPerItem ?? 45) * (process.volumeEstimate ?? 5) * confidence);
  const review = Math.round((process.baseline?.reviewMinutesPerItem ?? 8) * Math.max(1, (process.volumeEstimate ?? 5) / 2));
  const rework = Math.round(process.baseline?.reworkMinutesPerItem ?? gross * 0.12);
  const botsitting = Math.round(gross * 0.08);
  return {
    grossSavedMinutesPerWeek: gross,
    reviewMinutesPerWeek: review,
    reworkMinutesPerWeek: rework,
    botsittingMinutesPerWeek: botsitting,
    netSavedMinutesPerWeek: gross - review - rework - botsitting,
    valueConfidence: confidence > 0.75 ? "high" as const : confidence > 0.55 ? "medium" as const : "low" as const
  };
}

function blueprintAffinity(process: ProcessInventoryItem, blueprint: LoopBlueprint) {
  const haystack = `${process.name} ${process.description} ${process.painPoints.join(" ")} ${process.systemsTouched.join(" ")}`.toLowerCase();
  const hints = blueprintHints[blueprint.id] ?? [
    ...blueprint.name.toLowerCase().split(/\W+/),
    ...blueprint.processType.toLowerCase().split(/\W+/)
  ];
  const matches = hints.filter((hint) => haystack.includes(hint)).length;
  return Math.min(1, matches / Math.max(2, Math.min(5, hints.length)));
}

function ratioMatch(left: string[], right: string[]) {
  if (left.length === 0 || right.length === 0) return 0.35;
  const normalizedRight = right.map((item) => item.toLowerCase());
  const matches = left.filter((item) =>
    normalizedRight.some((candidate) => candidate.includes(item.toLowerCase()) || item.toLowerCase().includes(candidate))
  ).length;
  return Math.min(1, matches / left.length);
}

function automationModeScore(mode: ProcessInventoryItem["candidateAutomationMode"], riskLevel: LoopBlueprint["defaultRiskLevel"]) {
  if (mode === "autonomous_low_risk") return riskLevel === "low" ? 1 : 0.45;
  if (mode === "execute_with_approval") return 0.85;
  if (mode === "recommend_with_review") return 0.8;
  if (mode === "draft_only") return 0.65;
  return 0.5;
}

function riskFit(process: ProcessInventoryItem, blueprint: LoopBlueprint, department: DepartmentProfile) {
  if (process.riskLevel === "critical" && blueprint.defaultAutonomyLevel !== "L0") return 0.25;
  if (process.customerFacing && blueprint.defaultRiskLevel === "high" && department.riskTolerance === "low") return 0.3;
  return 0.85;
}

function verifierType(description: string) {
  const lower = description.toLowerCase();
  if (lower.includes("schema")) return "schema" as const;
  if (lower.includes("policy") || lower.includes("claim")) return "policy" as const;
  if (lower.includes("metric") || lower.includes("threshold")) return "numeric" as const;
  if (lower.includes("human") || lower.includes("review")) return "human_review" as const;
  return "evidence" as const;
}

