import { z } from "zod";
import { DepartmentTypeSchema } from "./department-skills";

export const LOOP_OPPORTUNITY_SCHEMA_VERSION = "loop-opportunity/v1alpha1" as const;
export const GRAPH_CHANGE_SET_SCHEMA_VERSION = "graph-change-set/v1alpha1" as const;

export const loopOpportunitySignalTypeSchema = z.enum([
  "unhandled_problem",
  "human_route_choice",
  "routing_correction",
  "router_evaluation_failure",
  "route_job_failure",
  "run_failure",
  "verification_failure",
  "review_friction",
  "outcome_regression",
  "outcome_incomplete",
  "negative_value",
  "improvement_signal"
]);

export const loopOpportunityKindSchema = z.enum([
  "create_loop",
  "improve_loop",
  "split_loop",
  "merge_loops",
  "retire_loop"
]);

export const loopOpportunityStatusSchema = z.enum([
  "detected",
  "qualified",
  "design_requested",
  "designing",
  "proposal_ready",
  "dismissed",
  "implemented"
]);

export const loopOpportunitySignalSchema = z.object({
  id: z.string().min(1),
  type: loopOpportunitySignalTypeSchema,
  sourceRef: z.string().min(1),
  workspaceId: z.string().min(1).optional(),
  companyId: z.string().min(1).optional(),
  occurredAt: z.string().datetime(),
  summary: z.string().min(1),
  severity: z.enum(["low", "medium", "high", "critical"]).default("medium"),
  problemType: z.string().min(1).optional(),
  loopId: z.string().optional(),
  problemId: z.string().optional(),
  eventId: z.string().optional(),
  evidenceRefs: z.array(z.string()).default([]),
  metrics: z.object({
    reviewMinutes: z.number().min(0).optional(),
    reworkMinutes: z.number().min(0).optional(),
    botsittingMinutes: z.number().min(0).optional(),
    netSavedMinutes: z.number().optional(),
    relativeDeltaPct: z.number().optional()
  }).default({})
});

export const loopOpportunityScoreSchema = z.object({
  total: z.number().min(0).max(100),
  recurrence: z.number().min(0).max(25),
  businessImpact: z.number().min(0).max(25),
  coverageGap: z.number().min(0).max(25),
  evidenceConfidence: z.number().min(0).max(15),
  humanFriction: z.number().min(0).max(15),
  riskPenalty: z.number().min(0).max(20),
  explanation: z.array(z.string().min(1)).min(1)
});

export const loopOpportunitySchema = z.object({
  schemaVersion: z.literal(LOOP_OPPORTUNITY_SCHEMA_VERSION).default(LOOP_OPPORTUNITY_SCHEMA_VERSION),
  id: z.string().min(1),
  fingerprint: z.string().min(1),
  generation: z.number().int().min(1).default(1),
  supersedesOpportunityId: z.string().optional(),
  workspaceId: z.string().min(1),
  companyId: z.string().min(1),
  department: DepartmentTypeSchema,
  kind: loopOpportunityKindSchema,
  status: loopOpportunityStatusSchema,
  problemType: z.string().min(1),
  title: z.string().min(1),
  summary: z.string().min(1),
  targetLoopIds: z.array(z.string()).default([]),
  problemIds: z.array(z.string()).default([]),
  signalIds: z.array(z.string()).default([]),
  signals: z.array(loopOpportunitySignalSchema).min(1),
  score: loopOpportunityScoreSchema,
  thresholds: z.object({
    qualify: z.number().min(0).max(100),
    autoDesign: z.number().min(0).max(100)
  }),
  discoverySessionId: z.string().optional(),
  designTaskId: z.string().optional(),
  graphChangeSetId: z.string().optional(),
  firstObservedAt: z.string().datetime(),
  lastObservedAt: z.string().datetime(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  dismissedAt: z.string().datetime().optional(),
  dismissalReason: z.string().optional()
});

export const graphChangeOperationSchema = z.enum([
  "add",
  "update",
  "split",
  "merge",
  "retire"
]);

export const graphChangeSchema = z.object({
  id: z.string().min(1),
  operation: graphChangeOperationSchema,
  department: DepartmentTypeSchema,
  targetLoopIds: z.array(z.string()).default([]),
  proposedLoopCount: z.number().int().min(0),
  title: z.string().min(1),
  rationale: z.string().min(1),
  expectedOutcome: z.string().min(1),
  evidenceRefs: z.array(z.string()).default([]),
  requiresExplicitApproval: z.boolean().default(true)
});

export const graphChangeSetSchema = z.object({
  schemaVersion: z.literal(GRAPH_CHANGE_SET_SCHEMA_VERSION).default(GRAPH_CHANGE_SET_SCHEMA_VERSION),
  id: z.string().min(1),
  version: z.number().int().min(1),
  workspaceId: z.string().min(1),
  companyId: z.string().min(1),
  baseGraphHash: z.string().min(1),
  opportunityId: z.string().min(1),
  status: z.enum(["proposed", "approved", "applied", "rejected", "superseded", "rolled_back"]).default("proposed"),
  changes: z.array(graphChangeSchema).min(1),
  supersedesId: z.string().optional(),
  designTaskId: z.string().optional(),
  designRunId: z.string().optional(),
  approvalReceiptIds: z.array(z.string().min(1)).default([]),
  appliedTransactionId: z.string().min(1).optional(),
  resultGraphHash: z.string().min(1).optional(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  appliedAt: z.string().datetime().optional(),
  rolledBackAt: z.string().datetime().optional(),
  rolledBackBy: z.string().min(1).optional()
});

export type LoopOpportunitySignalType = z.infer<typeof loopOpportunitySignalTypeSchema>;
export type LoopOpportunityKind = z.infer<typeof loopOpportunityKindSchema>;
export type LoopOpportunityStatus = z.infer<typeof loopOpportunityStatusSchema>;
export type LoopOpportunitySignal = z.infer<typeof loopOpportunitySignalSchema>;
export type LoopOpportunityScore = z.infer<typeof loopOpportunityScoreSchema>;
export type LoopOpportunity = z.infer<typeof loopOpportunitySchema>;
export type GraphChangeOperation = z.infer<typeof graphChangeOperationSchema>;
export type GraphChange = z.infer<typeof graphChangeSchema>;
export type GraphChangeSet = z.infer<typeof graphChangeSetSchema>;
