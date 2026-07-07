import { z } from "zod";

export const ProcessPainPointSchema = z.enum([
  "slow",
  "manual_context_gathering",
  "rework",
  "missed_follow_up",
  "quality_variance",
  "unclear_owner",
  "approval_bottleneck",
  "missing_measurement",
  "high_risk",
  "customer_sensitivity",
  "compliance_sensitivity"
]);

export const ProcessInventoryItemSchema = z.object({
  id: z.string(),
  companyId: z.string(),
  departmentId: z.string(),
  name: z.string(),
  description: z.string(),
  recurrence: z.enum(["ad_hoc", "daily", "weekly", "monthly", "event_driven"]),
  volumeEstimate: z.number().optional(),
  currentTrigger: z.string().optional(),
  currentInputs: z.array(z.string()).default([]),
  currentOutputs: z.array(z.string()).default([]),
  systemsTouched: z.array(z.string()).default([]),
  currentOwner: z.string().optional(),
  currentReviewer: z.string().optional(),
  painPoints: z.array(ProcessPainPointSchema).default([]),
  riskLevel: z.enum(["low", "medium", "high", "critical"]),
  customerFacing: z.boolean(),
  requiresHumanJudgment: z.boolean(),
  candidateAutomationMode: z.enum([
    "monitor_only",
    "draft_only",
    "recommend_with_review",
    "execute_with_approval",
    "autonomous_low_risk"
  ]),
  baseline: z.object({
    activeMinutesPerItem: z.number().optional(),
    reviewMinutesPerItem: z.number().optional(),
    reworkMinutesPerItem: z.number().optional(),
    cycleTimeHours: z.number().optional(),
    errorRate: z.number().optional()
  }).optional()
});

export type ProcessPainPoint = z.infer<typeof ProcessPainPointSchema>;
export type ProcessInventoryItem = z.infer<typeof ProcessInventoryItemSchema>;

