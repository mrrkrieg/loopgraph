import { readFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { appIdSchema, appVersionSchema, artifactDigestSchema, isoDateTimeSchema } from "../core";

export const PUBLISHED_CATALOG_SCHEMA_VERSION = "loopgraph-published-catalog/v1alpha1" as const;
export const PUBLISHED_CATALOG_FILE = "loopgraph.catalog.json" as const;

export const publishedCatalogReleaseSchema = z.object({
  appId: appIdSchema,
  version: appVersionSchema,
  digest: artifactDigestSchema,
  publisherId: appIdSchema,
  keyId: appIdSchema,
  status: z.enum(["active", "deprecated", "revoked"]),
  message: z.string().min(1).optional(),
  publishedAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema
}).strict();

export const publishedCatalogSchema = z.object({
  schemaVersion: z.literal(PUBLISHED_CATALOG_SCHEMA_VERSION),
  catalogId: appIdSchema,
  releases: z.array(publishedCatalogReleaseSchema).default([]),
  updatedAt: isoDateTimeSchema
}).strict();

export type PublishedCatalog = z.infer<typeof publishedCatalogSchema>;
export type PublishedCatalogRelease = z.infer<typeof publishedCatalogReleaseSchema>;

export async function readPublishedCatalog(root: string): Promise<PublishedCatalog | undefined> {
  try {
    return publishedCatalogSchema.parse(JSON.parse(await readFile(path.join(root, PUBLISHED_CATALOG_FILE), "utf8")));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}

export function publishedReleaseKey(appId: string, version: string, digest: string): string {
  return `${appId}@${version}#${digest}`;
}
