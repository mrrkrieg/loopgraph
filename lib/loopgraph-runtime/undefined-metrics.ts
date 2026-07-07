import type { AccessRequirement } from "../loopgraph-core/access-requirements";
import {
  UndefinedMetricSchema,
  type MetricDefinition,
  type UndefinedMetric
} from "../loopgraph-core/metric-definition";

export function detectUndefinedMetrics(
  metricDefinitions: MetricDefinition[],
  accessRequirements: AccessRequirement[]
): UndefinedMetric[] {
  const undefinedMetrics: UndefinedMetric[] = [];

  for (const metric of metricDefinitions) {
    const access = accessRequirements.filter((item) =>
      item.loopRecommendationId === metric.loopRecommendationId || item.loopId === metric.loopId
    );
    const suggestedIntegration = suggestIntegration(metric, access);
    const relevantAccess = suggestedIntegration
      ? access.filter((item) => item.integrationType === suggestedIntegration)
      : access;
    const connected = relevantAccess.some((item) => ["connected", "manual_fallback", "waived"].includes(item.status));

    if (metric.source === "undefined") {
      undefinedMetrics.push(undefinedMetric(metric, "needs_human_definition", "Define the metric source, owner, and formula.", suggestedIntegration));
      continue;
    }

    if (metric.source === "integration" && !connected) {
      undefinedMetrics.push(undefinedMetric(
        metric,
        "missing_integration",
        `Connect ${suggestedIntegration ?? "the source system"} or mark a manual fallback before this metric is trusted.`,
        suggestedIntegration
      ));
      continue;
    }

    if (metric.baselineRequired && metric.source === "modeled") {
      undefinedMetrics.push(undefinedMetric(
        metric,
        "missing_baseline",
        "Capture an observed baseline before treating modeled savings as value.",
        suggestedIntegration
      ));
      continue;
    }

    if (metric.type === "composite" && !metric.formula) {
      undefinedMetrics.push(undefinedMetric(metric, "missing_formula", "Add the composite metric formula.", suggestedIntegration));
    }
  }

  return undefinedMetrics;
}

function undefinedMetric(
  metric: MetricDefinition,
  reason: UndefinedMetric["reason"],
  requiredAction: string,
  suggestedIntegration?: string
) {
  return UndefinedMetricSchema.parse({
    id: `${metric.id}:undefined:${reason}`,
    companyId: metric.companyId,
    departmentId: metric.departmentId,
    loopRecommendationId: metric.loopRecommendationId,
    loopId: metric.loopId,
    metricKey: metric.key,
    label: metric.label,
    reason,
    requiredAction,
    suggestedIntegration,
    suggestedQuestion: `What source should prove ${metric.label}?`,
    ownerRole: metric.ownerRole,
    status: "open"
  });
}

function suggestIntegration(metric: MetricDefinition, access: AccessRequirement[]) {
  const key = metric.key.toLowerCase();
  if (key.includes("crm") || key.includes("qualified") || key.includes("lead") || key.includes("pipeline") || key.includes("opportunity") || key.includes("follow_up")) return "crm";
  if (key.includes("campaign") || key.includes("cost")) return "ads";
  if (key.includes("conversion") || key.includes("adoption")) return "analytics";
  if (key.includes("relationship")) return "calendar";
  if (key.includes("resolution") || key.includes("response") || key.includes("csat") || key.includes("ticket")) return "support";
  if (key.includes("usage") || key.includes("churn") || key.includes("renewal")) return "usage";
  return access[0]?.integrationType;
}
