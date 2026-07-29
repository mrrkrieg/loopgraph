import { z } from "zod";
import { DepartmentTypeSchema } from "./department-skills";
import { evidenceGapSchema } from "./evidence-gap";
import { loopDesignProposalSetSchema } from "./design";

export const HERMES_DESIGN_TASK_SCHEMA_VERSION = "hermes-design-task/v1alpha1" as const;
export const HERMES_DESIGN_CALLBACK_SCHEMA_VERSION = "hermes-design-callback/v1alpha1" as const;

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

export type HermesDesignTaskStatus = z.infer<typeof hermesDesignTaskStatusSchema>;
export type HermesDesignTask = z.infer<typeof hermesDesignTaskSchema>;
export type HermesDesignCallback = z.infer<typeof hermesDesignCallbackSchema>;
