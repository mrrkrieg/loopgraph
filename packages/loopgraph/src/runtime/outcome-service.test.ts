import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { LoopRunTrace, MetricDefinition } from "../core";
import {
  deriveLoopValueLedgerEntry,
  evaluateObservedOutcome,
  recordMetricSample,
  recordValueLedgerEntry
} from "./outcome-service";
import { FileOutcomeStore } from "./outcome-store";

describe("observed outcomes and value ledger", () => {
  it("records metric samples idempotently and rejects a conflicting duplicate identity", async () => {
    const store = await tempStore();
    const input = sampleInput({
      value: 100,
      sourceRef: "analytics:activation:2026-07-01"
    });
    const first = await recordMetricSample(store, input, new Date("2026-07-02T00:00:00.000Z"));
    const duplicate = await recordMetricSample(store, input, new Date("2026-07-03T00:00:00.000Z"));

    expect(first.duplicate).toBe(false);
    expect(duplicate).toMatchObject({
      duplicate: true,
      record: { id: first.record.id, value: 100 }
    });
    await expect(recordMetricSample(store, {
      ...input,
      value: 101
    }, new Date("2026-07-03T00:00:00.000Z"))).rejects.toThrow(/idempotency conflict/);
  });

  it("evaluates an observed target outcome from baseline and evaluation windows", async () => {
    const store = await tempStore();
    const definition = metricDefinition();
    await recordMetricSample(store, sampleInput({
      value: 100,
      sourceRef: "analytics:cac:baseline",
      window: {
        start: "2026-06-01T00:00:00.000Z",
        end: "2026-06-30T23:59:59.000Z"
      },
      observedAt: "2026-06-30T23:59:59.000Z"
    }));
    await recordMetricSample(store, sampleInput({
      value: 80,
      sourceRef: "analytics:cac:observed",
      window: {
        start: "2026-07-01T00:00:00.000Z",
        end: "2026-07-31T23:59:59.000Z"
      },
      observedAt: "2026-07-31T23:59:59.000Z"
    }));

    const result = await evaluateObservedOutcome({
      store,
      workspaceId: "workspace_1",
      companyId: "company_1",
      departmentId: "marketing",
      loopId: "marketing_ads",
      metricDefinition: definition,
      baselineWindow: {
        start: "2026-06-01T00:00:00.000Z",
        end: "2026-06-30T23:59:59.000Z"
      },
      evaluationWindow: {
        start: "2026-07-01T00:00:00.000Z",
        end: "2026-07-31T23:59:59.000Z"
      },
      now: new Date("2026-08-01T00:00:00.000Z")
    });

    expect(result.record).toMatchObject({
      status: "target_met",
      truthStatus: "observed",
      baseline: { value: 100 },
      observed: { value: 80 },
      absoluteDelta: -20,
      relativeDeltaPct: -20,
      evidenceSufficiency: { sufficient: true }
    });
  });

  it("marks an outcome incomplete instead of inventing a baseline or observed value", async () => {
    const store = await tempStore();
    const result = await evaluateObservedOutcome({
      store,
      workspaceId: "workspace_1",
      companyId: "company_1",
      loopId: "marketing_ads",
      metricDefinition: metricDefinition(),
      baselineWindow: {
        start: "2026-06-01T00:00:00.000Z",
        end: "2026-06-30T23:59:59.000Z"
      },
      evaluationWindow: {
        start: "2026-07-01T00:00:00.000Z",
        end: "2026-07-31T23:59:59.000Z"
      }
    });

    expect(result.record).toMatchObject({
      status: "incomplete",
      truthStatus: "incomplete",
      confidence: 0,
      evidenceSufficiency: {
        sufficient: false,
        reasons: expect.arrayContaining([
          expect.stringContaining("baseline"),
          expect.stringContaining("observed")
        ])
      }
    });
    expect(result.record.baseline).toBeUndefined();
    expect(result.record.observed).toBeUndefined();
  });

  it("derives net value from an observed outcome and recorded human labor", async () => {
    const store = await tempStore();
    const definition = metricDefinition();
    await recordMetricSample(store, sampleInput({
      value: 100,
      sourceRef: "analytics:cac:baseline",
      window: {
        start: "2026-06-01T00:00:00.000Z",
        end: "2026-06-30T23:59:59.000Z"
      },
      observedAt: "2026-06-30T23:59:59.000Z"
    }));
    await recordMetricSample(store, sampleInput({
      value: 80,
      sourceRef: "analytics:cac:observed",
      window: {
        start: "2026-07-01T00:00:00.000Z",
        end: "2026-07-31T23:59:59.000Z"
      },
      observedAt: "2026-07-31T23:59:59.000Z"
    }));
    const outcome = (await evaluateObservedOutcome({
      store,
      workspaceId: "workspace_1",
      companyId: "company_1",
      loopId: "marketing_ads",
      metricDefinition: definition,
      baselineWindow: {
        start: "2026-06-01T00:00:00.000Z",
        end: "2026-06-30T23:59:59.000Z"
      },
      evaluationWindow: {
        start: "2026-07-01T00:00:00.000Z",
        end: "2026-07-31T23:59:59.000Z"
      }
    })).record;
    const trace = {
      id: "run_1",
      loopId: "marketing_ads",
      humanReviews: [{
        id: "review_1",
        runId: "run_1",
        status: "approved",
        reviewerId: "owner_1",
        role: "approver",
        approvedFingerprints: [],
        rejectedFingerprints: [],
        reviewMinutes: 12,
        reworkMinutes: 5,
        botsittingMinutes: 3,
        governanceMinutes: 2,
        createdAt: "2026-07-15T00:00:00.000Z"
      }]
    } as unknown as LoopRunTrace;

    const result = await deriveLoopValueLedgerEntry({
      store,
      workspaceId: "workspace_1",
      companyId: "company_1",
      departmentId: "marketing",
      loopId: "marketing_ads",
      metricDefinition: definition,
      outcomeId: outcome.id,
      traces: [trace],
      window: {
        start: "2026-07-01T00:00:00.000Z",
        end: "2026-07-31T23:59:59.000Z"
      }
    });

    expect(result.record).toMatchObject({
      grossSavedMinutes: 200,
      observedCostMinutes: 22,
      netSavedMinutes: 178,
      truthStatus: "observed",
      observedOutcomeIds: [outcome.id],
      hiddenCostMinutes: {
        review: 12,
        rework: 5,
        botsitting: 3,
        escalation: 0,
        governance: 2
      }
    });
  });

  it("preserves samples referenced by outcomes while pruning unreferenced history", async () => {
    const store = await tempStore();
    const referenced = await recordMetricSample(store, sampleInput({
      value: 100,
      sourceRef: "analytics:referenced",
      window: {
        start: "2025-01-01T00:00:00.000Z",
        end: "2025-01-02T00:00:00.000Z"
      },
      observedAt: "2025-01-02T00:00:00.000Z"
    }));
    const orphan = await recordMetricSample(store, sampleInput({
      value: 90,
      sourceRef: "analytics:orphan",
      window: {
        start: "2025-01-03T00:00:00.000Z",
        end: "2025-01-04T00:00:00.000Z"
      },
      observedAt: "2025-01-04T00:00:00.000Z"
    }));
    await recordValueLedgerEntry({
      store,
      workspaceId: "workspace_1",
      companyId: "company_1",
      loopId: "marketing_ads",
      window: {
        start: "2025-01-01T00:00:00.000Z",
        end: "2025-01-31T00:00:00.000Z"
      }
    });
    await store.saveObservedOutcome({
      schemaVersion: "observed-outcome/v1alpha1",
      id: "outcome_retention",
      workspaceId: "workspace_1",
      companyId: "company_1",
      loopId: "marketing_ads",
      metricDefinitionId: "metric_cac",
      metricKey: "cost_per_qualified_customer",
      unit: "USD",
      desiredDirection: "decrease",
      evaluationWindow: {
        start: "2025-01-01T00:00:00.000Z",
        end: "2025-01-31T00:00:00.000Z"
      },
      baseline: {
        value: 100,
        sampleIds: [referenced.record.id]
      },
      status: "incomplete",
      truthStatus: "incomplete",
      confidence: 0,
      evidenceSufficiency: {
        sufficient: false,
        reasons: ["Observed evaluation sample has not arrived."]
      },
      guardrails: [],
      runIds: [],
      problemIds: [],
      evidenceRefs: [`metric_sample:${referenced.record.id}`],
      evaluatedAt: "2025-02-01T00:00:00.000Z"
    });

    const result = await store.pruneMetricSamples({
      olderThan: "2026-01-01T00:00:00.000Z"
    });

    expect(result.removedSampleIds).toEqual([orphan.record.id]);
    expect(result.preservedReferencedSampleIds).toEqual([referenced.record.id]);
    expect(await store.getMetricSample(referenced.record.id)).toBeTruthy();
    expect(await store.getMetricSample(orphan.record.id)).toBeUndefined();
  });
});

async function tempStore() {
  return new FileOutcomeStore(await mkdtemp(path.join(tmpdir(), "loopgraph-outcomes-")));
}

function metricDefinition(): MetricDefinition {
  return {
    id: "metric_cac",
    companyId: "company_1",
    departmentId: "marketing",
    loopId: "marketing_ads",
    key: "cost_per_qualified_customer",
    label: "Cost per qualified customer",
    description: "Qualified acquisition cost.",
    type: "currency",
    source: "integration",
    baselineRequired: true,
    unit: "USD",
    desiredDirection: "decrease",
    target: 85,
    valuePerUnitMinutes: 10,
    displayInDailySummary: true
  };
}

function sampleInput(overrides: {
  value: number;
  sourceRef: string;
  window?: { start: string; end: string };
  observedAt?: string;
}) {
  return {
    workspaceId: "workspace_1",
    companyId: "company_1",
    departmentId: "marketing",
    loopId: "marketing_ads",
    metricDefinitionId: "metric_cac",
    metricKey: "cost_per_qualified_customer",
    value: overrides.value,
    unit: "USD",
    window: overrides.window ?? {
      start: "2026-07-01T00:00:00.000Z",
      end: "2026-07-01T23:59:59.000Z"
    },
    observedAt: overrides.observedAt ?? "2026-07-01T23:59:59.000Z",
    source: {
      type: "integration" as const,
      sourceRef: overrides.sourceRef,
      connectorInstanceId: "analytics_primary"
    },
    quality: {
      status: "verified" as const
    },
    evidenceRefs: [`source:${overrides.sourceRef}`]
  };
}
