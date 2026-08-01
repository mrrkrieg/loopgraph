import { z } from "zod";
import { contentHash } from "./hash";
import { measurementWindowSchema, metricSampleQualityStatusSchema } from "./outcome";

export const METRIC_BINDING_SCHEMA_VERSION = "metric-binding/v1alpha1" as const;
export const METRIC_BINDINGS_FILE_SCHEMA_VERSION = "metric-bindings-file/v1alpha1" as const;
export const MEASUREMENT_JOB_SCHEMA_VERSION = "measurement-job/v1alpha1" as const;
export const CONNECTION_RECONCILIATION_SCHEMA_VERSION = "connection-reconciliation/v1alpha1" as const;

const filterValueSchema = z.union([
  z.string(),
  z.number().finite(),
  z.boolean(),
  z.array(z.union([z.string(), z.number().finite(), z.boolean()]))
]);

export const metricBindingRoleSchema = z.enum(["primary", "leading", "guardrail"]);
export const metricAggregationSchema = z.enum([
  "count",
  "sum",
  "average",
  "minimum",
  "maximum",
  "rate",
  "latest"
]);

export const metricGuardrailSchema = z.object({
  comparator: z.enum(["at_least", "at_most", "max_regression_pct", "min_improvement_pct"]),
  threshold: z.number().finite(),
  severity: z.enum(["warning", "blocking"]).default("blocking")
});

export const metricProviderQuerySchema = z.object({
  resource: z.string().min(1).max(200),
  fieldPath: z.string().min(1).max(500),
  timestampField: z.string().min(1).max(500),
  aggregation: metricAggregationSchema,
  filters: z.record(z.string(), filterValueSchema).default({}),
  groupBy: z.array(z.string().min(1).max(500)).max(10).default([])
});

export const metricBindingSchema = z.object({
  schemaVersion: z.literal(METRIC_BINDING_SCHEMA_VERSION).default(METRIC_BINDING_SCHEMA_VERSION),
  id: z.string().min(1),
  projectRootId: z.string().min(1),
  metricDefinitionId: z.string().min(1),
  metricKey: z.string().min(1),
  loopId: z.string().min(1),
  role: metricBindingRoleSchema,
  connectorInstanceId: z.string().min(1),
  capabilityKey: z.string().min(1),
  query: metricProviderQuerySchema,
  unit: z.string().min(1).max(64),
  schedule: z.object({
    cadenceSeconds: z.number().int().min(300).max(2_592_000),
    windowSeconds: z.number().int().min(60).max(31_536_000),
    lagSeconds: z.number().int().min(0).max(604_800).default(0)
  }),
  guardrail: metricGuardrailSchema.optional(),
  enabled: z.boolean().default(true),
  revision: z.number().int().min(1).default(1),
  createdBy: z.string().min(1),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime()
}).superRefine((binding, context) => {
  if (binding.role === "guardrail" && !binding.guardrail) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["guardrail"],
      message: "Guardrail metric bindings require a guardrail threshold"
    });
  }
  if (binding.role !== "guardrail" && binding.guardrail) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["guardrail"],
      message: "Only guardrail metric bindings may define a guardrail threshold"
    });
  }
});

export const metricBindingsFileSchema = z.object({
  schemaVersion: z.literal(METRIC_BINDINGS_FILE_SCHEMA_VERSION).default(METRIC_BINDINGS_FILE_SCHEMA_VERSION),
  bindings: z.array(metricBindingSchema).default([])
});

export const measurementJobSchema = z.object({
  schemaVersion: z.literal(MEASUREMENT_JOB_SCHEMA_VERSION).default(MEASUREMENT_JOB_SCHEMA_VERSION),
  id: z.string().min(1),
  idempotencyKey: z.string().min(1),
  projectRootId: z.string().min(1),
  bindingId: z.string().min(1),
  bindingHash: z.string().min(1),
  metricDefinitionId: z.string().min(1),
  metricKey: z.string().min(1),
  loopId: z.string().min(1),
  connectorInstanceId: z.string().min(1),
  capabilityKey: z.string().min(1),
  query: metricProviderQuerySchema,
  unit: z.string().min(1).max(64),
  window: measurementWindowSchema,
  dueAt: z.string().datetime(),
  status: z.enum(["pending", "claimed", "completed", "failed", "dead_letter", "cancelled"]),
  attemptCount: z.number().int().min(0).default(0),
  maxAttempts: z.number().int().min(1).max(20).default(3),
  lease: z.object({
    claimedBy: z.string().min(1),
    tokenHash: z.string().min(1),
    claimedAt: z.string().datetime(),
    expiresAt: z.string().datetime()
  }).optional(),
  result: z.object({
    metricSampleId: z.string().min(1),
    value: z.number().finite(),
    observedAt: z.string().datetime(),
    qualityStatus: metricSampleQualityStatusSchema,
    evidenceRefs: z.array(z.string().min(1)).min(1),
    completedAt: z.string().datetime()
  }).optional(),
  error: z.object({
    code: z.string().min(1),
    message: z.string().min(1),
    retryable: z.boolean(),
    failedAt: z.string().datetime()
  }).optional(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime()
});

export const connectionReconciliationIssueSchema = z.object({
  id: z.string().min(1),
  severity: z.enum(["info", "warning", "blocking"]),
  kind: z.enum([
    "missing_connection",
    "connection_degraded",
    "health_stale",
    "missing_capability",
    "missing_scope",
    "metric_binding_invalid",
    "webhook_manifest_missing",
    "webhook_manifest_stale",
    "measurement_overdue"
  ]),
  connectionInstanceId: z.string().min(1).optional(),
  bindingId: z.string().min(1).optional(),
  loopId: z.string().min(1).optional(),
  summary: z.string().min(1),
  repairAction: z.string().min(1),
  evidenceRefs: z.array(z.string().min(1)).default([])
});

export const connectionReconciliationReportSchema = z.object({
  schemaVersion: z.literal(CONNECTION_RECONCILIATION_SCHEMA_VERSION)
    .default(CONNECTION_RECONCILIATION_SCHEMA_VERSION),
  id: z.string().min(1),
  projectRootId: z.string().min(1),
  status: z.enum(["healthy", "degraded", "blocked"]),
  connectionPlanHash: z.string().min(1),
  metricBindingsHash: z.string().min(1),
  webhookCatalogVersion: z.string().min(1),
  webhookManifestOk: z.boolean(),
  checkedConnectionIds: z.array(z.string().min(1)).default([]),
  checkedBindingIds: z.array(z.string().min(1)).default([]),
  issues: z.array(connectionReconciliationIssueSchema).default([]),
  checkedAt: z.string().datetime()
});

export type MetricBindingRole = z.infer<typeof metricBindingRoleSchema>;
export type MetricAggregation = z.infer<typeof metricAggregationSchema>;
export type MetricGuardrail = z.infer<typeof metricGuardrailSchema>;
export type MetricBinding = z.infer<typeof metricBindingSchema>;
export type MetricBindingsFile = z.infer<typeof metricBindingsFileSchema>;
export type MeasurementJob = z.infer<typeof measurementJobSchema>;
export type ConnectionReconciliationIssue = z.infer<typeof connectionReconciliationIssueSchema>;
export type ConnectionReconciliationReport = z.infer<typeof connectionReconciliationReportSchema>;

export type HiddenLaborInput = {
  reviewMinutes?: number;
  reworkMinutes?: number;
  botsittingMinutes?: number;
  escalationMinutes?: number;
  governanceMinutes?: number;
  grossSavedMinutes?: number;
};

export type NetSavingsResult = {
  grossSavedMinutes: number;
  observedCostMinutes: number;
  netSavedMinutes: number;
  labels: {
    grossSaved: "modeled_estimate" | "observed";
    review: "observed";
    rework: "observed";
    botsitting: "observed";
    escalation: "observed";
    governance: "observed";
  };
};

export function calculateNetSavings(input: HiddenLaborInput): NetSavingsResult {
  const grossSavedMinutes = input.grossSavedMinutes ?? 0;
  const reviewMinutes = input.reviewMinutes ?? 0;
  const reworkMinutes = input.reworkMinutes ?? 0;
  const botsittingMinutes = input.botsittingMinutes ?? 0;
  const escalationMinutes = input.escalationMinutes ?? 0;
  const governanceMinutes = input.governanceMinutes ?? 0;
  const observedCostMinutes =
    reviewMinutes + reworkMinutes + botsittingMinutes + escalationMinutes + governanceMinutes;

  return {
    grossSavedMinutes,
    observedCostMinutes,
    netSavedMinutes: grossSavedMinutes - observedCostMinutes,
    labels: {
      grossSaved: input.grossSavedMinutes === undefined ? "modeled_estimate" : "observed",
      review: "observed",
      rework: "observed",
      botsitting: "observed",
      escalation: "observed",
      governance: "observed"
    }
  };
}

export function scoreLoopHealth(netSavedMinutes: number) {
  if (netSavedMinutes >= 120) return "Excellent";
  if (netSavedMinutes >= 30) return "Good";
  if (netSavedMinutes >= 0) return "Marginal";
  return "Negative net value";
}

export function metricBindingHash(binding: MetricBinding): string {
  return contentHash({
    ...binding,
    createdAt: undefined,
    updatedAt: undefined
  });
}
