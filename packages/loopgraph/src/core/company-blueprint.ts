import { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";
import { appIdSchema, appVersionSchema } from "./app-platform";

export const COMPANY_BLUEPRINT_SCHEMA_VERSION = "loopgraph-company-blueprint/v1alpha1" as const;
export const COMPANY_BLUEPRINT_CATALOG_SCHEMA_VERSION = "loopgraph-company-blueprint-catalog/v1alpha1" as const;

export const companyBlueprintPackRoleSchema = z.enum(["foundation", "operating", "oversight"]);

export const companyBlueprintPackSchema = z.object({
  packId: appIdSchema,
  role: companyBlueprintPackRoleSchema,
  installOrder: z.number().int().positive(),
  reason: z.string().min(1).max(1000),
  dependsOn: z.array(appIdSchema).default([])
}).strict();

export const companyBlueprintTopologyEdgeSchema = z.object({
  id: appIdSchema,
  sourcePackId: appIdSchema,
  targetPackId: appIdSchema,
  type: z.enum(["evidence_handoff", "support_request", "learning_return"]),
  objectType: appIdSchema,
  reason: z.string().min(1).max(1000),
  condition: z.string().min(1).max(1000)
}).strict();

export const companyObjectContractSchema = z.object({
  objectType: appIdSchema,
  description: z.string().min(1).max(1000),
  identityKeys: z.array(appIdSchema).min(1),
  producerPackIds: z.array(appIdSchema).min(1),
  consumerPackIds: z.array(appIdSchema).min(1),
  requiredEvidenceFields: z.array(appIdSchema).min(1)
}).strict();

export const companyBlueprintSchema = z.object({
  schemaVersion: z.literal(COMPANY_BLUEPRINT_SCHEMA_VERSION),
  id: appIdSchema,
  version: appVersionSchema,
  name: z.string().min(1).max(160),
  summary: z.string().min(1).max(1000),
  companyProfile: z.string().min(1).max(1000),
  businessOutcomes: z.array(z.string().min(1).max(500)).min(1),
  defaultPackId: appIdSchema,
  packs: z.array(companyBlueprintPackSchema).min(1),
  sharedContextKeys: z.array(appIdSchema).default([]),
  objectContracts: z.array(companyObjectContractSchema).min(1),
  topology: z.array(companyBlueprintTopologyEdgeSchema).min(1)
}).strict().superRefine((blueprint, ctx) => {
  const packIds = new Set<string>();
  const orders = new Set<number>();
  for (const [index, pack] of blueprint.packs.entries()) {
    if (packIds.has(pack.packId)) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["packs", index, "packId"], message: "Company Blueprint Pack IDs must be unique" });
    if (orders.has(pack.installOrder)) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["packs", index, "installOrder"], message: "Company Blueprint install order must be unique" });
    packIds.add(pack.packId);
    orders.add(pack.installOrder);
  }
  if (!packIds.has(blueprint.defaultPackId)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["defaultPackId"], message: "Default Department Pack must belong to the Company Blueprint" });
  }
  for (const [index, pack] of blueprint.packs.entries()) {
    for (const dependency of pack.dependsOn) {
      if (!packIds.has(dependency)) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["packs", index, "dependsOn"], message: `Unknown Company Blueprint dependency: ${dependency}` });
      if (dependency === pack.packId) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["packs", index, "dependsOn"], message: "A Department Pack cannot depend on itself" });
    }
  }
  const edgeIds = new Set<string>();
  for (const [index, edge] of blueprint.topology.entries()) {
    if (edgeIds.has(edge.id)) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["topology", index, "id"], message: "Company Blueprint topology edge IDs must be unique" });
    edgeIds.add(edge.id);
    if (!packIds.has(edge.sourcePackId) || !packIds.has(edge.targetPackId)) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["topology", index], message: "Company Blueprint topology edges must connect included Department Packs" });
    if (edge.sourcePackId === edge.targetPackId) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["topology", index], message: "Company Blueprint topology edges cannot be self-referential" });
  }
  const objectTypes = new Set<string>();
  for (const [index, contract] of blueprint.objectContracts.entries()) {
    if (objectTypes.has(contract.objectType)) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["objectContracts", index, "objectType"], message: "Company object contracts must use unique object types" });
    objectTypes.add(contract.objectType);
    for (const packId of [...contract.producerPackIds, ...contract.consumerPackIds]) {
      if (!packIds.has(packId)) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["objectContracts", index], message: `Company object contract references unknown Department Pack: ${packId}` });
    }
  }
  for (const [index, edge] of blueprint.topology.entries()) {
    if (!objectTypes.has(edge.objectType)) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["topology", index, "objectType"], message: `Topology edge references an undefined company object contract: ${edge.objectType}` });
  }
});

export const companyBlueprintCatalogSchema = z.object({
  schemaVersion: z.literal(COMPANY_BLUEPRINT_CATALOG_SCHEMA_VERSION),
  sourceDigest: z.string().regex(/^sha256:[a-f0-9]{64}$/),
  blueprints: z.array(companyBlueprintSchema)
}).strict().superRefine((catalog, ctx) => {
  const ids = new Set<string>();
  for (const [index, blueprint] of catalog.blueprints.entries()) {
    if (ids.has(blueprint.id)) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["blueprints", index, "id"], message: "Company Blueprint IDs must be unique" });
    ids.add(blueprint.id);
  }
});

export type CompanyBlueprint = z.infer<typeof companyBlueprintSchema>;
export type CompanyBlueprintCatalog = z.infer<typeof companyBlueprintCatalogSchema>;

export const companyBlueprintJsonSchemas = {
  CompanyBlueprint: zodToJsonSchema(companyBlueprintSchema, "CompanyBlueprint") as Record<string, unknown>,
  CompanyBlueprintCatalog: zodToJsonSchema(companyBlueprintCatalogSchema, "CompanyBlueprintCatalog") as Record<string, unknown>
};
