import { randomBytes } from "node:crypto";
import { pathToFileURL } from "node:url";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import {
  canonicalAppDigest,
  canonicalEntitySchema,
  measurementJobSchema,
  metricSampleSchema,
  observedOutcomeSchema,
  valueLedgerEntrySchema,
  type CanonicalEntity,
  type MeasurementJob,
  type MetricSample,
  type ObservedOutcome,
  type ValueLedgerEntry
} from "loopgraph/core";
import type { MeasurementJobClaimInput, OutcomeStoreSaveResult } from "loopgraph/runtime";
import { SupabaseEntityResolutionStore } from "../lib/db/adapters/supabase-entity-resolution-store";
import { SupabaseEvidenceStore } from "../lib/db/adapters/supabase-evidence-store";
import { readProjectedSecretFile } from "./projected-secret-file";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DIGEST_PATTERN = /^sha256:[0-9a-f]{64}$/;
const PROBE_SUFFIX_PATTERN = /^[0-9a-f]{24}$/;

type EvidenceProbeStore = {
  saveMeasurementJob(value: MeasurementJob): Promise<MeasurementJob>;
  claimDueJobs(input: MeasurementJobClaimInput): Promise<Array<{ job: MeasurementJob; leaseToken: string }>>;
  saveClaimedMeasurementJob(value: MeasurementJob, expectedLeaseTokenHash: string): Promise<MeasurementJob>;
  getMeasurementJob(id: string): Promise<MeasurementJob | undefined>;
  saveMetricSample(value: MetricSample): Promise<OutcomeStoreSaveResult<MetricSample>>;
  getMetricSample(id: string): Promise<MetricSample | undefined>;
  saveObservedOutcome(value: ObservedOutcome): Promise<OutcomeStoreSaveResult<ObservedOutcome>>;
  getObservedOutcome(id: string): Promise<ObservedOutcome | undefined>;
  saveValueLedgerEntry(value: ValueLedgerEntry): Promise<OutcomeStoreSaveResult<ValueLedgerEntry>>;
  getValueLedgerEntry(id: string): Promise<ValueLedgerEntry | undefined>;
};

type EntityProbeStore = {
  save(value: CanonicalEntity, expectedRevision?: number): Promise<CanonicalEntity>;
  list(workspaceId: string, companyId: string): Promise<CanonicalEntity[]>;
};

export type HostedLearningEntityProbeConfig = {
  supabaseUrl: string;
  organizationId: string;
  expectedScopeDigest: string;
  allowMutation: boolean;
};

export type HostedLearningEntityProbeReceipt = {
  schemaVersion: "hosted-learning-entity-staging-validation/v1";
  checkedAt: string;
  durationMs: number;
  scopeDigest: string;
  healthy: true;
  checks: Array<{
    name:
      | "distributed_measurement_claim"
      | "stale_lease_rejected"
      | "cross_replica_job_finalization"
      | "metric_sample_immutable"
      | "observed_outcome_immutable"
      | "value_ledger_immutable"
      | "cross_replica_entity_visibility"
      | "provider_alias_single_owner"
      | "probe_scope_clean";
    ok: true;
  }>;
};

export function hostedLearningEntityProbeScopeDigest(input: {
  supabaseUrl: string;
  organizationId: string;
}) {
  return canonicalAppDigest({
    origin: trustedOrigin(input.supabaseUrl),
    organizationId: assertOrganizationId(input.organizationId),
    probeNamespace: "learning_probe"
  });
}

export async function validateHostedLearningEntitiesStaging(
  config: HostedLearningEntityProbeConfig,
  dependencies: {
    clients: readonly [SupabaseClient, SupabaseClient];
    probeSuffix?: () => string;
    now?: () => Date;
    nowMs?: () => number;
    createEvidenceStore?: (client: SupabaseClient, scope: ProbeScope) => EvidenceProbeStore;
    createEntityStore?: (client: SupabaseClient, scope: ProbeScope) => EntityProbeStore;
  }
): Promise<HostedLearningEntityProbeReceipt> {
  if (!config.allowMutation) {
    throw new Error("Hosted learning/entity probe mutation was not explicitly enabled");
  }
  const scopeDigest = hostedLearningEntityProbeScopeDigest(config);
  if (!DIGEST_PATTERN.test(config.expectedScopeDigest) || config.expectedScopeDigest !== scopeDigest) {
    throw new Error("Hosted learning/entity probe target does not match the pinned staging scope");
  }
  const suffix = dependencies.probeSuffix?.() ?? randomBytes(12).toString("hex");
  if (!PROBE_SUFFIX_PATTERN.test(suffix)) {
    throw new Error("Hosted learning/entity probe identity is invalid");
  }

  const scope = {
    organizationId: assertOrganizationId(config.organizationId),
    projectKey: `learning_probe_${suffix}`
  };
  const makeEvidenceStore = dependencies.createEvidenceStore ??
    ((client: SupabaseClient, target: ProbeScope) => new SupabaseEvidenceStore(client, target));
  const makeEntityStore = dependencies.createEntityStore ??
    ((client: SupabaseClient, target: ProbeScope) => new SupabaseEntityResolutionStore(client, target));
  const evidence = dependencies.clients.map((client) => makeEvidenceStore(client, scope)) as
    [EvidenceProbeStore, EvidenceProbeStore];
  const entities = dependencies.clients.map((client) => makeEntityStore(client, scope)) as
    [EntityProbeStore, EntityProbeStore];
  const now = dependencies.now ?? (() => new Date());
  const nowMs = dependencies.nowMs ?? Date.now;
  const startedAt = nowMs();
  const fixtureTime = now();
  const fixtures = probeFixtures(suffix, fixtureTime);
  const checks: HostedLearningEntityProbeReceipt["checks"] = [];

  await cleanupProbe(dependencies.clients[0], scope);
  let operationError: unknown;
  let cleanupError: unknown;
  try {
    await evidence[0].saveMeasurementJob(fixtures.pendingJob);
    const claims = await Promise.all([
      evidence[0].claimDueJobs(claimInput("probe-worker-a", fixtureTime)),
      evidence[1].claimDueJobs(claimInput("probe-worker-b", fixtureTime))
    ]);
    const winners = claims.flat();
    if (
      winners.length !== 1 ||
      claims.filter((claim) => claim.length === 1).length !== 1 ||
      claims.some((claim) => claim.length > 1) ||
      winners[0]?.job.id !== fixtures.pendingJob.id ||
      !winners[0]?.job.lease?.tokenHash
    ) {
      throw new Error("Hosted measurement workers did not produce one exclusive claim");
    }
    checks.push({ name: "distributed_measurement_claim", ok: true });

    const winnerIndex = claims[0].length === 1 ? 0 : 1;
    const observerIndex = winnerIndex === 0 ? 1 : 0;
    const claimed = winners[0]!.job;
    const claimedLease = claimed.lease;
    if (!claimedLease) {
      throw new Error("Hosted measurement claim omitted its lease fence");
    }
    const completed = measurementJobSchema.parse({
      ...claimed,
      status: "completed",
      lease: undefined,
      result: {
        metricSampleId: fixtures.metricSample.id,
        value: fixtures.metricSample.value,
        observedAt: fixtures.metricSample.observedAt,
        qualityStatus: "verified",
        evidenceRefs: fixtures.metricSample.evidenceRefs,
        completedAt: fixtureTime.toISOString()
      },
      updatedAt: fixtureTime.toISOString()
    });
    const staleHash = claimedLease.tokenHash === "0000000000000000"
      ? "1111111111111111"
      : "0000000000000000";
    await expectRejected(
      evidence[winnerIndex].saveClaimedMeasurementJob(completed, staleHash),
      "Hosted measurement finalization accepted a stale lease"
    );
    checks.push({ name: "stale_lease_rejected", ok: true });

    await evidence[winnerIndex].saveClaimedMeasurementJob(completed, claimedLease.tokenHash);
    const observedJob = await evidence[observerIndex].getMeasurementJob(completed.id);
    if (JSON.stringify(observedJob) !== JSON.stringify(completed)) {
      throw new Error("A second hosted worker did not observe the finalized measurement job");
    }
    checks.push({ name: "cross_replica_job_finalization", ok: true });

    await assertImmutableRecord({
      recordType: "metric_sample",
      value: fixtures.metricSample,
      changedValue: { ...fixtures.metricSample, value: fixtures.metricSample.value + 1 },
      writer: evidence[0].saveMetricSample.bind(evidence[0]),
      readerWriter: evidence[1].saveMetricSample.bind(evidence[1]),
      reader: evidence[1].getMetricSample.bind(evidence[1]),
      client: dependencies.clients[1],
      scope
    });
    checks.push({ name: "metric_sample_immutable", ok: true });

    await assertImmutableRecord({
      recordType: "observed_outcome",
      value: fixtures.outcome,
      changedValue: { ...fixtures.outcome, confidence: 0.5 },
      writer: evidence[0].saveObservedOutcome.bind(evidence[0]),
      readerWriter: evidence[1].saveObservedOutcome.bind(evidence[1]),
      reader: evidence[1].getObservedOutcome.bind(evidence[1]),
      client: dependencies.clients[1],
      scope
    });
    checks.push({ name: "observed_outcome_immutable", ok: true });

    await assertImmutableRecord({
      recordType: "value_ledger",
      value: fixtures.valueEntry,
      changedValue: { ...fixtures.valueEntry, grossSavedMinutes: 61, netSavedMinutes: 51 },
      writer: evidence[0].saveValueLedgerEntry.bind(evidence[0]),
      readerWriter: evidence[1].saveValueLedgerEntry.bind(evidence[1]),
      reader: evidence[1].getValueLedgerEntry.bind(evidence[1]),
      client: dependencies.clients[1],
      scope
    });
    checks.push({ name: "value_ledger_immutable", ok: true });

    await entities[0].save(fixtures.primaryEntity);
    const visible = await entities[1].list(fixtures.primaryEntity.workspaceId, fixtures.primaryEntity.companyId);
    if (
      visible.length !== 1 ||
      JSON.stringify(visible[0]) !== JSON.stringify(fixtures.primaryEntity)
    ) {
      throw new Error("A second hosted worker did not observe the canonical entity");
    }
    checks.push({ name: "cross_replica_entity_visibility", ok: true });

    await expectRejected(
      entities[1].save(fixtures.conflictingEntity),
      "Hosted entity resolution accepted two owners for one provider alias"
    );
    const afterAliasConflict = await entities[0].list(
      fixtures.primaryEntity.workspaceId,
      fixtures.primaryEntity.companyId
    );
    if (
      afterAliasConflict.length !== 1 ||
      afterAliasConflict[0]?.id !== fixtures.primaryEntity.id ||
      JSON.stringify(afterAliasConflict[0]?.aliases) !== JSON.stringify(fixtures.primaryEntity.aliases)
    ) {
      throw new Error("Provider alias ownership changed after the rejected conflict");
    }
    checks.push({ name: "provider_alias_single_owner", ok: true });
  } catch (error) {
    operationError = error;
  } finally {
    try {
      await cleanupProbe(dependencies.clients[0], scope);
    } catch (error) {
      cleanupError = error;
    }
  }
  if (cleanupError) throw cleanupError;
  if (operationError) throw operationError;
  checks.push({ name: "probe_scope_clean", ok: true });

  if (checks.length !== 9) {
    throw new Error("Hosted learning/entity staging gate omitted a required control");
  }
  return {
    schemaVersion: "hosted-learning-entity-staging-validation/v1",
    checkedAt: now().toISOString(),
    durationMs: Math.max(0, nowMs() - startedAt),
    scopeDigest,
    healthy: true,
    checks
  };
}

type ProbeScope = { organizationId: string; projectKey: string };
type ImmutableRecordType = "metric_sample" | "observed_outcome" | "value_ledger";

async function assertImmutableRecord<T extends { id: string }>(input: {
  recordType: ImmutableRecordType;
  value: T;
  changedValue: T;
  writer(value: T): Promise<OutcomeStoreSaveResult<T>>;
  readerWriter(value: T): Promise<OutcomeStoreSaveResult<T>>;
  reader(id: string): Promise<T | undefined>;
  client: SupabaseClient;
  scope: ProbeScope;
}) {
  const first = await input.writer(input.value);
  const databaseReplay = await input.client.rpc("upsert_loopgraph_evidence_record", {
    p_organization_id: input.scope.organizationId,
    p_project_key: input.scope.projectKey,
    p_record_type: input.recordType,
    p_record_id: input.value.id,
    p_payload: input.value,
    p_expected_revision: null
  });
  const replay = await input.readerWriter(input.value);
  if (
    first.duplicate || databaseReplay.error ||
    JSON.stringify(databaseReplay.data) !== JSON.stringify(input.value) ||
    !replay.duplicate
  ) {
    throw new Error(`Hosted ${input.recordType} did not preserve idempotent replay semantics`);
  }
  const conflict = await input.client.rpc("upsert_loopgraph_evidence_record", {
    p_organization_id: input.scope.organizationId,
    p_project_key: input.scope.projectKey,
    p_record_type: input.recordType,
    p_record_id: input.value.id,
    p_payload: input.changedValue,
    p_expected_revision: null
  });
  if (!conflict.error) {
    throw new Error(`Hosted ${input.recordType} accepted a conflicting immutable payload`);
  }
  const retained = await input.reader(input.value.id);
  if (JSON.stringify(retained) !== JSON.stringify(input.value)) {
    throw new Error(`Hosted ${input.recordType} changed after an immutable conflict`);
  }
}

async function cleanupProbe(client: SupabaseClient, scope: ProbeScope) {
  const { data, error } = await client.rpc("loopgraph_learning_entity_probe_cleanup", {
    p_organization_id: scope.organizationId,
    p_project_key: scope.projectKey
  });
  if (error || !data || typeof data !== "object" || Array.isArray(data)) {
    throw new Error("Hosted learning/entity probe cleanup was unavailable");
  }
  const value = data as Record<string, unknown>;
  const expectedKeys = [
    "aliasesClean",
    "entitiesClean",
    "entitiesDeleted",
    "evidenceClean",
    "evidenceDeleted",
    "schemaVersion"
  ];
  const keys = Object.keys(value).sort();
  if (
    keys.length !== expectedKeys.length ||
    expectedKeys.some((key, index) => keys[index] !== key) ||
    value.schemaVersion !== "hosted-learning-entity-probe-cleanup/v1" ||
    value.evidenceClean !== true ||
    value.entitiesClean !== true ||
    value.aliasesClean !== true ||
    !Number.isSafeInteger(value.evidenceDeleted) || Number(value.evidenceDeleted) < 0 ||
    !Number.isSafeInteger(value.entitiesDeleted) || Number(value.entitiesDeleted) < 0
  ) {
    throw new Error("Hosted learning/entity probe cleanup did not prove an empty scope");
  }
}

function claimInput(claimedBy: string, now: Date): MeasurementJobClaimInput {
  return { claimedBy, limit: 1, leaseSeconds: 300, now };
}

async function expectRejected(operation: Promise<unknown>, message: string) {
  try {
    await operation;
  } catch {
    return;
  }
  throw new Error(message);
}

function probeFixtures(suffix: string, now: Date) {
  const observedAt = new Date(now.getTime() - 30_000).toISOString();
  const window = {
    start: new Date(now.getTime() - 120_000).toISOString(),
    end: new Date(now.getTime() - 60_000).toISOString()
  };
  const workspaceId = `probe-workspace-${suffix}`;
  const companyId = `probe-company-${suffix}`;
  const metricSample = metricSampleSchema.parse({
    id: `metric_sample_${suffix}`,
    idempotencyKey: `metric_sample_${suffix}`,
    workspaceId,
    companyId,
    departmentId: "product",
    loopId: "hosted_learning_probe",
    metricDefinitionId: `probe_metric_${suffix}`,
    metricKey: "probe_resolution_minutes",
    value: 10,
    unit: "minutes",
    window,
    observedAt,
    recordedAt: now.toISOString(),
    truthStatus: "observed",
    source: {
      type: "integration",
      sourceRef: `probe:${suffix}`,
      connectorInstanceId: `probe_connector_${suffix}`
    },
    quality: { status: "verified" },
    evidenceRefs: [`probe:${suffix}`]
  });
  const outcome = observedOutcomeSchema.parse({
    id: `observed_outcome_${suffix}`,
    workspaceId,
    companyId,
    departmentId: "product",
    loopId: "hosted_learning_probe",
    metricDefinitionId: metricSample.metricDefinitionId,
    metricKey: metricSample.metricKey,
    unit: metricSample.unit,
    desiredDirection: "decrease",
    evaluationWindow: window,
    baseline: { value: 12, sampleIds: [metricSample.id] },
    observed: { value: 10, sampleIds: [metricSample.id] },
    absoluteDelta: -2,
    relativeDeltaPct: -16.666667,
    status: "improved",
    truthStatus: "observed",
    confidence: 1,
    evidenceSufficiency: { sufficient: true, reasons: [] },
    evidenceRefs: [`metric_sample:${metricSample.id}`],
    evaluatedAt: now.toISOString()
  });
  const valueEntry = valueLedgerEntrySchema.parse({
    id: `value_ledger_${suffix}`,
    workspaceId,
    companyId,
    departmentId: "product",
    loopId: "hosted_learning_probe",
    window,
    grossSavedMinutes: 60,
    hiddenCostMinutes: { review: 5, rework: 2, botsitting: 1, escalation: 1, governance: 1 },
    observedCostMinutes: 10,
    netSavedMinutes: 50,
    truthStatus: "observed",
    observedOutcomeIds: [outcome.id],
    evidenceRefs: [`observed_outcome:${outcome.id}`],
    recordedAt: now.toISOString()
  });
  const pendingJob = measurementJobSchema.parse({
    id: `measurement_job_${suffix}`,
    idempotencyKey: `measurement_job_${suffix}`,
    projectRootId: `probe_project_${suffix}`,
    bindingId: `probe_binding_${suffix}`,
    bindingHash: canonicalAppDigest({ suffix, type: "binding" }),
    metricDefinitionId: metricSample.metricDefinitionId,
    metricKey: metricSample.metricKey,
    loopId: metricSample.loopId,
    connectorInstanceId: `probe_connector_${suffix}`,
    capabilityKey: "probe.read",
    query: {
      resource: "probe_events",
      fieldPath: "resolution_minutes",
      timestampField: "observed_at",
      aggregation: "average"
    },
    unit: metricSample.unit,
    window,
    dueAt: window.end,
    status: "pending",
    attemptCount: 0,
    maxAttempts: 3,
    createdAt: now.toISOString(),
    updatedAt: now.toISOString()
  });
  const alias = {
    provider: "loopgraph_probe",
    externalType: "account",
    externalId: `probe_external_${suffix}`,
    accountScope: `probe_account_${suffix}`
  };
  const primaryEntity = canonicalEntitySchema.parse({
    id: `entity_primary_${suffix}`,
    workspaceId,
    companyId,
    type: "account",
    displayName: "Hosted learning probe account",
    aliases: [alias],
    matchKeys: { probe: suffix },
    status: "active",
    revision: 1,
    createdAt: now.toISOString(),
    updatedAt: now.toISOString()
  });
  const conflictingEntity = canonicalEntitySchema.parse({
    ...primaryEntity,
    id: `entity_conflict_${suffix}`,
    displayName: "Conflicting hosted learning probe account"
  });
  return { pendingJob, metricSample, outcome, valueEntry, primaryEntity, conflictingEntity };
}

function trustedOrigin(value: string) {
  const url = new URL(value);
  if (
    url.protocol !== "https:" || url.username || url.password || url.pathname !== "/" ||
    url.search || url.hash
  ) {
    throw new Error("Hosted learning/entity probe requires one bare HTTPS origin");
  }
  return url.origin;
}

function assertOrganizationId(value: string) {
  if (!UUID_PATTERN.test(value)) {
    throw new Error("Hosted learning/entity probe organization must be a UUID");
  }
  return value.toLowerCase();
}

function required(name: string) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required for the hosted learning/entity probe`);
  return value;
}

async function main() {
  const supabaseUrl = required("LOOPGRAPH_LEARNING_ENTITY_PROBE_SUPABASE_URL");
  const organizationId = required("LOOPGRAPH_LEARNING_ENTITY_PROBE_ORGANIZATION_ID");
  if (process.argv.includes("--print-scope-digest")) {
    process.stdout.write(`${hostedLearningEntityProbeScopeDigest({ supabaseUrl, organizationId })}\n`);
    return;
  }
  if (required("LOOPGRAPH_LEARNING_ENTITY_PROBE_ALLOW_MUTATION") !== "yes") {
    throw new Error("LOOPGRAPH_LEARNING_ENTITY_PROBE_ALLOW_MUTATION must be exactly yes");
  }
  const expectedScopeDigest = required("LOOPGRAPH_EXPECTED_LEARNING_ENTITY_PROBE_SCOPE_DIGEST");
  const actualScopeDigest = hostedLearningEntityProbeScopeDigest({ supabaseUrl, organizationId });
  if (!DIGEST_PATTERN.test(expectedScopeDigest) || expectedScopeDigest !== actualScopeDigest) {
    throw new Error("Hosted learning/entity probe target does not match the pinned staging scope");
  }
  const serviceRole = await readProjectedSecretFile(
    required("LOOPGRAPH_LEARNING_ENTITY_PROBE_SERVICE_ROLE_KEY_FILE"),
    "LOOPGRAPH_LEARNING_ENTITY_PROBE_SERVICE_ROLE_KEY_FILE"
  );
  const options = {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }
  };
  const clients: [SupabaseClient, SupabaseClient] = [
    createClient(supabaseUrl, serviceRole, options),
    createClient(supabaseUrl, serviceRole, options)
  ];
  const receipt = await validateHostedLearningEntitiesStaging({
    supabaseUrl,
    organizationId,
    expectedScopeDigest,
    allowMutation: true
  }, { clients });
  process.stdout.write(`${JSON.stringify(receipt)}\n`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch(() => {
    process.stderr.write("Hosted learning/entity staging probe failed\n");
    process.exitCode = 1;
  });
}
