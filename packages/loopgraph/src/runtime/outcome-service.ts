import {
  METRIC_SAMPLE_SCHEMA_VERSION,
  OBSERVED_OUTCOME_SCHEMA_VERSION,
  VALUE_CALCULATION_VERSION,
  VALUE_LEDGER_ENTRY_SCHEMA_VERSION,
  contentHash,
  metricSampleSchema,
  observedOutcomeSchema,
  valueLedgerEntrySchema,
  type EvidenceTruthStatus,
  type LoopRunTrace,
  type MetricDefinition,
  type MetricSample,
  type ObservedOutcome,
  type ValueLedgerEntry
} from "../core";
import type { OutcomeStore, OutcomeStoreSaveResult } from "./outcome-store";

export type RecordMetricSampleInput = Omit<
  MetricSample,
  "schemaVersion" | "id" | "idempotencyKey" | "recordedAt" | "truthStatus"
> & {
  truthStatus?: EvidenceTruthStatus;
  recordedAt?: string;
};

export async function recordMetricSample(
  store: OutcomeStore,
  input: RecordMetricSampleInput,
  now = new Date()
): Promise<OutcomeStoreSaveResult<MetricSample>> {
  const truthStatus = input.truthStatus ?? inferSampleTruthStatus(input);
  const identity = {
    workspaceId: input.workspaceId,
    companyId: input.companyId,
    loopId: input.loopId,
    metricDefinitionId: input.metricDefinitionId,
    sourceType: input.source.type,
    sourceRef: input.source.sourceRef,
    window: input.window
  };
  const idempotencyKey = `metric_sample_${contentHash(identity)}`;
  const sample = metricSampleSchema.parse({
    ...input,
    schemaVersion: METRIC_SAMPLE_SCHEMA_VERSION,
    id: `sample_${contentHash({ idempotencyKey })}`,
    idempotencyKey,
    truthStatus,
    evidenceRefs: unique(input.evidenceRefs),
    recordedAt: input.recordedAt ?? now.toISOString()
  });
  return store.saveMetricSample(sample);
}

export async function recordTraceMetricSamples(input: {
  store: OutcomeStore;
  workspaceId: string;
  companyId: string;
  trace: LoopRunTrace;
  metricDefinitions: MetricDefinition[];
  now?: Date;
}): Promise<Array<OutcomeStoreSaveResult<MetricSample>>> {
  const completedAt = input.trace.completedAt ?? input.trace.startedAt;
  const results: Array<OutcomeStoreSaveResult<MetricSample>> = [];
  for (const metric of input.trace.metrics) {
    const definition = input.metricDefinitions.find((candidate) =>
      candidate.key === metric.name &&
      (!candidate.loopId || candidate.loopId === input.trace.loopId)
    );
    if (!definition) continue;
    results.push(await recordMetricSample(input.store, {
      workspaceId: input.workspaceId,
      companyId: input.companyId,
      departmentId: definition.departmentId,
      loopId: input.trace.loopId,
      metricDefinitionId: definition.id,
      metricKey: definition.key,
      value: metric.value,
      unit: metric.unit ?? definition.unit ?? defaultMetricUnit(definition.type),
      window: {
        start: input.trace.startedAt,
        end: completedAt
      },
      observedAt: completedAt,
      source: {
        type: "trace",
        sourceRef: `trace:${input.trace.id}:metric:${metric.name}`,
        runId: input.trace.id
      },
      quality: metric.observed
        ? { status: "verified" }
        : { status: "estimated", reason: "The run emitted this metric without marking it observed." },
      truthStatus: metric.observed ? "observed" : "incomplete",
      evidenceRefs: [`trace:${input.trace.id}`]
    }, input.now));
  }
  return results;
}

export async function evaluateObservedOutcome(input: {
  store: OutcomeStore;
  workspaceId: string;
  companyId: string;
  departmentId?: string;
  loopId: string;
  metricDefinition: MetricDefinition;
  baselineWindow: { start: string; end: string };
  evaluationWindow: { start: string; end: string };
  desiredDirection?: "increase" | "decrease" | "target" | "maintain";
  minimumBaselineSamples?: number;
  minimumObservedSamples?: number;
  tolerancePct?: number;
  guardrails?: ObservedOutcome["guardrails"];
  runIds?: string[];
  problemIds?: string[];
  now?: Date;
}): Promise<OutcomeStoreSaveResult<ObservedOutcome>> {
  const desiredDirection = input.desiredDirection ??
    input.metricDefinition.desiredDirection ??
    (input.metricDefinition.target === undefined ? "increase" : "target");
  const baselineSamples = usableSamples(await input.store.listMetricSamples({
    workspaceId: input.workspaceId,
    companyId: input.companyId,
    loopId: input.loopId,
    metricDefinitionId: input.metricDefinition.id,
    windowStart: input.baselineWindow.start,
    windowEnd: input.baselineWindow.end
  }), input.baselineWindow);
  const observedSamples = usableSamples(await input.store.listMetricSamples({
    workspaceId: input.workspaceId,
    companyId: input.companyId,
    loopId: input.loopId,
    metricDefinitionId: input.metricDefinition.id,
    windowStart: input.evaluationWindow.start,
    windowEnd: input.evaluationWindow.end
  }), input.evaluationWindow);
  const minimumBaselineSamples = input.minimumBaselineSamples ?? 1;
  const minimumObservedSamples = input.minimumObservedSamples ?? 1;
  const reasons: string[] = [];
  if (baselineSamples.length < minimumBaselineSamples) {
    reasons.push(`Need ${minimumBaselineSamples} baseline sample(s); found ${baselineSamples.length}.`);
  }
  if (observedSamples.length < minimumObservedSamples) {
    reasons.push(`Need ${minimumObservedSamples} observed sample(s); found ${observedSamples.length}.`);
  }
  const baselineValue = average(baselineSamples);
  const observedValue = average(observedSamples);
  const sufficient = reasons.length === 0 && baselineValue !== undefined && observedValue !== undefined;
  const truthStatus = outcomeTruthStatus(baselineSamples, observedSamples, sufficient);
  const absoluteDelta = sufficient ? observedValue - baselineValue : undefined;
  const relativeDeltaPct = sufficient && absoluteDelta !== undefined && baselineValue !== 0
    ? (absoluteDelta / Math.abs(baselineValue)) * 100
    : undefined;
  const status = sufficient
    ? classifyOutcome({
        baselineValue,
        observedValue,
        desiredDirection,
        target: input.metricDefinition.target,
        tolerancePct: input.tolerancePct ?? 1
      })
    : "incomplete";
  const identity = {
    workspaceId: input.workspaceId,
    companyId: input.companyId,
    loopId: input.loopId,
    metricDefinitionId: input.metricDefinition.id,
    evaluationWindow: input.evaluationWindow,
    baselineSampleIds: baselineSamples.map((sample) => sample.id).sort(),
    observedSampleIds: observedSamples.map((sample) => sample.id).sort()
  };
  const outcome = observedOutcomeSchema.parse({
    schemaVersion: OBSERVED_OUTCOME_SCHEMA_VERSION,
    id: `outcome_${contentHash(identity)}`,
    workspaceId: input.workspaceId,
    companyId: input.companyId,
    departmentId: input.departmentId ?? input.metricDefinition.departmentId,
    loopId: input.loopId,
    metricDefinitionId: input.metricDefinition.id,
    metricKey: input.metricDefinition.key,
    unit: input.metricDefinition.unit ?? observedSamples[0]?.unit ?? baselineSamples[0]?.unit ?? defaultMetricUnit(input.metricDefinition.type),
    desiredDirection,
    evaluationWindow: input.evaluationWindow,
    baseline: baselineValue === undefined ? undefined : {
      value: baselineValue,
      sampleIds: baselineSamples.map((sample) => sample.id).sort()
    },
    observed: observedValue === undefined ? undefined : {
      value: observedValue,
      sampleIds: observedSamples.map((sample) => sample.id).sort()
    },
    target: input.metricDefinition.target,
    absoluteDelta,
    relativeDeltaPct,
    status,
    truthStatus,
    confidence: sufficient
      ? round(Math.min(1, Math.min(baselineSamples.length / minimumBaselineSamples, observedSamples.length / minimumObservedSamples)))
      : 0,
    evidenceSufficiency: { sufficient, reasons },
    guardrails: input.guardrails ?? [],
    runIds: unique(input.runIds),
    problemIds: unique(input.problemIds),
    evidenceRefs: unique([
      ...baselineSamples.map((sample) => `metric_sample:${sample.id}`),
      ...observedSamples.map((sample) => `metric_sample:${sample.id}`)
    ]),
    evaluatedAt: (input.now ?? new Date()).toISOString()
  });
  return input.store.saveObservedOutcome(outcome);
}

export async function recordValueLedgerEntry(input: {
  store: OutcomeStore;
  workspaceId: string;
  companyId: string;
  departmentId?: string;
  loopId: string;
  window: { start: string; end: string };
  grossSavedMinutes?: number;
  modeledGrossSavedMinutes?: number;
  hiddenCostMinutes?: Partial<ValueLedgerEntry["hiddenCostMinutes"]>;
  observedOutcomeIds?: string[];
  runIds?: string[];
  reviewIds?: string[];
  evidenceRefs?: string[];
  monetaryValue?: {
    currency: string;
    grossAmount: number;
    observedCostAmount: number;
  };
  now?: Date;
}): Promise<OutcomeStoreSaveResult<ValueLedgerEntry>> {
  const outcomeIds = unique(input.observedOutcomeIds);
  const outcomes = (await Promise.all(outcomeIds.map((id) => input.store.getObservedOutcome(id))))
    .filter((outcome): outcome is ObservedOutcome => Boolean(outcome));
  if (outcomes.length !== outcomeIds.length) {
    throw new Error("Value ledger entry references an observed outcome that does not exist");
  }
  const hiddenCostMinutes = {
    review: input.hiddenCostMinutes?.review ?? 0,
    rework: input.hiddenCostMinutes?.rework ?? 0,
    botsitting: input.hiddenCostMinutes?.botsitting ?? 0,
    escalation: input.hiddenCostMinutes?.escalation ?? 0,
    governance: input.hiddenCostMinutes?.governance ?? 0
  };
  const observedCostMinutes = Object.values(hiddenCostMinutes).reduce((sum, value) => sum + value, 0);
  const grossSavedMinutes = input.grossSavedMinutes ?? input.modeledGrossSavedMinutes ?? 0;
  const truthStatus = valueTruthStatus({
    hasObservedGrossValue: input.grossSavedMinutes !== undefined,
    hasModeledGrossValue: input.modeledGrossSavedMinutes !== undefined,
    outcomes
  });
  const identity = {
    workspaceId: input.workspaceId,
    companyId: input.companyId,
    loopId: input.loopId,
    window: input.window,
    outcomeIds,
    runIds: unique(input.runIds)
  };
  const entry = valueLedgerEntrySchema.parse({
    schemaVersion: VALUE_LEDGER_ENTRY_SCHEMA_VERSION,
    id: `value_${contentHash(identity)}`,
    workspaceId: input.workspaceId,
    companyId: input.companyId,
    departmentId: input.departmentId,
    loopId: input.loopId,
    window: input.window,
    grossSavedMinutes,
    hiddenCostMinutes,
    observedCostMinutes,
    netSavedMinutes: grossSavedMinutes - observedCostMinutes,
    monetaryValue: input.monetaryValue ? {
      currency: input.monetaryValue.currency.toUpperCase(),
      grossAmount: input.monetaryValue.grossAmount,
      observedCostAmount: input.monetaryValue.observedCostAmount,
      netAmount: input.monetaryValue.grossAmount - input.monetaryValue.observedCostAmount
    } : undefined,
    truthStatus,
    calculationVersion: VALUE_CALCULATION_VERSION,
    observedOutcomeIds: outcomeIds,
    runIds: unique(input.runIds),
    reviewIds: unique(input.reviewIds),
    evidenceRefs: unique(input.evidenceRefs),
    recordedAt: (input.now ?? new Date()).toISOString()
  });
  return input.store.saveValueLedgerEntry(entry);
}

export async function deriveLoopValueLedgerEntry(input: {
  store: OutcomeStore;
  workspaceId: string;
  companyId: string;
  departmentId?: string;
  loopId: string;
  metricDefinition: MetricDefinition;
  outcomeId: string;
  traces: LoopRunTrace[];
  window: { start: string; end: string };
  now?: Date;
}): Promise<OutcomeStoreSaveResult<ValueLedgerEntry>> {
  const outcome = await input.store.getObservedOutcome(input.outcomeId);
  if (!outcome) throw new Error(`Observed outcome not found: ${input.outcomeId}`);
  if (outcome.loopId !== input.loopId || outcome.metricDefinitionId !== input.metricDefinition.id) {
    throw new Error("Observed outcome does not belong to the requested loop and metric");
  }
  const improvementUnits = beneficialImprovementUnits(outcome);
  const grossSavedMinutes = outcome.truthStatus === "observed" && input.metricDefinition.valuePerUnitMinutes !== undefined
    ? improvementUnits * input.metricDefinition.valuePerUnitMinutes
    : undefined;
  const modeledGrossSavedMinutes = outcome.truthStatus !== "incomplete" && grossSavedMinutes === undefined &&
    input.metricDefinition.valuePerUnitMinutes !== undefined
    ? improvementUnits * input.metricDefinition.valuePerUnitMinutes
    : undefined;
  const reviews = input.traces.flatMap((trace) => trace.humanReviews);
  const hiddenCostMinutes = {
    review: sum(reviews.map((review) => review.reviewMinutes ?? 0)),
    rework: sum(reviews.map((review) => review.reworkMinutes ?? 0)),
    botsitting: sum(reviews.map((review) => review.botsittingMinutes ?? 0)),
    escalation: sum(reviews.map((review) => review.escalationMinutes ?? 0)),
    governance: sum(reviews.map((review) => review.governanceMinutes ?? 0))
  };
  const monetaryGrossAmount = input.metricDefinition.valuePerUnitAmount === undefined
    ? undefined
    : improvementUnits * input.metricDefinition.valuePerUnitAmount;
  return recordValueLedgerEntry({
    store: input.store,
    workspaceId: input.workspaceId,
    companyId: input.companyId,
    departmentId: input.departmentId ?? input.metricDefinition.departmentId,
    loopId: input.loopId,
    window: input.window,
    grossSavedMinutes,
    modeledGrossSavedMinutes,
    hiddenCostMinutes,
    observedOutcomeIds: [outcome.id],
    runIds: input.traces.map((trace) => trace.id),
    reviewIds: reviews.map((review) => review.id),
    evidenceRefs: [
      `observed_outcome:${outcome.id}`,
      ...input.traces.map((trace) => `trace:${trace.id}`)
    ],
    monetaryValue: monetaryGrossAmount === undefined || !input.metricDefinition.valueCurrency
      ? undefined
      : {
          currency: input.metricDefinition.valueCurrency,
          grossAmount: monetaryGrossAmount,
          observedCostAmount: 0
        },
    now: input.now
  });
}

function inferSampleTruthStatus(input: RecordMetricSampleInput): EvidenceTruthStatus {
  if (input.source.type === "modeled") return "modeled";
  if (["missing", "rejected", "estimated"].includes(input.quality.status)) return "incomplete";
  return "observed";
}

function usableSamples(samples: MetricSample[], window: { start: string; end: string }): MetricSample[] {
  return samples
    .filter((sample) => sample.window.end >= window.start && sample.window.start <= window.end)
    .filter((sample) => !["missing", "rejected"].includes(sample.quality.status));
}

function average(samples: MetricSample[]): number | undefined {
  if (samples.length === 0) return undefined;
  return sum(samples.map((sample) => sample.value)) / samples.length;
}

function outcomeTruthStatus(
  baselineSamples: MetricSample[],
  observedSamples: MetricSample[],
  sufficient: boolean
): EvidenceTruthStatus {
  if (!sufficient) return "incomplete";
  const samples = [...baselineSamples, ...observedSamples];
  if (samples.some((sample) => sample.truthStatus === "incomplete" || sample.quality.status === "stale")) {
    return "incomplete";
  }
  if (samples.some((sample) => sample.truthStatus === "modeled")) return "modeled";
  return "observed";
}

function classifyOutcome(input: {
  baselineValue: number;
  observedValue: number;
  desiredDirection: ObservedOutcome["desiredDirection"];
  target?: number;
  tolerancePct: number;
}): ObservedOutcome["status"] {
  if (input.target !== undefined) {
    const targetMet = input.desiredDirection === "decrease"
      ? input.observedValue <= input.target
      : input.desiredDirection === "maintain"
        ? Math.abs(input.observedValue - input.target) <= tolerance(input.target, input.tolerancePct)
        : input.observedValue >= input.target;
    if (targetMet) return "target_met";
  }
  const delta = input.observedValue - input.baselineValue;
  const meaningful = tolerance(input.baselineValue, input.tolerancePct);
  if (Math.abs(delta) <= meaningful) return "unchanged";
  if (input.desiredDirection === "decrease") return delta < 0 ? "improved" : "regressed";
  if (input.desiredDirection === "maintain") return "regressed";
  return delta > 0 ? "improved" : "regressed";
}

function valueTruthStatus(input: {
  hasObservedGrossValue: boolean;
  hasModeledGrossValue: boolean;
  outcomes: ObservedOutcome[];
}): EvidenceTruthStatus {
  if (
    input.hasObservedGrossValue &&
    input.outcomes.length > 0 &&
    input.outcomes.every((outcome) => outcome.truthStatus === "observed")
  ) {
    return "observed";
  }
  if (
    (input.hasModeledGrossValue || input.hasObservedGrossValue) &&
    input.outcomes.length > 0 &&
    input.outcomes.every((outcome) => outcome.truthStatus !== "incomplete")
  ) {
    return "modeled";
  }
  return "incomplete";
}

function beneficialImprovementUnits(outcome: ObservedOutcome): number {
  if (outcome.status === "incomplete" || outcome.status === "regressed" || outcome.status === "unchanged") return 0;
  const delta = outcome.absoluteDelta ?? 0;
  return outcome.desiredDirection === "decrease" ? Math.max(0, -delta) : Math.max(0, delta);
}

function tolerance(value: number, tolerancePct: number) {
  return Math.max(Number.EPSILON, Math.abs(value) * (Math.max(0, tolerancePct) / 100));
}

function defaultMetricUnit(type: MetricDefinition["type"]): string {
  if (type === "duration") return "minutes";
  if (type === "currency") return "currency";
  if (type === "rate") return "percent";
  if (type === "boolean") return "boolean";
  return "count";
}

function unique(values: Array<string | undefined> | undefined): string[] {
  return Array.from(new Set((values ?? []).filter((value): value is string => Boolean(value)))).sort();
}

function sum(values: number[]): number {
  return values.reduce((total, value) => total + value, 0);
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}
