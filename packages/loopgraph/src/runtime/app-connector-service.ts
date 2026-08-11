import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import YAML from "yaml";
import {
  CONNECTOR_RECIPE_SCHEMA_VERSION,
  PROVIDER_SCHEMA_SNAPSHOT_VERSION,
  connectorFieldMappingSchema,
  connectorRecipeSchema,
  contentHash,
  providerSchemaSnapshotSchema,
  type ConnectionInstance,
  type ConnectorFieldMapping,
  type ConnectorRecipe,
  type ProviderSchemaField,
  type ProviderSchemaSnapshot
} from "../core";
import type { LoopPackLoadResult } from "./app-pack-loader";

export type FieldMappingSuggestion = {
  logicalField: string;
  providerField?: string;
  confidence: number;
  reason: string;
  requiresConfirmation: boolean;
  required: boolean;
};

type ProviderSchemaFieldInput = Omit<ProviderSchemaField, "sampleValues"> & { sampleValues?: unknown[] };

export type CapabilityResolution = {
  capability: string;
  required: boolean;
  connectionId?: string;
  recipeId?: string;
  status: "connected" | "reusable" | "missing" | "degraded";
  reason: string;
};

export async function loadConnectorRecipes(loaded: LoopPackLoadResult): Promise<ConnectorRecipe[]> {
  const recipes: ConnectorRecipe[] = [];
  for (const relativePath of loaded.manifest.entrypoints.connectors) {
    const absolutePath = resolvePackPath(loaded.root, relativePath);
    const raw = YAML.parse(await readFile(absolutePath, "utf8"));
    recipes.push(connectorRecipeSchema.parse(raw));
  }
  return recipes;
}

export function resolveConnectorCapabilities(input: {
  requiredCapabilities: string[];
  optionalCapabilities: string[];
  recipes: ConnectorRecipe[];
  connections: ConnectionInstance[];
  selectedRecipeId?: string;
}): CapabilityResolution[] {
  const required = new Set(input.requiredCapabilities);
  const selectedRecipes = input.selectedRecipeId
    ? input.recipes.filter((recipe) => recipe.id === input.selectedRecipeId)
    : input.recipes;
  if (input.selectedRecipeId && selectedRecipes.length === 0) {
    throw new Error(`Connector recipe not found: ${input.selectedRecipeId}`);
  }
  return [...input.requiredCapabilities, ...input.optionalCapabilities].map((capability) => {
    const recipe = selectedRecipes.find((candidate) => candidate.capabilities.some((binding) => binding.logicalCapability === capability));
    if (!recipe) {
      return { capability, required: required.has(capability), status: "missing", reason: "No selected provider recipe implements this logical capability." };
    }
    const binding = recipe.capabilities.find((candidate) => candidate.logicalCapability === capability)!;
    const providerId = providerIdForCapability(recipe, binding);
    const compatible = input.connections.find((connection) => {
      const manifestId = normalizeConnectorProviderId(connection.manifestId);
      const providerMatch = manifestId === providerId || manifestId.startsWith(`${providerId}.`) || manifestId.startsWith(`${providerId}-`);
      const capabilityMatch = connection.capabilityKeys.includes(capability)
        || connection.capabilityKeys.includes(binding.providerOperation)
        || connection.capabilityKeys.includes(broadCapability(capability));
      return providerMatch && capabilityMatch;
    });
    if (!compatible) {
      return { capability, required: required.has(capability), recipeId: recipe.id, status: "missing", reason: `${providerId} is selected through ${recipe.displayName}, but no connection grants ${capability}.` };
    }
    const missingScopes = binding.minimumScopes.filter((scope) => !connectionGrantsScope(compatible, providerId, scope));
    if (missingScopes.length > 0) {
      return { capability, required: required.has(capability), connectionId: compatible.id, recipeId: recipe.id, status: "missing", reason: `Connection ${compatible.id} is missing required scopes: ${missingScopes.join(", ")}.` };
    }
    if (!connectionPolicyAllows(compatible, binding.authority)) {
      return { capability, required: required.has(capability), connectionId: compatible.id, recipeId: recipe.id, status: "missing", reason: `Connection ${compatible.id} policy does not permit ${binding.authority} authority.` };
    }
    if (compatible.status === "degraded") {
      return { capability, required: required.has(capability), connectionId: compatible.id, recipeId: recipe.id, status: "degraded", reason: "A compatible connection exists but its health is degraded." };
    }
    if (compatible.status !== "connected") {
      return { capability, required: required.has(capability), connectionId: compatible.id, recipeId: recipe.id, status: "missing", reason: `Connection ${compatible.id} is ${compatible.status}.` };
    }
    return {
      capability,
      required: required.has(capability),
      connectionId: compatible.id,
      recipeId: recipe.id,
      status: "reusable",
      reason: `Reuse connected ${recipe.displayName} connection ${compatible.id}.`
    };
  });
}

export function providerIdForCapability(
  recipe: ConnectorRecipe,
  binding: ConnectorRecipe["capabilities"][number]
): string {
  if (binding.providerId) return normalizeConnectorProviderId(binding.providerId);
  const operationProvider = binding.providerOperation.split(".", 1)[0];
  return normalizeConnectorProviderId(operationProvider || recipe.providerId);
}

export function normalizeConnectorProviderId(providerId: string): string {
  const normalized = providerId.trim().toLowerCase();
  const aliases: Record<string, string> = {
    "google-ads": "google_ads",
    "paid-social": "meta_ads",
    "product-analytics": "product_analytics"
  };
  return aliases[normalized] ?? normalized.replace(/-/g, "_");
}

export class FileProviderSchemaSnapshotStore {
  constructor(private readonly filePath: string, private readonly workspaceId: string) {}

  async list(): Promise<ProviderSchemaSnapshot[]> {
    const raw = await readJson(this.filePath);
    if (!raw) return [];
    if (!isRecord(raw) || raw.schemaVersion !== PROVIDER_SCHEMA_SNAPSHOT_VERSION || !Array.isArray(raw.snapshots)) {
      throw new Error("Invalid provider schema snapshot registry");
    }
    return raw.snapshots
      .map((snapshot) => providerSchemaSnapshotSchema.parse(snapshot))
      .filter((snapshot) => snapshot.workspaceId === this.workspaceId);
  }

  async get(connectionId: string, now = new Date()): Promise<ProviderSchemaSnapshot | undefined> {
    const snapshot = (await this.list()).find((candidate) => candidate.connectionId === connectionId);
    if (!snapshot?.expiresAt || Date.parse(snapshot.expiresAt) > now.getTime()) return snapshot;
    return undefined;
  }

  async save(input: {
    connectionId: string;
    providerId: string;
    source: ProviderSchemaSnapshot["source"];
    samplePolicy: "redacted_only";
    objects: ProviderSchemaSnapshot["objects"];
    inspectedBy: string;
    inspectedAt?: string;
    expiresAt?: string;
  }): Promise<ProviderSchemaSnapshot> {
    const snapshots = await this.list();
    const snapshot = providerSchemaSnapshotSchema.parse({
      schemaVersion: PROVIDER_SCHEMA_SNAPSHOT_VERSION,
      workspaceId: this.workspaceId,
      ...input,
      inspectedAt: input.inspectedAt ?? new Date().toISOString()
    });
    const next = [
      ...snapshots.filter((candidate) => candidate.connectionId !== snapshot.connectionId),
      snapshot
    ].sort((left, right) => left.connectionId.localeCompare(right.connectionId));
    await atomicWriteJson(this.filePath, { schemaVersion: PROVIDER_SCHEMA_SNAPSHOT_VERSION, snapshots: next });
    return snapshot;
  }
}

export function suggestFieldMappings(input: {
  requiredLogicalFields: string[];
  optionalLogicalFields?: string[];
  providerFields: ProviderSchemaFieldInput[];
  writeRequiredLogicalFields?: string[];
}): FieldMappingSuggestion[] {
  const required = new Set(input.requiredLogicalFields);
  const writeRequired = new Set(input.writeRequiredLogicalFields ?? []);
  return [...input.requiredLogicalFields, ...(input.optionalLogicalFields ?? [])].map((logicalField) => {
    const candidates = input.providerFields
      .filter((providerField) => !writeRequired.has(logicalField) || providerField.writable)
      .map((providerField) => ({ providerField, score: fieldSimilarity(logicalField, providerField) }))
      .sort((left, right) => right.score - left.score || left.providerField.name.localeCompare(right.providerField.name));
    const best = candidates[0];
    if (!best || best.score < 0.45) {
      return {
        logicalField,
        confidence: 0,
        reason: "No provider field is similar enough to suggest safely.",
        requiresConfirmation: true,
        required: required.has(logicalField)
      };
    }
    return {
      logicalField,
      providerField: best.providerField.name,
      confidence: best.score,
      reason: `Matched ${logicalField} to ${best.providerField.label ?? best.providerField.name} using normalized name and type hints.`,
      requiresConfirmation: best.score < 0.9,
      required: required.has(logicalField)
    };
  });
}

export function validateFieldMappingCoverage(input: {
  requiredLogicalFields: string[];
  mappings: ConnectorFieldMapping[];
  connectionId: string;
  objectType: string;
}): { complete: boolean; missing: string[]; unverified: string[] } {
  const relevant = input.mappings.filter((mapping) => mapping.connectionId === input.connectionId && mapping.objectType === input.objectType);
  const missing = input.requiredLogicalFields.filter((field) => !relevant.some((mapping) => mapping.logicalField === field));
  const unverified = input.requiredLogicalFields.filter((field) => relevant.some((mapping) => mapping.logicalField === field && !mapping.verified));
  return { complete: missing.length === 0 && unverified.length === 0, missing, unverified };
}

export class FileConnectorFieldMappingStore {
  constructor(private readonly filePath: string, private readonly workspaceId: string) {}

  async list(): Promise<ConnectorFieldMapping[]> {
    const raw = await readJson(this.filePath);
    if (!raw) return [];
    if (!isRecord(raw) || raw.schemaVersion !== CONNECTOR_RECIPE_SCHEMA_VERSION || !Array.isArray(raw.mappings)) {
      throw new Error("Invalid connector field mapping registry");
    }
    return raw.mappings.map((mapping) => connectorFieldMappingSchema.parse(mapping)).filter((mapping) => mapping.workspaceId === this.workspaceId);
  }

  async saveConfirmed(input: {
    connectionId: string;
    objectType: string;
    logicalField: string;
    providerField: string;
    direction: "read" | "write" | "bidirectional";
    transform?: ConnectorFieldMapping["transform"];
    confidence: number;
    confirmedBy: string;
    installationId?: string;
    now?: Date;
  }): Promise<ConnectorFieldMapping> {
    const mappings = await this.list();
    const id = `mapping.${contentHash({ workspaceId: this.workspaceId, connectionId: input.connectionId, objectType: input.objectType, logicalField: input.logicalField })}`;
    const existing = mappings.find((mapping) => mapping.id === id);
    const timestamp = (input.now ?? new Date()).toISOString();
    const mapping = connectorFieldMappingSchema.parse({
      schemaVersion: CONNECTOR_RECIPE_SCHEMA_VERSION,
      id,
      workspaceId: this.workspaceId,
      connectionId: input.connectionId,
      objectType: input.objectType,
      logicalField: input.logicalField,
      providerField: input.providerField,
      direction: input.direction,
      transform: input.transform ?? { kind: "identity", config: {} },
      confidence: input.confidence,
      verified: true,
      confirmedBy: input.confirmedBy,
      dependentInstallationIds: Array.from(new Set([
        ...(existing?.dependentInstallationIds ?? []),
        ...(input.installationId ? [input.installationId] : [])
      ])).sort(),
      createdAt: existing?.createdAt ?? timestamp,
      updatedAt: timestamp
    });
    const next = [...mappings.filter((candidate) => candidate.id !== mapping.id), mapping].sort((left, right) => left.id.localeCompare(right.id));
    await atomicWriteJson(this.filePath, { schemaVersion: CONNECTOR_RECIPE_SCHEMA_VERSION, mappings: next });
    return mapping;
  }

  async attachInstallation(mappingIds: string[], installationId: string): Promise<ConnectorFieldMapping[]> {
    const mappings = await this.list();
    const requested = new Set(mappingIds);
    const missing = mappingIds.filter((id) => !mappings.some((mapping) => mapping.id === id));
    if (missing.length > 0) throw new Error(`Field mappings not found: ${missing.join(", ")}`);
    const timestamp = new Date().toISOString();
    const next = mappings.map((mapping) => requested.has(mapping.id)
      ? connectorFieldMappingSchema.parse({
        ...mapping,
        dependentInstallationIds: Array.from(new Set([...mapping.dependentInstallationIds, installationId])).sort(),
        updatedAt: timestamp
      })
      : mapping);
    await atomicWriteJson(this.filePath, { schemaVersion: CONNECTOR_RECIPE_SCHEMA_VERSION, mappings: next });
    return next;
  }

  async detachInstallation(installationId: string, now = new Date()): Promise<ConnectorFieldMapping[]> {
    const mappings = await this.list();
    const timestamp = now.toISOString();
    const next = mappings.map((mapping) => mapping.dependentInstallationIds.includes(installationId)
      ? connectorFieldMappingSchema.parse({
          ...mapping,
          dependentInstallationIds: mapping.dependentInstallationIds.filter((id) => id !== installationId),
          updatedAt: timestamp
        })
      : mapping);
    await atomicWriteJson(this.filePath, { schemaVersion: CONNECTOR_RECIPE_SCHEMA_VERSION, mappings: next });
    return next;
  }
}

function fieldSimilarity(logicalField: string, providerField: ProviderSchemaFieldInput): number {
  const logical = normalizeFieldName(logicalField.split(".").at(-1) ?? logicalField);
  const provider = normalizeFieldName(providerField.name);
  const label = normalizeFieldName(providerField.label ?? "");
  if (logical === provider || logical === label) return 1;
  const aliases: Record<string, string[]> = {
    id: ["recordid", "contactid", "leadid", "accountid", "hsobjectid"],
    email: ["emailaddress", "primaryemail", "workemail"],
    company: ["companyname", "organization", "organisation"],
    lifecyclestage: ["status", "stage", "leadstatus"],
    employeecount: ["employees", "numberofemployees", "headcount"],
    revenue: ["annualrevenue", "companyrevenue"],
    country: ["countrycode", "billingcountry"],
    domain: ["website", "companydomain", "websitedomain"],
    customerstatus: ["accountstatus", "type", "customertype"],
    territory: ["region", "salesregion", "ownerterritory"]
  };
  if ((aliases[logical] ?? []).includes(provider) || (aliases[logical] ?? []).includes(label)) return 0.95;
  if (provider.includes(logical) || logical.includes(provider) || label.includes(logical)) return 0.78;
  const overlap = trigramOverlap(logical, `${provider}${label}`);
  return Math.min(0.7, overlap);
}

function normalizeFieldName(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function broadCapability(capability: string): string {
  const parts = capability.split(".");
  return parts.length >= 3 ? `${parts[0]}.${parts.at(-1)}` : capability;
}

function connectionPolicyAllows(connection: ConnectionInstance, authority: ConnectorRecipe["capabilities"][number]["authority"]): boolean {
  if (authority === "read") return connection.readPolicy === "read_only";
  if (authority === "draft") return connection.writePolicy === "draft_only" || connection.writePolicy === "approved_only";
  return connection.writePolicy === "approved_only";
}

function connectionGrantsScope(connection: ConnectionInstance, providerId: string, requiredScope: string): boolean {
  const normalize = (scope: string) => scope.toLowerCase().replace(/^https:\/\/www\.googleapis\.com\/auth\//, "").replace(/[^a-z0-9]/g, "");
  const required = normalize(requiredScope);
  if (connection.grantedScopes.some((scope) => normalize(scope) === required)) return true;
  if (providerId === "intercom" && required === "conversationsread") {
    return connection.grantedScopes.some((scope) => normalize(scope) === "readconversations");
  }
  if (providerId === "stripe" && requiredScope.toLowerCase().endsWith(":read")) {
    return connection.grantedScopes.some((scope) => scope === "read_only" || scope === "read_write");
  }
  const brokerReadOnlyProviders = new Set(["zendesk", "workday", "netsuite"]);
  return connection.source === "hermes_connector_broker"
    && brokerReadOnlyProviders.has(providerId)
    && connection.brokerCapabilities.includes("provider.data.read")
    && connection.grantedScopes.length === 0;
}

function trigramOverlap(left: string, right: string): number {
  if (left.length < 3 || right.length < 3) return 0;
  const trigrams = (value: string) => new Set(Array.from({ length: value.length - 2 }, (_, index) => value.slice(index, index + 3)));
  const a = trigrams(left);
  const b = trigrams(right);
  const common = [...a].filter((item) => b.has(item)).length;
  return common / Math.max(a.size, b.size);
}

function resolvePackPath(root: string, relativePath: string): string {
  const absolute = path.resolve(root, relativePath);
  const relative = path.relative(root, absolute);
  if (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error(`Connector recipe escapes pack root: ${relativePath}`);
  }
  return absolute;
}

async function readJson(filePath: string): Promise<unknown> {
  try {
    return JSON.parse(await readFile(filePath, "utf8"));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}

async function atomicWriteJson(filePath: string, value: unknown): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  const temporary = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(temporary, JSON.stringify(value, null, 2));
  await rename(temporary, filePath);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
