import { z } from "zod";
import {
  HERMES_AGENT_INSTANCE_SCHEMA_VERSION,
  hermesAgentEnvironmentSchema,
  hermesAgentInstanceSchema,
  hermesAgentStatusSchema,
  hermesExecutionEventSchema
} from "../core";
import { FileStorageAdapter } from "../sdk/storage";
import { loadAgentOperationsReadModel } from "./agent-operations-read-model";
import { ingestHermesExecutionEvent } from "./hermes-execution-service";
import { FileHermesOperationsStore } from "./hermes-operations-store";
import { FileRoutingStore } from "./routing-store";
import { getLoopgraphRoot } from "./storage-resolver";
import { inspectLoopgraphWorkspace } from "./workspace";

export const hermesAgentRegisterInputSchema = z.object({
  projectRoot: z.string().optional(),
  id: z.string().min(1).max(160),
  name: z.string().min(1).max(200),
  workspaceId: z.string().min(1).max(160).optional(),
  organizationId: z.string().min(1).max(160).optional(),
  environment: hermesAgentEnvironmentSchema.default("local"),
  status: hermesAgentStatusSchema.default("online"),
  runtimeVersion: z.string().min(1).max(100),
  capabilities: z.array(z.string().min(1).max(160)).max(250).default([]),
  assignedLoopIds: z.array(z.string().min(1).max(200)).max(500).default([]),
  defaultRouter: z.boolean().default(true),
  publicKeyId: z.string().min(1).max(200).optional(),
  labels: z.record(z.string().max(100), z.string().max(500)).default({})
});

export const hermesAgentHeartbeatInputSchema = z.object({
  projectRoot: z.string().optional(),
  agentInstanceId: z.string().min(1).max(160),
  status: z.enum(["online", "degraded", "offline"]).default("online"),
  runtimeVersion: z.string().min(1).max(100).optional()
});

export const hermesExecutionEventIngestInputSchema = z.object({
  projectRoot: z.string().optional(),
  event: hermesExecutionEventSchema
});

export const agentOperationsGetInputSchema = z.object({
  projectRoot: z.string().optional(),
  source: z.string().optional(),
  department: z.string().optional(),
  loopId: z.string().optional(),
  agentInstanceId: z.string().optional(),
  status: z.string().optional(),
  needsAttention: z.boolean().optional(),
  limit: z.number().int().min(1).max(1_000).default(250)
});

export const loopgraphHermesOperationsToolDefinitions = [
  { name: "loopgraph_hermes_agent_register", description: "Register this Hermes runtime and its bounded capabilities for live Loopgraph assignments.", readOnly: false, idempotent: true },
  { name: "loopgraph_hermes_agent_heartbeat", description: "Refresh a registered Hermes runtime heartbeat without changing its granted capabilities.", readOnly: false, idempotent: true },
  { name: "loopgraph_hermes_execution_event_ingest", description: "Append one assignment-bound Hermes task, tool, approval, output, outcome, or run event to Loopgraph.", readOnly: false, idempotent: true },
  { name: "loopgraph_agent_operations_get", description: "Read the event-to-problem-to-loop-to-agent execution and outcome topology.", readOnly: true, idempotent: true }
] as const;
export const LOOPGRAPH_HERMES_OPERATIONS_TOOL_NAMES = loopgraphHermesOperationsToolDefinitions.map((tool) => tool.name);

export type LoopgraphHermesOperationsToolName = typeof loopgraphHermesOperationsToolDefinitions[number]["name"];

export async function callLoopgraphHermesOperationsTool(
  name: LoopgraphHermesOperationsToolName,
  input: unknown,
  options: { projectRoot?: string; now?: Date } = {}
): Promise<unknown> {
  if (name === "loopgraph_hermes_agent_register") {
    const parsed = hermesAgentRegisterInputSchema.parse(input);
    const projectRoot = parsed.projectRoot ?? options.projectRoot ?? process.cwd();
    const workspace = await inspectLoopgraphWorkspace({ projectRoot, createIfMissing: true });
    const now = (options.now ?? new Date()).toISOString();
    const agent = hermesAgentInstanceSchema.parse({
      schemaVersion: HERMES_AGENT_INSTANCE_SCHEMA_VERSION,
      id: parsed.id,
      workspaceId: parsed.workspaceId ?? workspace.registry.projectRootId,
      ...(parsed.organizationId ? { organizationId: parsed.organizationId } : {}),
      name: parsed.name,
      environment: parsed.environment,
      status: parsed.status,
      runtimeVersion: parsed.runtimeVersion,
      capabilities: parsed.capabilities,
      assignedLoopIds: parsed.assignedLoopIds,
      defaultRouter: parsed.defaultRouter,
      ...(parsed.publicKeyId ? { publicKeyId: parsed.publicKeyId } : {}),
      labels: parsed.labels,
      lastHeartbeatAt: now,
      registeredAt: now,
      updatedAt: now
    });
    await new FileHermesOperationsStore(getLoopgraphRoot(projectRoot)).saveAgentInstance(agent);
    return { agent, registered: true };
  }
  if (name === "loopgraph_hermes_agent_heartbeat") {
    const parsed = hermesAgentHeartbeatInputSchema.parse(input);
    const projectRoot = parsed.projectRoot ?? options.projectRoot ?? process.cwd();
    const store = new FileHermesOperationsStore(getLoopgraphRoot(projectRoot));
    const existing = await store.getAgentInstance(parsed.agentInstanceId);
    if (!existing) throw new Error(`Hermes agent is not registered: ${parsed.agentInstanceId}`);
    if (existing.status === "disabled") throw new Error("Disabled Hermes agents cannot restore themselves through heartbeat");
    const now = (options.now ?? new Date()).toISOString();
    const agent = hermesAgentInstanceSchema.parse({
      ...existing,
      status: parsed.status,
      ...(parsed.runtimeVersion ? { runtimeVersion: parsed.runtimeVersion } : {}),
      lastHeartbeatAt: now,
      updatedAt: now
    });
    await store.saveAgentInstance(agent);
    return { agent, heartbeatAccepted: true };
  }
  if (name === "loopgraph_hermes_execution_event_ingest") {
    const parsed = hermesExecutionEventIngestInputSchema.parse(input);
    const projectRoot = parsed.projectRoot ?? options.projectRoot ?? process.cwd();
    const root = getLoopgraphRoot(projectRoot);
    return ingestHermesExecutionEvent({
      event: parsed.event,
      operationsStore: new FileHermesOperationsStore(root),
      routingStore: new FileRoutingStore(root),
      storage: new FileStorageAdapter(root),
      now: options.now
    });
  }
  const parsed = agentOperationsGetInputSchema.parse(input);
  const projectRoot = parsed.projectRoot ?? options.projectRoot ?? process.cwd();
  return loadAgentOperationsReadModel({ ...parsed, projectRoot, now: options.now });
}
