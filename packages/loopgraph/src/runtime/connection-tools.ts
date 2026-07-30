import { z } from "zod";
import {
  connectionCapabilityStatusSchema,
  connectionEnvironmentSchema,
  credentialReferenceSchema
} from "../core";
import {
  buildConnectionPlan,
  setManualConnectionFallback
} from "./connection-plan";
import {
  readConnectionInstances,
  reportConnectionInstanceHealth,
  upsertConnectionInstance
} from "./connector-registry";

export const LOOPGRAPH_CONNECTION_TOOL_NAMES = [
  "loopgraph_connections_plan",
  "loopgraph_connections_set_manual_fallback",
  "loopgraph_connections_register",
  "loopgraph_connections_health_report",
  "loopgraph_connections_get"
] as const;

export type LoopgraphConnectionToolName = (typeof LOOPGRAPH_CONNECTION_TOOL_NAMES)[number];

export type LoopgraphConnectionToolRuntimeOptions = {
  projectRoot?: string;
};

export const connectionsPlanInputSchema = z.object({
  projectRoot: z.string().optional()
}).default({});

export const connectionsSetManualFallbackInputSchema = z.object({
  projectRoot: z.string().optional(),
  capability: z.string().min(1),
  label: z.string().min(1),
  instructions: z.string().optional(),
  updatedBy: z.string().optional()
});

export const connectionsRegisterInputSchema = z.object({
  projectRoot: z.string().optional(),
  id: z.string().min(1),
  manifestId: z.string().min(1),
  accountLabel: z.string().min(1).max(200).optional(),
  capabilityKeys: z.array(z.string().min(1)).max(100).default([]),
  credentialRef: credentialReferenceSchema.optional(),
  grantedScopes: z.array(z.string().min(1).max(512)).max(200).default([]),
  status: connectionCapabilityStatusSchema,
  statusReason: z.string().min(1).max(1000).optional(),
  environment: connectionEnvironmentSchema.default("simulate"),
  readPolicy: z.enum(["not_allowed", "manual_fallback", "read_only"]).default("manual_fallback"),
  writePolicy: z.enum(["not_allowed", "draft_only", "approved_only"]).default("not_allowed"),
  lastHealthCheckAt: z.string().datetime().optional()
});

export const connectionsHealthReportInputSchema = z.object({
  projectRoot: z.string().optional(),
  instanceId: z.string().min(1),
  status: z.enum(["connected", "degraded", "missing"]),
  checkedAt: z.string().datetime(),
  checkedBy: z.string().min(1).max(200),
  latencyMs: z.number().int().min(0).max(3_600_000).optional(),
  errorCode: z.string().min(1).max(200).optional(),
  evidenceRefs: z.array(z.string().min(1).max(512)).max(100).default([])
});

export const connectionsGetInputSchema = z.object({
  projectRoot: z.string().optional(),
  instanceId: z.string().min(1).optional()
}).default({});

export type ConnectionsPlanInput = z.input<typeof connectionsPlanInputSchema>;
export type ConnectionsSetManualFallbackInput = z.input<typeof connectionsSetManualFallbackInputSchema>;

export const loopgraphConnectionToolDefinitions = [
  {
    name: "loopgraph_connections_plan",
    description: "Return the non-secret connection checklist required by materialized LoopSpecs.",
    readOnly: true,
    idempotent: true
  },
  {
    name: "loopgraph_connections_set_manual_fallback",
    description: "Record a non-secret manual fallback for a missing capability so local simulation/routing can proceed safely.",
    readOnly: false,
    idempotent: false
  },
  {
    name: "loopgraph_connections_register",
    description: "Register non-secret connector metadata and an opaque Hermes credential reference.",
    readOnly: false,
    idempotent: true
  },
  {
    name: "loopgraph_connections_health_report",
    description: "Record a non-secret connector health receipt produced by Hermes.",
    readOnly: false,
    idempotent: true
  },
  {
    name: "loopgraph_connections_get",
    description: "Read registered non-secret connection metadata and health receipts.",
    readOnly: true,
    idempotent: true
  }
] satisfies Array<{
  name: LoopgraphConnectionToolName;
  description: string;
  readOnly: boolean;
  idempotent: boolean;
}>;

export async function callLoopgraphConnectionTool(
  name: LoopgraphConnectionToolName,
  input: unknown,
  options: LoopgraphConnectionToolRuntimeOptions = {}
) {
  if (name === "loopgraph_connections_plan") {
    const parsed = connectionsPlanInputSchema.parse(input);
    return buildConnectionPlan({
      projectRoot: parsed.projectRoot ?? options.projectRoot
    });
  }
  if (name === "loopgraph_connections_set_manual_fallback") {
    const parsed = connectionsSetManualFallbackInputSchema.parse(input);
    return setManualConnectionFallback({
      projectRoot: parsed.projectRoot ?? options.projectRoot,
      capability: parsed.capability,
      label: parsed.label,
      instructions: parsed.instructions,
      updatedBy: parsed.updatedBy
    });
  }
  if (name === "loopgraph_connections_register") {
    const parsed = connectionsRegisterInputSchema.parse(input);
    const projectRoot = parsed.projectRoot ?? options.projectRoot ?? process.cwd();
    const instance = { ...parsed };
    delete instance.projectRoot;
    return {
      connection: await upsertConnectionInstance(projectRoot, instance)
    };
  }
  if (name === "loopgraph_connections_health_report") {
    const parsed = connectionsHealthReportInputSchema.parse(input);
    return {
      connection: await reportConnectionInstanceHealth({
        projectRoot: parsed.projectRoot ?? options.projectRoot ?? process.cwd(),
        instanceId: parsed.instanceId,
        status: parsed.status,
        checkedAt: parsed.checkedAt,
        checkedBy: parsed.checkedBy,
        latencyMs: parsed.latencyMs,
        errorCode: parsed.errorCode,
        evidenceRefs: parsed.evidenceRefs
      })
    };
  }
  if (name === "loopgraph_connections_get") {
    const parsed = connectionsGetInputSchema.parse(input);
    const instances = await readConnectionInstances(parsed.projectRoot ?? options.projectRoot ?? process.cwd());
    return {
      connections: parsed.instanceId
        ? instances.filter((instance) => instance.id === parsed.instanceId)
        : instances
    };
  }
  throw new Error(`Unknown Loopgraph connection tool: ${String(name)}`);
}
