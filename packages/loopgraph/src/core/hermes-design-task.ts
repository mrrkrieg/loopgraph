import { z } from "zod";
import { DepartmentTypeSchema } from "./department-skills";
import { DiscoveryAnswerValueTypeSchema } from "./discovery";
import {
  evidenceGapRequiredForSchema,
  evidenceGapSchema
} from "./evidence-gap";
import {
  loopDesignContextSchema,
  loopDesignProposalSetSchema
} from "./design";

export const HERMES_DESIGN_TASK_SCHEMA_VERSION = "hermes-design-task/v1alpha1" as const;
export const HERMES_DESIGN_CALLBACK_SCHEMA_VERSION = "hermes-design-callback/v1alpha1" as const;
export const HERMES_DESIGN_REQUEST_SCHEMA_VERSION = "hermes-design-request/v1alpha1" as const;
export const HERMES_DESIGN_DISPATCH_JOB_SCHEMA_VERSION =
  "hermes-design-dispatch-job/v1alpha1" as const;
export const HERMES_DESIGN_CALLBACK_JOB_SCHEMA_VERSION =
  "hermes-design-callback-job/v1alpha1" as const;

export const hermesDesignTaskStatusSchema = z.enum([
  "queued",
  "needs_input",
  "awaiting_hermes",
  "designing",
  "needs_repair",
  "completed",
  "failed",
  "cancelled"
]);

export const hermesDesignTaskDeliverySchema = z.object({
  status: z.enum(["pending", "sent", "not_configured", "failed"]).default("pending"),
  destination: z.string().optional(),
  attemptCount: z.number().int().min(0).default(0),
  lastAttemptAt: z.string().datetime().optional(),
  acknowledgedAt: z.string().datetime().optional(),
  responseStatus: z.number().int().optional(),
  error: z.string().optional()
});

export const hermesDesignTaskSchema = z.object({
  schemaVersion: z.literal(HERMES_DESIGN_TASK_SCHEMA_VERSION).default(HERMES_DESIGN_TASK_SCHEMA_VERSION),
  id: z.string().min(1),
  idempotencyKey: z.string().min(1),
  sessionId: z.string().min(1),
  companyId: z.string().min(1),
  department: DepartmentTypeSchema,
  status: hermesDesignTaskStatusSchema,
  reason: z.enum(["user_requested", "loop_opportunity", "unhandled_problem", "improvement"]).default("user_requested"),
  originProblemIds: z.array(z.string()).default([]),
  originOpportunityId: z.string().optional(),
  contextHash: z.string().optional(),
  blockingGapIds: z.array(z.string()).default([]),
  nextQuestionGapIds: z.array(z.string()).default([]),
  designRunIds: z.array(z.string()).default([]),
  compilerErrors: z.array(z.string()).default([]),
  callbackIds: z.array(z.string()).default([]),
  hermesTaskId: z.string().optional(),
  delivery: hermesDesignTaskDeliverySchema.default({ status: "pending" }),
  requestedBy: z.string().default("loopgraph"),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  completedAt: z.string().datetime().optional()
});

const callbackBaseSchema = z.object({
  schemaVersion: z.literal(HERMES_DESIGN_CALLBACK_SCHEMA_VERSION).default(HERMES_DESIGN_CALLBACK_SCHEMA_VERSION),
  callbackId: z.string().min(1),
  taskId: z.string().min(1),
  occurredAt: z.string().datetime(),
  hermesTaskId: z.string().optional()
});

export const hermesDesignCallbackSchema = z.discriminatedUnion("type", [
  callbackBaseSchema.extend({
    type: z.literal("task.acknowledged"),
    message: z.string().optional()
  }),
  callbackBaseSchema.extend({
    type: z.literal("task.questions_requested"),
    gaps: z.array(evidenceGapSchema).min(1)
  }),
  callbackBaseSchema.extend({
    type: z.literal("task.proposal_submitted"),
    proposalSet: loopDesignProposalSetSchema,
    providerName: z.string().optional(),
    modelIdentifier: z.string().optional(),
    providerMetadata: z.record(z.string(), z.unknown()).default({})
  }),
  callbackBaseSchema.extend({
    type: z.literal("task.failed"),
    error: z.string().min(1),
    retryable: z.boolean().default(false)
  })
]);

export const hermesDesignRequestSchema = z.object({
  schemaVersion: z.literal(HERMES_DESIGN_REQUEST_SCHEMA_VERSION)
    .default(HERMES_DESIGN_REQUEST_SCHEMA_VERSION),
  event_type: z.literal("loopgraph.design_requested"),
  task: hermesDesignTaskSchema,
  context: loopDesignContextSchema.optional(),
  gaps: z.array(evidenceGapSchema).default([]),
  nextQuestions: z.array(z.object({
    gapId: z.string().min(1),
    questionId: z.string().min(1).optional(),
    prompt: z.string().min(1),
    valueType: DiscoveryAnswerValueTypeSchema,
    options: z.array(z.string()).optional(),
    examples: z.array(z.string()).default([]),
    reason: z.string().min(1),
    requiredFor: z.array(evidenceGapRequiredForSchema).min(1),
    blocking: z.boolean()
  })).default([]),
  callback: z.object({
    url: z.string().url(),
    signatureHeader: z.literal("x-hermes-signature"),
    timestampHeader: z.literal("x-hermes-timestamp")
  }).optional(),
  allowedLoopgraphTools: z.tuple([
    z.literal("loopgraph_opportunities_get"),
    z.literal("loopgraph_evidence_gaps_get"),
    z.literal("loopgraph_evidence_gap_answer"),
    z.literal("loopgraph_design_context_get"),
    z.literal("loopgraph_design_submit")
  ]),
  instructions: z.array(z.string()).default([])
});

export const hermesDesignDispatchJobStatusSchema = z.enum([
  "queued",
  "claimed",
  "completed",
  "failed",
  "dead_letter",
  "cancelled"
]);

export const hermesDesignDispatchJobSchema = z.object({
  schemaVersion: z.literal(HERMES_DESIGN_DISPATCH_JOB_SCHEMA_VERSION)
    .default(HERMES_DESIGN_DISPATCH_JOB_SCHEMA_VERSION),
  id: z.string().min(1),
  idempotencyKey: z.string().min(1),
  taskId: z.string().min(1),
  request: hermesDesignRequestSchema,
  status: hermesDesignDispatchJobStatusSchema,
  attemptCount: z.number().int().min(0).default(0),
  maxAttempts: z.number().int().min(1).default(5),
  retryPolicy: z.object({
    baseDelaySeconds: z.number().int().min(1).default(30),
    maxDelaySeconds: z.number().int().min(1).default(3600),
    backoffMultiplier: z.number().min(1).default(2)
  }).default({
    baseDelaySeconds: 30,
    maxDelaySeconds: 3600,
    backoffMultiplier: 2
  }),
  nextRunAt: z.string().datetime(),
  lease: z.object({
    claimedBy: z.string().min(1),
    leaseToken: z.string().min(1),
    claimedAt: z.string().datetime(),
    expiresAt: z.string().datetime()
  }).optional(),
  result: z.object({
    destination: z.string().optional(),
    responseStatus: z.number().int().optional(),
    hermesTaskId: z.string().optional(),
    completedAt: z.string().datetime()
  }).optional(),
  lastError: z.object({
    message: z.string().min(1),
    at: z.string().datetime()
  }).optional(),
  deadLetterReason: z.string().optional(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime()
});

export const hermesDesignCallbackJobStatusSchema = z.enum([
  "queued",
  "claimed",
  "completed",
  "failed",
  "dead_letter",
  "cancelled"
]);

export const hermesDesignCallbackJobSchema = z.object({
  schemaVersion: z.literal(HERMES_DESIGN_CALLBACK_JOB_SCHEMA_VERSION)
    .default(HERMES_DESIGN_CALLBACK_JOB_SCHEMA_VERSION),
  id: z.string().min(1).max(160),
  idempotencyKey: z.string().min(1).max(160),
  taskId: z.string().min(1).max(256),
  callbackId: z.string().min(1).max(256),
  requestHash: z.string().regex(/^[a-f0-9]{64}$/),
  callback: hermesDesignCallbackSchema,
  status: hermesDesignCallbackJobStatusSchema,
  attemptCount: z.number().int().min(0).default(0),
  maxAttempts: z.number().int().min(1).max(100).default(5),
  retryPolicy: z.object({
    baseDelaySeconds: z.number().int().min(1).default(30),
    maxDelaySeconds: z.number().int().min(1).default(3600),
    backoffMultiplier: z.number().min(1).default(2)
  }).default({
    baseDelaySeconds: 30,
    maxDelaySeconds: 3600,
    backoffMultiplier: 2
  }),
  nextRunAt: z.string().datetime(),
  lease: z.object({
    claimedBy: z.string().min(1),
    leaseToken: z.string().min(1),
    claimedAt: z.string().datetime(),
    expiresAt: z.string().datetime()
  }).optional(),
  result: z.object({
    duplicate: z.boolean(),
    designRunId: z.string().optional(),
    validationErrors: z.array(z.string()).default([]),
    completedAt: z.string().datetime()
  }).optional(),
  lastError: z.object({
    message: z.string().min(1),
    at: z.string().datetime()
  }).optional(),
  deadLetterReason: z.string().optional(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime()
}).superRefine((job, context) => {
  if (job.callback.taskId !== job.taskId) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["callback", "taskId"],
      message: "Callback task identity must match its inbox job"
    });
  }
  if (job.callback.callbackId !== job.callbackId) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["callback", "callbackId"],
      message: "Callback identity must match its inbox job"
    });
  }
  if (job.status === "claimed" && !job.lease) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["lease"],
      message: "Claimed callback jobs require a lease"
    });
  }
  if (job.status !== "claimed" && job.lease) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["lease"],
      message: "Only claimed callback jobs may carry a lease"
    });
  }
});

export type HermesDesignTaskStatus = z.infer<typeof hermesDesignTaskStatusSchema>;
export type HermesDesignTask = z.infer<typeof hermesDesignTaskSchema>;
export type HermesDesignCallback = z.infer<typeof hermesDesignCallbackSchema>;
export type HermesDesignRequest = z.infer<typeof hermesDesignRequestSchema>;
export type HermesDesignDispatchJobStatus =
  z.infer<typeof hermesDesignDispatchJobStatusSchema>;
export type HermesDesignDispatchJob = z.infer<typeof hermesDesignDispatchJobSchema>;
export type HermesDesignCallbackJobStatus =
  z.infer<typeof hermesDesignCallbackJobStatusSchema>;
export type HermesDesignCallbackJob = z.infer<typeof hermesDesignCallbackJobSchema>;
