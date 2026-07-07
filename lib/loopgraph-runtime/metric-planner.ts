import {
  MetricDefinitionSchema,
  type MetricDefinition,
  type UndefinedMetric
} from "../loopgraph-core/metric-definition";
import type { AccessRequirement } from "../loopgraph-core/access-requirements";
import type { DepartmentSkillPack } from "../loopgraph-core/department-skills";
import type { LoopRecommendation } from "../loopgraph-core/loop-recommendation";
import { detectUndefinedMetrics } from "./undefined-metrics";

export function generateMetricDefinitions(
  recommendation: LoopRecommendation,
  skillPack?: DepartmentSkillPack
): MetricDefinition[] {
  const blueprint = skillPack?.loopBlueprints.find((item) => item.id === recommendation.blueprintId);
  const metricKeys = blueprint?.defaultMetrics.length
    ? blueprint.defaultMetrics
    : recommendation.metricDrafts.map((metric) => metric.key);

  const metrics = metricKeys
    .map((metricKey) => skillPack?.defaultMetrics.find((metric) => metric.key === metricKey))
    .filter((metric): metric is NonNullable<typeof metric> => Boolean(metric))
    .map((metric, index) => MetricDefinitionSchema.parse({
      id: `${recommendation.id}:metric:${metric.key}`,
      companyId: recommendation.companyId,
      departmentId: recommendation.departmentId,
      loopRecommendationId: recommendation.id,
      key: metric.key,
      label: metric.label,
      description: metric.description,
      type: inferMetricType(metric.key, metric.formula),
      source: metric.source,
      formula: metric.formula,
      baselineRequired: metric.baselineRequired,
      ownerRole: index === 0 ? "Department owner" : "Loop owner",
      displayInDailySummary: index < 3
    }));

  return [
    ...metrics,
    MetricDefinitionSchema.parse({
      id: `${recommendation.id}:metric:net_saved_minutes`,
      companyId: recommendation.companyId,
      departmentId: recommendation.departmentId,
      loopRecommendationId: recommendation.id,
      key: "net_saved_minutes",
      label: "Net saved minutes",
      description: "Gross time savings minus review, rework, escalation, governance, and botsitting time.",
      type: "duration",
      source: "modeled",
      formula: "gross_saved_minutes - review_minutes - rework_minutes - escalation_minutes - governance_minutes - botsitting_minutes",
      baselineRequired: true,
      ownerRole: "Management",
      displayInDailySummary: true
    })
  ];
}

export function generateMetricPlan(
  recommendations: LoopRecommendation[],
  skillPacks: DepartmentSkillPack[] = [],
  accessRequirements: AccessRequirement[] = []
): {
  metricDefinitions: MetricDefinition[];
  undefinedMetrics: UndefinedMetric[];
} {
  const metricDefinitions = recommendations.flatMap((recommendation) => generateMetricDefinitions(
    recommendation,
    skillPacks.find((pack) => pack.id === recommendation.skillPackId)
  ));
  const undefinedMetrics = detectUndefinedMetrics(metricDefinitions, accessRequirements);
  return { metricDefinitions, undefinedMetrics };
}

function inferMetricType(key: string, formula?: string): MetricDefinition["type"] {
  const lower = `${key} ${formula ?? ""}`;
  if (lower.includes("cost") || lower.includes("cash") || lower.includes("invoice")) return "currency";
  if (lower.includes("rate") || lower.includes("accuracy") || lower.includes("conversion")) return "rate";
  if (lower.includes("time") || lower.includes("latency") || lower.includes("minutes") || lower.includes("cycle")) return "duration";
  if (lower.includes("score") || lower.includes("health") || lower.includes("sentiment")) return "score";
  return formula ? "composite" : "count";
}

