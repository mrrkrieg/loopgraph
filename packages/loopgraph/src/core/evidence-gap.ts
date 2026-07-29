import { z } from "zod";
import { DepartmentTypeSchema } from "./department-skills";
import { DiscoveryAnswerValueTypeSchema } from "./discovery";

export const EVIDENCE_GAP_SCHEMA_VERSION = "evidence-gap/v1alpha1" as const;
export const EVIDENCE_GAP_SET_SCHEMA_VERSION = "evidence-gap-set/v1alpha1" as const;

export const evidenceGapRequiredForSchema = z.enum([
  "problem_classification",
  "design",
  "simulation",
  "routing",
  "execution"
]);

export const evidenceGapResolutionSchema = z.enum([
  "ask_user",
  "inspect_project",
  "connect_source",
  "request_sample",
  "assign_owner",
  "define_policy",
  "revise_proposal"
]);

export const evidenceGapStatusSchema = z.enum([
  "open",
  "asked",
  "resolved",
  "waived"
]);

export const evidenceGapSchema = z.object({
  schemaVersion: z.literal(EVIDENCE_GAP_SCHEMA_VERSION).default(EVIDENCE_GAP_SCHEMA_VERSION),
  id: z.string().min(1),
  sessionId: z.string().min(1),
  companyId: z.string().min(1),
  department: DepartmentTypeSchema.optional(),
  scope: z.enum(["company", "department", "problem", "loop", "connection", "metric", "policy"]),
  field: z.string().min(1),
  questionId: z.string().min(1).optional(),
  reason: z.string().min(1),
  requiredFor: z.array(evidenceGapRequiredForSchema).min(1),
  resolution: evidenceGapResolutionSchema,
  status: evidenceGapStatusSchema.default("open"),
  blocking: z.boolean().default(true),
  confidence: z.number().min(0).max(1).optional(),
  evidenceRefs: z.array(z.string()).default([]),
  question: z.object({
    prompt: z.string().min(1),
    valueType: DiscoveryAnswerValueTypeSchema,
    options: z.array(z.string()).optional(),
    examples: z.array(z.string()).default([])
  }).optional(),
  answerRef: z.string().optional(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime()
});

export const evidenceGapSetSchema = z.object({
  schemaVersion: z.literal(EVIDENCE_GAP_SET_SCHEMA_VERSION).default(EVIDENCE_GAP_SET_SCHEMA_VERSION),
  sessionId: z.string().min(1),
  companyId: z.string().min(1),
  revision: z.number().int().min(0),
  generatedAt: z.string().datetime(),
  gaps: z.array(evidenceGapSchema).default([])
});

export type EvidenceGapRequiredFor = z.infer<typeof evidenceGapRequiredForSchema>;
export type EvidenceGapResolution = z.infer<typeof evidenceGapResolutionSchema>;
export type EvidenceGapStatus = z.infer<typeof evidenceGapStatusSchema>;
export type EvidenceGap = z.infer<typeof evidenceGapSchema>;
export type EvidenceGapSet = z.infer<typeof evidenceGapSetSchema>;
