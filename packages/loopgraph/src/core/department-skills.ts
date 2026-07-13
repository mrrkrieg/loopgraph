import { z } from "zod";

export const DepartmentTypeSchema = z.enum([
  "management",
  "marketing",
  "sales",
  "product",
  "customer_success",
  "engineering",
  "ops_finance",
  "hr_talent",
  "legal_compliance",
  "custom"
]);

export const DiscoveryQuestionTypeSchema = z.enum([
  "text",
  "textarea",
  "single_select",
  "multi_select",
  "number",
  "boolean",
  "integration_picker",
  "metric_picker",
  "owner_picker",
  "risk_level",
  "autonomy_level"
]);

export const DiscoveryQuestionProducesSchema = z.enum([
  "company_context",
  "department_context",
  "process_inventory",
  "goal",
  "signal",
  "integration_requirement",
  "metric",
  "human_review_rule",
  "risk_rule",
  "loop_candidate"
]);

export const DiscoveryQuestionSchema = z.object({
  id: z.string(),
  prompt: z.string(),
  helpText: z.string().optional(),
  type: DiscoveryQuestionTypeSchema,
  required: z.boolean(),
  options: z.array(z.string()).optional(),
  produces: z.array(DiscoveryQuestionProducesSchema)
});

export const LoopBlueprintSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  processType: z.string(),
  defaultTrigger: z.string(),
  defaultRoutine: z.array(z.string()),
  defaultVerifier: z.array(z.string()),
  defaultHumanReview: z.array(z.string()),
  defaultMetrics: z.array(z.string()),
  defaultRiskLevel: z.enum(["low", "medium", "high", "critical"]),
  defaultAutonomyLevel: z.enum(["L0", "L1", "L2", "L3", "L4"])
});

export const DepartmentSkillPackSchema = z.object({
  id: z.string(),
  departmentType: DepartmentTypeSchema,
  name: z.string(),
  description: z.string(),
  purpose: z.string(),
  commonGoals: z.array(z.object({
    id: z.string(),
    label: z.string(),
    description: z.string(),
    exampleMetrics: z.array(z.string()),
    typicalPainPoints: z.array(z.string())
  })),
  discoveryQuestions: z.array(DiscoveryQuestionSchema),
  loopBlueprints: z.array(LoopBlueprintSchema),
  requiredIntegrations: z.array(z.object({
    integrationType: z.string(),
    reason: z.string(),
    variables: z.array(z.string()),
    actions: z.array(z.string()),
    requiredForLoopBlueprints: z.array(z.string())
  })),
  defaultMetrics: z.array(z.object({
    key: z.string(),
    label: z.string(),
    description: z.string(),
    source: z.enum(["integration", "trace", "human_review", "manual", "modeled", "undefined"]),
    formula: z.string().optional(),
    baselineRequired: z.boolean()
  })),
  humanReviewRules: z.array(z.object({
    id: z.string(),
    condition: z.string(),
    reviewerRole: z.string(),
    reason: z.string()
  })).default([]),
  riskRules: z.array(z.object({
    id: z.string(),
    condition: z.string(),
    requiredAction: z.enum(["allow", "review", "block", "escalate"]),
    reason: z.string()
  })),
  dailySummaryFields: z.array(z.object({
    key: z.string(),
    label: z.string(),
    source: z.string(),
    displayType: z.enum(["number", "currency", "duration", "status", "text", "trend"])
  }))
});

export type DepartmentType = z.infer<typeof DepartmentTypeSchema>;
export type DiscoveryQuestion = z.infer<typeof DiscoveryQuestionSchema>;
export type LoopBlueprint = z.infer<typeof LoopBlueprintSchema>;
export type DepartmentSkillPack = z.infer<typeof DepartmentSkillPackSchema>;

