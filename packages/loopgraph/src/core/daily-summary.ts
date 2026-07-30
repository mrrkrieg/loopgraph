import { z } from "zod";
import { UndefinedMetricSchema } from "./metric-definition";
import { ReadinessLevelSchema } from "./readiness";

export const DailySummarySchema = z.object({
  id: z.string(),
  companyId: z.string(),
  date: z.string(),
  companyHealth: z.number().min(0).max(100),
  healthTruthStatus: z.enum(["observed", "modeled", "incomplete"]).default("incomplete"),
  trackedLoopCount: z.number().int().min(0).default(0),
  loopsRanCount: z.number().int().min(0).default(0),
  netSavedMinutes: z.number(),
  grossSavedMinutes: z.number(),
  reviewMinutes: z.number(),
  reworkMinutes: z.number(),
  botsittingMinutes: z.number(),
  escalationMinutes: z.number(),
  governanceMinutes: z.number(),
  valueTruthStatus: z.enum(["observed", "modeled", "incomplete"]).default("incomplete"),
  metricSampleCount: z.number().int().min(0).default(0),
  observedOutcomeCount: z.number().int().min(0).default(0),
  valueLedgerEntryCount: z.number().int().min(0).default(0),
  departments: z.array(z.object({
    departmentId: z.string(),
    name: z.string(),
    health: z.number().min(0).max(100),
    activeLoopCount: z.number(),
    blockedLoopCount: z.number(),
    openReviewCount: z.number(),
    undefinedMetricCount: z.number(),
    summary: z.string()
  })),
  loops: z.array(z.object({
    loopId: z.string(),
    loopName: z.string(),
    departmentId: z.string(),
    departmentName: z.string(),
    status: z.enum([
      "healthy",
      "needs_attention",
      "blocked",
      "missing_access",
      "missing_metric",
      "waiting_for_human",
      "failed_verification",
      "draft"
    ]),
    readinessLevel: ReadinessLevelSchema,
    mainMetric: z.object({
      label: z.string(),
      value: z.union([z.string(), z.number()]).optional(),
      delta: z.number().optional(),
      status: z.enum(["observed", "modeled", "undefined"])
    }).optional(),
    lastRunAt: z.string().optional(),
    openReviewCount: z.number(),
    escalationCount: z.number(),
    undefinedMetricCount: z.number(),
    netSavedMinutes: z.number(),
    botsittingMinutes: z.number(),
    valueTruthStatus: z.enum(["observed", "modeled", "incomplete"]).default("incomplete"),
    outcomeStatus: z.enum(["improved", "unchanged", "regressed", "target_met", "incomplete"]).optional(),
    summary: z.string(),
    nextAction: z.string().optional()
  })),
  openReviews: z.array(z.any()).default([]),
  escalations: z.array(z.any()).default([]),
  undefinedMetrics: z.array(UndefinedMetricSchema).default([]),
  recommendedActions: z.array(z.object({
    id: z.string(),
    priority: z.enum(["low", "medium", "high"]),
    label: z.string(),
    reason: z.string(),
    targetType: z.enum(["loop", "department", "metric", "access", "review", "integration"]),
    targetId: z.string().optional()
  })).default([]),
  generatedAt: z.string()
});

export type DailySummary = z.infer<typeof DailySummarySchema>;
