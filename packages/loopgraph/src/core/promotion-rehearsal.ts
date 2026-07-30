import { z } from "zod";
import { contentHash } from "./hash";
import { routingActivationModeSchema } from "./routing";

export const PROMOTION_REHEARSAL_SCHEMA_VERSION = "promotion-rehearsal/v1alpha1" as const;

export const promotionRehearsalScenarioKindSchema = z.enum([
  "loop_happy_path",
  "loop_missing_context",
  "loop_risk_escalation",
  "routing_positive",
  "routing_missing_context",
  "routing_risk",
  "duplicate_delivery",
  "no_match",
  "ambiguity_abstention",
  "catalog_overlap",
  "graph_regression",
  "activation_policy"
]);

export const promotionRehearsalScenarioReceiptSchema = z.object({
  kind: promotionRehearsalScenarioKindSchema,
  required: z.boolean().default(true),
  status: z.enum(["passed", "failed", "not_applicable"]),
  fixtureIds: z.array(z.string().min(1)).default([]),
  runIds: z.array(z.string().min(1)).default([]),
  evaluationIds: z.array(z.string().min(1)).default([]),
  checkedLoopIds: z.array(z.string().min(1)).default([]),
  evidenceRefs: z.array(z.string().min(1)).default([]),
  errors: z.array(z.string().min(1)).default([])
});

export const promotionRoutingMetricsSchema = z.object({
  truePositiveCount: z.number().int().min(0),
  falseTriggerCount: z.number().int().min(0),
  missedProblemCount: z.number().int().min(0),
  abstentionCount: z.number().int().min(0),
  expectedRouteCount: z.number().int().min(0),
  expectedNoRouteCount: z.number().int().min(0),
  duplicateExpectedCount: z.number().int().min(0),
  duplicateSuppressedCount: z.number().int().min(0),
  precision: z.number().min(0).max(1),
  recall: z.number().min(0).max(1),
  falseTriggerRate: z.number().min(0).max(1),
  missedProblemRate: z.number().min(0).max(1),
  abstentionRate: z.number().min(0).max(1),
  duplicateSuppressionRate: z.number().min(0).max(1).optional(),
  averageDecisionLatencyMs: z.number().min(0)
});

export const promotionRehearsalReportSchema = z.object({
  schemaVersion: z.literal(PROMOTION_REHEARSAL_SCHEMA_VERSION).default(PROMOTION_REHEARSAL_SCHEMA_VERSION),
  id: z.string().min(1),
  reportHash: z.string().min(1),
  projectRootId: z.string().min(1),
  loopId: z.string().min(1),
  loopSpecHash: z.string().min(1),
  graphHash: z.string().min(1),
  fixtureManifestHash: z.string().min(1),
  previousMode: routingActivationModeSchema,
  targetMode: routingActivationModeSchema,
  status: z.enum(["passed", "failed"]),
  requiredScenarioKinds: z.array(promotionRehearsalScenarioKindSchema).min(1),
  scenarios: z.array(promotionRehearsalScenarioReceiptSchema).min(1),
  routingMetrics: promotionRoutingMetricsSchema,
  routingGateFailures: z.array(z.string().min(1)).default([]),
  generatedBy: z.string().min(1),
  createdAt: z.string().datetime(),
  validUntil: z.string().datetime()
});

export type PromotionRehearsalScenarioKind = z.infer<typeof promotionRehearsalScenarioKindSchema>;
export type PromotionRehearsalScenarioReceipt = z.infer<typeof promotionRehearsalScenarioReceiptSchema>;
export type PromotionRehearsalReport = z.infer<typeof promotionRehearsalReportSchema>;

export function promotionRehearsalHash(
  report: Omit<PromotionRehearsalReport, "id" | "reportHash">
): string {
  return contentHash(report);
}

export function promotionRehearsalEvidenceRef(reportId: string): string {
  return `promotion-rehearsal:${reportId}`;
}
