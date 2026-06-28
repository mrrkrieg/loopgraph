import type { LoopRunTrace } from "../loopgraph-core/trace";
import type { HumanReviewTrace } from "../loopgraph-core/review";
import type { EscalationCase } from "../loopgraph-core/escalation";

export type JSONSchema = Record<string, unknown>;

export type IntegrationConfig = Record<string, unknown>;

export type VariableDefinition = {
  key: string;
  label: string;
  description: string;
  type: string;
  sensitivity: "public" | "internal" | "confidential" | "restricted";
};

export type ActionDefinition = {
  key: string;
  label: string;
  description: string;
  writeCapable: boolean;
  riskLevel: "low" | "medium" | "high" | "critical";
};

export type SignalDefinition = {
  key: string;
  label: string;
};

export type VariableValue = {
  key: string;
  value: unknown;
  retrievedAt: string;
  freshness: "realtime" | "hourly" | "daily" | "manual" | "fixture";
  trusted: boolean;
};

export type PreparedActionInput = {
  toolKey: string;
  payload: Record<string, unknown>;
};

export type PreparedActionResult = {
  id: string;
  toolKey: string;
  label: string;
  payload: Record<string, unknown>;
  fingerprint: string;
  riskLevel: "low" | "medium" | "high" | "critical";
  requiresApproval: boolean;
  customerFacing: boolean;
};

export type CommitPreparedActionInput = {
  preparedAction: PreparedActionResult;
  approvedFingerprints: string[];
};

export type ActionResult = {
  status: "mock_committed" | "rejected";
  message: string;
  fingerprint: string;
};

export type HealthCheckResult = { ok: boolean; message: string };

export interface IntegrationAdapter {
  id: string;
  name: string;
  version: string;
  getConfigSchema(): JSONSchema;
  getAuthSchema(): JSONSchema;
  listVariables(): VariableDefinition[];
  listActions(): ActionDefinition[];
  listSignals(): SignalDefinition[];
  readVariable(key: string, fixture: Record<string, unknown>): Promise<VariableValue>;
  prepareAction(input: PreparedActionInput): Promise<PreparedActionResult>;
  commitPreparedAction(input: CommitPreparedActionInput): Promise<ActionResult>;
  healthCheck(): Promise<HealthCheckResult>;
}

export interface StorageAdapter {
  saveRun(trace: LoopRunTrace): Promise<void>;
  getRun(runId: string): Promise<LoopRunTrace | null>;
  saveReview(review: HumanReviewTrace): Promise<void>;
  saveEscalationCase(caseItem: EscalationCase): Promise<void>;
  getEscalationCase(caseId: string): Promise<EscalationCase | null>;
  listRuns(): Promise<Array<{ id: string; loopId: string; status: string }>>;
  listCases(): Promise<Array<{ id: string; sourceLoopId: string; severity: string; status: string }>>;
}
