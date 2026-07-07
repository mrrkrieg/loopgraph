import { z } from "zod";
import type { ReviewRole } from "./constants";

export const preparedActionSchema = z.object({
  id: z.string(),
  toolKey: z.string(),
  label: z.string(),
  payload: z.record(z.string(), z.unknown()),
  fingerprint: z.string(),
  riskLevel: z.enum(["low", "medium", "high", "critical"]),
  requiresApproval: z.boolean(),
  customerFacing: z.boolean().default(false),
  proposedActionId: z.string()
});

export const approvalPolicySchema = z.object({
  requireFingerprintMatch: z.boolean().default(true),
  separateCustomerFacingApproval: z.boolean().default(true),
  allowedRoles: z.array(z.enum(["approver", "reviewer", "owner", "teacher", "executor", "accountability_holder"])).default(["approver"])
});

export const humanReviewTraceSchema = z.object({
  id: z.string(),
  runId: z.string(),
  status: z.enum(["open", "approved", "rejected", "needs_changes", "expired", "request_evidence", "reassigned"]),
  role: z.enum(["approver", "reviewer", "owner", "teacher", "executor", "accountability_holder"]),
  approvedFingerprints: z.array(z.string()).default([]),
  rejectedFingerprints: z.array(z.string()).default([]),
  comment: z.string().optional(),
  teacherFeedback: z.string().optional(),
  reviewMinutes: z.number().optional(),
  reworkMinutes: z.number().optional(),
  botsittingMinutes: z.number().optional(),
  escalationMinutes: z.number().optional(),
  governanceMinutes: z.number().optional(),
  reassignedTo: z.string().optional(),
  createdAt: z.string(),
  decidedAt: z.string().optional()
});

export type PreparedAction = z.infer<typeof preparedActionSchema>;
export type ApprovalPolicy = z.infer<typeof approvalPolicySchema>;
export type HumanReviewTrace = z.infer<typeof humanReviewTraceSchema>;

export function validateApprovalBinding(prepared: PreparedAction, approvedFingerprints: string[]): boolean {
  return approvedFingerprints.includes(prepared.fingerprint);
}

export type ReviewDecisionInput = {
  runId: string;
  role: ReviewRole;
  approvedFingerprints?: string[];
  comment?: string;
  teacherFeedback?: string;
  reviewMinutes?: number;
};
