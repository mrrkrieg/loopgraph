import { randomUUID } from "node:crypto";
import path from "node:path";
import {
  CONNECTION_RECONCILIATION_SCHEMA_VERSION,
  MEASUREMENT_JOB_SCHEMA_VERSION,
  METRIC_BINDING_SCHEMA_VERSION,
  connectionReconciliationReportSchema,
  contentHash,
  measurementJobSchema,
  metricBindingHash,
  metricBindingSchema,
  type ConnectionReconciliationIssue,
  type ConnectionReconciliationReport,
  type MeasurementJob,
  type MetricBinding,
  type MetricGuardrail
} from "../core";
import { buildConnectionPlan } from "./connection-plan";
import {
  capabilityForManifest,
  defaultConnectorManifests,
  readConnectionInstances
} from "./connector-registry";
import { doctorHermesWebhookRoutes } from "./hermes-webhooks";
import { enqueueLoopControllerTriggerBestEffort } from "./loop-controller-triggers";
import { FileMeasurementStore, type MeasurementStore } from "./measurement-store";
import { FileOutcomeStore, type OutcomeStore } from "./outcome-store";
import { evaluateObservedOutcome, recordMetricSample } from "./outcome-service";
import { readProjectMetricDefinitions } from "./outcome-tools";
import { readWorkspaceGraphState } from "./semantic-graph-state";
import { getLoopgraphRoot } from "./storage-resolver";
import { readLoopgraphWorkspace } from "./workspace";

export type UpsertMetricBindingInput = Omit<
  MetricBinding,
  "schemaVersion" | "id" | "projectRootId" | "revision" | "createdAt" | "updatedAt"
> & {
  projectRoot?: string;
  id?: string;
  expectedRevision?: number;
  now?: Date;
};

export async function upsertMetricBinding(
  input: UpsertMetricBindingInput,
  options: { store?: MeasurementStore } = {}
): Promise<MetricBinding> {
  const projectRoot = path.resolve(input.projectRoot ?? process.cwd());
  const now = input.now ?? new Date();
  const workspace = await readLoopgraphWorkspace(projectRoot);
  const graph = await readWorkspaceGraphState(projectRoot);
  if (!graph.entries.some((entry) => entry.id === input.loopId)) {
    throw new Error(`Registered loop not found: ${input.loopId}`);
  }
  const definition = (await readProjectMetricDefinitions(projectRoot))
    .find((candidate) => candidate.id === input.metricDefinitionId);
  if (!definition) throw new Error(`Metric definition not found: ${input.metricDefinitionId}`);
  if (definition.loopId && definition.loopId !== input.loopId) {
    throw new Error(`Metric definition ${definition.id} belongs to loop ${definition.loopId}`);
  }
  if (definition.key !== input.metricKey) {
    throw new Error(`Metric binding key ${input.metricKey} does not match definition key ${definition.key}`);
  }
  const connection = (await readConnectionInstances(projectRoot))
    .find((candidate) => candidate.id === input.connectorInstanceId);
  if (!connection) throw new Error(`Connection instance not found: ${input.connectorInstanceId}`);
  const manifest = defaultConnectorManifests().find((candidate) => candidate.id === connection.manifestId);
  const capability = manifest && capabilityForManifest(manifest, input.capabilityKey);
  if (!capability || capability.direction !== "read") {
    throw new Error(`Connection ${connection.id} does not expose read capability ${input.capabilityKey}`);
  }
  if (!connection.capabilityKeys.includes(input.capabilityKey)) {
    throw new Error(`Connection ${connection.id} has not granted capability ${input.capabilityKey}`);
  }
  const missingScopes = capability.minimumScopes.filter((scope) => !connection.grantedScopes.includes(scope));
  if (missingScopes.length > 0) {
    throw new Error(`Connection ${connection.id} is missing required scopes: ${missingScopes.join(", ")}`);
  }
  const store: MeasurementStore = options.store ?? new FileMeasurementStore(getLoopgraphRoot(projectRoot));
  const id = input.id ?? `metric_binding_${contentHash({
    metricDefinitionId: input.metricDefinitionId,
    loopId: input.loopId,
    connectorInstanceId: input.connectorInstanceId
  })}`;
  const existing = await store.getMetricBinding(id);
  const binding = metricBindingSchema.parse({
    ...input,
    schemaVersion: METRIC_BINDING_SCHEMA_VERSION,
    id,
    projectRootId: workspace.projectRootId,
    revision: (existing?.revision ?? 0) + 1,
    createdAt: existing?.createdAt ?? now.toISOString(),
    updatedAt: now.toISOString()
  });
  return store.saveMetricBinding(binding, input.expectedRevision);
}

export async function scheduleDueMeasurements(input: {
  projectRoot?: string;
  bindingId?: string;
  backfillWindows?: number;
  maxAttempts?: number;
  now?: Date;
}, options: { store?: MeasurementStore } = {}): Promise<{
  schemaVersion: "measurement-scheduler/v1alpha1";
  scheduledAt: string;
  created: MeasurementJob[];
  existing: MeasurementJob[];
  blockedBindings: Array<{ bindingId: string; reason: string }>;
}> {
  const projectRoot = path.resolve(input.projectRoot ?? process.cwd());
  const now = input.now ?? new Date();
  const backfillWindows = boundedInteger(input.backfillWindows ?? 1, 1, 100, "backfillWindows");
  const maxAttempts = boundedInteger(input.maxAttempts ?? 3, 1, 20, "maxAttempts");
  const store = options.store ?? new FileMeasurementStore(getLoopgraphRoot(projectRoot));
  const bindings = (await store.listMetricBindings())
    .filter((binding) => binding.enabled && (!input.bindingId || binding.id === input.bindingId));
  const connections = new Map((await readConnectionInstances(projectRoot)).map((instance) => [instance.id, instance]));
  const created: MeasurementJob[] = [];
  const existing: MeasurementJob[] = [];
  const blockedBindings: Array<{ bindingId: string; reason: string }> = [];

  await store.withJobLock(async () => {
    for (const binding of bindings) {
      const connection = connections.get(binding.connectorInstanceId);
      if (!connection || connection.status !== "connected") {
        blockedBindings.push({
          bindingId: binding.id,
          reason: !connection
            ? `Connection ${binding.connectorInstanceId} is missing.`
            : `Connection ${connection.id} is ${connection.status}; measurement requires connected status.`
        });
        continue;
      }
      for (let offset = backfillWindows - 1; offset >= 0; offset -= 1) {
        const window = measurementWindowForBinding(binding, now, offset);
        const dueAt = new Date(Date.parse(window.end) + binding.schedule.lagSeconds * 1000).toISOString();
        if (Date.parse(dueAt) > now.getTime()) continue;
        const idempotencyKey = `measurement_${contentHash({
          projectRootId: binding.projectRootId,
          bindingId: binding.id,
          bindingHash: metricBindingHash(binding),
          window
        })}`;
        const jobId = `measurement_job_${contentHash(idempotencyKey)}`;
        const found = await store.getMeasurementJob(jobId);
        if (found) {
          existing.push(found);
          continue;
        }
        const job = measurementJobSchema.parse({
          schemaVersion: MEASUREMENT_JOB_SCHEMA_VERSION,
          id: jobId,
          idempotencyKey,
          projectRootId: binding.projectRootId,
          bindingId: binding.id,
          bindingHash: metricBindingHash(binding),
          metricDefinitionId: binding.metricDefinitionId,
          metricKey: binding.metricKey,
          loopId: binding.loopId,
          connectorInstanceId: binding.connectorInstanceId,
          capabilityKey: binding.capabilityKey,
          query: binding.query,
          unit: binding.unit,
          window,
          dueAt,
          status: "pending",
          attemptCount: 0,
          maxAttempts,
          createdAt: now.toISOString(),
          updatedAt: now.toISOString()
        });
        created.push(await store.saveMeasurementJob(job));
      }
    }
  });

  return {
    schemaVersion: "measurement-scheduler/v1alpha1",
    scheduledAt: now.toISOString(),
    created,
    existing,
    blockedBindings
  };
}

export async function claimMeasurementJobs(input: {
  projectRoot?: string;
  claimedBy: string;
  limit?: number;
  leaseSeconds?: number;
  connectionInstanceId?: string;
  now?: Date;
}, options: { store?: MeasurementStore } = {}): Promise<Array<{
  job: MeasurementJob;
  leaseToken: string;
}>> {
  const projectRoot = path.resolve(input.projectRoot ?? process.cwd());
  const now = input.now ?? new Date();
  const limit = boundedInteger(input.limit ?? 20, 1, 100, "limit");
  const leaseSeconds = boundedInteger(input.leaseSeconds ?? 300, 30, 3600, "leaseSeconds");
  const store: MeasurementStore = options.store ?? new FileMeasurementStore(getLoopgraphRoot(projectRoot));
  if (store.claimDueJobs) {
    return store.claimDueJobs({
      claimedBy: input.claimedBy,
      limit,
      leaseSeconds,
      connectionInstanceId: input.connectionInstanceId,
      now
    });
  }
  return store.withJobLock(async () => {
    const candidates = (await store.listMeasurementJobs())
      .filter((job) => !input.connectionInstanceId || job.connectorInstanceId === input.connectionInstanceId)
      .filter((job) => job.dueAt <= now.toISOString())
      .filter((job) =>
        (job.status === "pending" || job.status === "failed") && job.attemptCount < job.maxAttempts ||
        job.status === "claimed" && Boolean(job.lease && Date.parse(job.lease.expiresAt) <= now.getTime())
      )
      .slice(0, limit);
    const claimed: Array<{ job: MeasurementJob; leaseToken: string }> = [];
    for (const job of candidates) {
      const leaseToken = randomUUID();
      const next = measurementJobSchema.parse({
        ...job,
        status: "claimed",
        attemptCount: job.attemptCount + 1,
        lease: {
          claimedBy: input.claimedBy,
          tokenHash: contentHash(leaseToken),
          claimedAt: now.toISOString(),
          expiresAt: new Date(now.getTime() + leaseSeconds * 1000).toISOString()
        },
        error: undefined,
        updatedAt: now.toISOString()
      });
      claimed.push({ job: await store.saveMeasurementJob(next), leaseToken });
    }
    return claimed;
  });
}

export async function completeMeasurementJob(input: {
  projectRoot?: string;
  jobId: string;
  leaseToken: string;
  value: number;
  observedAt: string;
  qualityStatus?: "verified" | "estimated" | "stale";
  qualityReason?: string;
  evidenceRefs: string[];
  now?: Date;
}, options: { store?: MeasurementStore; outcomeStore?: OutcomeStore } = {}) {
  const projectRoot = path.resolve(input.projectRoot ?? process.cwd());
  const now = input.now ?? new Date();
  const store: MeasurementStore = options.store ?? new FileMeasurementStore(getLoopgraphRoot(projectRoot));
  const outcomeStore = options.outcomeStore ?? new FileOutcomeStore(getLoopgraphRoot(projectRoot));
  return store.withJobLock(async () => {
    const job = await requireClaimedJob(store, input.jobId, input.leaseToken, now);
    const binding = await requireCurrentBinding(store, job);
    const connection = (await readConnectionInstances(projectRoot))
      .find((candidate) => candidate.id === job.connectorInstanceId);
    if (!connection || connection.status !== "connected") {
      throw new Error(`Connection ${job.connectorInstanceId} is not connected`);
    }
    if (input.evidenceRefs.length === 0) {
      throw new Error("Completing a measurement requires at least one provider evidence reference");
    }
    const definitions = await readProjectMetricDefinitions(projectRoot);
    const definition = definitions.find((candidate) => candidate.id === job.metricDefinitionId);
    if (!definition) throw new Error(`Metric definition not found: ${job.metricDefinitionId}`);
    const workspace = await readLoopgraphWorkspace(projectRoot);
    const qualityStatus = input.qualityStatus ?? "verified";
    const sample = await recordMetricSample(outcomeStore, {
      workspaceId: workspace.projectRootId,
      companyId: definition.companyId,
      departmentId: definition.departmentId,
      loopId: job.loopId,
      metricDefinitionId: definition.id,
      metricKey: definition.key,
      value: input.value,
      unit: job.unit,
      window: job.window,
      observedAt: input.observedAt,
      source: {
        type: "integration",
        sourceRef: `connector:${job.connectorInstanceId}:binding:${binding.id}:window:${job.window.end}`,
        connectorInstanceId: job.connectorInstanceId
      },
      quality: {
        status: qualityStatus,
        reason: input.qualityReason,
        freshnessDeadline: new Date(
          Date.parse(job.window.end) + (definition.staleAfterHours ?? 24) * 60 * 60 * 1000
        ).toISOString()
      },
      truthStatus: qualityStatus === "estimated" ? "incomplete" : "observed",
      evidenceRefs: [...new Set(input.evidenceRefs)]
    }, now);
    const completed = measurementJobSchema.parse({
      ...job,
      status: "completed",
      lease: undefined,
      result: {
        metricSampleId: sample.record.id,
        value: input.value,
        observedAt: input.observedAt,
        qualityStatus,
        evidenceRefs: [...new Set(input.evidenceRefs)],
        completedAt: now.toISOString()
      },
      updatedAt: now.toISOString()
    });
    if (store.saveClaimedMeasurementJob) {
      await store.saveClaimedMeasurementJob(completed, contentHash(input.leaseToken));
    } else {
      await store.saveMeasurementJob(completed);
    }
    const automaticOutcomes = await evaluateReadyBoundOutcomes({
      projectRoot,
      loopId: job.loopId,
      windowEnd: job.window.end,
      store,
      outcomeStore,
      now
    });
    return {
      job: completed,
      sample: sample.record,
      duplicateSample: sample.duplicate,
      automaticOutcomes
    };
  });
}

export async function failMeasurementJob(input: {
  projectRoot?: string;
  jobId: string;
  leaseToken: string;
  code: string;
  message: string;
  retryable?: boolean;
  now?: Date;
}, options: { store?: MeasurementStore } = {}): Promise<MeasurementJob> {
  const projectRoot = path.resolve(input.projectRoot ?? process.cwd());
  const now = input.now ?? new Date();
  const store: MeasurementStore = options.store ?? new FileMeasurementStore(getLoopgraphRoot(projectRoot));
  return store.withJobLock(async () => {
    const job = await requireClaimedJob(store, input.jobId, input.leaseToken, now);
    const retryable = input.retryable ?? true;
    const next = measurementJobSchema.parse({
      ...job,
      status: retryable && job.attemptCount < job.maxAttempts ? "failed" : "dead_letter",
      lease: undefined,
      error: {
        code: input.code,
        message: input.message,
        retryable,
        failedAt: now.toISOString()
      },
      updatedAt: now.toISOString()
    });
    return store.saveClaimedMeasurementJob
      ? store.saveClaimedMeasurementJob(next, contentHash(input.leaseToken))
      : store.saveMeasurementJob(next);
  });
}

export async function reconcileConnectionsAndMeasurements(input: {
  projectRoot?: string;
  healthStaleAfterHours?: number;
  measurementOverdueAfterHours?: number;
  now?: Date;
}, options: { store?: MeasurementStore } = {}): Promise<{
  report: ConnectionReconciliationReport;
  controllerTrigger: Awaited<ReturnType<typeof enqueueLoopControllerTriggerBestEffort>>;
}> {
  const projectRoot = path.resolve(input.projectRoot ?? process.cwd());
  const now = input.now ?? new Date();
  const healthStaleAfterHours = boundedInteger(input.healthStaleAfterHours ?? 24, 1, 8760, "healthStaleAfterHours");
  const overdueAfterHours = boundedInteger(
    input.measurementOverdueAfterHours ?? 24,
    1,
    8760,
    "measurementOverdueAfterHours"
  );
  const store = options.store ?? new FileMeasurementStore(getLoopgraphRoot(projectRoot));
  const workspace = await readLoopgraphWorkspace(projectRoot);
  const [plan, webhook, bindings, instances, jobs] = await Promise.all([
    buildConnectionPlan({ projectRoot, now }),
    doctorHermesWebhookRoutes({ projectRoot, now }),
    store.listMetricBindings(),
    readConnectionInstances(projectRoot),
    store.listMeasurementJobs()
  ]);
  const instancesById = new Map(instances.map((instance) => [instance.id, instance]));
  const manifests = new Map(defaultConnectorManifests().map((manifest) => [manifest.id, manifest]));
  const issues: ConnectionReconciliationIssue[] = [];
  const addIssue = (issue: Omit<ConnectionReconciliationIssue, "id">) => {
    issues.push({
      ...issue,
      id: `reconciliation_issue_${contentHash(issue)}`
    });
  };

  for (const binding of bindings.filter((candidate) => candidate.enabled)) {
    const connection = instancesById.get(binding.connectorInstanceId);
    if (!connection) {
      addIssue({
        severity: "blocking",
        kind: "missing_connection",
        bindingId: binding.id,
        loopId: binding.loopId,
        summary: `Metric binding ${binding.id} references missing connection ${binding.connectorInstanceId}.`,
        repairAction: "Register the connector instance in Hermes and update this metric binding.",
        evidenceRefs: []
      });
      continue;
    }
    if (connection.status !== "connected") {
      addIssue({
        severity: "blocking",
        kind: "connection_degraded",
        connectionInstanceId: connection.id,
        bindingId: binding.id,
        loopId: binding.loopId,
        summary: `Connection ${connection.id} is ${connection.status}.`,
        repairAction: "Repair provider authorization or health, then report a successful Hermes health check.",
        evidenceRefs: connection.health?.evidenceRefs ?? []
      });
    }
    const healthAt = connection.health?.checkedAt ?? connection.lastHealthCheckAt;
    if (!healthAt || Date.parse(healthAt) + healthStaleAfterHours * 60 * 60 * 1000 < now.getTime()) {
      addIssue({
        severity: "warning",
        kind: "health_stale",
        connectionInstanceId: connection.id,
        bindingId: binding.id,
        loopId: binding.loopId,
        summary: `Connection ${connection.id} has no recent health evidence.`,
        repairAction: "Ask Hermes to run the connector health probe and submit its non-secret receipt.",
        evidenceRefs: []
      });
    }
    const manifest = manifests.get(connection.manifestId);
    const capability = manifest && capabilityForManifest(manifest, binding.capabilityKey);
    if (!capability || !connection.capabilityKeys.includes(binding.capabilityKey)) {
      addIssue({
        severity: "blocking",
        kind: "missing_capability",
        connectionInstanceId: connection.id,
        bindingId: binding.id,
        loopId: binding.loopId,
        summary: `Connection ${connection.id} cannot collect ${binding.capabilityKey}.`,
        repairAction: "Grant the required read capability or bind the metric to a compatible connection.",
        evidenceRefs: []
      });
    } else {
      const missingScopes = capability.minimumScopes.filter((scope) => !connection.grantedScopes.includes(scope));
      if (missingScopes.length > 0) {
        addIssue({
          severity: "blocking",
          kind: "missing_scope",
          connectionInstanceId: connection.id,
          bindingId: binding.id,
          loopId: binding.loopId,
          summary: `Connection ${connection.id} is missing scopes: ${missingScopes.join(", ")}.`,
          repairAction: "Reauthorize the connector in Hermes with the minimum read-only scopes.",
          evidenceRefs: []
        });
      }
    }
  }

  if (!webhook.manifestExists) {
    addIssue({
      severity: "blocking",
      kind: "webhook_manifest_missing",
      summary: "The project-local Hermes route manifest has not been synced.",
      repairAction: "Run the Hermes webhook sync after reviewing the generated route plan.",
      evidenceRefs: []
    });
  } else if (!webhook.ok) {
    addIssue({
      severity: "blocking",
      kind: "webhook_manifest_stale",
      summary: "The Hermes route manifest no longer matches the active Loopgraph routing catalog.",
      repairAction: "Review and sync the current Hermes route plan, then rerun reconciliation.",
      evidenceRefs: [`hermes-catalog:${webhook.plan.catalogVersion}`]
    });
  }

  const overdueCutoff = new Date(now.getTime() - overdueAfterHours * 60 * 60 * 1000).toISOString();
  for (const job of jobs.filter((candidate) =>
    ["pending", "failed", "claimed"].includes(candidate.status) && candidate.dueAt < overdueCutoff
  )) {
    addIssue({
      severity: job.status === "claimed" ? "warning" : "blocking",
      kind: "measurement_overdue",
      connectionInstanceId: job.connectorInstanceId,
      bindingId: job.bindingId,
      loopId: job.loopId,
      summary: `Measurement job ${job.id} has been ${job.status} since its ${job.dueAt} due time.`,
      repairAction: "Run the Hermes measurement collector or inspect the job error and retry/dead-letter state.",
      evidenceRefs: [`measurement-job:${job.id}`]
    });
  }

  const status = issues.some((issue) => issue.severity === "blocking")
    ? "blocked" as const
    : issues.length > 0
      ? "degraded" as const
      : "healthy" as const;
  const report = connectionReconciliationReportSchema.parse({
    schemaVersion: CONNECTION_RECONCILIATION_SCHEMA_VERSION,
    id: `connection_reconciliation_${contentHash({
      projectRootId: workspace.projectRootId,
      connectionPlanHash: contentHash(plan),
      metricBindingsHash: contentHash(bindings),
      webhookCatalogVersion: webhook.plan.catalogVersion,
      issues,
      checkedAt: now.toISOString()
    })}`,
    projectRootId: workspace.projectRootId,
    status,
    connectionPlanHash: contentHash(plan),
    metricBindingsHash: contentHash(bindings),
    webhookCatalogVersion: webhook.plan.catalogVersion,
    webhookManifestOk: webhook.ok,
    checkedConnectionIds: instances.map((instance) => instance.id).sort(),
    checkedBindingIds: bindings.map((binding) => binding.id).sort(),
    issues,
    checkedAt: now.toISOString()
  });
  await store.saveReconciliationReport(report);
  const controllerTrigger = await enqueueLoopControllerTriggerBestEffort({
    projectRoot,
    type: "connector_health",
    triggerId: report.id,
    sourceRef: `connection-reconciliation:${report.id}`,
    occurredAt: report.checkedAt,
    requestedBy: "loopgraph-connection-reconciliation",
    evidenceRefs: [report.id, ...issues.flatMap((issue) => issue.evidenceRefs)]
  }, { now });
  return { report, controllerTrigger };
}

async function requireClaimedJob(
  store: MeasurementStore,
  jobId: string,
  leaseToken: string,
  now: Date
): Promise<MeasurementJob> {
  const job = await store.getMeasurementJob(jobId);
  if (!job) throw new Error(`Measurement job not found: ${jobId}`);
  if (job.status !== "claimed" || !job.lease) throw new Error(`Measurement job ${job.id} is not claimed`);
  if (job.lease.tokenHash !== contentHash(leaseToken)) throw new Error("Measurement job lease token is invalid");
  if (Date.parse(job.lease.expiresAt) < now.getTime()) throw new Error("Measurement job lease has expired");
  return job;
}

async function requireCurrentBinding(store: MeasurementStore, job: MeasurementJob): Promise<MetricBinding> {
  const binding = await store.getMetricBinding(job.bindingId);
  if (!binding) throw new Error(`Metric binding not found: ${job.bindingId}`);
  if (!binding.enabled) throw new Error(`Metric binding ${binding.id} is disabled`);
  if (metricBindingHash(binding) !== job.bindingHash) {
    throw new Error(`Measurement job ${job.id} is stale because metric binding ${binding.id} changed`);
  }
  return binding;
}

function measurementWindowForBinding(binding: MetricBinding, now: Date, offset: number) {
  const cadenceMs = binding.schedule.cadenceSeconds * 1000;
  const lagMs = binding.schedule.lagSeconds * 1000;
  const windowMs = binding.schedule.windowSeconds * 1000;
  const latestEnd = Math.floor((now.getTime() - lagMs) / cadenceMs) * cadenceMs - offset * cadenceMs;
  return {
    start: new Date(latestEnd - windowMs).toISOString(),
    end: new Date(latestEnd).toISOString()
  };
}

async function evaluateReadyBoundOutcomes(input: {
  projectRoot: string;
  loopId: string;
  windowEnd: string;
  store: MeasurementStore;
  outcomeStore: OutcomeStore;
  now: Date;
}) {
  const bindings = (await input.store.listMetricBindings(input.loopId)).filter((binding) => binding.enabled);
  const primaryBindings = bindings.filter((binding) => binding.role === "primary");
  const guardrailBindings = bindings.filter((binding) => binding.role === "guardrail");
  const jobs = (await input.store.listMeasurementJobs({ loopId: input.loopId, status: "completed" }))
    .filter((job) => Boolean(job.result));
  const definitions = await readProjectMetricDefinitions(input.projectRoot);
  const results = [];

  for (const primary of primaryBindings) {
    const primaryJobs = jobs
      .filter((job) => job.bindingId === primary.id && job.window.end <= input.windowEnd)
      .sort((left, right) => right.window.end.localeCompare(left.window.end));
    if (primaryJobs.length < 2 || primaryJobs[0]?.window.end !== input.windowEnd) continue;
    const current = primaryJobs[0];
    const baseline = primaryJobs[1];
    const guardrails = [];
    let guardrailsReady = true;
    for (const guardrail of guardrailBindings) {
      const currentJob = jobs.find((job) => job.bindingId === guardrail.id && job.window.end === current.window.end);
      const baselineJob = jobs
        .filter((job) => job.bindingId === guardrail.id && job.window.end < current.window.end)
        .sort((left, right) => right.window.end.localeCompare(left.window.end))[0];
      if (!currentJob?.result || !baselineJob?.result || !guardrail.guardrail) {
        guardrailsReady = false;
        break;
      }
      guardrails.push({
        metricDefinitionId: guardrail.metricDefinitionId,
        label: guardrail.metricKey,
        passed: guardrailPassed(guardrail.guardrail, baselineJob.result.value, currentJob.result.value),
        evidenceRefs: [
          `metric_sample:${baselineJob.result.metricSampleId}`,
          `metric_sample:${currentJob.result.metricSampleId}`
        ]
      });
    }
    if (!guardrailsReady) continue;
    const definition = definitions.find((candidate) => candidate.id === primary.metricDefinitionId);
    if (!definition) continue;
    const evaluated = await evaluateObservedOutcome({
      store: input.outcomeStore,
      workspaceId: primary.projectRootId,
      companyId: definition.companyId,
      departmentId: definition.departmentId,
      loopId: input.loopId,
      metricDefinition: definition,
      baselineWindow: baseline.window,
      evaluationWindow: current.window,
      guardrails,
      now: input.now
    });
    const controllerTrigger = await enqueueLoopControllerTriggerBestEffort({
      projectRoot: input.projectRoot,
      type: "outcome_window",
      triggerId: evaluated.record.id,
      sourceRef: `observed-outcome:${evaluated.record.id}`,
      occurredAt: evaluated.record.evaluatedAt,
      requestedBy: "loopgraph-measurement-collector",
      evidenceRefs: [evaluated.record.id, ...evaluated.record.evidenceRefs]
    }, { now: input.now });
    results.push({ ...evaluated, controllerTrigger });
  }
  return results;
}

function guardrailPassed(guardrail: MetricGuardrail, baseline: number, observed: number): boolean {
  if (guardrail.comparator === "at_least") return observed >= guardrail.threshold;
  if (guardrail.comparator === "at_most") return observed <= guardrail.threshold;
  const changePct = baseline === 0 ? (observed === 0 ? 0 : Number.POSITIVE_INFINITY) :
    ((observed - baseline) / Math.abs(baseline)) * 100;
  if (guardrail.comparator === "max_regression_pct") return changePct >= -Math.abs(guardrail.threshold);
  return changePct >= guardrail.threshold;
}

function boundedInteger(value: number, minimum: number, maximum: number, label: string): number {
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    throw new Error(`${label} must be an integer from ${minimum} to ${maximum}.`);
  }
  return value;
}
