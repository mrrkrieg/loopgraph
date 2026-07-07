import type { RunStatus } from "../core/constants";

const transitions: Record<RunStatus, RunStatus[]> = {
  DRAFT: ["VALIDATED", "FAILED_VALIDATION"],
  VALIDATED: ["READY"],
  READY: ["SIMULATING"],
  SIMULATING: ["PROPOSED_ACTIONS", "FAILED_VALIDATION"],
  PROPOSED_ACTIONS: ["VERIFYING"],
  VERIFYING: ["WAITING_FOR_REVIEW", "COMPLETED", "FAILED_VERIFICATION", "BLOCKED_BY_POLICY", "ESCALATED"],
  WAITING_FOR_REVIEW: ["APPROVED", "REJECTED", "CANCELLED"],
  APPROVED: ["COMMITTED"],
  COMMITTED: ["COMPLETED"],
  COMPLETED: [],
  FAILED_VALIDATION: [],
  FAILED_VERIFICATION: [],
  ESCALATED: ["WAITING_FOR_REVIEW", "COMPLETED"],
  REJECTED: [],
  BLOCKED_BY_POLICY: [],
  CANCELLED: []
};

export function canTransition(from: RunStatus, to: RunStatus): boolean {
  return transitions[from]?.includes(to) ?? false;
}

export function assertTransition(from: RunStatus, to: RunStatus) {
  if (!canTransition(from, to)) {
    throw new Error(`Invalid state transition ${from} -> ${to}`);
  }
}

export function terminalStatuses(): RunStatus[] {
  return ["COMPLETED", "FAILED_VALIDATION", "FAILED_VERIFICATION", "REJECTED", "BLOCKED_BY_POLICY", "CANCELLED"];
}
