import { z } from "zod";
import { DepartmentTypeSchema } from "./department-skills";

export const LOOP_CONTROLLER_POLICY_SCHEMA_VERSION = "loop-controller-policy/v1alpha1" as const;
export const LOOP_CONTROLLER_RUN_SCHEMA_VERSION = "loop-controller-run/v1alpha1" as const;
export const LOOP_CONTROLLER_CHECKPOINT_SCHEMA_VERSION = "loop-controller-checkpoint/v1alpha1" as const;
export const LOOP_CONTROLLER_TRIGGER_RECORD_SCHEMA_VERSION = "loop-controller-trigger-record/v1alpha1" as const;

export const loopControllerTriggerTypeSchema = z.enum([
  "manual",
  "schedule",
  "routing_event",
  "route_job",
  "review",
  "outcome_window",
  "connector_health",
  "management_cycle"
]);

export const loopControllerDecisionActionSchema = z.enum([
  "no_action",
  "request_evidence",
  "start_design",
  "wait_for_design",
  "review_change",
  "shadow_materialize",
  "propose_pause",
  "propose_retire"
]);

export const loopControllerPolicySchema = z.object({
  schemaVersion: z.literal(LOOP_CONTROLLER_POLICY_SCHEMA_VERSION).default(LOOP_CONTROLLER_POLICY_SCHEMA_VERSION),
  enabled: z.boolean().default(true),
  autoStartDesign: z.boolean().default(true),
  autoEvaluateOutcomes: z.boolean().default(true),
  autoShadowMaterialization: z.boolean().default(true),
  qualifyThreshold: z.number().min(0).max(100).default(45),
  autoDesignThreshold: z.number().min(0).max(100).default(65),
  autoShadowThreshold: z.number().min(0).max(100).default(80),
  maxDecisionsPerRun: z.number().int().min(1).max(100).default(20),
  cooldownSeconds: z.number().int().min(0).max(31_536_000).default(3600),
  maximumSignalSeverityForAutoShadow: z.enum(["low", "medium"]).default("medium"),
  blockedAutoShadowDepartments: z.array(DepartmentTypeSchema).default([
    "ops_finance",
    "hr_talent",
    "legal_compliance"
  ]),
  allowedAutoShadowChangeOperations: z.array(z.enum(["add", "update"])).default(["add"]),
  requireNoOpenQuestions: z.boolean().default(true),
  requireNoUserApprovalItems: z.boolean().default(true),
  requireRoutingConnectionsReady: z.boolean().default(true)
}).superRefine((policy, context) => {
  if (policy.autoDesignThreshold < policy.qualifyThreshold) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["autoDesignThreshold"],
      message: "autoDesignThreshold cannot be lower than qualifyThreshold"
    });
  }
  if (policy.autoShadowThreshold < policy.autoDesignThreshold) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["autoShadowThreshold"],
      message: "autoShadowThreshold cannot be lower than autoDesignThreshold"
    });
  }
});

export const loopControllerTriggerSchema = z.object({
  type: loopControllerTriggerTypeSchema,
  id: z.string().min(1),
  occurredAt: z.string().datetime(),
  sourceRef: z.string().min(1),
  requestedBy: z.string().min(1).optional(),
  evidenceRefs: z.array(z.string().min(1)).default([])
});

export const loopControllerPolicyRuleSchema = z.object({
  id: z.string().min(1),
  passed: z.boolean(),
  summary: z.string().min(1),
  evidenceRefs: z.array(z.string().min(1)).default([])
});

export const loopControllerDecisionSchema = z.object({
  id: z.string().min(1),
  action: loopControllerDecisionActionSchema,
  opportunityId: z.string().min(1).optional(),
  graphChangeSetId: z.string().min(1).optional(),
  designTaskId: z.string().min(1).optional(),
  designRunId: z.string().min(1).optional(),
  materializationId: z.string().min(1).optional(),
  graphApprovalReceiptId: z.string().min(1).optional(),
  graphTransactionId: z.string().min(1).optional(),
  department: DepartmentTypeSchema.optional(),
  targetLoopIds: z.array(z.string().min(1)).default([]),
  score: z.number().min(0).max(100).optional(),
  summary: z.string().min(1),
  reason: z.string().min(1),
  evidenceRefs: z.array(z.string().min(1)).default([]),
  policy: z.object({
    passed: z.boolean(),
    rules: z.array(loopControllerPolicyRuleSchema).default([])
  }),
  createdAt: z.string().datetime()
});

export const loopControllerRunSchema = z.object({
  schemaVersion: z.literal(LOOP_CONTROLLER_RUN_SCHEMA_VERSION).default(LOOP_CONTROLLER_RUN_SCHEMA_VERSION),
  id: z.string().min(1),
  idempotencyKey: z.string().min(1),
  projectRootId: z.string().min(1),
  trigger: loopControllerTriggerSchema,
  status: z.enum(["running", "completed", "failed", "disabled"]),
  policyHash: z.string().min(1),
  evidenceFingerprint: z.string().min(1),
  evidence: z.object({
    opportunitySignalCount: z.number().int().min(0),
    opportunityIds: z.array(z.string().min(1)).default([]),
    graphChangeSetIds: z.array(z.string().min(1)).default([]),
    designTaskIds: z.array(z.string().min(1)).default([]),
    evaluatedOutcomeIds: z.array(z.string().min(1)).default([]),
    outcomeTruth: z.object({
      observed: z.number().int().min(0),
      modeled: z.number().int().min(0),
      incomplete: z.number().int().min(0)
    }).default({ observed: 0, modeled: 0, incomplete: 0 })
  }),
  decisions: z.array(loopControllerDecisionSchema).default([]),
  errors: z.array(z.object({
    code: z.string().min(1),
    message: z.string().min(1),
    evidenceRefs: z.array(z.string().min(1)).default([])
  })).default([]),
  startedAt: z.string().datetime(),
  completedAt: z.string().datetime().optional(),
  nextEligibleAt: z.string().datetime().optional()
});

export const loopControllerCheckpointSchema = z.object({
  schemaVersion: z.literal(LOOP_CONTROLLER_CHECKPOINT_SCHEMA_VERSION).default(LOOP_CONTROLLER_CHECKPOINT_SCHEMA_VERSION),
  projectRootId: z.string().min(1),
  lastRunId: z.string().min(1),
  lastCompletedAt: z.string().datetime(),
  lastEvidenceFingerprint: z.string().min(1),
  lastTriggerId: z.string().min(1),
  opportunityWatermarks: z.record(z.string(), z.string().datetime()).default({}),
  updatedAt: z.string().datetime()
});

export const loopControllerTriggerRecordSchema = z.object({
  schemaVersion: z.literal(LOOP_CONTROLLER_TRIGGER_RECORD_SCHEMA_VERSION)
    .default(LOOP_CONTROLLER_TRIGGER_RECORD_SCHEMA_VERSION),
  id: z.string().min(1),
  projectRootId: z.string().min(1),
  trigger: loopControllerTriggerSchema,
  status: z.enum(["pending", "processing", "completed", "failed"]),
  attempts: z.number().int().min(0).default(0),
  leaseId: z.string().uuid().optional(),
  leaseExpiresAt: z.string().datetime().optional(),
  controllerRunId: z.string().min(1).optional(),
  error: z.string().min(1).optional(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  completedAt: z.string().datetime().optional()
});

export type LoopControllerTriggerType = z.infer<typeof loopControllerTriggerTypeSchema>;
export type LoopControllerDecisionAction = z.infer<typeof loopControllerDecisionActionSchema>;
export type LoopControllerPolicy = z.infer<typeof loopControllerPolicySchema>;
export type LoopControllerTrigger = z.infer<typeof loopControllerTriggerSchema>;
export type LoopControllerPolicyRule = z.infer<typeof loopControllerPolicyRuleSchema>;
export type LoopControllerDecision = z.infer<typeof loopControllerDecisionSchema>;
export type LoopControllerRun = z.infer<typeof loopControllerRunSchema>;
export type LoopControllerCheckpoint = z.infer<typeof loopControllerCheckpointSchema>;
export type LoopControllerTriggerRecord = z.infer<typeof loopControllerTriggerRecordSchema>;
