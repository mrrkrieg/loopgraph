import type { EscalationCase } from "../core/escalation";
import type { StorageAdapter } from "../sdk/adapters";

export type CaseStatus = EscalationCase["status"];

export async function listEscalationCases(storage: StorageAdapter) {
  return storage.listCases();
}

export async function transitionCaseStatus(
  storage: StorageAdapter,
  caseId: string,
  status: CaseStatus,
  outcome?: EscalationCase["outcome"]
) {
  const caseItem = await storage.getEscalationCase(caseId);
  if (!caseItem) throw new Error(`Case not found: ${caseId}`);

  const updated: EscalationCase = {
    ...caseItem,
    status,
    outcome: outcome ?? caseItem.outcome
  };

  await storage.saveEscalationCase(updated);
  return updated;
}

async function writeCaseOutcomeToTrace(
  storage: StorageAdapter,
  caseItem: EscalationCase,
  outcome: NonNullable<EscalationCase["outcome"]>
) {
  const trace = await storage.getRun(caseItem.sourceRunId);
  if (!trace) {
    return;
  }

  trace.outputs = [
    ...trace.outputs.filter((output) => output.id !== `case_outcome_${caseItem.id}`),
    {
      id: `case_outcome_${caseItem.id}`,
      type: "case_outcome",
      content: {
        caseId: caseItem.id,
        status: caseItem.status,
        outcome
      }
    },
    {
      id: `improvement_case_${caseItem.id}`,
      type: "improvement_signal",
      content: {
        loopId: trace.loopId,
        sourceRunId: trace.id,
        title: `Case resolved: ${caseItem.summary}`,
        description: outcome.resolutionSummary,
        failureMode: "case_resolved",
        teacherFeedback: outcome.businessResult
      }
    }
  ];

  await storage.saveRun(trace);
}

export async function resolveCase(
  storage: StorageAdapter,
  caseId: string,
  outcome: NonNullable<EscalationCase["outcome"]>
) {
  const updated = await transitionCaseStatus(storage, caseId, "resolved", outcome);
  await writeCaseOutcomeToTrace(storage, updated, outcome);
  return updated;
}
