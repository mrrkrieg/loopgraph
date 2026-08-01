import { z } from "zod";

export const CANONICAL_ENTITY_SCHEMA_VERSION = "canonical-entity/v1alpha1" as const;
export const ENTITY_RESOLUTION_SCHEMA_VERSION = "entity-resolution/v1alpha1" as const;

export const companyEntityTypeSchema = z.enum([
  "account",
  "campaign",
  "incident",
  "customer",
  "contract",
  "contact",
  "deal",
  "employee",
  "invoice",
  "repository",
  "support_ticket",
  "custom"
]);

export const providerEntityAliasSchema = z.object({
  provider: z.string().min(1).max(100),
  externalType: z.string().min(1).max(100),
  externalId: z.string().min(1).max(512),
  accountScope: z.string().min(1).max(240).optional()
});

export const canonicalEntitySchema = z.object({
  schemaVersion: z.literal(CANONICAL_ENTITY_SCHEMA_VERSION).default(CANONICAL_ENTITY_SCHEMA_VERSION),
  id: z.string().min(1).max(240),
  workspaceId: z.string().min(1).max(240),
  companyId: z.string().min(1).max(240),
  type: companyEntityTypeSchema,
  displayName: z.string().min(1).max(500).optional(),
  aliases: z.array(providerEntityAliasSchema).max(500).default([]),
  matchKeys: z.record(z.string(), z.string()).default({}),
  status: z.enum(["active", "merged", "retired"]).default("active"),
  mergedIntoId: z.string().min(1).max(240).optional(),
  revision: z.number().int().positive().default(1),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime()
}).superRefine((entity, context) => {
  if (entity.status === "merged" && !entity.mergedIntoId) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "A merged entity requires mergedIntoId", path: ["mergedIntoId"] });
  }
});

export const entityResolutionRequestSchema = z.object({
  schemaVersion: z.literal(ENTITY_RESOLUTION_SCHEMA_VERSION).default(ENTITY_RESOLUTION_SCHEMA_VERSION),
  workspaceId: z.string().min(1).max(240),
  companyId: z.string().min(1).max(240),
  provider: z.string().min(1).max(100),
  externalType: z.string().min(1).max(100),
  externalId: z.string().min(1).max(512),
  accountScope: z.string().min(1).max(240).optional(),
  expectedType: companyEntityTypeSchema.optional(),
  deterministicKeys: z.record(z.string(), z.string()).default({})
});

export const entityResolutionResultSchema = z.object({
  schemaVersion: z.literal(ENTITY_RESOLUTION_SCHEMA_VERSION).default(ENTITY_RESOLUTION_SCHEMA_VERSION),
  status: z.enum(["exact", "created", "ambiguous", "unresolved"]),
  canonicalEntityId: z.string().min(1).optional(),
  candidateEntityIds: z.array(z.string().min(1)).default([]),
  matchedBy: z.enum(["provider_alias", "deterministic_key", "none"]),
  requiresHumanReview: z.boolean(),
  reasons: z.array(z.string().min(1)).default([])
});

export type CompanyEntityType = z.infer<typeof companyEntityTypeSchema>;
export type ProviderEntityAlias = z.infer<typeof providerEntityAliasSchema>;
export type CanonicalEntity = z.infer<typeof canonicalEntitySchema>;
export type EntityResolutionRequest = z.infer<typeof entityResolutionRequestSchema>;
export type EntityResolutionResult = z.infer<typeof entityResolutionResultSchema>;
