import { z } from "zod";
import { DepartmentTypeSchema } from "./department-skills";
import { AccessRequirementSchema, HumanInputRequirementSchema } from "./access-requirements";
import { LoopRecommendationSchema } from "./loop-recommendation";
import { MetricDefinitionSchema, UndefinedMetricSchema } from "./metric-definition";
import { ProcessInventoryItemSchema } from "./process-inventory";

export const CompanyDiscoveryProfileSchema = z.object({
  id: z.string(),
  name: z.string().optional(),
  description: z.string().optional(),
  customerType: z.string().optional(),
  primaryGoal: z.string().optional(),
  northStarMetric: z.string().optional(),
  riskTolerance: z.enum(["low", "medium", "high"]).optional(),
  departments: z.array(DepartmentTypeSchema).default([]),
  tools: z.array(z.string()).default([]),
  bottlenecks: z.array(z.string()).default([]),
  recurringWork: z.array(z.string()).default([]),
  aiNeverActions: z.array(z.string()).default([]),
  customerFacingOutputs: z.array(z.string()).default([]),
  leadershipJudgment: z.array(z.string()).default([])
});

export const DepartmentProfileSchema = z.object({
  id: z.string(),
  companyId: z.string(),
  departmentType: DepartmentTypeSchema,
  name: z.string(),
  ownerRole: z.string().optional(),
  goal: z.string().optional(),
  tools: z.array(z.string()).default([]),
  painPoints: z.array(z.string()).default([]),
  riskTolerance: z.enum(["low", "medium", "high"]).default("medium"),
  answers: z.record(z.string(), z.unknown()).default({})
});

export const DepartmentGoalSchema = z.object({
  id: z.string(),
  companyId: z.string(),
  departmentId: z.string(),
  label: z.string(),
  metricKeys: z.array(z.string()).default([])
});

export const ProcessGoalMappingSchema = z.object({
  id: z.string(),
  processId: z.string(),
  goalId: z.string(),
  confidence: z.number().min(0).max(1)
});

export const DiscoveryAnswerSchema = z.object({
  id: z.string(),
  questionId: z.string(),
  scope: z.enum(["company", "department", "process", "goal", "access", "metric", "human"]),
  departmentId: z.string().optional(),
  value: z.unknown(),
  answeredAt: z.string()
});

export const BusinessDiscoverySessionSchema = z.object({
  id: z.string(),
  companyId: z.string(),
  status: z.enum([
    "started",
    "company_questions",
    "department_questions",
    "process_inventory",
    "goal_mapping",
    "access_mapping",
    "recommendations_ready",
    "human_requirements",
    "metric_definition",
    "ready_to_materialize",
    "completed"
  ]),
  companyProfile: CompanyDiscoveryProfileSchema.optional(),
  departmentProfiles: z.array(DepartmentProfileSchema).default([]),
  processInventory: z.array(ProcessInventoryItemSchema).default([]),
  departmentGoals: z.array(DepartmentGoalSchema).default([]),
  processGoalMappings: z.array(ProcessGoalMappingSchema).default([]),
  answers: z.array(DiscoveryAnswerSchema).default([]),
  recommendedLoops: z.array(LoopRecommendationSchema).default([]),
  accessRequirements: z.array(AccessRequirementSchema).default([]),
  metricDefinitions: z.array(MetricDefinitionSchema).default([]),
  undefinedMetrics: z.array(UndefinedMetricSchema).default([]),
  humanRequirements: z.array(HumanInputRequirementSchema).default([]),
  createdLoopIds: z.array(z.string()).default([]),
  createdAt: z.string(),
  updatedAt: z.string()
});

export type CompanyDiscoveryProfile = z.infer<typeof CompanyDiscoveryProfileSchema>;
export type DepartmentProfile = z.infer<typeof DepartmentProfileSchema>;
export type DepartmentGoal = z.infer<typeof DepartmentGoalSchema>;
export type ProcessGoalMapping = z.infer<typeof ProcessGoalMappingSchema>;
export type DiscoveryAnswer = z.infer<typeof DiscoveryAnswerSchema>;
export type BusinessDiscoverySession = z.infer<typeof BusinessDiscoverySessionSchema>;

