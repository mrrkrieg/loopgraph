import { z } from "zod";

export const evidenceRefSchema = z.object({
  id: z.string(),
  sourceId: z.string(),
  sourceType: z.enum(["policy", "fixture", "integration", "memory", "event", "trace"]),
  excerpt: z.string(),
  fieldPath: z.string().optional(),
  trusted: z.boolean().default(true)
});

export const assumptionSchema = z.object({
  id: z.string(),
  statement: z.string(),
  confidence: z.number().min(0).max(1)
});

export const policyInputSchema = z.object({
  key: z.string(),
  value: z.unknown(),
  source: z.string()
});

export const proposedActionSchema = z.object({
  id: z.string(),
  toolKey: z.string(),
  label: z.string(),
  input: z.record(z.string(), z.unknown()),
  riskLevel: z.enum(["low", "medium", "high", "critical"]),
  requiresApproval: z.boolean(),
  customerFacing: z.boolean().default(false)
});

export const verificationRequestSchema = z.object({
  required: z.boolean(),
  reason: z.string().optional(),
  checks: z.array(z.string()).default([])
});

export const escalationRequestSchema = z.object({
  required: z.boolean(),
  category: z.string().optional(),
  severity: z.enum(["P0", "P1", "P2", "P3"]).optional(),
  rationale: z.string().optional()
});

export const agentRunOutputSchema = z.object({
  decisionSummary: z.string(),
  assumptions: z.array(assumptionSchema).default([]),
  proposedActions: z.array(proposedActionSchema).default([]),
  evidence: z.array(evidenceRefSchema).default([]),
  policyInputs: z.array(policyInputSchema).default([]),
  verificationRequest: verificationRequestSchema,
  escalationRequest: escalationRequestSchema.optional()
});

export type EvidenceRef = z.infer<typeof evidenceRefSchema>;
export type Assumption = z.infer<typeof assumptionSchema>;
export type PolicyInput = z.infer<typeof policyInputSchema>;
export type ProposedAction = z.infer<typeof proposedActionSchema>;
export type VerificationRequest = z.infer<typeof verificationRequestSchema>;
export type EscalationRequest = z.infer<typeof escalationRequestSchema>;
export type AgentRunOutput = z.infer<typeof agentRunOutputSchema>;
