import { Readable, Writable } from "node:stream";
import { zodToJsonSchema } from "zod-to-json-schema";
import {
  evidenceGapSetSchema,
  eventEnvelopeSchema,
  graphChangeSetSchema,
  hermesDesignTaskSchema,
  listDepartmentCatalog,
  loopOpportunitySchema,
  loopDesignContextSchema,
  loopDesignProposalSetSchema,
  requireDepartmentType,
  routingCardSchema,
  routingDecisionSchema
} from "../core";
import {
  callLoopgraphRoutingTool,
  eventsReplayInputSchema,
  loopgraphRoutingToolDefinitions,
  routeCommitSimulateInputSchema,
  routingCatalogGetInputSchema,
  eventsIngestInputSchema,
  routingDecisionSubmitInputSchema,
  routingHumanChoiceSubmitInputSchema,
  type LoopgraphRoutingToolName
} from "../runtime/routing-tools";
import {
  callLoopgraphRoutingOpsTool,
  eventsGetInputSchema,
  graphGetInputSchema,
  lifecycleEventsGetInputSchema,
  loopgraphRoutingOpsToolDefinitions,
  problemsGetInputSchema,
  routeJobsGetInputSchema,
  routingEvaluationsGetInputSchema,
  routingDecisionGetInputSchema,
  type LoopgraphRoutingOpsToolName
} from "../runtime/routing-ops-tools";
import {
  callLoopgraphRoutingEvaluationTool,
  loopgraphRoutingEvaluationToolDefinitions,
  routingEvaluationRunInputSchema,
  type LoopgraphRoutingEvaluationToolName
} from "../runtime/routing-evaluation-tools";
import {
  callLoopgraphHermesWebhookTool,
  hermesWebhookFixtureTestInputSchema,
  hermesWebhooksDoctorInputSchema,
  hermesWebhooksPlanInputSchema,
  hermesWebhooksSyncInputSchema,
  loopgraphHermesWebhookToolDefinitions,
  type LoopgraphHermesWebhookToolName
} from "../runtime/hermes-webhooks";
import {
  callLoopgraphWorkspaceTool,
  departmentsListInputSchema,
  loopgraphWorkspaceToolDefinitions,
  workspaceInspectInputSchema,
  type LoopgraphWorkspaceToolName
} from "../runtime/workspace-tools";
import {
  callLoopgraphDiscoveryTool,
  discoveryConfirmProjectContextInputSchema,
  discoveryGetInputSchema,
  discoveryNextQuestionsInputSchema,
  discoverySelectDepartmentsInputSchema,
  discoveryStartInputSchema,
  discoverySubmitAnswersInputSchema,
  loopgraphDiscoveryToolDefinitions,
  type LoopgraphDiscoveryToolName
} from "../runtime/discovery-tools";
import {
  getDiscoverySession,
  listHermesDiscoverySessions
} from "../runtime/discovery-session";
import {
  callLoopgraphDesignTool,
  designContextGetInputSchema,
  designEditInputSchema,
  designGenerateInputSchema,
  designSubmitInputSchema,
  loopgraphDesignToolDefinitions,
  type LoopgraphDesignToolName
} from "../runtime/design-tools";
import {
  callLoopgraphHermesDesignTool,
  evidenceGapAnswerInputSchema,
  evidenceGapsGetInputSchema,
  hermesDesignStartInputSchema,
  hermesDesignTasksGetInputSchema,
  loopgraphHermesDesignToolDefinitions,
  type LoopgraphHermesDesignToolName
} from "../runtime/hermes-design-tools";
import {
  callLoopgraphOpportunityTool,
  graphChangesGetInputSchema,
  loopgraphOpportunityToolDefinitions,
  opportunitiesGetInputSchema,
  opportunitiesScanInputSchema,
  opportunityDismissInputSchema,
  type LoopgraphOpportunityToolName
} from "../runtime/loop-opportunity-tools";
import {
  callLoopgraphLoopTool,
  loopgraphLoopToolDefinitions,
  loopsListInputSchema,
  loopsMaterializeInputSchema,
  loopsSimulateInputSchema,
  loopsValidateInputSchema,
  runsGetInputSchema,
  caseResolveInputSchema,
  reviewSubmitInputSchema,
  type LoopgraphLoopToolName
} from "../runtime/loop-tools";
import { listLoopgraphLoops } from "../runtime/loop-materialization";
import {
  callLoopgraphProjectTool,
  loopgraphProjectToolDefinitions,
  projectInspectInputSchema,
  type LoopgraphProjectToolName
} from "../runtime/project-tools";
import {
  callLoopgraphConnectionTool,
  connectionsPlanInputSchema,
  connectionsSetManualFallbackInputSchema,
  loopgraphConnectionToolDefinitions,
  type LoopgraphConnectionToolName
} from "../runtime/connection-tools";
import { loadLoopSpecFromPath } from "../runtime/loader";

const LATEST_MCP_PROTOCOL_VERSION = "2025-11-25";
const SUPPORTED_MCP_PROTOCOL_VERSIONS = new Set([
  LATEST_MCP_PROTOCOL_VERSION,
  "2025-06-18",
  "2025-03-26"
]);

type JsonRpcId = string | number;

type JsonRpcRequest = {
  jsonrpc: "2.0";
  id?: JsonRpcId;
  method: string;
  params?: Record<string, unknown>;
};

type JsonRpcResponse = {
  jsonrpc: "2.0";
  id: JsonRpcId | null;
  result?: Record<string, unknown>;
  error?: {
    code: number;
    message: string;
    data?: unknown;
  };
};

type LoopgraphMcpResource = {
  uri: string;
  name: string;
  description: string;
  mimeType: "application/json";
};

export type LoopgraphMcpExposure = "admin" | "webhook_router" | "lifecycle_router";

export type LoopgraphMcpServerOptions = {
  projectRoot?: string;
  now?: Date;
  exposure?: LoopgraphMcpExposure;
};

type LoopgraphMcpToolName =
  | LoopgraphRoutingToolName
  | LoopgraphRoutingOpsToolName
  | LoopgraphRoutingEvaluationToolName
  | LoopgraphHermesWebhookToolName
  | LoopgraphWorkspaceToolName
  | LoopgraphDiscoveryToolName
  | LoopgraphProjectToolName
  | LoopgraphDesignToolName
  | LoopgraphHermesDesignToolName
  | LoopgraphOpportunityToolName
  | LoopgraphConnectionToolName
  | LoopgraphLoopToolName;

const toolInputSchemas = {
  loopgraph_workspace_inspect: workspaceInspectInputSchema,
  loopgraph_departments_list: departmentsListInputSchema,
  loopgraph_discovery_start: discoveryStartInputSchema,
  loopgraph_discovery_get: discoveryGetInputSchema,
  loopgraph_discovery_confirm_project_context: discoveryConfirmProjectContextInputSchema,
  loopgraph_discovery_select_departments: discoverySelectDepartmentsInputSchema,
  loopgraph_discovery_next_questions: discoveryNextQuestionsInputSchema,
  loopgraph_discovery_submit_answers: discoverySubmitAnswersInputSchema,
  loopgraph_project_inspect: projectInspectInputSchema,
  loopgraph_design_context_get: designContextGetInputSchema,
  loopgraph_design_generate: designGenerateInputSchema,
  loopgraph_design_submit: designSubmitInputSchema,
  loopgraph_design_edit: designEditInputSchema,
  loopgraph_hermes_design_start: hermesDesignStartInputSchema,
  loopgraph_hermes_design_tasks_get: hermesDesignTasksGetInputSchema,
  loopgraph_evidence_gaps_get: evidenceGapsGetInputSchema,
  loopgraph_evidence_gap_answer: evidenceGapAnswerInputSchema,
  loopgraph_opportunities_scan: opportunitiesScanInputSchema,
  loopgraph_opportunities_get: opportunitiesGetInputSchema,
  loopgraph_opportunity_dismiss: opportunityDismissInputSchema,
  loopgraph_graph_changes_get: graphChangesGetInputSchema,
  loopgraph_connections_plan: connectionsPlanInputSchema,
  loopgraph_connections_set_manual_fallback: connectionsSetManualFallbackInputSchema,
  loopgraph_loops_list: loopsListInputSchema,
  loopgraph_runs_get: runsGetInputSchema,
  loopgraph_loops_materialize: loopsMaterializeInputSchema,
  loopgraph_loops_validate: loopsValidateInputSchema,
  loopgraph_loops_simulate: loopsSimulateInputSchema,
  loopgraph_review_submit: reviewSubmitInputSchema,
  loopgraph_case_resolve: caseResolveInputSchema,
  loopgraph_routing_catalog_get: routingCatalogGetInputSchema,
  loopgraph_events_ingest: eventsIngestInputSchema,
  loopgraph_events_replay: eventsReplayInputSchema,
  loopgraph_routing_decision_submit: routingDecisionSubmitInputSchema,
  loopgraph_routing_human_choice_submit: routingHumanChoiceSubmitInputSchema,
  loopgraph_route_commit_simulate: routeCommitSimulateInputSchema,
  loopgraph_events_get: eventsGetInputSchema,
  loopgraph_problems_get: problemsGetInputSchema,
  loopgraph_routing_decision_get: routingDecisionGetInputSchema,
  loopgraph_route_jobs_get: routeJobsGetInputSchema,
  loopgraph_routing_evaluations_get: routingEvaluationsGetInputSchema,
  loopgraph_lifecycle_events_get: lifecycleEventsGetInputSchema,
  loopgraph_graph_get: graphGetInputSchema,
  loopgraph_routing_evaluation_run: routingEvaluationRunInputSchema,
  loopgraph_hermes_webhooks_plan: hermesWebhooksPlanInputSchema,
  loopgraph_hermes_webhooks_sync: hermesWebhooksSyncInputSchema,
  loopgraph_hermes_webhooks_doctor: hermesWebhooksDoctorInputSchema,
  loopgraph_hermes_webhooks_test: hermesWebhookFixtureTestInputSchema
};

const loopgraphMcpToolDefinitions = [
  ...loopgraphWorkspaceToolDefinitions,
  ...loopgraphDiscoveryToolDefinitions,
  ...loopgraphProjectToolDefinitions,
  ...loopgraphDesignToolDefinitions,
  ...loopgraphHermesDesignToolDefinitions,
  ...loopgraphOpportunityToolDefinitions,
  ...loopgraphConnectionToolDefinitions,
  ...loopgraphLoopToolDefinitions,
  ...loopgraphRoutingToolDefinitions,
  ...loopgraphRoutingOpsToolDefinitions,
  ...loopgraphRoutingEvaluationToolDefinitions,
  ...loopgraphHermesWebhookToolDefinitions
] as const;

export const LOOPGRAPH_WEBHOOK_ROUTER_MCP_TOOL_NAMES = [
  "loopgraph_routing_catalog_get",
  "loopgraph_events_ingest",
  "loopgraph_routing_decision_submit",
  "loopgraph_events_get",
  "loopgraph_problems_get",
  "loopgraph_routing_decision_get",
  "loopgraph_graph_get"
] as const satisfies readonly LoopgraphMcpToolName[];

export const LOOPGRAPH_LIFECYCLE_ROUTER_MCP_TOOL_NAMES = [
  "loopgraph_events_ingest",
  "loopgraph_events_get",
  "loopgraph_graph_get"
] as const satisfies readonly LoopgraphMcpToolName[];

export const LOOPGRAPH_MCP_STATIC_RESOURCE_URIS = [
  "loopgraph://schemas/loop-design-context",
  "loopgraph://schemas/loop-design-proposal-set",
  "loopgraph://schemas/event-envelope",
  "loopgraph://schemas/routing-card",
  "loopgraph://schemas/routing-decision",
  "loopgraph://schemas/evidence-gap-set",
  "loopgraph://schemas/hermes-design-task",
  "loopgraph://schemas/loop-opportunity",
  "loopgraph://schemas/graph-change-set",
  "loopgraph://graph/company"
] as const;

const LOOPGRAPH_ROUTER_SCHEMA_RESOURCE_URIS = new Set([
  "loopgraph://schemas/event-envelope",
  "loopgraph://schemas/routing-card",
  "loopgraph://schemas/routing-decision"
]);

export function normalizeLoopgraphMcpExposure(value: unknown): LoopgraphMcpExposure {
  if (value === undefined || value === null || value === "") return "admin";
  if (value === "admin" || value === "webhook_router" || value === "lifecycle_router") return value;
  throw new Error(`Unsupported Loopgraph MCP exposure: ${String(value)}`);
}

export function listLoopgraphMcpTools(options: Pick<LoopgraphMcpServerOptions, "exposure"> = {}) {
  const exposure = normalizeLoopgraphMcpExposure(options.exposure);
  return loopgraphMcpToolDefinitions
    .filter((tool) => isToolAllowedForExposure(tool.name, exposure))
    .map((tool) => ({
      name: tool.name,
      title: titleFromToolName(tool.name),
      description: tool.description,
      inputSchema: zodToJsonSchema(toolInputSchemas[tool.name], `${tool.name}_input`),
      annotations: {
        title: titleFromToolName(tool.name),
        readOnlyHint: isReadOnlyToolName(tool.name),
        destructiveHint: false,
        idempotentHint: isIdempotentToolName(tool.name),
        openWorldHint: false
      }
    }));
}

export async function listLoopgraphMcpResources(
  options: LoopgraphMcpServerOptions = {}
): Promise<LoopgraphMcpResource[]> {
  const projectRoot = options.projectRoot ?? process.cwd();
  const departmentResources = listDepartmentCatalog({ includeCustom: true }).map((department) => ({
    uri: `loopgraph://departments/${department.id}`,
    name: `${department.label} department`,
    description: department.description,
    mimeType: "application/json" as const
  }));
  const schemaResources: LoopgraphMcpResource[] = [
    {
      uri: LOOPGRAPH_MCP_STATIC_RESOURCE_URIS[0],
      name: "LoopDesignContext schema",
      description: "Bounded model input schema Hermes uses for high-reasoning loop design.",
      mimeType: "application/json"
    },
    {
      uri: LOOPGRAPH_MCP_STATIC_RESOURCE_URIS[1],
      name: "LoopDesignProposalSet schema",
      description: "Structured proposal schema Hermes must submit back to Loopgraph for validation.",
      mimeType: "application/json"
    },
    {
      uri: LOOPGRAPH_MCP_STATIC_RESOURCE_URIS[2],
      name: "EventEnvelope schema",
      description: "Normalized event schema used by Hermes webhook, schedule, manual, and lifecycle events.",
      mimeType: "application/json"
    },
    {
      uri: LOOPGRAPH_MCP_STATIC_RESOURCE_URIS[3],
      name: "RoutingCard schema",
      description: "Bounded per-loop route eligibility card schema shown to Hermes during event routing.",
      mimeType: "application/json"
    },
    {
      uri: LOOPGRAPH_MCP_STATIC_RESOURCE_URIS[4],
      name: "RoutingDecision schema",
      description: "Schema-constrained decision Hermes submits after classifying a business event.",
      mimeType: "application/json"
    },
    {
      uri: LOOPGRAPH_MCP_STATIC_RESOURCE_URIS[5],
      name: "EvidenceGapSet schema",
      description: "Focused missing-evidence contract Loopgraph uses to drive adaptive Hermes questions.",
      mimeType: "application/json"
    },
    {
      uri: LOOPGRAPH_MCP_STATIC_RESOURCE_URIS[6],
      name: "HermesDesignTask schema",
      description: "Durable Loopgraph-initiated design task and delivery state exposed to trusted Hermes sessions.",
      mimeType: "application/json"
    },
    {
      uri: LOOPGRAPH_MCP_STATIC_RESOURCE_URIS[7],
      name: "LoopOpportunity schema",
      description: "Explainable, scored opportunity to create, improve, split, merge, or retire a business loop.",
      mimeType: "application/json"
    },
    {
      uri: LOOPGRAPH_MCP_STATIC_RESOURCE_URIS[8],
      name: "GraphChangeSet schema",
      description: "Versioned proposed changes to the company loop graph derived from observed evidence.",
      mimeType: "application/json"
    }
  ];
  const graphResources: LoopgraphMcpResource[] = [{
    uri: LOOPGRAPH_MCP_STATIC_RESOURCE_URIS[9],
    name: "Hermes Company Brain graph",
    description: "Project-bound design graph projection: Hermes Brain -> Department -> Loops.",
    mimeType: "application/json"
  }];
  const exposure = normalizeLoopgraphMcpExposure(options.exposure);
  if (exposure !== "admin") {
    return [...schemaResources, ...graphResources]
      .filter((resource) => isResourceAllowedForExposure(resource.uri, exposure));
  }
  const sessions = await listHermesDiscoverySessions(projectRoot);
  const sessionResources = sessions.map((session) => ({
    uri: `loopgraph://discovery/${encodeURIComponent(session.id)}`,
    name: `Discovery session ${session.id}`,
    description: `Loopgraph discovery session for company ${session.companyId}.`,
    mimeType: "application/json" as const
  }));
  const loops = await listLoopgraphLoops({ projectRoot });
  const loopResources = loops.loops.map((loop) => ({
    uri: `loopgraph://loops/${encodeURIComponent(loop.loopId)}`,
    name: `${loop.name} loop`,
    description: `Registered ${loop.department} loop with ${loop.routingReady ? "ready" : "missing"} Hermes routing contract.`,
    mimeType: "application/json" as const
  }));

  return [
    ...schemaResources,
    ...departmentResources,
    ...sessionResources,
    ...loopResources,
    ...graphResources
  ];
}

export async function handleLoopgraphMcpMessage(
  message: unknown,
  options: LoopgraphMcpServerOptions = {}
): Promise<JsonRpcResponse | JsonRpcResponse[] | null> {
  if (Array.isArray(message)) {
    if (message.length === 0) {
      return errorResponse(null, -32600, "Invalid Request", "Batch requests must not be empty");
    }
    const responses = (await Promise.all(message.map((item) => handleSingleMessage(item, options))))
      .filter((response): response is JsonRpcResponse => response !== null);
    return responses.length > 0 ? responses : null;
  }

  return handleSingleMessage(message, options);
}

export async function runLoopgraphMcpStdioServer(
  options: LoopgraphMcpServerOptions & {
    input?: Readable;
    output?: Writable;
    errorOutput?: Writable;
  } = {}
): Promise<void> {
  const input = options.input ?? process.stdin;
  const output = options.output ?? process.stdout;
  const errorOutput = options.errorOutput ?? process.stderr;
  let buffer = "";

  input.setEncoding("utf8");

  for await (const chunk of input) {
    buffer += chunk;
    let newlineIndex = buffer.indexOf("\n");

    while (newlineIndex >= 0) {
      const line = buffer.slice(0, newlineIndex).trim();
      buffer = buffer.slice(newlineIndex + 1);

      if (line.length > 0) {
        await handleLine(line, output, errorOutput, options);
      }

      newlineIndex = buffer.indexOf("\n");
    }
  }

  const remaining = buffer.trim();
  if (remaining.length > 0) {
    await handleLine(remaining, output, errorOutput, options);
  }
}

async function handleLine(
  line: string,
  output: Writable,
  errorOutput: Writable,
  options: LoopgraphMcpServerOptions
): Promise<void> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch (error) {
    writeJsonLine(output, errorResponse(null, -32700, "Parse error", error instanceof Error ? error.message : String(error)));
    return;
  }

  try {
    const response = await handleLoopgraphMcpMessage(parsed, options);
    if (response !== null) writeJsonLine(output, response);
  } catch (error) {
    errorOutput.write(`${error instanceof Error ? error.message : String(error)}\n`);
    writeJsonLine(output, errorResponse(null, -32603, "Internal error"));
  }
}

async function handleSingleMessage(
  message: unknown,
  options: LoopgraphMcpServerOptions
): Promise<JsonRpcResponse | null> {
  if (!isRecord(message) || message.jsonrpc !== "2.0") {
    return errorResponse(requestId(message), -32600, "Invalid Request", "Expected a JSON-RPC 2.0 message");
  }

  if (typeof message.method !== "string") {
    return null;
  }

  const hasId = Object.prototype.hasOwnProperty.call(message, "id");
  if (!hasId) {
    return null;
  }

  const id = requestId(message);
  if (id === null) {
    return errorResponse(null, -32600, "Invalid Request", "Request id must be a string or number");
  }

  return handleRequest({ ...(message as JsonRpcRequest), id }, options);
}

async function handleRequest(
  request: JsonRpcRequest & { id: JsonRpcId },
  options: LoopgraphMcpServerOptions
): Promise<JsonRpcResponse> {
  if (request.method === "initialize") {
    const requestedProtocolVersion = isRecord(request.params) && typeof request.params.protocolVersion === "string"
      ? request.params.protocolVersion
      : undefined;

    return resultResponse(request.id, {
      protocolVersion: requestedProtocolVersion && SUPPORTED_MCP_PROTOCOL_VERSIONS.has(requestedProtocolVersion)
        ? requestedProtocolVersion
        : LATEST_MCP_PROTOCOL_VERSION,
      capabilities: {
        tools: {
          listChanged: false
        },
        resources: {
          subscribe: false,
          listChanged: false
        }
      },
      serverInfo: {
        name: "loopgraph",
        version: "0.2.0"
      },
      instructions: mcpInstructionsForExposure(normalizeLoopgraphMcpExposure(options.exposure))
    });
  }

  if (request.method === "ping") {
    return resultResponse(request.id, {});
  }

  if (request.method === "tools/list") {
    return resultResponse(request.id, {
      tools: listLoopgraphMcpTools(options)
    });
  }

  if (request.method === "resources/list") {
    return resultResponse(request.id, {
      resources: await listLoopgraphMcpResources(options)
    });
  }

  if (request.method === "resources/read") {
    return handleResourceRead(request, options);
  }

  if (request.method === "tools/call") {
    return handleToolCall(request, options);
  }

  return errorResponse(request.id, -32601, "Method not found", request.method);
}

async function handleResourceRead(
  request: JsonRpcRequest & { id: JsonRpcId },
  options: LoopgraphMcpServerOptions
): Promise<JsonRpcResponse> {
  const params = isRecord(request.params) ? request.params : {};
  if (typeof params.uri !== "string") {
    return errorResponse(request.id, -32602, "Invalid params", "resources/read requires a string uri");
  }

  try {
    const content = await readLoopgraphMcpResource(params.uri, options);
    return resultResponse(request.id, {
      contents: [{
        uri: params.uri,
        mimeType: "application/json",
        text: `${JSON.stringify(content, null, 2)}\n`
      }]
    });
  } catch (error) {
    return errorResponse(request.id, -32002, "Resource not found", error instanceof Error ? error.message : String(error));
  }
}

async function readLoopgraphMcpResource(
  uri: string,
  options: LoopgraphMcpServerOptions = {}
): Promise<unknown> {
  const exposure = normalizeLoopgraphMcpExposure(options.exposure);
  if (!isResourceAllowedForExposure(uri, exposure)) {
    throw new Error(`Loopgraph MCP resource is unavailable for ${exposure} exposure: ${uri}`);
  }
  const parsed = parseLoopgraphResourceUri(uri);
  const projectRoot = options.projectRoot ?? process.cwd();

  if (parsed.collection === "schemas") {
    return schemaResource(parsed.id);
  }

  if (parsed.collection === "departments") {
    const departmentType = requireDepartmentType(parsed.id);
    const department = listDepartmentCatalog({ includeCustom: true }).find((item) => item.id === departmentType);
    if (!department) throw new Error(`Department resource not found: ${parsed.id}`);
    return {
      schemaVersion: "department-resource/v1alpha1",
      department
    };
  }

  if (parsed.collection === "discovery") {
    const session = await getDiscoverySession(parsed.id, projectRoot);
    if (!session) throw new Error(`Discovery session resource not found: ${parsed.id}`);
    return session;
  }

  if (parsed.collection === "loops") {
    const loops = await listLoopgraphLoops({ projectRoot });
    const loop = loops.loops.find((item) => item.loopId === parsed.id);
    if (!loop) throw new Error(`Loop resource not found: ${parsed.id}`);
    const loaded = await loadLoopSpecFromPath(loop.specPath);
    return {
      schemaVersion: "loop-resource/v1alpha1",
      loop,
      spec: loaded.ok ? loaded.spec : undefined,
      loadErrors: loaded.ok ? [] : loaded.errors
    };
  }

  if (parsed.collection === "graph" && parsed.id === "company") {
    return callLoopgraphMcpTool("loopgraph_graph_get", { projection: "design" }, options);
  }

  throw new Error(`Unsupported Loopgraph resource URI: ${uri}`);
}

async function handleToolCall(
  request: JsonRpcRequest & { id: JsonRpcId },
  options: LoopgraphMcpServerOptions
): Promise<JsonRpcResponse> {
  const params = isRecord(request.params) ? request.params : {};
  const name = params.name;

  if (!isLoopgraphMcpToolName(name)) {
    return errorResponse(request.id, -32601, "Tool not found", typeof name === "string" ? name : undefined);
  }
  if (!isToolAllowedForExposure(name, normalizeLoopgraphMcpExposure(options.exposure))) {
    return errorResponse(request.id, -32601, "Tool not found", typeof name === "string" ? name : undefined);
  }

  try {
    const structuredContent = await callLoopgraphMcpTool(
      name,
      isRecord(params.arguments) ? params.arguments : {},
      options
    );

    return resultResponse(request.id, {
      content: [{
        type: "text",
        text: JSON.stringify(structuredContent, null, 2)
      }],
      structuredContent,
      isError: false
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return resultResponse(request.id, {
      content: [{
        type: "text",
        text: message
      }],
      isError: true
    });
  }
}

async function callLoopgraphMcpTool(
  name: LoopgraphMcpToolName,
  input: Record<string, unknown>,
  options: LoopgraphMcpServerOptions
) {
  const boundInput = bindProjectRoot(input, options);

  if (isLoopgraphRoutingToolName(name)) {
    return callLoopgraphRoutingTool(name, boundInput, {
      projectRoot: options.projectRoot,
      now: options.now
    });
  }

  if (isLoopgraphRoutingOpsToolName(name)) {
    return callLoopgraphRoutingOpsTool(name, boundInput, {
      projectRoot: options.projectRoot,
      now: options.now
    });
  }

  if (isLoopgraphRoutingEvaluationToolName(name)) {
    return callLoopgraphRoutingEvaluationTool(name, boundInput, {
      projectRoot: options.projectRoot,
      now: options.now
    });
  }

  if (isLoopgraphHermesWebhookToolName(name)) {
    return callLoopgraphHermesWebhookTool(name, boundInput, {
      projectRoot: options.projectRoot,
      now: options.now
    });
  }

  if (isLoopgraphWorkspaceToolName(name)) {
    return callLoopgraphWorkspaceTool(name, boundInput, {
      projectRoot: options.projectRoot
    });
  }

  if (isLoopgraphDesignToolName(name)) {
    return callLoopgraphDesignTool(name, boundInput, {
      projectRoot: options.projectRoot
    });
  }

  if (isLoopgraphHermesDesignToolName(name)) {
    return callLoopgraphHermesDesignTool(name, boundInput, {
      projectRoot: options.projectRoot,
      now: options.now
    });
  }

  if (isLoopgraphOpportunityToolName(name)) {
    return callLoopgraphOpportunityTool(name, boundInput, {
      projectRoot: options.projectRoot,
      now: options.now
    });
  }

  if (isLoopgraphProjectToolName(name)) {
    return callLoopgraphProjectTool(name, boundInput, {
      projectRoot: options.projectRoot
    });
  }

  if (isLoopgraphConnectionToolName(name)) {
    return callLoopgraphConnectionTool(name, boundInput, {
      projectRoot: options.projectRoot
    });
  }

  if (isLoopgraphLoopToolName(name)) {
    return callLoopgraphLoopTool(name, boundInput, {
      projectRoot: options.projectRoot,
      now: options.now
    });
  }

  return callLoopgraphDiscoveryTool(name, boundInput, {
    projectRoot: options.projectRoot
  });
}

function bindProjectRoot(
  input: Record<string, unknown>,
  options: LoopgraphMcpServerOptions
): Record<string, unknown> {
  if (!options.projectRoot) return input;
  return {
    ...input,
    projectRoot: options.projectRoot
  };
}

function parseLoopgraphResourceUri(uri: string): { collection: string; id: string } {
  let parsed: URL;
  try {
    parsed = new URL(uri);
  } catch {
    throw new Error(`Invalid Loopgraph resource URI: ${uri}`);
  }
  if (parsed.protocol !== "loopgraph:") {
    throw new Error(`Unsupported resource protocol: ${parsed.protocol}`);
  }
  const id = decodeURIComponent(parsed.pathname.replace(/^\//, ""));
  if (!parsed.hostname || !id) {
    throw new Error(`Loopgraph resource URI must include a collection and id: ${uri}`);
  }
  return {
    collection: parsed.hostname,
    id
  };
}

function schemaResource(id: string) {
  if (id === "loop-design-context") {
    return {
      schemaVersion: "mcp-schema-resource/v1alpha1",
      id,
      jsonSchema: zodToJsonSchema(loopDesignContextSchema, "LoopDesignContext")
    };
  }
  if (id === "loop-design-proposal-set") {
    return {
      schemaVersion: "mcp-schema-resource/v1alpha1",
      id,
      jsonSchema: zodToJsonSchema(loopDesignProposalSetSchema, "LoopDesignProposalSet")
    };
  }
  if (id === "event-envelope") {
    return {
      schemaVersion: "mcp-schema-resource/v1alpha1",
      id,
      jsonSchema: zodToJsonSchema(eventEnvelopeSchema, "EventEnvelope")
    };
  }
  if (id === "routing-card") {
    return {
      schemaVersion: "mcp-schema-resource/v1alpha1",
      id,
      jsonSchema: zodToJsonSchema(routingCardSchema, "RoutingCard")
    };
  }
  if (id === "routing-decision") {
    return {
      schemaVersion: "mcp-schema-resource/v1alpha1",
      id,
      jsonSchema: zodToJsonSchema(routingDecisionSchema, "RoutingDecision")
    };
  }
  if (id === "evidence-gap-set") {
    return {
      schemaVersion: "mcp-schema-resource/v1alpha1",
      id,
      jsonSchema: zodToJsonSchema(evidenceGapSetSchema, "EvidenceGapSet")
    };
  }
  if (id === "hermes-design-task") {
    return {
      schemaVersion: "mcp-schema-resource/v1alpha1",
      id,
      jsonSchema: zodToJsonSchema(hermesDesignTaskSchema, "HermesDesignTask")
    };
  }
  if (id === "loop-opportunity") {
    return {
      schemaVersion: "mcp-schema-resource/v1alpha1",
      id,
      jsonSchema: zodToJsonSchema(loopOpportunitySchema, "LoopOpportunity")
    };
  }
  if (id === "graph-change-set") {
    return {
      schemaVersion: "mcp-schema-resource/v1alpha1",
      id,
      jsonSchema: zodToJsonSchema(graphChangeSetSchema, "GraphChangeSet")
    };
  }
  throw new Error(`Schema resource not found: ${id}`);
}

function writeJsonLine(output: Writable, value: unknown): void {
  output.write(`${JSON.stringify(value)}\n`);
}

function resultResponse(id: JsonRpcId, result: Record<string, unknown>): JsonRpcResponse {
  return {
    jsonrpc: "2.0",
    id,
    result
  };
}

function errorResponse(id: JsonRpcId | null, code: number, message: string, data?: unknown): JsonRpcResponse {
  return {
    jsonrpc: "2.0",
    id,
    error: {
      code,
      message,
      ...(data === undefined ? {} : { data })
    }
  };
}

function requestId(message: unknown): JsonRpcId | null {
  if (!isRecord(message)) return null;
  const id = message.id;
  return typeof id === "string" || typeof id === "number" ? id : null;
}

function isLoopgraphRoutingToolName(value: unknown): value is LoopgraphRoutingToolName {
  return typeof value === "string" && loopgraphRoutingToolDefinitions.some((tool) => tool.name === value);
}

function isLoopgraphRoutingOpsToolName(value: unknown): value is LoopgraphRoutingOpsToolName {
  return typeof value === "string" && loopgraphRoutingOpsToolDefinitions.some((tool) => tool.name === value);
}

function isLoopgraphRoutingEvaluationToolName(value: unknown): value is LoopgraphRoutingEvaluationToolName {
  return typeof value === "string" && loopgraphRoutingEvaluationToolDefinitions.some((tool) => tool.name === value);
}

function isLoopgraphHermesWebhookToolName(value: unknown): value is LoopgraphHermesWebhookToolName {
  return typeof value === "string" && loopgraphHermesWebhookToolDefinitions.some((tool) => tool.name === value);
}

function isLoopgraphWorkspaceToolName(value: unknown): value is LoopgraphWorkspaceToolName {
  return typeof value === "string" && loopgraphWorkspaceToolDefinitions.some((tool) => tool.name === value);
}

function isLoopgraphDiscoveryToolName(value: unknown): value is LoopgraphDiscoveryToolName {
  return typeof value === "string" && loopgraphDiscoveryToolDefinitions.some((tool) => tool.name === value);
}

function isLoopgraphDesignToolName(value: unknown): value is LoopgraphDesignToolName {
  return typeof value === "string" && loopgraphDesignToolDefinitions.some((tool) => tool.name === value);
}

function isLoopgraphHermesDesignToolName(value: unknown): value is LoopgraphHermesDesignToolName {
  return typeof value === "string" && loopgraphHermesDesignToolDefinitions.some((tool) => tool.name === value);
}

function isLoopgraphOpportunityToolName(value: unknown): value is LoopgraphOpportunityToolName {
  return typeof value === "string" && loopgraphOpportunityToolDefinitions.some((tool) => tool.name === value);
}

function isLoopgraphProjectToolName(value: unknown): value is LoopgraphProjectToolName {
  return typeof value === "string" && loopgraphProjectToolDefinitions.some((tool) => tool.name === value);
}

function isLoopgraphConnectionToolName(value: unknown): value is LoopgraphConnectionToolName {
  return typeof value === "string" && loopgraphConnectionToolDefinitions.some((tool) => tool.name === value);
}

function isLoopgraphLoopToolName(value: unknown): value is LoopgraphLoopToolName {
  return typeof value === "string" && loopgraphLoopToolDefinitions.some((tool) => tool.name === value);
}

function isLoopgraphMcpToolName(value: unknown): value is LoopgraphMcpToolName {
  return isLoopgraphRoutingToolName(value) ||
    isLoopgraphRoutingOpsToolName(value) ||
    isLoopgraphRoutingEvaluationToolName(value) ||
    isLoopgraphHermesWebhookToolName(value) ||
    isLoopgraphWorkspaceToolName(value) ||
    isLoopgraphDiscoveryToolName(value) ||
    isLoopgraphProjectToolName(value) ||
    isLoopgraphDesignToolName(value) ||
    isLoopgraphHermesDesignToolName(value) ||
    isLoopgraphOpportunityToolName(value) ||
    isLoopgraphConnectionToolName(value) ||
    isLoopgraphLoopToolName(value);
}

function isToolAllowedForExposure(name: LoopgraphMcpToolName, exposure: LoopgraphMcpExposure): boolean {
  if (exposure === "admin") return true;
  if (exposure === "webhook_router") return (LOOPGRAPH_WEBHOOK_ROUTER_MCP_TOOL_NAMES as readonly string[]).includes(name);
  return (LOOPGRAPH_LIFECYCLE_ROUTER_MCP_TOOL_NAMES as readonly string[]).includes(name);
}

function isResourceAllowedForExposure(uri: string, exposure: LoopgraphMcpExposure): boolean {
  if (exposure === "admin") return true;
  return LOOPGRAPH_ROUTER_SCHEMA_RESOURCE_URIS.has(uri) || uri === "loopgraph://graph/company";
}

function mcpInstructionsForExposure(exposure: LoopgraphMcpExposure): string {
  if (exposure === "webhook_router") {
    return "Loopgraph exposes only bounded event-ingest, routing-decision, routing-state, and graph tools for isolated Hermes webhook-router turns.";
  }
  if (exposure === "lifecycle_router") {
    return "Loopgraph exposes only lifecycle event receipt, lifecycle state read, and graph tools for notification-only Hermes lifecycle turns.";
  }
  return "Loopgraph exposes project-bound workspace, department, discovery, design, local runtime, and routing administration tools for trusted Hermes/operator turns.";
}

function isReadOnlyToolName(name: LoopgraphMcpToolName): boolean {
  return name === "loopgraph_workspace_inspect" ||
    name === "loopgraph_departments_list" ||
    name === "loopgraph_discovery_get" ||
    name === "loopgraph_discovery_next_questions" ||
    name === "loopgraph_project_inspect" ||
    name === "loopgraph_design_context_get" ||
    name === "loopgraph_hermes_design_tasks_get" ||
    name === "loopgraph_opportunities_get" ||
    name === "loopgraph_graph_changes_get" ||
    name === "loopgraph_connections_plan" ||
    name === "loopgraph_loops_list" ||
    name === "loopgraph_runs_get" ||
    name === "loopgraph_loops_validate" ||
    name === "loopgraph_routing_catalog_get" ||
    name === "loopgraph_events_get" ||
    name === "loopgraph_problems_get" ||
    name === "loopgraph_routing_decision_get" ||
    name === "loopgraph_route_jobs_get" ||
    name === "loopgraph_routing_evaluations_get" ||
    name === "loopgraph_lifecycle_events_get" ||
    name === "loopgraph_graph_get" ||
    name === "loopgraph_hermes_webhooks_plan" ||
    name === "loopgraph_hermes_webhooks_doctor";
}

function isIdempotentToolName(name: LoopgraphMcpToolName): boolean {
  return ![
    "loopgraph_discovery_start",
    "loopgraph_discovery_select_departments",
    "loopgraph_discovery_submit_answers",
    "loopgraph_design_generate",
    "loopgraph_design_submit",
    "loopgraph_design_edit",
    "loopgraph_evidence_gap_answer",
    "loopgraph_opportunity_dismiss",
    "loopgraph_connections_set_manual_fallback",
    "loopgraph_loops_materialize",
    "loopgraph_loops_simulate",
    "loopgraph_review_submit",
    "loopgraph_case_resolve",
    "loopgraph_events_replay",
    "loopgraph_routing_decision_submit",
    "loopgraph_routing_human_choice_submit",
    "loopgraph_routing_evaluation_run",
    "loopgraph_route_commit_simulate",
    "loopgraph_hermes_webhooks_test"
  ].includes(name);
}

function titleFromToolName(name: string): string {
  return name
    .replace(/^loopgraph_/, "")
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}
