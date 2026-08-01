import { mkdir, readFile, readdir, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  contentHash,
  hermesAgentInstanceSchema,
  hermesExecutionEventSchema,
  type HermesAgentEnvironment,
  type HermesAgentInstance,
  type HermesExecutionEvent
} from "../core";
import { getLoopgraphRoot } from "./storage-resolver";

export type HermesAgentListFilters = {
  workspaceId?: string;
  organizationId?: string;
  environment?: HermesAgentEnvironment;
  status?: HermesAgentInstance["status"];
};

export type HermesExecutionEventListFilters = {
  workspaceId?: string;
  organizationId?: string;
  companyId?: string;
  agentInstanceId?: string;
  routeJobId?: string;
  runId?: string;
  correlationId?: string;
  eventType?: HermesExecutionEvent["eventType"];
  limit?: number;
};

export type HermesExecutionEventAppendResult = {
  event: HermesExecutionEvent;
  created: boolean;
};

export interface HermesOperationsStore {
  saveAgentInstance(agent: HermesAgentInstance): Promise<void>;
  getAgentInstance(agentInstanceId: string): Promise<HermesAgentInstance | null>;
  listAgentInstances(filters?: HermesAgentListFilters): Promise<HermesAgentInstance[]>;
  appendExecutionEvent(event: HermesExecutionEvent): Promise<HermesExecutionEventAppendResult>;
  getExecutionEventByIdempotencyKey(idempotencyKey: string): Promise<HermesExecutionEvent | null>;
  listExecutionEvents(filters?: HermesExecutionEventListFilters): Promise<HermesExecutionEvent[]>;
}

export class FileHermesOperationsStore implements HermesOperationsStore {
  constructor(private rootDir = getLoopgraphRoot()) {}

  async saveAgentInstance(agent: HermesAgentInstance): Promise<void> {
    const parsed = hermesAgentInstanceSchema.parse(agent);
    await this.ensureDirs();
    await writeJsonAtomic(this.agentPath(parsed.id), parsed);
  }

  async getAgentInstance(agentInstanceId: string): Promise<HermesAgentInstance | null> {
    return readJson(this.agentPath(agentInstanceId), hermesAgentInstanceSchema);
  }

  async listAgentInstances(filters: HermesAgentListFilters = {}): Promise<HermesAgentInstance[]> {
    const agents = await listJsonRecords(this.agentsDir(), hermesAgentInstanceSchema);
    return agents
      .filter((agent) => !filters.workspaceId || agent.workspaceId === filters.workspaceId)
      .filter((agent) => !filters.organizationId || agent.organizationId === filters.organizationId)
      .filter((agent) => !filters.environment || agent.environment === filters.environment)
      .filter((agent) => !filters.status || agent.status === filters.status)
      .sort((left, right) => left.name.localeCompare(right.name));
  }

  async appendExecutionEvent(event: HermesExecutionEvent): Promise<HermesExecutionEventAppendResult> {
    const parsed = hermesExecutionEventSchema.parse(event);
    await this.ensureDirs();
    const eventPath = this.eventPath(parsed.idempotencyKey);
    try {
      await writeFile(eventPath, serializeJson(parsed), { encoding: "utf8", mode: 0o600, flag: "wx" });
      return { event: parsed, created: true };
    } catch (error) {
      if (!isFileExistsError(error)) throw error;
      const existing = await readJson(eventPath, hermesExecutionEventSchema);
      if (!existing) throw new Error(`Hermes execution event idempotency record is unreadable: ${parsed.idempotencyKey}`);
      if (contentHash(existing) !== contentHash(parsed)) {
        throw new Error(`Hermes execution event idempotency conflict: ${parsed.idempotencyKey}`);
      }
      return { event: existing, created: false };
    }
  }

  async getExecutionEventByIdempotencyKey(idempotencyKey: string): Promise<HermesExecutionEvent | null> {
    return readJson(this.eventPath(idempotencyKey), hermesExecutionEventSchema);
  }

  async listExecutionEvents(filters: HermesExecutionEventListFilters = {}): Promise<HermesExecutionEvent[]> {
    const events = await listJsonRecords(this.eventsDir(), hermesExecutionEventSchema);
    const filtered = events
      .filter((event) => !filters.workspaceId || event.workspaceId === filters.workspaceId)
      .filter((event) => !filters.organizationId || event.organizationId === filters.organizationId)
      .filter((event) => !filters.companyId || event.companyId === filters.companyId)
      .filter((event) => !filters.agentInstanceId || event.agentInstanceId === filters.agentInstanceId)
      .filter((event) => !filters.routeJobId || event.routeJobId === filters.routeJobId)
      .filter((event) => !filters.runId || event.runId === filters.runId)
      .filter((event) => !filters.correlationId || event.correlationId === filters.correlationId)
      .filter((event) => !filters.eventType || event.eventType === filters.eventType)
      .sort((left, right) => left.occurredAt.localeCompare(right.occurredAt) || left.sequence - right.sequence);
    return filters.limit ? filtered.slice(Math.max(0, filtered.length - filters.limit)) : filtered;
  }

  private baseDir(): string {
    return path.join(this.rootDir, "hermes", "operations");
  }

  private agentsDir(): string {
    return path.join(this.baseDir(), "agents");
  }

  private eventsDir(): string {
    return path.join(this.baseDir(), "events");
  }

  private agentPath(agentInstanceId: string): string {
    return path.join(this.agentsDir(), `${safeFileName(agentInstanceId)}.json`);
  }

  private eventPath(idempotencyKey: string): string {
    return path.join(this.eventsDir(), `${contentHash(idempotencyKey)}.json`);
  }

  private async ensureDirs(): Promise<void> {
    await Promise.all([
      mkdir(this.agentsDir(), { recursive: true, mode: 0o700 }),
      mkdir(this.eventsDir(), { recursive: true, mode: 0o700 })
    ]);
  }
}

export async function selectHermesAgentForExecution(input: {
  store: HermesOperationsStore;
  workspaceId: string;
  environment: HermesAgentEnvironment;
  requiredCapabilities: string[];
  loopId?: string;
  preferredAgentInstanceId?: string;
  now?: Date;
  heartbeatTtlSeconds?: number;
}): Promise<HermesAgentInstance | null> {
  const now = input.now ?? new Date();
  const heartbeatTtlMs = (input.heartbeatTtlSeconds ?? 180) * 1_000;
  const agents = await input.store.listAgentInstances({
    workspaceId: input.workspaceId,
    environment: input.environment
  });
  const required = new Set(input.requiredCapabilities);
  const eligible = agents.filter((agent) =>
    ["online", "degraded"].includes(agent.status) &&
    now.getTime() - Date.parse(agent.lastHeartbeatAt) <= heartbeatTtlMs &&
    (agent.assignedLoopIds.length === 0 || !input.loopId || agent.assignedLoopIds.includes(input.loopId)) &&
    [...required].every((capability) => agent.capabilities.includes(capability))
  );
  if (input.preferredAgentInstanceId) {
    return eligible.find((agent) => agent.id === input.preferredAgentInstanceId) ?? null;
  }
  return eligible.sort((left, right) => {
    if (left.defaultRouter !== right.defaultRouter) return left.defaultRouter ? -1 : 1;
    if (left.status !== right.status) return left.status === "online" ? -1 : 1;
    return right.lastHeartbeatAt.localeCompare(left.lastHeartbeatAt);
  })[0] ?? null;
}

function safeFileName(value: string): string {
  return encodeURIComponent(value);
}

function serializeJson(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

async function writeJsonAtomic(filePath: string, value: unknown): Promise<void> {
  const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(tempPath, serializeJson(value), { encoding: "utf8", mode: 0o600 });
  await rename(tempPath, filePath);
}

async function listJsonRecords<T>(directory: string, schema: { parse(input: unknown): T }): Promise<T[]> {
  try {
    const names = await readdir(directory);
    const values = await Promise.all(names.filter((name) => name.endsWith(".json")).map((name) => readJson(path.join(directory, name), schema)));
    const parsed: T[] = [];
    for (const value of values) {
      if (value !== null) parsed.push(value as T);
    }
    return parsed;
  } catch {
    return [];
  }
}

async function readJson<T>(filePath: string, schema: { parse(input: unknown): T }): Promise<T | null> {
  try {
    return schema.parse(JSON.parse(await readFile(filePath, "utf8")));
  } catch {
    return null;
  }
}

function isFileExistsError(error: unknown): boolean {
  return Boolean(error && typeof error === "object" && "code" in error && error.code === "EEXIST");
}
