import { z } from "zod";

export const MetricDefinitionSchema = z.object({
  id: z.string(),
  companyId: z.string(),
  departmentId: z.string().optional(),
  loopRecommendationId: z.string().optional(),
  loopId: z.string().optional(),
  key: z.string(),
  label: z.string(),
  description: z.string(),
  type: z.enum(["count", "rate", "duration", "currency", "score", "boolean", "composite"]),
  source: z.enum(["integration", "trace", "human_review", "manual", "modeled", "undefined"]),
  formula: z.string().optional(),
  baselineRequired: z.boolean(),
  unit: z.string().min(1).max(64).optional(),
  desiredDirection: z.enum(["increase", "decrease", "target", "maintain"]).optional(),
  baselineValue: z.number().finite().optional(),
  target: z.number().optional(),
  evaluationWindowDays: z.number().int().min(0).max(3650).optional(),
  staleAfterHours: z.number().int().min(1).max(87600).optional(),
  valuePerUnitMinutes: z.number().min(0).optional(),
  valuePerUnitAmount: z.number().min(0).optional(),
  valueCurrency: z.string().length(3).optional(),
  ownerRole: z.string().optional(),
  displayInDailySummary: z.boolean()
});

export const UndefinedMetricSchema = z.object({
  id: z.string(),
  companyId: z.string(),
  departmentId: z.string().optional(),
  loopRecommendationId: z.string().optional(),
  loopId: z.string().optional(),
  metricKey: z.string(),
  label: z.string(),
  reason: z.enum([
    "missing_integration",
    "missing_variable",
    "missing_baseline",
    "missing_formula",
    "needs_human_definition",
    "stale_source"
  ]),
  requiredAction: z.string(),
  suggestedIntegration: z.string().optional(),
  suggestedQuestion: z.string().optional(),
  ownerRole: z.string().optional(),
  status: z.enum(["open", "in_progress", "resolved", "waived"])
});

export type MetricDefinition = z.infer<typeof MetricDefinitionSchema>;
export type UndefinedMetric = z.infer<typeof UndefinedMetricSchema>;
