import path from "node:path";
import { z } from "zod";
import {
  metricAggregationSchema,
  metricBindingRoleSchema,
  metricGuardrailSchema
} from "../core";
import {
  claimMeasurementJobs,
  completeMeasurementJob,
  failMeasurementJob,
  reconcileConnectionsAndMeasurements,
  scheduleDueMeasurements,
  upsertMetricBinding
} from "./measurement-service";
import { FileMeasurementStore } from "./measurement-store";
import { getLoopgraphRoot } from "./storage-resolver";

export const LOOPGRAPH_MEASUREMENT_TOOL_NAMES = [
  "loopgraph_metric_bindings_set",
  "loopgraph_metric_bindings_get",
  "loopgraph_measurements_schedule",
  "loopgraph_measurement_jobs_claim",
  "loopgraph_measurement_jobs_complete",
  "loopgraph_measurement_jobs_fail",
  "loopgraph_measurement_jobs_get",
  "loopgraph_connections_reconcile",
  "loopgraph_connections_reconciliations_get"
] as const;

export type LoopgraphMeasurementToolName = (typeof LOOPGRAPH_MEASUREMENT_TOOL_NAMES)[number];

export type LoopgraphMeasurementToolRuntimeOptions = {
  projectRoot?: string;
  now?: Date;
};

const projectRootSchema = z.string().optional();

export const metricBindingsSetInputSchema = z.object({
  projectRoot: projectRootSchema,
  id: z.string().min(1).optional(),
  metricDefinitionId: z.string().min(1),
  metricKey: z.string().min(1),
  loopId: z.string().min(1),
  role: metricBindingRoleSchema,
  connectorInstanceId: z.string().min(1),
  capabilityKey: z.string().min(1),
  query: z.object({
    resource: z.string().min(1).max(200),
    fieldPath: z.string().min(1).max(500),
    timestampField: z.string().min(1).max(500),
    aggregation: metricAggregationSchema,
    filters: z.record(
      z.string(),
      z.union([
        z.string(),
        z.number().finite(),
        z.boolean(),
        z.array(z.union([z.string(), z.number().finite(), z.boolean()]))
      ])
    ).default({}),
    groupBy: z.array(z.string().min(1).max(500)).max(10).default([])
  }),
  unit: z.string().min(1).max(64),
  schedule: z.object({
    cadenceSeconds: z.number().int().min(300).max(2_592_000),
    windowSeconds: z.number().int().min(60).max(31_536_000),
    lagSeconds: z.number().int().min(0).max(604_800).default(0)
  }),
  guardrail: metricGuardrailSchema.optional(),
  enabled: z.boolean().default(true),
  createdBy: z.string().min(1).max(200),
  expectedRevision: z.number().int().min(0).optional()
});

export const metricBindingsGetInputSchema = z.object({
  projectRoot: projectRootSchema,
  bindingId: z.string().min(1).optional(),
  loopId: z.string().min(1).optional()
}).default({});

export const measurementsScheduleInputSchema = z.object({
  projectRoot: projectRootSchema,
  bindingId: z.string().min(1).optional(),
  backfillWindows: z.number().int().min(1).max(100).default(1),
  maxAttempts: z.number().int().min(1).max(20).default(3)
}).default({});

export const measurementJobsClaimInputSchema = z.object({
  projectRoot: projectRootSchema,
  claimedBy: z.string().min(1).max(200),
  limit: z.number().int().min(1).max(100).default(20),
  leaseSeconds: z.number().int().min(30).max(3600).default(300),
  connectionInstanceId: z.string().min(1).optional()
});

export const measurementJobsCompleteInputSchema = z.object({
  projectRoot: projectRootSchema,
  jobId: z.string().min(1),
  leaseToken: z.string().uuid(),
  value: z.number().finite(),
  observedAt: z.string().datetime(),
  qualityStatus: z.enum(["verified", "estimated", "stale"]).default("verified"),
  qualityReason: z.string().min(1).max(1000).optional(),
  evidenceRefs: z.array(z.string().min(1).max(512)).min(1).max(100)
});

export const measurementJobsFailInputSchema = z.object({
  projectRoot: projectRootSchema,
  jobId: z.string().min(1),
  leaseToken: z.string().uuid(),
  code: z.string().min(1).max(200),
  message: z.string().min(1).max(2000),
  retryable: z.boolean().default(true)
});

export const measurementJobsGetInputSchema = z.object({
  projectRoot: projectRootSchema,
  jobId: z.string().min(1).optional(),
  bindingId: z.string().min(1).optional(),
  loopId: z.string().min(1).optional(),
  connectionInstanceId: z.string().min(1).optional(),
  status: z.enum(["pending", "claimed", "completed", "failed", "dead_letter", "cancelled"]).optional(),
  dueBefore: z.string().datetime().optional()
}).default({});

export const connectionsReconcileInputSchema = z.object({
  projectRoot: projectRootSchema,
  healthStaleAfterHours: z.number().int().min(1).max(8760).default(24),
  measurementOverdueAfterHours: z.number().int().min(1).max(8760).default(24)
}).default({});

export const connectionReconciliationsGetInputSchema = z.object({
  projectRoot: projectRootSchema,
  reportId: z.string().min(1).optional()
}).default({});

export const loopgraphMeasurementToolDefinitions = [
  {
    name: "loopgraph_metric_bindings_set",
    description: "Bind a LoopSpec metric to one exact Hermes connector query, schedule, and optional guardrail.",
    readOnly: false,
    idempotent: true
  },
  {
    name: "loopgraph_metric_bindings_get",
    description: "Read exact provider metric bindings for registered loops.",
    readOnly: true,
    idempotent: true
  },
  {
    name: "loopgraph_measurements_schedule",
    description: "Create idempotent due measurement jobs from enabled metric bindings.",
    readOnly: false,
    idempotent: true
  },
  {
    name: "loopgraph_measurement_jobs_claim",
    description: "Claim due measurement jobs with short-lived opaque leases for a trusted Hermes collector.",
    readOnly: false,
    idempotent: false
  },
  {
    name: "loopgraph_measurement_jobs_complete",
    description: "Complete a leased measurement job with a provider value and durable evidence references.",
    readOnly: false,
    idempotent: true
  },
  {
    name: "loopgraph_measurement_jobs_fail",
    description: "Return a leased measurement job for retry or move it to dead letter without hiding the failure.",
    readOnly: false,
    idempotent: true
  },
  {
    name: "loopgraph_measurement_jobs_get",
    description: "Inspect scheduled measurement work, leases, results, and failures.",
    readOnly: true,
    idempotent: true
  },
  {
    name: "loopgraph_connections_reconcile",
    description: "Reconcile connector health, scopes, capabilities, Hermes webhook routes, and overdue measurements.",
    readOnly: false,
    idempotent: true
  },
  {
    name: "loopgraph_connections_reconciliations_get",
    description: "Read durable connection and measurement reconciliation reports.",
    readOnly: true,
    idempotent: true
  }
] satisfies Array<{
  name: LoopgraphMeasurementToolName;
  description: string;
  readOnly: boolean;
  idempotent: boolean;
}>;

export async function callLoopgraphMeasurementTool(
  name: LoopgraphMeasurementToolName,
  input: unknown,
  options: LoopgraphMeasurementToolRuntimeOptions = {}
) {
  const optionRoot = path.resolve(options.projectRoot ?? process.cwd());

  if (name === "loopgraph_metric_bindings_set") {
    const parsed = metricBindingsSetInputSchema.parse(input);
    const { projectRoot, expectedRevision, ...binding } = parsed;
    return {
      binding: await upsertMetricBinding({
        ...binding,
        projectRoot: path.resolve(projectRoot ?? optionRoot),
        expectedRevision,
        now: options.now
      })
    };
  }

  if (name === "loopgraph_metric_bindings_get") {
    const parsed = metricBindingsGetInputSchema.parse(input);
    const store = measurementStore(parsed.projectRoot ?? optionRoot);
    if (parsed.bindingId) return { binding: await store.getMetricBinding(parsed.bindingId) };
    return { bindings: await store.listMetricBindings(parsed.loopId) };
  }

  if (name === "loopgraph_measurements_schedule") {
    const parsed = measurementsScheduleInputSchema.parse(input);
    return scheduleDueMeasurements({
      ...parsed,
      projectRoot: path.resolve(parsed.projectRoot ?? optionRoot),
      now: options.now
    });
  }

  if (name === "loopgraph_measurement_jobs_claim") {
    const parsed = measurementJobsClaimInputSchema.parse(input);
    return {
      claims: await claimMeasurementJobs({
        ...parsed,
        projectRoot: path.resolve(parsed.projectRoot ?? optionRoot),
        now: options.now
      })
    };
  }

  if (name === "loopgraph_measurement_jobs_complete") {
    const parsed = measurementJobsCompleteInputSchema.parse(input);
    return completeMeasurementJob({
      ...parsed,
      projectRoot: path.resolve(parsed.projectRoot ?? optionRoot),
      now: options.now
    });
  }

  if (name === "loopgraph_measurement_jobs_fail") {
    const parsed = measurementJobsFailInputSchema.parse(input);
    return {
      job: await failMeasurementJob({
        ...parsed,
        projectRoot: path.resolve(parsed.projectRoot ?? optionRoot),
        now: options.now
      })
    };
  }

  if (name === "loopgraph_measurement_jobs_get") {
    const parsed = measurementJobsGetInputSchema.parse(input);
    const store = measurementStore(parsed.projectRoot ?? optionRoot);
    if (parsed.jobId) return { job: await store.getMeasurementJob(parsed.jobId) };
    return {
      jobs: await store.listMeasurementJobs({
        bindingId: parsed.bindingId,
        loopId: parsed.loopId,
        connectionInstanceId: parsed.connectionInstanceId,
        status: parsed.status,
        dueBefore: parsed.dueBefore
      })
    };
  }

  if (name === "loopgraph_connections_reconcile") {
    const parsed = connectionsReconcileInputSchema.parse(input);
    return reconcileConnectionsAndMeasurements({
      ...parsed,
      projectRoot: path.resolve(parsed.projectRoot ?? optionRoot),
      now: options.now
    });
  }

  if (name === "loopgraph_connections_reconciliations_get") {
    const parsed = connectionReconciliationsGetInputSchema.parse(input);
    const store = measurementStore(parsed.projectRoot ?? optionRoot);
    if (parsed.reportId) return { report: await store.getReconciliationReport(parsed.reportId) };
    return { reports: await store.listReconciliationReports() };
  }

  throw new Error(`Unknown Loopgraph measurement tool: ${String(name)}`);
}

function measurementStore(projectRoot: string): FileMeasurementStore {
  return new FileMeasurementStore(getLoopgraphRoot(path.resolve(projectRoot)));
}
