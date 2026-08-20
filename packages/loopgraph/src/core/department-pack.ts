import { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";
import { appIdSchema, appVersionSchema, logicalCapabilitySchema } from "./app-platform";
import { DepartmentTypeSchema } from "./department-skills";

export const DEPARTMENT_PACK_SCHEMA_VERSION = "loopgraph-department-pack/v1alpha1" as const;
export const DEPARTMENT_PACK_CATALOG_SCHEMA_VERSION = "loopgraph-department-pack-catalog/v1alpha1" as const;

export const departmentPackAppRoleSchema = z.enum(["foundation", "primary", "supporting"]);

export const departmentPackAppSchema = z.object({
  appId: appIdSchema,
  role: departmentPackAppRoleSchema,
  installOrder: z.number().int().positive(),
  reason: z.string().min(1).max(1000),
  dependsOn: z.array(appIdSchema).default([])
}).strict();

export const departmentPackTopologyEdgeSchema = z.object({
  id: appIdSchema,
  sourceAppId: appIdSchema,
  targetAppId: appIdSchema,
  type: z.enum(["supports", "handoff", "evidence_return"]),
  reason: z.string().min(1).max(1000),
  condition: z.string().min(1).max(1000).optional()
}).strict();

export const departmentPackSchema = z.object({
  schemaVersion: z.literal(DEPARTMENT_PACK_SCHEMA_VERSION),
  id: appIdSchema,
  version: appVersionSchema,
  name: z.string().min(1).max(160),
  department: DepartmentTypeSchema.exclude(["custom"]),
  summary: z.string().min(1).max(1000),
  businessOutcomes: z.array(z.string().min(1).max(500)).min(1),
  defaultAppId: appIdSchema,
  apps: z.array(departmentPackAppSchema).min(1),
  sharedContextKeys: z.array(appIdSchema).default([]),
  sharedCapabilities: z.array(logicalCapabilitySchema).default([]),
  topology: z.array(departmentPackTopologyEdgeSchema).default([])
}).strict().superRefine((pack, ctx) => {
  const appIds = new Set<string>();
  const orders = new Set<number>();
  for (const [index, app] of pack.apps.entries()) {
    if (appIds.has(app.appId)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["apps", index, "appId"], message: "Department Pack app IDs must be unique" });
    }
    if (orders.has(app.installOrder)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["apps", index, "installOrder"], message: "Department Pack install order must be unique" });
    }
    appIds.add(app.appId);
    orders.add(app.installOrder);
  }
  if (!appIds.has(pack.defaultAppId)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["defaultAppId"], message: "Default App must belong to the Department Pack" });
  }
  for (const [index, app] of pack.apps.entries()) {
    for (const dependency of app.dependsOn) {
      if (!appIds.has(dependency)) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["apps", index, "dependsOn"], message: `Unknown Department Pack dependency: ${dependency}` });
      }
      if (dependency === app.appId) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["apps", index, "dependsOn"], message: "An App cannot depend on itself" });
      }
    }
  }
  const edgeIds = new Set<string>();
  for (const [index, edge] of pack.topology.entries()) {
    if (edgeIds.has(edge.id)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["topology", index, "id"], message: "Department Pack topology edge IDs must be unique" });
    }
    edgeIds.add(edge.id);
    if (!appIds.has(edge.sourceAppId) || !appIds.has(edge.targetAppId)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["topology", index], message: "Department Pack topology edges must connect Apps in the same pack" });
    }
    if (edge.sourceAppId === edge.targetAppId) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["topology", index], message: "Department Pack topology edges cannot be self-referential" });
    }
  }
});

export const departmentPackCatalogSchema = z.object({
  schemaVersion: z.literal(DEPARTMENT_PACK_CATALOG_SCHEMA_VERSION),
  sourceDigest: z.string().regex(/^sha256:[a-f0-9]{64}$/),
  packs: z.array(departmentPackSchema)
}).strict().superRefine((catalog, ctx) => {
  const ids = new Set<string>();
  for (const [index, pack] of catalog.packs.entries()) {
    if (ids.has(pack.id)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["packs", index, "id"], message: "Department Pack IDs must be unique" });
    }
    ids.add(pack.id);
  }
});

export type DepartmentPack = z.infer<typeof departmentPackSchema>;
export type DepartmentPackApp = z.infer<typeof departmentPackAppSchema>;
export type DepartmentPackCatalog = z.infer<typeof departmentPackCatalogSchema>;

export const departmentPackJsonSchemas = {
  DepartmentPack: zodToJsonSchema(departmentPackSchema, "DepartmentPack") as Record<string, unknown>,
  DepartmentPackCatalog: zodToJsonSchema(departmentPackCatalogSchema, "DepartmentPackCatalog") as Record<string, unknown>
};
