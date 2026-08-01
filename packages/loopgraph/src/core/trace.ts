import { z } from "zod";
import { contextSnapshotSchema } from "./context";
import { humanReviewTraceSchema, preparedActionSchema } from "./review";
import { agentRunOutputSchema } from "./evidence";
import type { RunStatus } from "./constants";

export const triggerRefSchema = z.object({
  type: z.string(),
  source: z.string(),
  event: z.string(),
  eventId: z.string(),
  receivedAt: z.string()
});

export const inputSnapshotSchema = z.object({
  key: z.string(),
  value: z.unknown(),
  source: z.string()
});

export const toolCallTraceSchema = z.object({
  id: z.string(),
  toolKey: z.string(),
  input: z.record(z.string(), z.unknown()),
  output: z.unknown().optional(),
  status: z.enum(["pending", "completed", "failed", "mock_committed"]),
  startedAt: z.string(),
  completedAt: z.string().optional()
});

export const taskRunTraceSchema = z.object({
  id: z.string(),
  label: z.string(),
  owner: z.string().optional(),
  status: z.enum(["pending", "running", "waiting_review", "completed", "failed"]),
  summary: z.string().optional(),
  startedAt: z.string().optional(),
  completedAt: z.string().optional(),
  error: z.object({
    code: z.string(),
    message: z.string()
  }).optional()
});

export const policyDecisionSchema = z.object({
  ruleId: z.string(),
  matched: z.boolean(),
  action: z.string(),
  reason: z.string(),
  requiresReview: z.boolean().default(false),
  createEscalationCase: z.boolean().default(false)
});

export const verificationResultSchema = z.object({
  verifierId: z.string(),
  passed: z.boolean(),
  confidence: z.number().min(0).max(1).optional(),
  summary: z.string(),
  checks: z.array(z.object({
    name: z.string(),
    passed: z.boolean(),
    message: z.string().optional()
  })).default([])
});

export const outputArtifactSchema = z.object({
  id: z.string(),
  type: z.string(),
  content: z.unknown()
});

export const metricUpdateSchema = z.object({
  name: z.string(),
  value: z.number(),
  unit: z.string().optional(),
  observed: z.boolean().default(false)
});

export const runErrorSchema = z.object({
  code: z.string(),
  message: z.string(),
  at: z.string()
});

export const runProvenanceSchema = z.object({
  invocation: z.object({
    actor: z.string(),
    source: z.string().optional(),
    userId: z.string().optional(),
    sessionId: z.string().optional(),
    routeAttemptId: z.string().optional(),
    routeCommitId: z.string().optional()
  }),
  liveExecutionGate: z.object({
    checkedAt: z.string(),
    allowed: z.boolean(),
    activationMode: z.string().optional(),
    reasonCodes: z.array(z.string()).default([]),
    requiredActions: z.array(z.string()).default([])
  }).optional(),
  approvalPolicy: z.object({
    requireFingerprintMatch: z.boolean(),
    separateCustomerFacingApproval: z.boolean(),
    allowedRoles: z.array(z.string()).default([])
  }).optional(),
  connectorChecks: z.array(z.object({
    capability: z.string(),
    requiredFor: z.string(),
    status: z.string(),
    connectedRuntimeInstances: z.array(z.object({
      instanceId: z.string(),
      manifestId: z.string(),
      environment: z.string()
    })).default([])
  })).default([])
});

export const loopRunTraceSchema = z.object({
  id: z.string(),
  loopId: z.string(),
  loopSpecVersion: z.string(),
  loopSpecHash: z.string(),
  parentRunId: z.string().optional(),
  mode: z.enum(["validate", "simulate", "dry-run", "execute"]),
  status: z.custom<RunStatus>(),
  trigger: triggerRefSchema,
  idempotencyKey: z.string(),
  contextSnapshot: contextSnapshotSchema,
  inputs: z.array(inputSnapshotSchema).default([]),
  agentOutput: agentRunOutputSchema.optional(),
  proposedActions: z.array(z.object({
    id: z.string(),
    toolKey: z.string(),
    label: z.string(),
    input: z.record(z.string(), z.unknown()),
    riskLevel: z.enum(["low", "medium", "high", "critical"]),
    requiresApproval: z.boolean(),
    customerFacing: z.boolean().default(false)
  })).default([]),
  preparedActions: z.array(preparedActionSchema).default([]),
  taskRuns: z.array(taskRunTraceSchema).optional(),
  toolCalls: z.array(toolCallTraceSchema).default([]),
  policyDecisions: z.array(policyDecisionSchema).default([]),
  verificationResults: z.array(verificationResultSchema).default([]),
  escalationCases: z.array(z.string()).default([]),
  humanReviews: z.array(humanReviewTraceSchema).default([]),
  outputs: z.array(outputArtifactSchema).default([]),
  metrics: z.array(metricUpdateSchema).default([]),
  errors: z.array(runErrorSchema).default([]),
  provenance: runProvenanceSchema.optional(),
  startedAt: z.string(),
  completedAt: z.string().optional(),
  latencyMs: z.number().optional(),
  estimatedCost: z.number().optional()
});

export type TriggerRef = z.infer<typeof triggerRefSchema>;
export type InputSnapshot = z.infer<typeof inputSnapshotSchema>;
export type ToolCallTrace = z.infer<typeof toolCallTraceSchema>;
export type TaskRunTrace = z.infer<typeof taskRunTraceSchema>;
export type PolicyDecision = z.infer<typeof policyDecisionSchema>;
export type VerificationResult = z.infer<typeof verificationResultSchema>;
export type OutputArtifact = z.infer<typeof outputArtifactSchema>;
export type MetricUpdate = z.infer<typeof metricUpdateSchema>;
export type RunError = z.infer<typeof runErrorSchema>;
export type RunProvenance = z.infer<typeof runProvenanceSchema>;
export type LoopRunTrace = z.infer<typeof loopRunTraceSchema>;
