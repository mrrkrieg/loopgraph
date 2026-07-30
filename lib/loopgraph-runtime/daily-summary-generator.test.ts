import { describe, expect, it } from "vitest";
import { buildDemoDiscoverySession } from "./discovery-engine";
import { generateDailySummary } from "./daily-summary-generator";
import { tryMaterializeLoopRecommendation } from "./loop-materializer";

describe("daily summary generator", () => {
  it("marks missing access and undefined metrics in loop status", async () => {
    const session = await buildDemoDiscoverySession();
    const accepted = session.recommendedLoops.slice(0, 2).map((recommendation) => ({ ...recommendation, status: "accepted" as const }));
    const specs = accepted.flatMap((recommendation) => {
      const departmentProfile = session.departmentProfiles.find((department) => department.id === recommendation.departmentId);
      const result = tryMaterializeLoopRecommendation({
        recommendation,
        companyProfile: session.companyProfile!,
        departmentProfile: departmentProfile!,
        accessRequirements: session.accessRequirements.filter((access) => access.loopRecommendationId === recommendation.id),
        metricDefinitions: session.metricDefinitions.filter((metric) => metric.loopRecommendationId === recommendation.id),
        humanRequirements: session.humanRequirements.filter((human) => human.loopRecommendationId === recommendation.id)
      });
      return result.ok ? [result.spec] : [];
    });

    const summary = generateDailySummary({
      companyId: session.companyId,
      loopSpecs: specs,
      traces: [],
      cases: [],
      reviews: [],
      accessRequirements: session.accessRequirements,
      metricDefinitions: session.metricDefinitions,
      undefinedMetrics: session.undefinedMetrics,
      improvements: []
    });

    expect(summary.netSavedMinutes).toBe(0);
    expect(summary.grossSavedMinutes).toBe(0);
    expect(summary.valueTruthStatus).toBe("incomplete");
    expect(summary.loops.map((loop) => loop.status)).toContain("missing_access");
    expect(summary.recommendedActions.some((action) => action.targetType === "access")).toBe(true);
  });

  it("uses only ledger evidence for saved time and reports observed metric movement", async () => {
    const session = await buildDemoDiscoverySession();
    const recommendation = session.recommendedLoops[0]!;
    const departmentProfile = session.departmentProfiles.find((department) => department.id === recommendation.departmentId)!;
    const result = tryMaterializeLoopRecommendation({
      recommendation: { ...recommendation, status: "accepted" },
      companyProfile: session.companyProfile!,
      departmentProfile,
      accessRequirements: [],
      metricDefinitions: session.metricDefinitions.filter((metric) => metric.loopRecommendationId === recommendation.id),
      humanRequirements: session.humanRequirements.filter((human) => human.loopRecommendationId === recommendation.id)
    });
    if (!result.ok) throw new Error(result.errors.join("; "));
    const metricDefinition = session.metricDefinitions.find((metric) => metric.loopRecommendationId === recommendation.id)!;

    const summary = generateDailySummary({
      companyId: session.companyId,
      loopSpecs: [result.spec],
      traces: [],
      cases: [],
      reviews: [],
      accessRequirements: [],
      metricDefinitions: [metricDefinition],
      undefinedMetrics: [],
      improvements: [],
      date: "2026-07-12",
      metricSamples: [{
        schemaVersion: "metric-sample/v1alpha1",
        id: "sample_1",
        idempotencyKey: "sample_key_1",
        workspaceId: "workspace_1",
        companyId: session.companyId,
        departmentId: result.spec.topology?.department,
        loopId: result.spec.metadata.id,
        metricDefinitionId: metricDefinition.id,
        metricKey: metricDefinition.key,
        value: 42,
        unit: metricDefinition.unit ?? "count",
        window: {
          start: "2026-07-12T00:00:00.000Z",
          end: "2026-07-12T23:59:59.000Z"
        },
        observedAt: "2026-07-12T23:59:59.000Z",
        recordedAt: "2026-07-12T23:59:59.000Z",
        truthStatus: "observed",
        source: {
          type: "integration",
          sourceRef: "analytics:metric:2026-07-12"
        },
        quality: { status: "verified" },
        evidenceRefs: []
      }],
      observedOutcomes: [],
      valueLedgerEntries: [{
        schemaVersion: "value-ledger-entry/v1alpha1",
        id: "ledger_1",
        workspaceId: "workspace_1",
        companyId: session.companyId,
        departmentId: result.spec.topology?.department,
        loopId: result.spec.metadata.id,
        window: {
          start: "2026-07-12T00:00:00.000Z",
          end: "2026-07-12T23:59:59.000Z"
        },
        grossSavedMinutes: 90,
        hiddenCostMinutes: {
          review: 10,
          rework: 5,
          botsitting: 4,
          escalation: 0,
          governance: 1
        },
        observedCostMinutes: 20,
        netSavedMinutes: 70,
        truthStatus: "observed",
        calculationVersion: "loop-value/v1alpha1",
        observedOutcomeIds: ["outcome_1"],
        runIds: [],
        reviewIds: [],
        evidenceRefs: [],
        recordedAt: "2026-07-12T23:59:59.000Z"
      }]
    });

    expect(summary).toMatchObject({
      grossSavedMinutes: 90,
      netSavedMinutes: 70,
      botsittingMinutes: 4,
      valueTruthStatus: "observed",
      metricSampleCount: 1,
      valueLedgerEntryCount: 1
    });
    expect(summary.loops[0]).toMatchObject({
      mainMetric: { value: 42, status: "observed" },
      netSavedMinutes: 70,
      valueTruthStatus: "observed"
    });
  });
});
