import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  canonicalEntitySchema,
  entityResolutionRequestSchema,
  entityResolutionResultSchema,
  type CanonicalEntity,
  type EntityResolutionRequest,
  type EntityResolutionResult
} from "../core";

export interface EntityResolutionStore {
  readonly persistence?: "local" | "distributed";
  list(workspaceId: string, companyId: string): Promise<CanonicalEntity[]>;
  save(entity: CanonicalEntity, expectedRevision?: number): Promise<CanonicalEntity>;
}

export class InMemoryEntityResolutionStore implements EntityResolutionStore {
  private readonly entities = new Map<string, CanonicalEntity>();
  async list(workspaceId: string, companyId: string) {
    return [...this.entities.values()].filter((entity) => entity.workspaceId === workspaceId && entity.companyId === companyId);
  }
  async save(entity: CanonicalEntity, expectedRevision?: number) {
    const parsed = canonicalEntitySchema.parse(entity);
    const existing = this.entities.get(parsed.id);
    if (expectedRevision !== undefined && existing?.revision !== expectedRevision) throw new Error("Canonical entity revision conflict");
    this.entities.set(parsed.id, parsed);
    return parsed;
  }
}

export class FileEntityResolutionStore implements EntityResolutionStore {
  readonly persistence = "local" as const;
  constructor(private readonly loopgraphRoot = path.join(process.cwd(), ".loopgraph")) {}
  async list(workspaceId: string, companyId: string) {
    try {
      const value = JSON.parse(await readFile(this.filePath(), "utf8")) as { entities?: unknown[] };
      return (value.entities ?? []).map((entity) => canonicalEntitySchema.parse(entity)).filter((entity) => entity.workspaceId === workspaceId && entity.companyId === companyId);
    } catch (error) {
      if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") return [];
      throw error;
    }
  }
  async save(entity: CanonicalEntity, expectedRevision?: number) {
    const parsed = canonicalEntitySchema.parse(entity);
    const all = await this.readAll();
    const existing = all.find((candidate) => candidate.id === parsed.id);
    if (expectedRevision !== undefined && existing?.revision !== expectedRevision) throw new Error("Canonical entity revision conflict");
    const values = [...all.filter((candidate) => candidate.id !== parsed.id), parsed].sort((a, b) => a.id.localeCompare(b.id));
    await mkdir(path.dirname(this.filePath()), { recursive: true, mode: 0o700 });
    const temporary = `${this.filePath()}.${process.pid}.${randomUUID()}.tmp`;
    await writeFile(temporary, `${JSON.stringify({ schemaVersion: "canonical-entities/v1alpha1", entities: values }, null, 2)}\n`, { mode: 0o600 });
    await rename(temporary, this.filePath());
    return parsed;
  }
  private async readAll() {
    try {
      const value = JSON.parse(await readFile(this.filePath(), "utf8")) as { entities?: unknown[] };
      return (value.entities ?? []).map((entity) => canonicalEntitySchema.parse(entity));
    } catch (error) {
      if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") return [];
      throw error;
    }
  }
  private filePath() { return path.join(this.loopgraphRoot, "entities", "canonical.json"); }
}

export async function resolveCompanyEntity(input: {
  store: EntityResolutionStore;
  request: EntityResolutionRequest;
  createIfMissing?: boolean;
  now?: Date;
}): Promise<EntityResolutionResult> {
  const request = entityResolutionRequestSchema.parse(input.request);
  const entities = (await input.store.list(request.workspaceId, request.companyId)).filter((entity) => entity.status === "active");
  const aliases = entities.filter((entity) => entity.aliases.some((alias) =>
    alias.provider === request.provider && alias.externalType === request.externalType && alias.externalId === request.externalId && (alias.accountScope ?? "") === (request.accountScope ?? "")
  ));
  if (aliases.length === 1) return result("exact", aliases[0]!.id, [], "provider_alias", false, ["Exact provider alias matched."]);
  if (aliases.length > 1) return result("ambiguous", undefined, aliases.map((entity) => entity.id), "provider_alias", true, ["The provider alias is attached to multiple active entities."]);

  const safeKeys = Object.entries(request.deterministicKeys).filter(([key, value]) => isAllowedDeterministicKey(key) && value.trim());
  const keyed = safeKeys.length === 0 ? [] : entities.filter((entity) => {
    if (request.expectedType && entity.type !== request.expectedType) return false;
    return safeKeys.every(([key, value]) => normalizeKey(entity.matchKeys[key]) === normalizeKey(value));
  });
  if (keyed.length === 1) return result("exact", keyed[0]!.id, [], "deterministic_key", false, ["All supplied deterministic identity keys matched."]);
  if (keyed.length > 1) return result("ambiguous", undefined, keyed.map((entity) => entity.id), "deterministic_key", true, ["Deterministic keys matched multiple entities; Hermes must ask a human."]);
  if (!input.createIfMissing || !request.expectedType) return result("unresolved", undefined, [], "none", true, ["No exact identity match; fuzzy auto-merging is disabled."]);

  const now = (input.now ?? new Date()).toISOString();
  const created = await input.store.save(canonicalEntitySchema.parse({
    id: `entity_${randomUUID()}`,
    workspaceId: request.workspaceId,
    companyId: request.companyId,
    type: request.expectedType,
    aliases: [{ provider: request.provider, externalType: request.externalType, externalId: request.externalId, accountScope: request.accountScope }],
    matchKeys: Object.fromEntries(safeKeys),
    status: "active",
    revision: 1,
    createdAt: now,
    updatedAt: now
  }));
  return result("created", created.id, [], "none", false, ["Created a canonical entity from an explicit expected type."]);
}

const isAllowedDeterministicKey = (key: string) => ["domain", "email", "contract_number", "repository_full_name", "campaign_external_key", "incident_key"].includes(key);
const normalizeKey = (value: string | undefined) => value?.trim().toLowerCase() ?? "";
function result(status: EntityResolutionResult["status"], canonicalEntityId: string | undefined, candidateEntityIds: string[], matchedBy: EntityResolutionResult["matchedBy"], requiresHumanReview: boolean, reasons: string[]) {
  return entityResolutionResultSchema.parse({ status, canonicalEntityId, candidateEntityIds, matchedBy, requiresHumanReview, reasons });
}
