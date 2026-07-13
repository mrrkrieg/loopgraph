import { z } from "zod";
import { AccessRequirementSchema, HumanInputRequirementSchema } from "./access-requirements";
import { MetricDefinitionSchema, UndefinedMetricSchema } from "./metric-definition";
import { LoopReadinessSchema } from "./readiness";

export const LoopRecommendationSchema = z.object({
  id: z.string(),
  companyId: z.string(),
  departmentId: z.string(),
  sourceProcessIds: z.array(z.string()),
  skillPackId: z.string(),
  blueprintId: z.string(),
  name: z.string(),
  goal: z.string(),
  whyRecommended: z.string(),
  confidence: z.number().min(0).max(1),
  trigger: z.object({
    type: z.enum(["schedule", "event", "manual", "webhook"]),
    description: z.string(),
    cadence: z.string().optional()
  }),
  observes: z.array(z.object({
    key: z.string(),
    label: z.string(),
    source: z.string(),
    required: z.boolean()
  })),
  allowedActions: z.array(z.object({
    key: z.string(),
    label: z.string(),
    riskLevel: z.enum(["low", "medium", "high", "critical"]),
    requiresApproval: z.boolean()
  })),
  forbiddenActions: z.array(z.string()).default([]),
  verifierDraft: z.array(z.object({
    type: z.enum(["schema", "policy", "evidence", "numeric", "human_review", "custom"]),
    description: z.string()
  })),
  humanReviewDraft: z.array(z.object({
    condition: z.string(),
    reviewerRole: z.string(),
    reason: z.string()
  })),
  metricDrafts: z.array(MetricDefinitionSchema).default([]),
  undefinedMetrics: z.array(UndefinedMetricSchema).default([]),
  accessRequirements: z.array(AccessRequirementSchema).default([]),
  humanRequirements: z.array(HumanInputRequirementSchema).default([]),
  readiness: LoopReadinessSchema,
  estimatedValue: z.object({
    grossSavedMinutesPerWeek: z.number().optional(),
    reviewMinutesPerWeek: z.number().optional(),
    reworkMinutesPerWeek: z.number().optional(),
    botsittingMinutesPerWeek: z.number().optional(),
    netSavedMinutesPerWeek: z.number().optional(),
    valueConfidence: z.enum(["low", "medium", "high"])
  }),
  status: z.enum([
    "draft",
    "recommended",
    "accepted",
    "rejected",
    "needs_more_info",
    "materialized"
  ]),
  validationErrors: z.array(z.string()).default([])
});

export type LoopRecommendation = z.infer<typeof LoopRecommendationSchema>;

