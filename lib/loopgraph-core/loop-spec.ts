import { z } from "zod";
import { LOOPGRAPH_API_VERSION, LOOP_KIND } from "./constants";
import { contextPrecedenceRuleSchema, contextSourceSchema } from "./context";
import { approvalPolicySchema } from "./review";

const jsonSchema = z.record(z.string(), z.unknown());

export const ownerRefSchema = z.object({
  role: z.string(),
  name: z.string().optional()
});

export const triggerSpecSchema = z.object({
  type: z.enum(["webhook", "schedule", "manual", "event"]),
  source: z.string(),
  event: z.string(),
  schedule: z.string().optional()
});

export const fixtureRefSchema = z.object({
  id: z.string(),
  path: z.string()
});

export const routineStepSchema = z.object({
  id: z.string(),
  name: z.string(),
  stepType: z.string(),
  actor: z.enum(["agent", "human", "system"]),
  description: z.string()
});

export const toolBindingSchema = z.object({
  key: z.string(),
  adapterId: z.string(),
  label: z.string(),
  writeCapable: z.boolean().default(false),
  inputSchema: jsonSchema.optional(),
  riskLevel: z.enum(["low", "medium", "high", "critical"]).default("low")
});

export const actionPolicySchema = z.object({
  toolKey: z.string(),
  allowed: z.boolean().default(true),
  requiresApproval: z.boolean().default(false),
  customerFacing: z.boolean().default(false),
  riskLevel: z.enum(["low", "medium", "high", "critical"]).default("low")
});

export const forbiddenActionRuleSchema = z.object({
  toolKey: z.string(),
  reason: z.string()
});

export const escalationRuleSchema = z.object({
  id: z.string(),
  when: z.record(z.string(), z.unknown()),
  createEscalationCase: z.object({
    category: z.string(),
    severity: z.enum(["P0", "P1", "P2", "P3"]).optional()
  }).optional(),
  routeTo: z.object({
    primaryOwner: z.string(),
    reviewers: z.array(z.string()).default([]),
    responseSla: z.string().optional()
  }),
  requiresApproval: z.array(z.string()).default([]),
  decisionsRequired: z.array(z.string()).default([])
});

export const verifierBindingSchema = z.object({
  id: z.string(),
  type: z.enum(["schema", "policy", "evidence", "numeric_threshold", "approval_required", "mock_judge"]),
  config: z.record(z.string(), z.unknown()).optional()
});

export const loopSpecSchema = z.object({
  apiVersion: z.literal(LOOPGRAPH_API_VERSION),
  kind: z.literal(LOOP_KIND),
  metadata: z.object({
    id: z.string().min(1),
    name: z.string().min(1),
    version: z.string().min(1),
    description: z.string().optional(),
    labels: z.record(z.string(), z.string()).optional(),
    owner: ownerRefSchema.optional()
  }),
  trigger: triggerSpecSchema,
  input: z.object({
    schema: jsonSchema,
    fixtures: z.array(fixtureRefSchema).optional()
  }),
  output: z.object({
    schema: jsonSchema
  }),
  context: z.object({
    sources: z.array(contextSourceSchema),
    precedence: z.array(contextPrecedenceRuleSchema).default([]),
    tokenBudget: z.number().optional(),
    redactionPolicy: z.enum(["none", "restricted_only", "aggressive"]).default("restricted_only")
  }),
  routine: z.object({
    steps: z.array(routineStepSchema).min(1)
  }),
  tools: z.array(toolBindingSchema).default([]),
  policy: z.object({
    allowedActions: z.array(actionPolicySchema).default([]),
    forbiddenActions: z.array(forbiddenActionRuleSchema).default([]),
    escalationRules: z.array(escalationRuleSchema).default([]),
    riskLimits: z.array(z.object({ key: z.string(), max: z.number() })).optional()
  }),
  verification: z.array(verifierBindingSchema).default([]),
  approval: approvalPolicySchema,
  persistence: z.object({
    idempotency: z.object({ enabled: z.boolean().default(true) }),
    timeout: z.object({ seconds: z.number() }).optional(),
    retry: z.object({ maxAttempts: z.number() }).optional()
  }).default({ idempotency: { enabled: true } }),
  trace: z.object({
    captureContextSnapshot: z.boolean().default(true),
    captureToolInputOutput: z.boolean().default(true),
    evidenceRequired: z.boolean().default(true),
    exportOpenTelemetry: z.boolean().optional()
  }),
  topology: z.object({
    parentLoopId: z.string().optional(),
    department: z.string().optional(),
    tags: z.array(z.string()).optional()
  }).optional(),
  studioExtension: z.record(z.string(), z.unknown()).optional()
});

export type LoopSpec = z.infer<typeof loopSpecSchema>;

export function validateLoopSpec(input: unknown): LoopSpec {
  const spec = loopSpecSchema.parse(input);
  const errors = collectLoopSpecSemanticErrors(spec);
  if (errors.length > 0) {
    throw new Error(`LoopSpec semantic validation failed:\n- ${errors.join("\n- ")}`);
  }
  return spec;
}

export function collectLoopSpecSemanticErrors(spec: LoopSpec): string[] {
  const errors: string[] = [];
  const allowedByTool = new Map(spec.policy.allowedActions.map((a) => [a.toolKey, a]));

  for (const tool of spec.tools) {
    if (tool.writeCapable && !allowedByTool.has(tool.key)) {
      errors.push(`Write-capable tool "${tool.key}" missing policy.allowedActions entry`);
    }
  }

  for (const action of spec.policy.allowedActions) {
    if (action.requiresApproval && !spec.approval.requireFingerprintMatch) {
      errors.push(`Action "${action.toolKey}" requires approval but approval.requireFingerprintMatch is false`);
    }
  }

  for (const rule of spec.policy.escalationRules) {
    if (!rule.routeTo.primaryOwner) errors.push(`Escalation rule "${rule.id}" missing routeTo.primaryOwner`);
    if (!rule.routeTo.responseSla) errors.push(`Escalation rule "${rule.id}" missing routeTo.responseSla deadline`);
    if (rule.createEscalationCase && rule.decisionsRequired.length === 0) {
      errors.push(`Escalation rule "${rule.id}" missing decisionsRequired`);
    }
  }

  if (spec.trace.evidenceRequired) {
    const outputProps = (spec.output.schema.properties ?? {}) as Record<string, unknown>;
    if (!("evidence" in outputProps)) {
      errors.push("trace.evidenceRequired=true but output.schema lacks evidence field");
    }
  }

  return errors;
}

export function exportLoopSpecJsonSchema(): Record<string, unknown> {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { zodToJsonSchema } = require("zod-to-json-schema") as {
    zodToJsonSchema: (schema: z.ZodTypeAny, name?: string) => Record<string, unknown>;
  };
  return zodToJsonSchema(loopSpecSchema, "LoopSpec");
}
