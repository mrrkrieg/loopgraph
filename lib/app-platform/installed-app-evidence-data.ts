import "server-only";

import type { OutcomeView, ValueEntryView } from "@/lib/loopgraph-runtime/operating-view-data";
import { getOutcomeStore } from "@/lib/loopgraph-runtime/storage-resolver";

export async function getInstalledAppEvidenceData(loopIds: string[]): Promise<{
  outcomes: OutcomeView[];
  valueEntries: ValueEntryView[];
}> {
  if (loopIds.length === 0) return { outcomes: [], valueEntries: [] };
  const store = getOutcomeStore();
  const [outcomeGroups, valueGroups] = await Promise.all([
    Promise.all(loopIds.map((loopId) => store.listObservedOutcomes({ loopId }))),
    Promise.all(loopIds.map((loopId) => store.listValueLedgerEntries({ loopId })))
  ]);
  const outcomes = uniqueById(outcomeGroups.flat()).map((outcome) => ({
    id: outcome.id,
    loopId: outcome.loopId,
    metricKey: outcome.metricKey,
    status: humanize(outcome.status),
    truthStatus: outcome.truthStatus,
    baseline: outcome.baseline?.value,
    observed: outcome.observed?.value,
    relativeDeltaPct: outcome.relativeDeltaPct,
    confidence: outcome.confidence,
    guardrailsPassed: outcome.guardrails.filter((guardrail) => guardrail.passed).length,
    guardrailCount: outcome.guardrails.length,
    missingReasons: outcome.evidenceSufficiency.reasons,
    evaluatedAt: outcome.evaluatedAt
  }));
  const valueEntries = uniqueById(valueGroups.flat()).map((entry) => ({
    id: entry.id,
    loopId: entry.loopId,
    truthStatus: entry.truthStatus,
    grossSavedMinutes: entry.grossSavedMinutes,
    observedCostMinutes: entry.observedCostMinutes,
    netSavedMinutes: entry.netSavedMinutes,
    hiddenCosts: entry.hiddenCostMinutes,
    monetaryValue: entry.monetaryValue
      ? { currency: entry.monetaryValue.currency, netAmount: entry.monetaryValue.netAmount }
      : undefined,
    recordedAt: entry.recordedAt
  }));
  return { outcomes, valueEntries };
}

function uniqueById<T extends { id: string }>(values: T[]): T[] {
  return [...new Map(values.map((value) => [value.id, value])).values()];
}

function humanize(value: string): string {
  return value.replace(/[_-]+/g, " ");
}
