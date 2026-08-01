import { z } from "zod";

export const METRIC_SAMPLE_SCHEMA_VERSION = "metric-sample/v1alpha1" as const;
export const OBSERVED_OUTCOME_SCHEMA_VERSION = "observed-outcome/v1alpha1" as const;
export const VALUE_LEDGER_ENTRY_SCHEMA_VERSION = "value-ledger-entry/v1alpha1" as const;
export const VALUE_CALCULATION_VERSION = "loop-value/v1alpha1" as const;

export const evidenceTruthStatusSchema = z.enum(["observed", "modeled", "incomplete"]);
export const metricSampleSourceTypeSchema = z.enum([
  "integration",
  "trace",
  "human_review",
  "manual",
  "modeled"
]);
export const metricSampleQualityStatusSchema = z.enum([
  "verified",
  "estimated",
  "stale",
  "missing",
  "rejected"
]);
export const outcomeStatusSchema = z.enum([
  "improved",
  "unchanged",
  "regressed",
  "target_met",
  "incomplete"
]);

export const measurementWindowSchema = z.object({
  start: z.string().datetime(),
  end: z.string().datetime()
}).superRefine((window, context) => {
  if (Date.parse(window.end) < Date.parse(window.start)) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Measurement window end must not precede its start",
      path: ["end"]
    });
  }
});

export const metricSampleSchema = z.object({
  schemaVersion: z.literal(METRIC_SAMPLE_SCHEMA_VERSION).default(METRIC_SAMPLE_SCHEMA_VERSION),
  id: z.string().min(1),
  idempotencyKey: z.string().min(1),
  workspaceId: z.string().min(1),
  companyId: z.string().min(1),
  departmentId: z.string().min(1).optional(),
  loopId: z.string().min(1).optional(),
  metricDefinitionId: z.string().min(1),
  metricKey: z.string().min(1),
  value: z.number().finite(),
  unit: z.string().min(1).max(64),
  window: measurementWindowSchema,
  observedAt: z.string().datetime(),
  recordedAt: z.string().datetime(),
  truthStatus: evidenceTruthStatusSchema,
  source: z.object({
    type: metricSampleSourceTypeSchema,
    sourceRef: z.string().min(1).max(512),
    connectorInstanceId: z.string().min(1).optional(),
    runId: z.string().min(1).optional(),
    reviewId: z.string().min(1).optional()
  }),
  quality: z.object({
    status: metricSampleQualityStatusSchema,
    reason: z.string().min(1).max(1000).optional(),
    freshnessDeadline: z.string().datetime().optional()
  }),
  evidenceRefs: z.array(z.string().min(1).max(512)).max(100).default([])
}).superRefine((sample, context) => {
  if (sample.truthStatus === "observed" && ["estimated", "missing", "rejected"].includes(sample.quality.status)) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: "An observed metric sample must have verified or stale source quality",
      path: ["truthStatus"]
    });
  }
  if (sample.truthStatus === "modeled" && sample.source.type !== "modeled") {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: "A modeled metric sample must use the modeled source type",
      path: ["source", "type"]
    });
  }
});

export const observedOutcomeSchema = z.object({
  schemaVersion: z.literal(OBSERVED_OUTCOME_SCHEMA_VERSION).default(OBSERVED_OUTCOME_SCHEMA_VERSION),
  id: z.string().min(1),
  workspaceId: z.string().min(1),
  companyId: z.string().min(1),
  departmentId: z.string().min(1).optional(),
  loopId: z.string().min(1),
  metricDefinitionId: z.string().min(1),
  metricKey: z.string().min(1),
  unit: z.string().min(1).max(64),
  desiredDirection: z.enum(["increase", "decrease", "target", "maintain"]),
  evaluationWindow: measurementWindowSchema,
  baseline: z.object({
    value: z.number().finite(),
    sampleIds: z.array(z.string().min(1)).min(1)
  }).optional(),
  observed: z.object({
    value: z.number().finite(),
    sampleIds: z.array(z.string().min(1)).min(1)
  }).optional(),
  target: z.number().finite().optional(),
  absoluteDelta: z.number().finite().optional(),
  relativeDeltaPct: z.number().finite().optional(),
  status: outcomeStatusSchema,
  truthStatus: evidenceTruthStatusSchema,
  confidence: z.number().min(0).max(1),
  evidenceSufficiency: z.object({
    sufficient: z.boolean(),
    reasons: z.array(z.string().min(1)).default([])
  }),
  guardrails: z.array(z.object({
    metricDefinitionId: z.string().min(1),
    label: z.string().min(1),
    passed: z.boolean(),
    evidenceRefs: z.array(z.string().min(1)).default([])
  })).default([]),
  runIds: z.array(z.string().min(1)).default([]),
  problemIds: z.array(z.string().min(1)).default([]),
  evidenceRefs: z.array(z.string().min(1).max(512)).max(200).default([]),
  evaluatedAt: z.string().datetime()
}).superRefine((outcome, context) => {
  if (outcome.status !== "incomplete" && (!outcome.baseline || !outcome.observed)) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: "A complete observed outcome requires baseline and observed measurements",
      path: ["status"]
    });
  }
  if (outcome.truthStatus === "observed" && !outcome.evidenceSufficiency.sufficient) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: "An observed outcome requires sufficient evidence",
      path: ["truthStatus"]
    });
  }
});

export const valueLedgerEntrySchema = z.object({
  schemaVersion: z.literal(VALUE_LEDGER_ENTRY_SCHEMA_VERSION).default(VALUE_LEDGER_ENTRY_SCHEMA_VERSION),
  id: z.string().min(1),
  workspaceId: z.string().min(1),
  companyId: z.string().min(1),
  departmentId: z.string().min(1).optional(),
  loopId: z.string().min(1),
  window: measurementWindowSchema,
  grossSavedMinutes: z.number().min(0),
  hiddenCostMinutes: z.object({
    review: z.number().min(0).default(0),
    rework: z.number().min(0).default(0),
    botsitting: z.number().min(0).default(0),
    escalation: z.number().min(0).default(0),
    governance: z.number().min(0).default(0)
  }),
  operatingCostMinutes: z.object({
    connectorOperations: z.number().min(0),
    supervision: z.number().min(0),
    organizationalChange: z.number().min(0)
  }).optional(),
  observedCostMinutes: z.number().min(0),
  netSavedMinutes: z.number(),
  monetaryValue: z.object({
    currency: z.string().length(3),
    grossAmount: z.number().min(0),
    observedCostAmount: z.number().min(0),
    netAmount: z.number()
  }).optional(),
  truthStatus: evidenceTruthStatusSchema,
  calculationVersion: z.literal(VALUE_CALCULATION_VERSION).default(VALUE_CALCULATION_VERSION),
  observedOutcomeIds: z.array(z.string().min(1)).default([]),
  runIds: z.array(z.string().min(1)).default([]),
  reviewIds: z.array(z.string().min(1)).default([]),
  evidenceRefs: z.array(z.string().min(1).max(512)).max(200).default([]),
  recordedAt: z.string().datetime()
}).superRefine((entry, context) => {
  const observedCostMinutes = [
    ...Object.values(entry.hiddenCostMinutes),
    ...Object.values(entry.operatingCostMinutes ?? {})
  ].reduce((sum, value) => sum + value, 0);
  if (Math.abs(observedCostMinutes - entry.observedCostMinutes) > 0.000001) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: "observedCostMinutes must equal the sum of hiddenCostMinutes",
      path: ["observedCostMinutes"]
    });
  }
  if (Math.abs(entry.grossSavedMinutes - entry.observedCostMinutes - entry.netSavedMinutes) > 0.000001) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: "netSavedMinutes must equal grossSavedMinutes minus observedCostMinutes",
      path: ["netSavedMinutes"]
    });
  }
  if (entry.truthStatus === "observed" && entry.observedOutcomeIds.length === 0) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Observed value requires at least one observed outcome",
      path: ["observedOutcomeIds"]
    });
  }
});

export type EvidenceTruthStatus = z.infer<typeof evidenceTruthStatusSchema>;
export type MetricSampleSourceType = z.infer<typeof metricSampleSourceTypeSchema>;
export type MetricSampleQualityStatus = z.infer<typeof metricSampleQualityStatusSchema>;
export type OutcomeStatus = z.infer<typeof outcomeStatusSchema>;
export type MeasurementWindow = z.infer<typeof measurementWindowSchema>;
export type MetricSample = z.infer<typeof metricSampleSchema>;
export type ObservedOutcome = z.infer<typeof observedOutcomeSchema>;
export type ValueLedgerEntry = z.infer<typeof valueLedgerEntrySchema>;
