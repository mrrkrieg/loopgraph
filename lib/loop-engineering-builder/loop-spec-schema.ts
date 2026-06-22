import { z } from "zod";

export const loopSpecSchema = z.object({
  id: z.string(),
  name: z.string().min(1),
  department: z.string().min(1),
  loopType: z.string().min(1),
  goal: z.string().min(1),
  targetMetric: z.string().min(1),
  businessOutcome: z.string().min(1),
  workItem: z.string().min(1),
  trigger: z.string().min(1),
  cadence: z.string().min(1),
  inputs: z.array(
    z.object({
      name: z.string(),
      source: z.string(),
      required: z.boolean(),
      description: z.string()
    })
  ),
  dataSources: z.array(
    z.object({
      name: z.string(),
      type: z.string(),
      purpose: z.string(),
      required: z.boolean()
    })
  ),
  routine: z.array(
    z.object({
      stepName: z.string(),
      stepType: z.string(),
      description: z.string(),
      actor: z.enum(["agent", "human", "system"]),
      toolRequired: z.string().optional()
    })
  ),
  verification: z.array(
    z.object({
      name: z.string(),
      checkType: z.enum(["deterministic", "llm_judge", "human_review", "metric_check"]),
      description: z.string(),
      passCriteria: z.string()
    })
  ),
  escalation: z.array(
    z.object({
      condition: z.string(),
      reason: z.string(),
      ownerRole: z.string(),
      severity: z.enum(["low", "medium", "high", "critical"])
    })
  ),
  humanOwner: z.string().min(1),
  autonomyLevel: z.string().min(1),
  traceSchema: z.record(z.string(), z.unknown()),
  metrics: z.array(
    z.object({
      name: z.string(),
      type: z.string(),
      target: z.string(),
      source: z.string()
    })
  ),
  measurementPlan: z.object({
    baselineWorkVolume: z.string(),
    baselineHumanTime: z.string(),
    loopHumanExecutionTime: z.string(),
    reviewTime: z.string(),
    reworkTime: z.string(),
    botsittingTime: z.string(),
    escalationTime: z.string(),
    qualityMetric: z.string(),
    businessOutcomeMetric: z.string(),
    reviewCadence: z.string()
  }),
  managementReviewOutput: z.object({
    cadence: z.string(),
    questions: z.array(z.string()),
    decisionsNeeded: z.array(z.string()),
    rollupMetrics: z.array(z.string())
  })
});

export type LoopSpec = z.infer<typeof loopSpecSchema>;

export function validateLoopSpec(input: unknown): LoopSpec {
  return loopSpecSchema.parse(input);
}
