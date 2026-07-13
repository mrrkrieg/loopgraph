import { z } from "zod";
import { evidenceRefSchema, proposedActionSchema } from "./evidence";

export const decisionRequestSchema = z.object({
  id: z.string(),
  question: z.string(),
  requiredRole: z.string(),
  blocking: z.boolean().default(true)
});

export const roleRefSchema = z.object({
  role: z.string(),
  name: z.string().optional()
});

export const escalationCaseSchema = z.object({
  id: z.string(),
  sourceRunId: z.string(),
  sourceLoopId: z.string(),
  createdAt: z.string(),
  category: z.enum([
    "customer_risk",
    "service_incident",
    "security",
    "revenue_risk",
    "legal_risk",
    "product_gap",
    "operational_blocker"
  ]),
  severity: z.enum(["P0", "P1", "P2", "P3"]),
  confidence: z.number().min(0).max(1),
  affectedEntities: z.object({
    companyId: z.string().optional(),
    accountId: z.string().optional(),
    accountName: z.string().optional(),
    repository: z.string().optional(),
    contacts: z.array(z.string()).optional(),
    contractValue: z.number().optional(),
    renewalDate: z.string().optional(),
    productAreas: z.array(z.string()).optional()
  }).default({}),
  summary: z.string(),
  customerImpact: z.string().optional(),
  businessImpact: z.string().optional(),
  suspectedCause: z.string().optional(),
  evidence: z.array(evidenceRefSchema).default([]),
  unresolvedQuestions: z.array(z.string()).default([]),
  recommendedActions: z.array(proposedActionSchema).default([]),
  decisionsRequired: z.array(decisionRequestSchema).default([]),
  routing: z.object({
    primaryOwner: roleRefSchema,
    reviewers: z.array(roleRefSchema).default([]),
    informed: z.array(roleRefSchema).default([]),
    escalationDeadline: z.string(),
    nextUpdateDueAt: z.string().optional()
  }),
  responsePlan: z.object({
    internalActions: z.array(z.object({
      id: z.string(),
      toolKey: z.string(),
      label: z.string(),
      payload: z.record(z.string(), z.unknown()),
      fingerprint: z.string()
    })).default([]),
    customerFacingDraft: z.object({
      id: z.string(),
      toolKey: z.string(),
      label: z.string(),
      payload: z.record(z.string(), z.unknown()),
      fingerprint: z.string()
    }).optional(),
    successCriteria: z.array(z.string()).default([])
  }).default({ internalActions: [], successCriteria: [] }),
  status: z.enum(["open", "under_review", "approved", "in_progress", "resolved", "closed", "rejected"]).default("open"),
  outcome: z.object({
    resolutionSummary: z.string(),
    resolvedAt: z.string().optional(),
    businessResult: z.string().optional(),
    customerResult: z.string().optional(),
    classificationCorrect: z.boolean().optional(),
    followUpRequired: z.boolean().optional()
  }).optional()
});

export type EscalationCase = z.infer<typeof escalationCaseSchema>;
export type DecisionRequest = z.infer<typeof decisionRequestSchema>;

export function validateEscalationCaseInvariants(caseItem: EscalationCase): string[] {
  const errors: string[] = [];
  if (["P0", "P1"].includes(caseItem.severity)) {
    if (caseItem.evidence.length === 0) errors.push("High-severity cases require evidence");
    if (!caseItem.routing.primaryOwner.role) errors.push("High-severity cases require a primary owner");
    if (!caseItem.routing.escalationDeadline) errors.push("High-severity cases require an escalation deadline");
    if (caseItem.decisionsRequired.length === 0) errors.push("High-severity cases require decisionsRequired");
  }
  return errors;
}
