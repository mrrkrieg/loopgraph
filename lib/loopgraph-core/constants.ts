export const LOOPGRAPH_API_VERSION = "loopgraph/v1alpha1" as const;
export const LOOP_KIND = "Loop" as const;

export const MAX_PARENT_CHILD_RUN_DEPTH = 3;
export const MAX_ESCALATION_REENTRY_DEPTH = 2;

export type RuntimeMode = "validate" | "simulate" | "dry-run" | "execute";

export type RunStatus =
  | "DRAFT"
  | "VALIDATED"
  | "READY"
  | "SIMULATING"
  | "PROPOSED_ACTIONS"
  | "VERIFYING"
  | "WAITING_FOR_REVIEW"
  | "APPROVED"
  | "COMMITTED"
  | "COMPLETED"
  | "FAILED_VALIDATION"
  | "FAILED_VERIFICATION"
  | "ESCALATED"
  | "REJECTED"
  | "BLOCKED_BY_POLICY"
  | "CANCELLED";

export type ReviewRole =
  | "approver"
  | "reviewer"
  | "owner"
  | "teacher"
  | "executor"
  | "accountability_holder";

export type RiskLevel = "low" | "medium" | "high" | "critical";

export type Sensitivity = "public" | "internal" | "confidential" | "restricted";

export type Freshness = "realtime" | "hourly" | "daily" | "manual" | "fixture";
