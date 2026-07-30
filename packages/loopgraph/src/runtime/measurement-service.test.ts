import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  LOOPGRAPH_API_VERSION,
  LOOP_KIND,
  type MetricDefinition
} from "../core";
import {
  reportConnectionInstanceHealth,
  upsertConnectionInstance
} from "./connector-registry";
import { syncHermesWebhookRoutes } from "./hermes-webhooks";
import {
  claimMeasurementJobs,
  completeMeasurementJob,
  reconcileConnectionsAndMeasurements,
  scheduleDueMeasurements,
  upsertMetricBinding
} from "./measurement-service";
import { FileMeasurementStore } from "./measurement-store";
import { FileOutcomeStore } from "./outcome-store";

describe("scheduled connector measurements", () => {
  it("binds exact provider fields, schedules idempotently, and evaluates outcomes with guardrails", async () => {
    const projectRoot = await createMeasurementProject();
    await registerHealthyAnalyticsConnection(projectRoot);
    const primary = await upsertMetricBinding({
      projectRoot,
      metricDefinitionId: "metric_activation",
      metricKey: "activation_rate",
      loopId: "product_activation",
      role: "primary",
      connectorInstanceId: "analytics_main",
      capabilityKey: "analytics.read",
      query: providerQuery("activation_rate"),
      unit: "percent",
      schedule: { cadenceSeconds: 3600, windowSeconds: 3600, lagSeconds: 0 },
      enabled: true,
      createdBy: "hermes-admin"
    });
    const guardrail = await upsertMetricBinding({
      projectRoot,
      metricDefinitionId: "metric_error_rate",
      metricKey: "error_rate",
      loopId: "product_activation",
      role: "guardrail",
      connectorInstanceId: "analytics_main",
      capabilityKey: "analytics.read",
      query: providerQuery("error_rate"),
      unit: "percent",
      schedule: { cadenceSeconds: 3600, windowSeconds: 3600, lagSeconds: 0 },
      guardrail: { comparator: "at_most", threshold: 5, severity: "blocking" },
      enabled: true,
      createdBy: "hermes-admin"
    });
    const now = new Date("2026-07-29T02:00:00.000Z");
    const scheduled = await scheduleDueMeasurements({
      projectRoot,
      backfillWindows: 2,
      now
    });
    const repeated = await scheduleDueMeasurements({
      projectRoot,
      backfillWindows: 2,
      now
    });

    expect(scheduled.created).toHaveLength(4);
    expect(repeated).toMatchObject({
      created: [],
      existing: expect.arrayContaining([
        expect.objectContaining({ bindingId: primary.id }),
        expect.objectContaining({ bindingId: guardrail.id })
      ])
    });

    const claims = await claimMeasurementJobs({
      projectRoot,
      claimedBy: "hermes-analytics-collector",
      limit: 10,
      now
    });
    expect(claims).toHaveLength(4);
    expect(claims.every((claim) => !claim.job.lease?.tokenHash.includes(claim.leaseToken))).toBe(true);

    for (const claim of claims) {
      const currentWindow = claim.job.window.end === "2026-07-29T02:00:00.000Z";
      const primaryJob = claim.job.bindingId === primary.id;
      await completeMeasurementJob({
        projectRoot,
        jobId: claim.job.id,
        leaseToken: claim.leaseToken,
        value: primaryJob
          ? currentWindow ? 70 : 50
          : currentWindow ? 3 : 2,
        observedAt: claim.job.window.end,
        evidenceRefs: [`provider-query:${claim.job.id}`],
        now: new Date("2026-07-29T02:05:00.000Z")
      });
    }

    const outcomeStore = new FileOutcomeStore(path.join(projectRoot, ".loopgraph"));
    const [samples, outcomes] = await Promise.all([
      outcomeStore.listMetricSamples({ loopId: "product_activation" }),
      outcomeStore.listObservedOutcomes({ loopId: "product_activation" })
    ]);
    expect(samples).toHaveLength(4);
    expect(outcomes).toMatchObject([{
      metricDefinitionId: "metric_activation",
      status: "target_met",
      truthStatus: "observed",
      baseline: { value: 50 },
      observed: { value: 70 },
      guardrails: [{
        metricDefinitionId: "metric_error_rate",
        passed: true
      }]
    }]);
  });

  it("rejects stale binding jobs and reconciles Hermes routes, health, and overdue work", async () => {
    const projectRoot = await createMeasurementProject();
    await registerHealthyAnalyticsConnection(projectRoot);
    await syncHermesWebhookRoutes({
      projectRoot,
      now: new Date("2026-07-29T01:50:00.000Z")
    });
    const binding = await upsertMetricBinding({
      projectRoot,
      metricDefinitionId: "metric_activation",
      metricKey: "activation_rate",
      loopId: "product_activation",
      role: "primary",
      connectorInstanceId: "analytics_main",
      capabilityKey: "analytics.read",
      query: providerQuery("activation_rate"),
      unit: "percent",
      schedule: { cadenceSeconds: 3600, windowSeconds: 3600, lagSeconds: 0 },
      enabled: true,
      createdBy: "hermes-admin"
    });
    const scheduleNow = new Date("2026-07-29T02:00:00.000Z");
    await scheduleDueMeasurements({ projectRoot, now: scheduleNow });
    const [claim] = await claimMeasurementJobs({
      projectRoot,
      claimedBy: "collector",
      now: scheduleNow
    });
    if (!claim) throw new Error("Expected a measurement claim");
    await upsertMetricBinding({
      ...binding,
      projectRoot,
      query: providerQuery("activated_accounts"),
      expectedRevision: binding.revision,
      now: new Date("2026-07-29T02:01:00.000Z")
    });

    await expect(completeMeasurementJob({
      projectRoot,
      jobId: claim.job.id,
      leaseToken: claim.leaseToken,
      value: 70,
      observedAt: claim.job.window.end,
      evidenceRefs: ["provider-query:stale-job"],
      now: new Date("2026-07-29T02:02:00.000Z")
    })).rejects.toThrow(/stale/);

    await reportConnectionInstanceHealth({
      projectRoot,
      instanceId: "analytics_main",
      status: "degraded",
      checkedAt: "2026-07-29T02:03:00.000Z",
      checkedBy: "hermes-health",
      errorCode: "provider_timeout",
      evidenceRefs: ["health-check:analytics-main"]
    });
    const { report, controllerTrigger } = await reconcileConnectionsAndMeasurements({
      projectRoot,
      now: new Date("2026-07-31T05:00:00.000Z"),
      healthStaleAfterHours: 24,
      measurementOverdueAfterHours: 24
    });

    expect(report.status).toBe("blocked");
    expect(report.webhookManifestOk).toBe(true);
    expect(report.issues.map((issue) => issue.kind)).toEqual(expect.arrayContaining([
      "connection_degraded",
      "health_stale",
      "measurement_overdue"
    ]));
    expect(controllerTrigger).toMatchObject({ enqueued: true });
    const persisted = await new FileMeasurementStore(path.join(projectRoot, ".loopgraph"))
      .getReconciliationReport(report.id);
    expect(persisted?.id).toBe(report.id);
  });
});

async function createMeasurementProject(): Promise<string> {
  const projectRoot = await mkdtemp(path.join(tmpdir(), "loopgraph-measurements-"));
  const specPath = path.join(projectRoot, "loops", "product-activation.loopgraph.json");
  await mkdir(path.dirname(specPath), { recursive: true });
  await writeFile(specPath, `${JSON.stringify(productActivationSpec(), null, 2)}\n`);
  await mkdir(path.join(projectRoot, ".loopgraph", "metrics"), { recursive: true });
  await writeFile(path.join(projectRoot, ".loopgraph", "workspace.json"), `${JSON.stringify({
    version: 1,
    demoCatalogEnabled: false,
    registeredSpecs: [{
      id: "product_activation",
      name: "Activation Learning",
      path: path.relative(projectRoot, specPath),
      department: "product",
      addedAt: "2026-07-29T00:00:00.000Z"
    }]
  }, null, 2)}\n`);
  await Promise.all(metricDefinitions().map((definition) =>
    writeFile(
      path.join(projectRoot, ".loopgraph", "metrics", `${definition.id}.json`),
      `${JSON.stringify(definition, null, 2)}\n`
    )
  ));
  return projectRoot;
}

async function registerHealthyAnalyticsConnection(projectRoot: string) {
  await upsertConnectionInstance(projectRoot, {
    id: "analytics_main",
    manifestId: "product_analytics",
    accountLabel: "Production analytics",
    capabilityKeys: ["analytics.read", "analytics.events"],
    credentialRef: "hermes://credentials/analytics-main",
    grantedScopes: [],
    status: "connected",
    environment: "live",
    readPolicy: "read_only",
    writePolicy: "not_allowed",
    lastHealthCheckAt: "2026-07-29T01:55:00.000Z",
    health: {
      status: "connected",
      checkedAt: "2026-07-29T01:55:00.000Z",
      checkedBy: "hermes-health",
      latencyMs: 120,
      evidenceRefs: ["health-check:analytics-main"]
    }
  });
}

function providerQuery(fieldPath: string) {
  return {
    resource: "activation_funnel",
    fieldPath,
    timestampField: "occurred_at",
    aggregation: "average" as const,
    filters: { environment: "production" },
    groupBy: []
  };
}

function metricDefinitions(): MetricDefinition[] {
  return [
    {
      id: "metric_activation",
      companyId: "company_1",
      departmentId: "product",
      loopId: "product_activation",
      key: "activation_rate",
      label: "Activation rate",
      description: "Qualified accounts reaching activation.",
      type: "rate",
      source: "integration",
      baselineRequired: true,
      unit: "percent",
      desiredDirection: "increase",
      target: 60,
      displayInDailySummary: true
    },
    {
      id: "metric_error_rate",
      companyId: "company_1",
      departmentId: "product",
      loopId: "product_activation",
      key: "error_rate",
      label: "Error rate",
      description: "Activation-path error guardrail.",
      type: "rate",
      source: "integration",
      baselineRequired: true,
      unit: "percent",
      desiredDirection: "decrease",
      displayInDailySummary: true
    }
  ];
}

function productActivationSpec() {
  return {
    apiVersion: LOOPGRAPH_API_VERSION,
    kind: LOOP_KIND,
    metadata: {
      id: "product_activation",
      name: "Activation Learning",
      version: "1.0.0",
      description: "Improve qualified product activation."
    },
    trigger: { type: "event", source: "hermes", event: "business_event" },
    input: { schema: { type: "object" } },
    output: {
      schema: {
        type: "object",
        required: ["decisionSummary", "proposedActions", "evidence", "policyInputs", "verificationRequest"],
        properties: {
          decisionSummary: { type: "string" },
          proposedActions: { type: "array" },
          evidence: { type: "array" },
          policyInputs: { type: "array" },
          verificationRequest: { type: "object" }
        }
      }
    },
    context: { sources: [], precedence: [] },
    routine: {
      steps: [{
        id: "observe",
        name: "Observe activation",
        stepType: "observe",
        actor: "system",
        description: "Inspect product activation evidence."
      }]
    },
    tools: [{
      key: "draft_experiment",
      adapterId: "manual",
      label: "Draft experiment",
      writeCapable: false,
      riskLevel: "low"
    }],
    policy: {
      allowedActions: [{
        toolKey: "draft_experiment",
        allowed: true,
        requiresApproval: false,
        riskLevel: "low"
      }],
      forbiddenActions: [],
      escalationRules: []
    },
    verification: [],
    approval: {
      requireFingerprintMatch: true,
      separateCustomerFacingApproval: true,
      allowedRoles: ["owner"]
    },
    persistence: { idempotency: { enabled: true } },
    trace: {
      captureContextSnapshot: true,
      captureToolInputOutput: true,
      evidenceRequired: true
    },
    topology: { department: "product" },
    routing: {
      schemaVersion: "routing-contract/v1alpha1",
      problemTypes: ["activation_drop"],
      accepts: [{
        sourcePattern: "analytics*",
        eventTypePattern: "metric.*",
        subjectTypes: ["funnel"],
        requiredFields: ["metric.key", "metric.value"]
      }],
      inputMapping: { metricKey: "metric.key" },
      minimumConfidence: 0.8,
      activationMode: "shadow",
      requiredConnections: ["analytics.read"]
    }
  };
}
