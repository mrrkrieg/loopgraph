import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  APP_CONFIGURATION_SCHEMA_VERSION,
  COMPANY_CONTEXT_SCHEMA_VERSION,
  appConfigurationSchema,
  appOverlaySchema,
  companyContextSchema,
  companyContextValueSchema,
  type AppConfigField,
  type AppConfiguration,
  type AppOverlay,
  type CompanyContext,
  type CompanyContextValue
} from "../core";

export type ContextProposal = Omit<CompanyContextValue, "verified" | "confirmedAt" | "confirmedBy" | "consumerInstallationIds"> & {
  explanation: string;
};

export type ConfigurationResolution = {
  configuration: AppConfiguration;
  missing: AppConfigField[];
  needsConfirmation: Array<{ field: AppConfigField; value: unknown; provenance: AppConfiguration["provenance"][string] }>;
};

export class FileCompanyContextStore {
  constructor(private readonly filePath: string) {}

  async get(workspaceId: string, companyId: string): Promise<CompanyContext> {
    const raw = await readJson(this.filePath);
    if (!raw) {
      return companyContextSchema.parse({
        schemaVersion: COMPANY_CONTEXT_SCHEMA_VERSION,
        workspaceId,
        companyId,
        revision: 0,
        values: [],
        updatedAt: new Date(0).toISOString(),
        updatedBy: "system"
      });
    }
    const context = companyContextSchema.parse(raw);
    if (context.workspaceId !== workspaceId || context.companyId !== companyId) {
      throw new Error("Company context tenant identity does not match the requested workspace and company");
    }
    return context;
  }

  async approveValue(input: {
    workspaceId: string;
    companyId: string;
    proposal: ContextProposal;
    approvedBy: string;
    expectedRevision: number;
    consumerInstallationId?: string;
    now?: Date;
  }): Promise<CompanyContext> {
    const current = await this.get(input.workspaceId, input.companyId);
    if (current.revision !== input.expectedRevision) {
      throw new Error(`Company context revision mismatch: expected ${input.expectedRevision}, found ${current.revision}`);
    }
    const timestamp = (input.now ?? new Date()).toISOString();
    const { explanation: _explanation, ...proposalValue } = input.proposal;
    const value = companyContextValueSchema.parse({
      ...proposalValue,
      verified: true,
      confirmedAt: timestamp,
      confirmedBy: input.approvedBy,
      consumerInstallationIds: input.consumerInstallationId ? [input.consumerInstallationId] : []
    });
    const existing = current.values.find((candidate) => candidate.key === value.key);
    const consumerInstallationIds = Array.from(new Set([
      ...(existing?.consumerInstallationIds ?? []),
      ...value.consumerInstallationIds
    ])).sort();
    const next = companyContextSchema.parse({
      ...current,
      revision: current.revision + 1,
      values: [
        ...current.values.filter((candidate) => candidate.key !== value.key),
        { ...value, consumerInstallationIds }
      ].sort((left, right) => left.key.localeCompare(right.key)),
      updatedAt: timestamp,
      updatedBy: input.approvedBy
    });
    await atomicWriteJson(this.filePath, next);
    return next;
  }

  async attachConsumer(input: {
    workspaceId: string;
    companyId: string;
    contextKeys: string[];
    installationId: string;
    expectedRevision: number;
    actor: string;
  }): Promise<CompanyContext> {
    const current = await this.get(input.workspaceId, input.companyId);
    if (current.revision !== input.expectedRevision) throw new Error("Company context revision changed during installation");
    const requested = new Set(input.contextKeys);
    const missing = input.contextKeys.filter((key) => !current.values.some((value) => value.key === key));
    if (missing.length > 0) throw new Error(`Cannot attach missing company context keys: ${missing.join(", ")}`);
    const next = companyContextSchema.parse({
      ...current,
      revision: current.revision + 1,
      values: current.values.map((value) => requested.has(value.key)
        ? { ...value, consumerInstallationIds: Array.from(new Set([...value.consumerInstallationIds, input.installationId])).sort() }
        : value),
      updatedAt: new Date().toISOString(),
      updatedBy: input.actor
    });
    await atomicWriteJson(this.filePath, next);
    return next;
  }

  async detachConsumer(input: {
    workspaceId: string;
    companyId: string;
    installationId: string;
    actor: string;
    now?: Date;
  }): Promise<CompanyContext> {
    const current = await this.get(input.workspaceId, input.companyId);
    const timestamp = (input.now ?? new Date()).toISOString();
    const next = companyContextSchema.parse({
      ...current,
      revision: current.revision + 1,
      values: current.values.map((value) => ({
        ...value,
        consumerInstallationIds: value.consumerInstallationIds.filter((id) => id !== input.installationId)
      })),
      updatedAt: timestamp,
      updatedBy: input.actor
    });
    await atomicWriteJson(this.filePath, next);
    return next;
  }
}

export function resolveAppConfiguration(input: {
  appId: string;
  version: string;
  fields: AppConfigField[];
  presetValues?: Record<string, unknown>;
  companyContext?: CompanyContext;
  installValues?: Record<string, unknown>;
  overlay?: AppOverlay;
  now?: Date;
}): ConfigurationResolution {
  const values: Record<string, unknown> = {};
  const provenance: AppConfiguration["provenance"] = {};
  const apply = (
    layer: "pack_default" | "preset" | "company_context" | "install_config" | "overlay",
    candidateValues: Record<string, unknown>,
    confirmed: boolean,
    metadata: { confidence?: number; sourceRef?: string } = {}
  ) => {
    for (const [key, value] of Object.entries(candidateValues)) {
      if (!input.fields.some((field) => field.key === key) || value === undefined) continue;
      values[key] = value;
      provenance[key] = { layer, confirmed, ...metadata };
    }
  };

  apply("pack_default", Object.fromEntries(input.fields.filter((field) => field.defaultValue !== undefined).map((field) => [field.key, field.defaultValue])), true);
  apply("preset", input.presetValues ?? {}, true);
  if (input.companyContext) {
    for (const field of input.fields) {
      if (!field.contextRef) continue;
      const contextValue = input.companyContext.values.find((value) => value.key === field.contextRef && value.verified);
      if (contextValue) apply("company_context", { [field.key]: contextValue.value }, Boolean(contextValue.confirmedAt), {
        confidence: contextValue.confidence,
        sourceRef: field.contextRef
      });
    }
  }
  apply("install_config", input.installValues ?? {}, true);
  if (input.overlay) {
    appOverlaySchema.parse(input.overlay);
    for (const operation of input.overlay.operations) {
      if (operation.op === "set" && operation.path.startsWith("/values/")) {
        apply("overlay", { [decodePointerToken(operation.path.slice("/values/".length))]: operation.value }, true, { sourceRef: input.overlay.id });
      } else if (operation.op === "remove" && operation.path.startsWith("/values/")) {
        const key = decodePointerToken(operation.path.slice("/values/".length));
        delete values[key];
        delete provenance[key];
      }
    }
  }

  const missing = input.fields.filter((field) => isFieldRequired(field, values) && values[field.key] === undefined);
  const needsConfirmation = input.fields.flatMap((field) => {
    const source = provenance[field.key];
    if (!source || values[field.key] === undefined || source.confirmed) return [];
    return [{ field, value: values[field.key], provenance: source }];
  });
  const configuration = appConfigurationSchema.parse({
    schemaVersion: APP_CONFIGURATION_SCHEMA_VERSION,
    appId: input.appId,
    version: input.version,
    fields: input.fields,
    values,
    provenance,
    ...(missing.length === 0 && needsConfirmation.length === 0 ? { completedAt: (input.now ?? new Date()).toISOString() } : {})
  });
  return { configuration, missing, needsConfirmation };
}

export function inferContextProposal(input: {
  field: AppConfigField;
  candidateValue: unknown;
  source: ContextProposal["provenance"]["source"];
  sourceRef?: string;
  confidence: number;
  owner: string;
  visibility?: ContextProposal["visibility"];
  now?: Date;
}): ContextProposal {
  if (!input.field.contextRef) throw new Error(`Configuration field ${input.field.key} has no company context reference`);
  return {
    key: input.field.contextRef,
    type: input.field.valueType,
    value: input.candidateValue,
    provenance: {
      source: input.source,
      ...(input.sourceRef ? { sourceRef: input.sourceRef } : {}),
      observedAt: (input.now ?? new Date()).toISOString()
    },
    confidence: input.confidence,
    owner: input.owner,
    visibility: input.visibility ?? "workspace",
    explanation: `Inferred ${input.field.label} from ${input.source}${input.sourceRef ? ` (${input.sourceRef})` : ""} with confidence ${input.confidence.toFixed(2)}.`
  };
}

function isFieldRequired(field: AppConfigField, values: Record<string, unknown>): boolean {
  if (field.requirement === "required") return true;
  if (field.requirement === "optional") return false;
  if (!field.condition) return true;
  const [key, expected] = field.condition.split("=").map((part) => part.trim());
  if (!expected) return Boolean(values[key]);
  return String(values[key]) === expected;
}

function decodePointerToken(value: string): string {
  return value.replace(/~1/g, "/").replace(/~0/g, "~");
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
