import { z } from "zod";
import { DepartmentTypeSchema } from "./department-skills";
import { logicalCapabilitySchema, packRelativePathSchema, permissionRiskSchema } from "./app-platform";
import { loopRoutingContractSchema } from "./routing";

export const APP_LOOP_SCHEMA_VERSION = "loopgraph-app-loop/v1alpha1" as const;
export const APP_SKILL_SCHEMA_VERSION = "loopgraph-app-skill/v1alpha1" as const;
export const APP_SETUP_SCHEMA_VERSION = "loopgraph-app-setup/v1alpha1" as const;
export const APP_EVAL_SUITE_SCHEMA_VERSION = "loopgraph-app-eval-suite/v1alpha1" as const;

export const appLoopDefinitionSchema = z.object({
  schemaVersion: z.literal(APP_LOOP_SCHEMA_VERSION),
  kind: z.literal("AppLoop"),
  metadata: z.object({
    id: z.string().min(1),
    name: z.string().min(1),
    version: z.string().min(1),
    description: z.string().min(1),
    department: DepartmentTypeSchema,
    ownerRole: z.string().min(1),
    tags: z.array(z.string().min(1)).default([])
  }).strict(),
  trigger: z.object({
    source: z.string().min(1),
    event: z.string().min(1),
    type: z.enum(["webhook", "event", "schedule", "manual"]).default("event"),
    schedule: z.string().min(1).optional()
  }).strict(),
  input: z.object({
    requiredFields: z.array(z.string().min(1)).min(1),
    subjectTypes: z.array(z.string().min(1)).min(1),
    fixtures: z.array(z.object({ id: z.string().min(1), path: packRelativePathSchema }).strict()).default([])
  }).strict(),
  routine: z.array(z.object({
    id: z.string().min(1),
    name: z.string().min(1),
    actor: z.enum(["agent", "human", "system"]),
    type: z.enum(["observe", "assess", "decide", "prepare", "verify", "learn"]),
    description: z.string().min(1)
  }).strict()).min(1),
  capabilities: z.array(z.object({
    key: logicalCapabilitySchema,
    authority: z.enum(["read", "draft", "approve", "execute"]),
    risk: permissionRiskSchema,
    required: z.boolean(),
    purpose: z.string().min(1),
    customerFacing: z.boolean().default(false)
  }).strict()).min(1),
  skills: z.array(z.string().min(1)).default([]),
  outcomes: z.array(z.object({
    metric: z.string().min(1),
    description: z.string().min(1),
    direction: z.enum(["increase", "decrease", "maintain"]),
    sourceCapability: logicalCapabilitySchema.optional()
  }).strict()).min(1),
  routing: loopRoutingContractSchema,
  policy: z.object({
    forbiddenActions: z.array(z.object({ capability: logicalCapabilitySchema, reason: z.string().min(1) }).strict()).default([]),
    escalationOwner: z.string().min(1),
    escalationSla: z.string().min(1),
    separateCustomerFacingApproval: z.boolean().default(true)
  }).strict()
}).strict().superRefine((loop, ctx) => {
  const requiredCapabilities = loop.capabilities.filter((capability) => capability.required).map((capability) => capability.key);
  for (const capability of loop.routing.requiredConnections) {
    if (!requiredCapabilities.includes(capability)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["routing", "requiredConnections"], message: `${capability} must be a required loop capability` });
    }
  }
  for (const outcome of loop.outcomes) {
    if (outcome.sourceCapability && !loop.capabilities.some((capability) => capability.key === outcome.sourceCapability)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["outcomes"], message: `Outcome capability ${outcome.sourceCapability} is not declared` });
    }
  }
});

export const appSkillDefinitionSchema = z.object({
  schemaVersion: z.literal(APP_SKILL_SCHEMA_VERSION),
  kind: z.literal("HermesSkill"),
  id: z.string().min(1),
  name: z.string().min(1),
  description: z.string().min(1),
  department: DepartmentTypeSchema,
  goal: z.string().min(1),
  inputs: z.array(z.string().min(1)).min(1),
  outputs: z.array(z.string().min(1)).min(1),
  instructions: z.array(z.string().min(1)).min(1),
  boundaries: z.array(z.string().min(1)).min(1),
  requiredCapabilities: z.array(logicalCapabilitySchema).default([])
}).strict();

export const appSetupDefinitionSchema = z.object({
  schemaVersion: z.literal(APP_SETUP_SCHEMA_VERSION),
  kind: z.literal("AppSetup"),
  questions: z.array(z.object({
    key: z.string().min(1),
    prompt: z.string().min(1),
    why: z.string().min(1),
    valueType: z.enum(["string", "number", "boolean", "string_list", "object"]),
    requirement: z.enum(["required", "optional", "conditional"]),
    inferFromContext: z.string().min(1).optional(),
    confirmWhenInferred: z.boolean().default(false),
    condition: z.string().min(1).optional(),
    defaultValue: z.unknown().optional()
  }).strict()).default([])
}).strict();

export const appEvalSuiteSchema = z.object({
  schemaVersion: z.literal(APP_EVAL_SUITE_SCHEMA_VERSION),
  kind: z.literal("AppEvalSuite"),
  id: z.string().min(1),
  appId: z.string().min(1),
  scenarios: z.array(z.object({
    id: z.string().min(1),
    fixture: packRelativePathSchema,
    expectedAction: z.enum(["route", "append_evidence", "request_human", "defer", "unhandled", "ignore"]),
    expectedLoopId: z.string().min(1).optional(),
    connectorState: z.enum(["connected", "degraded", "unavailable"]).default("connected"),
    expectedApproval: z.boolean().default(false),
    notes: z.string().min(1)
  }).strict()).min(1)
}).strict();

export type AppLoopDefinition = z.infer<typeof appLoopDefinitionSchema>;
export type AppSkillDefinition = z.infer<typeof appSkillDefinitionSchema>;
export type AppSetupDefinition = z.infer<typeof appSetupDefinitionSchema>;
export type AppEvalSuite = z.infer<typeof appEvalSuiteSchema>;

