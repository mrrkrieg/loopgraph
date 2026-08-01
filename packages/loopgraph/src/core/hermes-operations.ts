import { z } from "zod";

export const HERMES_AGENT_INSTANCE_SCHEMA_VERSION = "hermes-agent-instance/v1alpha1" as const;
export const HERMES_EXECUTION_EVENT_SCHEMA_VERSION = "hermes-execution-event/v1alpha1" as const;

export const hermesAgentEnvironmentSchema = z.enum(["local", "sandbox", "staging", "production"]);
export const hermesAgentStatusSchema = z.enum(["online", "degraded", "offline", "disabled"]);

export const hermesAgentInstanceSchema = z.object({
  schemaVersion: z.literal(HERMES_AGENT_INSTANCE_SCHEMA_VERSION).default(HERMES_AGENT_INSTANCE_SCHEMA_VERSION),
  id: z.string().min(1).max(160),
  workspaceId: z.string().min(1).max(160),
  organizationId: z.string().min(1).max(160).optional(),
  name: z.string().min(1).max(200),
  environment: hermesAgentEnvironmentSchema,
  status: hermesAgentStatusSchema,
  runtimeVersion: z.string().min(1).max(100),
  capabilities: z.array(z.string().min(1).max(160)).max(250).default([]),
  assignedLoopIds: z.array(z.string().min(1).max(200)).max(500).default([]),
  defaultRouter: z.boolean().default(false),
  publicKeyId: z.string().min(1).max(200).optional(),
  labels: z.record(z.string().max(100), z.string().max(500)).default({}),
  lastHeartbeatAt: z.string().datetime(),
  registeredAt: z.string().datetime(),
  updatedAt: z.string().datetime()
});

export const hermesExecutionEventTypeSchema = z.enum([
  "assignment.received",
  "run.started",
  "task.started",
  "task.completed",
  "task.failed",
  "tool.started",
  "tool.completed",
  "tool.failed",
  "approval.requested",
  "approval.resolved",
  "output.created",
  "outcome.observed",
  "run.completed",
  "run.failed"
]);

const executionTaskSchema = z.object({
  id: z.string().min(1).max(200),
  label: z.string().min(1).max(300),
  owner: z.string().min(1).max(200).optional(),
  summary: z.string().max(2_000).optional()
});

const executionToolSchema = z.object({
  callId: z.string().min(1).max(200),
  toolKey: z.string().min(1).max(200),
  inputRef: z.string().min(1).max(500).optional(),
  outputRef: z.string().min(1).max(500).optional()
});

const executionApprovalSchema = z.object({
  id: z.string().min(1).max(200),
  status: z.enum(["requested", "approved", "rejected", "expired"]),
  requestedRole: z.string().min(1).max(160).optional(),
  resolvedBy: z.string().min(1).max(200).optional(),
  reason: z.string().max(2_000).optional()
});

const executionOutputSchema = z.object({
  id: z.string().min(1).max(200),
  type: z.string().min(1).max(160),
  label: z.string().min(1).max(300),
  artifactRef: z.string().min(1).max(500).optional()
});

const executionOutcomeSchema = z.object({
  metricKey: z.string().min(1).max(200),
  value: z.number(),
  unit: z.string().min(1).max(80).optional(),
  evidenceRef: z.string().min(1).max(500).optional()
});

const executionErrorSchema = z.object({
  code: z.string().min(1).max(160),
  message: z.string().min(1).max(4_000),
  retryable: z.boolean().default(false)
});

export const hermesExecutionEventSchema = z.object({
  schemaVersion: z.literal(HERMES_EXECUTION_EVENT_SCHEMA_VERSION).default(HERMES_EXECUTION_EVENT_SCHEMA_VERSION),
  id: z.string().min(1).max(200),
  idempotencyKey: z.string().min(1).max(250),
  workspaceId: z.string().min(1).max(160),
  organizationId: z.string().min(1).max(160).optional(),
  companyId: z.string().min(1).max(160),
  agentInstanceId: z.string().min(1).max(160),
  eventType: hermesExecutionEventTypeSchema,
  routeJobId: z.string().min(1).max(200),
  routeCommitId: z.string().min(1).max(200),
  routeAttemptId: z.string().min(1).max(200),
  eventId: z.string().min(1).max(200),
  problemId: z.string().min(1).max(200),
  loopId: z.string().min(1).max(200),
  loopSpecHash: z.string().min(1).max(200),
  runId: z.string().min(1).max(200),
  correlationId: z.string().min(1).max(200),
  sequence: z.number().int().min(0),
  task: executionTaskSchema.optional(),
  tool: executionToolSchema.optional(),
  approval: executionApprovalSchema.optional(),
  output: executionOutputSchema.optional(),
  outcome: executionOutcomeSchema.optional(),
  error: executionErrorSchema.optional(),
  summary: z.string().max(4_000).optional(),
  occurredAt: z.string().datetime(),
  recordedAt: z.string().datetime()
}).superRefine((event, context) => {
  if (event.eventType.startsWith("task.") && !event.task) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["task"], message: `${event.eventType} requires task metadata` });
  }
  if (event.eventType.startsWith("tool.") && !event.tool) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["tool"], message: `${event.eventType} requires tool metadata` });
  }
  if (event.eventType.startsWith("approval.") && !event.approval) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["approval"], message: `${event.eventType} requires approval metadata` });
  }
  if (event.eventType === "output.created" && !event.output) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["output"], message: "output.created requires output metadata" });
  }
  if (event.eventType === "outcome.observed" && !event.outcome) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["outcome"], message: "outcome.observed requires outcome metadata" });
  }
  if (["run.failed", "task.failed", "tool.failed"].includes(event.eventType) && !event.error) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["error"], message: `${event.eventType} requires a redacted error` });
  }
});

export const hermesExecutionAssignmentSchema = z.object({
  schemaVersion: z.literal("hermes-execution-assignment/v1alpha1").default("hermes-execution-assignment/v1alpha1"),
  assignmentId: z.string().min(1).max(200),
  workspaceId: z.string().min(1).max(160),
  companyId: z.string().min(1).max(160),
  agentInstanceId: z.string().min(1).max(160),
  routeJobId: z.string().min(1).max(200),
  routeCommitId: z.string().min(1).max(200),
  routeAttemptId: z.string().min(1).max(200),
  eventId: z.string().min(1).max(200),
  problemId: z.string().min(1).max(200),
  loopId: z.string().min(1).max(200),
  loopSpecHash: z.string().min(1).max(200),
  runId: z.string().min(1).max(200),
  correlationId: z.string().min(1).max(200),
  activationMode: z.enum(["execute_with_approval", "autonomous_low_risk"]),
  requiredCapabilities: z.array(z.string().min(1).max(160)).max(250).default([]),
  eventRef: z.string().min(1).max(500),
  callbackUrl: z.string().url().optional(),
  inputMapping: z.record(z.string(), z.unknown()).default({}),
  issuedAt: z.string().datetime()
});

export type HermesAgentInstance = z.infer<typeof hermesAgentInstanceSchema>;
export type HermesAgentEnvironment = z.infer<typeof hermesAgentEnvironmentSchema>;
export type HermesExecutionEvent = z.infer<typeof hermesExecutionEventSchema>;
export type HermesExecutionEventType = z.infer<typeof hermesExecutionEventTypeSchema>;
export type HermesExecutionAssignment = z.infer<typeof hermesExecutionAssignmentSchema>;
