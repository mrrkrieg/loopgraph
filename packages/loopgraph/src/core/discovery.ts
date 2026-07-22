import { z } from "zod";
import { DepartmentTypeSchema } from "./department-skills";
import { AccessRequirementSchema, HumanInputRequirementSchema } from "./access-requirements";
import { LoopRecommendationSchema } from "./loop-recommendation";
import { MetricDefinitionSchema, UndefinedMetricSchema } from "./metric-definition";
import { ProcessInventoryItemSchema } from "./process-inventory";
import { projectProfileSchema } from "./project-inspection";

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

export const DiscoveryAnswerValueTypeSchema = z.enum([
  "text",
  "number",
  "boolean",
  "string_array",
  "object",
  "unknown"
]);

export const DiscoveryAnswerSourceSchema = z.enum([
  "user",
  "project_detector",
  "imported_fixture",
  "hermes_inference",
  "existing_workspace"
]);

export const DiscoveryAnswerSchema = z.object({
  id: z.string(),
  questionId: z.string(),
  scope: z.enum(["company", "department", "process", "goal", "access", "metric", "human"]),
  departmentId: z.string().optional(),
  value: z.unknown(),
  valueType: DiscoveryAnswerValueTypeSchema.default("unknown"),
  source: DiscoveryAnswerSourceSchema.default("user"),
  evidenceRefs: z.array(z.string()).default([]),
  confidence: z.number().min(0).max(1).optional(),
  confirmedByUser: z.boolean().default(true),
  supersedesAnswerId: z.string().optional(),
  sensitivity: z.enum(["public", "internal", "confidential", "restricted"]).default("internal"),
  redactionApplied: z.boolean().default(false),
  answeredAt: z.string()
});

export const QuestionBundleFieldSchema = z.object({
  id: z.string(),
  label: z.string(),
  prompt: z.string(),
  valueType: DiscoveryAnswerValueTypeSchema,
  required: z.boolean().default(false),
  options: z.array(z.string()).optional(),
  scope: DiscoveryAnswerSchema.shape.scope,
  requiredFor: z.array(z.enum(["candidate_generation", "design", "materialization", "execution"])).default([])
});

export const QuestionBundleSchema = z.object({
  id: z.string(),
  stage: z.enum(["project_context", "department_selection", "question_bundle", "follow_up", "design_ready"]),
  departmentType: DepartmentTypeSchema.optional(),
  prompt: z.string(),
  whyAsked: z.string(),
  examples: z.array(z.string()).default([]),
  fields: z.array(QuestionBundleFieldSchema),
  requiredFor: z.array(z.enum(["candidate_generation", "design", "materialization", "execution"])).default([]),
  followUpRules: z.array(z.string()).default([]),
  maxFollowUps: z.number().int().min(0).default(3)
});

export const DiscoveryQuestionQueueItemSchema = z.object({
  bundleId: z.string(),
  status: z.enum(["pending", "active", "answered", "skipped", "blocked"]).default("pending"),
  departmentType: DepartmentTypeSchema.optional()
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
  projectProfileId: z.string().optional(),
  projectProfile: projectProfileSchema.optional(),
  selectedDepartmentIds: z.array(DepartmentTypeSchema).default([]),
  activeDepartmentId: DepartmentTypeSchema.optional(),
  activeStage: z.enum([
    "workspace",
    "department_selection",
    "questions",
    "design_context",
    "proposal_review",
    "materialization",
    "completed"
  ]).default("workspace"),
  activeQuestionBundleId: z.string().optional(),
  questionQueue: z.array(DiscoveryQuestionQueueItemSchema).default([]),
  designRunIds: z.array(z.string()).default([]),
  revision: z.number().int().min(0).default(0),
  createdByActor: z.enum(["browser", "hermes", "cli", "api"]).default("api"),
  lastActor: z.enum(["browser", "hermes", "cli", "api"]).default("api"),
  lastTransitionAt: z.string().optional(),
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
export type DiscoveryAnswerValueType = z.infer<typeof DiscoveryAnswerValueTypeSchema>;
export type DiscoveryAnswerSource = z.infer<typeof DiscoveryAnswerSourceSchema>;
export type DiscoveryAnswer = z.infer<typeof DiscoveryAnswerSchema>;
export type QuestionBundleField = z.infer<typeof QuestionBundleFieldSchema>;
export type QuestionBundle = z.infer<typeof QuestionBundleSchema>;
export type DiscoveryQuestionQueueItem = z.infer<typeof DiscoveryQuestionQueueItemSchema>;
export type BusinessDiscoverySession = z.infer<typeof BusinessDiscoverySessionSchema>;
