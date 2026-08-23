import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";
import type {
  CanonicalEntity,
  MeasurementJob,
  MetricSample,
  ObservedOutcome,
  ValueLedgerEntry
} from "loopgraph/core";
import {
  hostedLearningEntityProbeScopeDigest,
  validateHostedLearningEntitiesStaging
} from "./validate-hosted-learning-entities-staging";

const scope = {
  supabaseUrl: "https://learning-staging.supabase.co",
  organizationId: "123e4567-e89b-42d3-a456-426614174000"
};
const config = {
  ...scope,
  expectedScopeDigest: hostedLearningEntityProbeScopeDigest(scope),
  allowMutation: true
};
const suffix = "0123456789abcdef01234567";

describe("hosted learning and entity staging probe", () => {
  it("proves distributed claims, immutable evidence, alias ownership, and exact cleanup", async () => {
    const harness = probeHarness();
    let clock = 100;
    const receipt = await validateHostedLearningEntitiesStaging(config, {
      clients: harness.clients,
      probeSuffix: () => suffix,
      now: sequentialDates([
        "2026-08-23T04:00:00.000Z",
        "2026-08-23T04:00:01.000Z"
      ]),
      nowMs: () => (clock += 25),
      createEvidenceStore: harness.createEvidenceStore,
      createEntityStore: harness.createEntityStore
    });

    expect(receipt).toEqual({
      schemaVersion: "hosted-learning-entity-staging-validation/v1",
      checkedAt: "2026-08-23T04:00:01.000Z",
      durationMs: 25,
      scopeDigest: config.expectedScopeDigest,
      healthy: true,
      checks: [
        { name: "distributed_measurement_claim", ok: true },
        { name: "stale_lease_rejected", ok: true },
        { name: "cross_replica_job_finalization", ok: true },
        { name: "metric_sample_immutable", ok: true },
        { name: "observed_outcome_immutable", ok: true },
        { name: "value_ledger_immutable", ok: true },
        { name: "cross_replica_entity_visibility", ok: true },
        { name: "provider_alias_single_owner", ok: true },
        { name: "probe_scope_clean", ok: true }
      ]
    });
    expect(harness.cleanupCalls).toBe(2);
    expect(harness.isEmpty()).toBe(true);
    const serialized = JSON.stringify(receipt);
    expect(serialized).not.toContain(scope.supabaseUrl);
    expect(serialized).not.toContain(scope.organizationId);
    expect(serialized).not.toContain(suffix);
    expect(serialized).not.toContain("lease-token");
    expect(serialized).not.toContain("probe_external");
  });

  it("requires explicit mutation authority and an independently pinned scope", async () => {
    const harness = probeHarness();
    await expect(validateHostedLearningEntitiesStaging({ ...config, allowMutation: false }, {
      clients: harness.clients
    })).rejects.toThrow(/explicitly enabled/i);
    await expect(validateHostedLearningEntitiesStaging({
      ...config,
      expectedScopeDigest: `sha256:${"f".repeat(64)}`
    }, {
      clients: harness.clients
    })).rejects.toThrow(/pinned staging scope/i);
    expect(harness.cleanupCalls).toBe(0);
  });

  it("cleans the reserved scope when an evidence assertion fails", async () => {
    const harness = probeHarness({ failObservedOutcomeSave: true });
    await expect(validateHostedLearningEntitiesStaging(config, {
      clients: harness.clients,
      probeSuffix: () => suffix,
      now: () => new Date("2026-08-23T04:00:00.000Z"),
      createEvidenceStore: harness.createEvidenceStore,
      createEntityStore: harness.createEntityStore
    })).rejects.toThrow(/synthetic outcome failure/i);
    expect(harness.cleanupCalls).toBe(2);
    expect(harness.isEmpty()).toBe(true);
  });

  it("rejects malformed probe identities before privileged calls", async () => {
    const harness = probeHarness();
    await expect(validateHostedLearningEntitiesStaging(config, {
      clients: harness.clients,
      probeSuffix: () => "not-random",
      createEvidenceStore: harness.createEvidenceStore,
      createEntityStore: harness.createEntityStore
    })).rejects.toThrow(/identity is invalid/i);
    expect(harness.cleanupCalls).toBe(0);
  });

  it("uses a canonical lowercase organization for cleanup and store scopes", async () => {
    const harness = probeHarness();
    await expect(validateHostedLearningEntitiesStaging({
      ...config,
      organizationId: scope.organizationId.toUpperCase()
    }, {
      clients: harness.clients,
      probeSuffix: () => suffix,
      now: () => new Date("2026-08-23T04:00:00.000Z"),
      createEvidenceStore: harness.createEvidenceStore,
      createEntityStore: harness.createEntityStore
    })).resolves.toMatchObject({ healthy: true });
    expect(harness.scopes.every((value) => value.organizationId === scope.organizationId)).toBe(true);
  });
});

function probeHarness(options: { failObservedOutcomeSave?: boolean } = {}) {
  let cleanupCalls = 0;
  let job: MeasurementJob | undefined;
  let aliasOwner: string | undefined;
  const entities = new Map<string, CanonicalEntity>();
  const immutable = {
    metric_sample: new Map<string, MetricSample>(),
    observed_outcome: new Map<string, ObservedOutcome>(),
    value_ledger: new Map<string, ValueLedgerEntry>()
  };
  const scopes: Array<{ organizationId: string; projectKey: string }> = [];
  const clientIndexes = new WeakMap<object, number>();
  const clients = [0, 1].map((index) => {
    const client = {
      rpc: async (name: string, args: Record<string, unknown>) => {
        expect(args.p_organization_id).toBe(scope.organizationId);
        expect(args.p_project_key).toMatch(/^learning_probe_[a-f0-9]{24}$/);
        if (name === "loopgraph_learning_entity_probe_cleanup") {
          cleanupCalls += 1;
          const evidenceDeleted = Number(Boolean(job)) + Object.values(immutable)
            .reduce((total, records) => total + records.size, 0);
          const entitiesDeleted = entities.size;
          job = undefined;
          aliasOwner = undefined;
          entities.clear();
          Object.values(immutable).forEach((records) => records.clear());
          return {
            data: {
              schemaVersion: "hosted-learning-entity-probe-cleanup/v1",
              evidenceClean: true,
              entitiesClean: true,
              aliasesClean: true,
              evidenceDeleted,
              entitiesDeleted
            },
            error: null
          };
        }
        if (name === "upsert_loopgraph_evidence_record") {
          const recordType = args.p_record_type as keyof typeof immutable;
          const payload = args.p_payload as MetricSample | ObservedOutcome | ValueLedgerEntry;
          const existing = immutable[recordType].get(payload.id);
          if (existing && JSON.stringify(existing) !== JSON.stringify(payload)) {
            return { data: null, error: new Error("immutable conflict") };
          }
          return { data: payload, error: null };
        }
        return { data: null, error: new Error("unexpected RPC") };
      }
    } as unknown as SupabaseClient;
    clientIndexes.set(client as object, index);
    return client;
  }) as [SupabaseClient, SupabaseClient];

  const createEvidenceStore = (client: SupabaseClient, targetScope: { organizationId: string; projectKey: string }) => {
    scopes.push(targetScope);
    const index = clientIndexes.get(client as object)!;
    return {
      saveMeasurementJob: async (value: MeasurementJob) => {
        if (!job) job = structuredClone(value);
        return structuredClone(job);
      },
      claimDueJobs: async () => {
        if (!job || job.status !== "pending") return [];
        job = {
          ...job,
          status: "claimed",
          attemptCount: job.attemptCount + 1,
          lease: {
            claimedBy: `worker-${index}`,
            tokenHash: "0123456789abcdef",
            claimedAt: "2026-08-23T04:00:00.000Z",
            expiresAt: "2026-08-23T04:05:00.000Z"
          }
        };
        return [{ job: structuredClone(job), leaseToken: `lease-token-${index}` }];
      },
      saveClaimedMeasurementJob: async (value: MeasurementJob, expectedHash: string) => {
        if (!job?.lease || job.lease.tokenHash !== expectedHash) throw new Error("lease conflict");
        job = structuredClone(value);
        return structuredClone(job);
      },
      getMeasurementJob: async () => job ? structuredClone(job) : undefined,
      saveMetricSample: (value: MetricSample) => saveImmutable("metric_sample", value),
      getMetricSample: async (id: string) => clone(immutable.metric_sample.get(id)),
      saveObservedOutcome: async (value: ObservedOutcome) => {
        if (options.failObservedOutcomeSave) throw new Error("synthetic outcome failure");
        return saveImmutable("observed_outcome", value);
      },
      getObservedOutcome: async (id: string) => clone(immutable.observed_outcome.get(id)),
      saveValueLedgerEntry: (value: ValueLedgerEntry) => saveImmutable("value_ledger", value),
      getValueLedgerEntry: async (id: string) => clone(immutable.value_ledger.get(id))
    };
  };

  const createEntityStore = (_client: SupabaseClient, targetScope: { organizationId: string; projectKey: string }) => {
    scopes.push(targetScope);
    return {
      save: async (value: CanonicalEntity) => {
        const alias = value.aliases[0];
        if (aliasOwner && aliasOwner !== value.id && alias) throw new Error("alias conflict");
        if (alias) aliasOwner = value.id;
        entities.set(value.id, structuredClone(value));
        return structuredClone(value);
      },
      list: async (workspaceId: string, companyId: string) => [...entities.values()]
        .filter((value) => value.workspaceId === workspaceId && value.companyId === companyId)
        .map((value) => structuredClone(value))
    };
  };

  async function saveImmutable<T extends MetricSample | ObservedOutcome | ValueLedgerEntry>(
    type: keyof typeof immutable,
    value: T
  ) {
    const records = immutable[type] as Map<string, T>;
    const existing = records.get(value.id);
    if (existing) {
      if (JSON.stringify(existing) !== JSON.stringify(value)) throw new Error("immutable conflict");
      return { record: structuredClone(existing), duplicate: true };
    }
    records.set(value.id, structuredClone(value));
    return { record: structuredClone(value), duplicate: false };
  }

  return {
    clients,
    createEvidenceStore,
    createEntityStore,
    scopes,
    get cleanupCalls() { return cleanupCalls; },
    isEmpty: () => !job && !aliasOwner && entities.size === 0 &&
      Object.values(immutable).every((records) => records.size === 0)
  };
}

function clone<T>(value: T | undefined): T | undefined {
  return value === undefined ? undefined : structuredClone(value);
}

function sequentialDates(values: string[]) {
  let index = 0;
  return () => new Date(values[Math.min(index++, values.length - 1)]!);
}
