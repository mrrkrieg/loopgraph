import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Readable, Writable } from "node:stream";
import { describe, expect, it } from "vitest";
import { LOOPGRAPH_API_VERSION, LOOP_KIND, createEventEnvelopeId, eventEnvelopeSchema } from "../core";
import {
  handleLoopgraphMcpMessage,
  LOOPGRAPH_LIFECYCLE_ROUTER_MCP_TOOL_NAMES,
  listLoopgraphMcpResources,
  listLoopgraphMcpTools,
  LOOPGRAPH_WEBHOOK_ROUTER_MCP_TOOL_NAMES,
  LOOPGRAPH_MCP_STATIC_RESOURCE_URIS,
  runLoopgraphMcpStdioServer
} from "./server";

async function createRoutingProject(): Promise<{ projectRoot: string }> {
  const projectRoot = await mkdtemp(path.join(tmpdir(), "loopgraph-mcp-"));
  const specPath = path.join(projectRoot, "loops", "marketing-ads.loopgraph.json");
  await mkdir(path.dirname(specPath), { recursive: true });
  await writeFile(specPath, `${JSON.stringify(marketingAdsSpec(), null, 2)}\n`);
  await mkdir(path.join(projectRoot, ".loopgraph"), { recursive: true });
  await writeFile(path.join(projectRoot, ".loopgraph", "workspace.json"), `${JSON.stringify({
    version: 1,
    demoCatalogEnabled: false,
    registeredSpecs: [{
      id: "marketing_ads",
      name: "Ads",
      path: path.relative(projectRoot, specPath),
      department: "marketing",
      addedAt: "2026-07-21T12:00:00.000Z"
    }]
  }, null, 2)}\n`);
  return { projectRoot };
}

function marketingAdsSpec() {
  return {
    apiVersion: LOOPGRAPH_API_VERSION,
    kind: LOOP_KIND,
    metadata: {
      id: "marketing_ads",
      name: "Ads",
      version: "1.0.0",
      description: "Improve qualified acquisition efficiency."
    },
    trigger: { type: "event", source: "hermes", event: "business_event" },
    input: { schema: { type: "object" } },
    output: {
      schema: {
        type: "object",
        required: ["decisionSummary", "proposedActions", "evidence", "policyInputs", "verificationRequest"],
        properties: {
          decisionSummary: { type: "string" },
          proposedActions: { type: "array" },
          evidence: { type: "array" },
          policyInputs: { type: "array" },
          verificationRequest: { type: "object" }
        }
      }
    },
    context: { sources: [], precedence: [] },
    routine: {
      steps: [{ id: "observe", name: "Observe", stepType: "observe", actor: "system", description: "Observe campaign signals." }]
    },
    tools: [{ key: "draft_review", adapterId: "manual", label: "Draft review", writeCapable: false, riskLevel: "low" }],
    policy: {
      allowedActions: [{ toolKey: "draft_review", allowed: true, requiresApproval: false, riskLevel: "low" }],
      forbiddenActions: [],
      escalationRules: []
    },
    verification: [],
    approval: { requireFingerprintMatch: true, separateCustomerFacingApproval: true, allowedRoles: ["owner"] },
    persistence: { idempotency: { enabled: true } },
    trace: { captureContextSnapshot: true, captureToolInputOutput: true, evidenceRequired: true },
    topology: { department: "marketing" },
    routing: {
      schemaVersion: "routing-contract/v1alpha1",
      problemTypes: ["paid_acquisition_efficiency_drop"],
      accepts: [{
        sourcePattern: "google_ads*",
        eventTypePattern: "campaign.*",
        subjectTypes: ["campaign"],
        requiredFields: ["signals.spendDeltaPct", "signals.costPerQualifiedCustomerDeltaPct"]
      }],
      inputMapping: { campaignId: "subject.id" },
      minimumConfidence: 0.8,
      activationMode: "shadow"
    }
  };
}

function adsEvent(sourceDeliveryId: string) {
  const base = {
    workspaceId: "workspace_1",
    companyId: "company_1",
    source: "google_ads_detector",
    sourceDeliveryId,
    eventType: "campaign.performance_anomaly"
  };

  return eventEnvelopeSchema.parse({
    id: createEventEnvelopeId(base),
    ...base,
    sourceRoute: "hermes.google_ads_detector",
    occurredAt: "2026-07-21T12:00:00.000Z",
    receivedAt: "2026-07-21T12:00:01.000Z",
    subject: { type: "campaign", id: "campaign_123" },
    correlationId: "corr_campaign_123",
    normalizedPayload: {
      signals: {
        spendDeltaPct: 18,
        costPerQualifiedCustomerDeltaPct: 31
      }
    },
    trust: { signatureVerified: true, signer: "google_ads", untrustedFields: [] }
  });
}

function marketingAdsFixture() {
  return {
    eventId: "evt_marketing_ads_happy",
    simulatedAt: "2026-07-21T12:00:00.000Z",
    expectedAssessment: {
      decisionSummary: "Campaign spend is rising faster than qualified pipeline.",
      assumptions: [{ id: "assumption_1", statement: "The fixture is synthetic.", confidence: 1 }],
      proposedActions: [{
        id: "act_draft",
        toolKey: "draft_review",
        label: "Draft campaign review",
        input: { recommendation: "Pause the low-quality audience segment." },
        riskLevel: "low",
        requiresApproval: false,
        customerFacing: false
      }],
      evidence: [{
        id: "evidence_1",
        sourceId: "fixture.signals",
        sourceType: "fixture",
        excerpt: "Spend +18%, cost per qualified customer +31%",
        trusted: true
      }],
      policyInputs: [{ key: "confidence", value: 0.91, source: "fixture" }],
      verificationRequest: { required: false, checks: ["evidence"] },
      escalationRequest: { required: false }
    }
  };
}

function isMcpResultRecord(value: unknown): value is { result: { structuredContent: Record<string, unknown> } } {
  return Boolean(
    value &&
      typeof value === "object" &&
      "result" in value &&
      (value as { result?: unknown }).result &&
      typeof (value as { result?: unknown }).result === "object" &&
      "structuredContent" in ((value as { result?: Record<string, unknown> }).result ?? {}) &&
      typeof (value as { result?: { structuredContent?: unknown } }).result?.structuredContent === "object"
  );
}

function resourceJson(value: unknown): Record<string, unknown> {
  const contents = (value as { result?: { contents?: Array<{ text?: string }> } }).result?.contents;
  const text = contents?.[0]?.text;
  if (!text) throw new Error("MCP resource response did not include text content");
  return JSON.parse(text) as Record<string, unknown>;
}

async function expectMcpToolDenied(input: {
  projectRoot: string;
  exposure: "webhook_router" | "lifecycle_router";
  toolName: string;
}) {
  const response = await handleLoopgraphMcpMessage({
    jsonrpc: "2.0",
    id: `${input.exposure}-${input.toolName}-denied`,
    method: "tools/call",
    params: {
      name: input.toolName,
      arguments: { projectRoot: input.projectRoot }
    }
  }, {
    projectRoot: input.projectRoot,
    exposure: input.exposure
  });

  expect(response).toMatchObject({
    jsonrpc: "2.0",
    id: `${input.exposure}-${input.toolName}-denied`,
    error: {
      code: -32601,
      message: "Tool not found",
      data: input.toolName
    }
  });
}

describe("Loopgraph MCP server", () => {
  it("rejects an oversized JSON line before parsing and continues with the next request", async () => {
    const oversized = JSON.stringify({
      jsonrpc: "2.0",
      id: "oversized",
      method: "ping",
      padding: "x".repeat(2_000)
    });
    const ping = JSON.stringify({ jsonrpc: "2.0", id: "ping-after-limit", method: "ping" });
    let outputText = "";
    const output = new Writable({
      write(chunk, _encoding, callback) {
        outputText += chunk.toString();
        callback();
      }
    });

    await runLoopgraphMcpStdioServer({
      input: Readable.from([`${oversized}\n${ping}\n`]),
      output,
      errorOutput: new Writable({ write(_chunk, _encoding, callback) { callback(); } }),
      maxLineBytes: 512
    });

    const responses = outputText.trim().split("\n").map((line) => JSON.parse(line));
    expect(responses[0]).toMatchObject({
      error: {
        code: -32600,
        message: "Request too large"
      }
    });
    expect(responses[1]).toMatchObject({
      id: "ping-after-limit",
      result: {}
    });
  });

  it("announces tools capability during initialize", async () => {
    const response = await handleLoopgraphMcpMessage({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2025-06-18",
        capabilities: {},
        clientInfo: { name: "test", version: "0.0.0" }
      }
    });

    expect(response).toMatchObject({
      jsonrpc: "2.0",
      id: 1,
      result: {
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
          name: "loopgraph"
        }
      }
    });
  });

  it("lists project admin workspace, discovery, design, routing, and local runtime tools", async () => {
    const response = await handleLoopgraphMcpMessage({
      jsonrpc: "2.0",
      id: "tools",
      method: "tools/list"
    });

    expect(response).toMatchObject({
      jsonrpc: "2.0",
      id: "tools",
      result: {
        tools: expect.arrayContaining([
          expect.objectContaining({ name: "loopgraph_workspace_inspect" }),
          expect.objectContaining({ name: "loopgraph_departments_list" }),
          expect.objectContaining({ name: "loopgraph_discovery_start" }),
          expect.objectContaining({ name: "loopgraph_discovery_get" }),
          expect.objectContaining({ name: "loopgraph_discovery_confirm_project_context" }),
          expect.objectContaining({ name: "loopgraph_discovery_select_departments" }),
          expect.objectContaining({ name: "loopgraph_discovery_next_questions" }),
          expect.objectContaining({ name: "loopgraph_discovery_submit_answers" }),
          expect.objectContaining({ name: "loopgraph_project_inspect" }),
          expect.objectContaining({ name: "loopgraph_design_context_get" }),
          expect.objectContaining({ name: "loopgraph_design_generate" }),
          expect.objectContaining({ name: "loopgraph_design_submit" }),
          expect.objectContaining({ name: "loopgraph_design_edit" }),
          expect.objectContaining({ name: "loopgraph_hermes_design_start" }),
          expect.objectContaining({ name: "loopgraph_hermes_design_tasks_get" }),
          expect.objectContaining({ name: "loopgraph_evidence_gaps_get" }),
          expect.objectContaining({ name: "loopgraph_evidence_gap_answer" }),
          expect.objectContaining({ name: "loopgraph_opportunities_scan" }),
          expect.objectContaining({ name: "loopgraph_opportunities_get" }),
          expect.objectContaining({ name: "loopgraph_opportunity_dismiss" }),
          expect.objectContaining({ name: "loopgraph_graph_changes_get" }),
          expect.objectContaining({ name: "loopgraph_graph_change_decide" }),
          expect.objectContaining({ name: "loopgraph_graph_change_apply" }),
          expect.objectContaining({ name: "loopgraph_graph_history_get" }),
          expect.objectContaining({ name: "loopgraph_loop_promotion_approve" }),
          expect.objectContaining({ name: "loopgraph_loop_promote" }),
          expect.objectContaining({ name: "loopgraph_loop_lifecycle_approve" }),
          expect.objectContaining({ name: "loopgraph_loop_lifecycle_set" }),
          expect.objectContaining({ name: "loopgraph_graph_rollback_approve" }),
          expect.objectContaining({ name: "loopgraph_graph_rollback" }),
          expect.objectContaining({ name: "loopgraph_route_worker_run" }),
          expect.objectContaining({ name: "loopgraph_route_job_retry" }),
          expect.objectContaining({ name: "loopgraph_route_job_cancel" }),
          expect.objectContaining({ name: "loopgraph_metric_samples_ingest" }),
          expect.objectContaining({ name: "loopgraph_metric_samples_get" }),
          expect.objectContaining({ name: "loopgraph_outcomes_evaluate" }),
          expect.objectContaining({ name: "loopgraph_outcomes_get" }),
          expect.objectContaining({ name: "loopgraph_value_ledger_record" }),
          expect.objectContaining({ name: "loopgraph_value_ledger_get" }),
          expect.objectContaining({ name: "loopgraph_controller_run" }),
          expect.objectContaining({ name: "loopgraph_controller_runs_get" }),
          expect.objectContaining({ name: "loopgraph_controller_policy_get" }),
          expect.objectContaining({ name: "loopgraph_controller_policy_set" }),
          expect.objectContaining({ name: "loopgraph_connections_plan" }),
          expect.objectContaining({ name: "loopgraph_connections_set_manual_fallback" }),
          expect.objectContaining({ name: "loopgraph_connections_register" }),
          expect.objectContaining({ name: "loopgraph_connections_health_report" }),
          expect.objectContaining({ name: "loopgraph_connections_get" }),
          expect.objectContaining({ name: "loopgraph_metric_bindings_set" }),
          expect.objectContaining({ name: "loopgraph_metric_bindings_get" }),
          expect.objectContaining({ name: "loopgraph_measurements_schedule" }),
          expect.objectContaining({ name: "loopgraph_measurement_jobs_claim" }),
          expect.objectContaining({ name: "loopgraph_measurement_jobs_complete" }),
          expect.objectContaining({ name: "loopgraph_measurement_jobs_fail" }),
          expect.objectContaining({ name: "loopgraph_measurement_jobs_get" }),
          expect.objectContaining({ name: "loopgraph_connections_reconcile" }),
          expect.objectContaining({ name: "loopgraph_connections_reconciliations_get" }),
          expect.objectContaining({ name: "loopgraph_loops_list" }),
          expect.objectContaining({ name: "loopgraph_runs_get" }),
          expect.objectContaining({ name: "loopgraph_loops_materialize" }),
          expect.objectContaining({ name: "loopgraph_loops_validate" }),
          expect.objectContaining({ name: "loopgraph_loops_simulate" }),
          expect.objectContaining({ name: "loopgraph_review_submit" }),
          expect.objectContaining({ name: "loopgraph_case_resolve" }),
          expect.objectContaining({ name: "loopgraph_routing_catalog_get" }),
          expect.objectContaining({ name: "loopgraph_events_ingest" }),
          expect.objectContaining({ name: "loopgraph_events_replay" }),
          expect.objectContaining({ name: "loopgraph_routing_decision_submit" }),
          expect.objectContaining({ name: "loopgraph_routing_human_choice_submit" }),
          expect.objectContaining({ name: "loopgraph_route_commit_simulate" }),
          expect.objectContaining({ name: "loopgraph_events_get" }),
          expect.objectContaining({ name: "loopgraph_problems_get" }),
          expect.objectContaining({ name: "loopgraph_routing_decision_get" }),
          expect.objectContaining({ name: "loopgraph_route_jobs_get" }),
          expect.objectContaining({ name: "loopgraph_routing_evaluations_get" }),
          expect.objectContaining({ name: "loopgraph_lifecycle_events_get" }),
          expect.objectContaining({ name: "loopgraph_graph_get" }),
          expect.objectContaining({ name: "loopgraph_routing_evaluation_run" }),
          expect.objectContaining({ name: "loopgraph_promotion_rehearsal_run" }),
          expect.objectContaining({ name: "loopgraph_promotion_rehearsals_get" }),
          expect.objectContaining({ name: "loopgraph_hermes_webhooks_plan" }),
          expect.objectContaining({ name: "loopgraph_hermes_webhooks_sync" }),
          expect.objectContaining({ name: "loopgraph_hermes_webhooks_doctor" }),
          expect.objectContaining({ name: "loopgraph_hermes_webhooks_test" })
        ])
      }
    });
    expect(listLoopgraphMcpTools()).toHaveLength(134);
    expect(listLoopgraphMcpTools().map((tool) => tool.name)).toEqual(expect.arrayContaining([
      "loopgraph_hermes_agent_register",
      "loopgraph_hermes_agent_heartbeat",
      "loopgraph_hermes_execution_event_ingest",
      "loopgraph_agent_operations_get",
      "loopgraph_marketplace_search",
      "loopgraph_app_get",
      "loopgraph_app_onboarding_get",
      "loopgraph_app_install_plan",
      "loopgraph_app_install_apply",
      "loopgraph_app_install_status",
      "loopgraph_connector_schema_record",
      "loopgraph_app_field_mappings_get",
      "loopgraph_app_field_mapping_confirm",
      "loopgraph_app_test",
      "loopgraph_app_historical_replay",
      "loopgraph_app_evaluation_label",
      "loopgraph_app_promotion_recommendation",
      "loopgraph_app_configure",
      "loopgraph_app_overlay_apply",
      "loopgraph_app_repair",
      "loopgraph_app_duplicate",
      "loopgraph_app_diff",
      "loopgraph_app_update_plan",
      "loopgraph_app_update_apply",
      "loopgraph_app_rollback",
      "loopgraph_app_detach",
      "loopgraph_app_uninstall",
      "loopgraph_app_activate",
      "loopgraph_app_pause",
      "loopgraph_app_resume",
      "loopgraph_app_publisher_key_generate",
      "loopgraph_app_publisher_keys_get",
      "loopgraph_app_init",
      "loopgraph_app_capture",
      "loopgraph_app_validate",
      "loopgraph_app_pack",
      "loopgraph_app_sign",
      "loopgraph_app_publish",
      "loopgraph_app_release_status",
      "loopgraph_marketplace_sources_get",
      "loopgraph_marketplace_source_add",
      "loopgraph_marketplace_source_refresh"
    ]));
    const graphApply = listLoopgraphMcpTools()
      .find((tool) => tool.name === "loopgraph_graph_change_apply");
    const graphHistory = listLoopgraphMcpTools()
      .find((tool) => tool.name === "loopgraph_graph_history_get");
    expect(graphApply?.annotations).toMatchObject({
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: false
    });
    expect(graphHistory?.annotations).toMatchObject({
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true
    });
  });

  it("supports a restricted webhook-router exposure for untrusted Hermes event turns", async () => {
    const { projectRoot } = await createRoutingProject();
    const toolsResponse = await handleLoopgraphMcpMessage({
      jsonrpc: "2.0",
      id: "router-tools",
      method: "tools/list"
    }, {
      projectRoot,
      exposure: "webhook_router"
    });
    const tools = (toolsResponse as { result?: { tools?: Array<{ name: string }> } }).result?.tools ?? [];
    const toolNames = tools.map((tool) => tool.name);

    expect(toolNames).toEqual([...LOOPGRAPH_WEBHOOK_ROUTER_MCP_TOOL_NAMES]);
    expect(toolNames).not.toContain("loopgraph_events_replay");
    expect(toolNames).not.toContain("loopgraph_routing_human_choice_submit");
    expect(toolNames).not.toContain("loopgraph_route_commit_simulate");
    expect(toolNames).not.toContain("loopgraph_loops_simulate");
    expect(toolNames).not.toContain("loopgraph_design_submit");
    expect(toolNames).not.toContain("loopgraph_loops_materialize");
    expect(toolNames).not.toContain("loopgraph_hermes_webhooks_sync");
    expect(toolNames).not.toContain("loopgraph_route_worker_run");
    expect(toolNames).not.toContain("loopgraph_graph_change_apply");
    expect(toolNames).not.toContain("loopgraph_graph_rollback");
    expect(listLoopgraphMcpTools({ exposure: "lifecycle_router" }).map((tool) => tool.name)).toEqual([
      ...LOOPGRAPH_LIFECYCLE_ROUTER_MCP_TOOL_NAMES
    ]);

    for (const toolName of [
      "loopgraph_workspace_inspect",
      "loopgraph_discovery_start",
      "loopgraph_project_inspect",
      "loopgraph_design_context_get",
      "loopgraph_design_submit",
      "loopgraph_design_edit",
      "loopgraph_opportunities_scan",
      "loopgraph_opportunities_get",
      "loopgraph_opportunity_dismiss",
      "loopgraph_graph_changes_get",
      "loopgraph_graph_change_decide",
      "loopgraph_graph_change_apply",
      "loopgraph_graph_history_get",
      "loopgraph_loop_promotion_approve",
      "loopgraph_loop_promote",
      "loopgraph_loop_lifecycle_approve",
      "loopgraph_loop_lifecycle_set",
      "loopgraph_graph_rollback_approve",
      "loopgraph_graph_rollback",
      "loopgraph_route_worker_run",
      "loopgraph_route_job_retry",
      "loopgraph_route_job_cancel",
      "loopgraph_metric_samples_ingest",
      "loopgraph_metric_samples_get",
      "loopgraph_outcomes_evaluate",
      "loopgraph_outcomes_get",
      "loopgraph_value_ledger_record",
      "loopgraph_value_ledger_get",
      "loopgraph_controller_run",
      "loopgraph_controller_runs_get",
      "loopgraph_controller_policy_get",
      "loopgraph_controller_policy_set",
      "loopgraph_connections_set_manual_fallback",
      "loopgraph_connections_register",
      "loopgraph_connections_health_report",
      "loopgraph_connections_get",
      "loopgraph_metric_bindings_set",
      "loopgraph_metric_bindings_get",
      "loopgraph_measurements_schedule",
      "loopgraph_measurement_jobs_claim",
      "loopgraph_measurement_jobs_complete",
      "loopgraph_measurement_jobs_fail",
      "loopgraph_measurement_jobs_get",
      "loopgraph_connections_reconcile",
      "loopgraph_connections_reconciliations_get",
      "loopgraph_loops_materialize",
      "loopgraph_loops_validate",
      "loopgraph_loops_simulate",
      "loopgraph_review_submit",
      "loopgraph_case_resolve",
      "loopgraph_events_replay",
      "loopgraph_routing_human_choice_submit",
      "loopgraph_route_commit_simulate",
      "loopgraph_routing_evaluation_run",
      "loopgraph_hermes_webhooks_plan",
      "loopgraph_hermes_webhooks_sync",
      "loopgraph_hermes_webhooks_test"
    ]) {
      await expectMcpToolDenied({
        projectRoot,
        exposure: "webhook_router",
        toolName
      });
    }

    for (const toolName of [
      "loopgraph_routing_catalog_get",
      "loopgraph_routing_decision_submit",
      "loopgraph_problems_get",
      "loopgraph_routing_decision_get",
      "loopgraph_graph_change_decide",
      "loopgraph_graph_change_apply",
      "loopgraph_graph_history_get",
      "loopgraph_loop_promotion_approve",
      "loopgraph_loop_promote",
      "loopgraph_loop_lifecycle_approve",
      "loopgraph_loop_lifecycle_set",
      "loopgraph_graph_rollback_approve",
      "loopgraph_graph_rollback",
      "loopgraph_loops_simulate",
      "loopgraph_route_commit_simulate",
      "loopgraph_connections_register",
      "loopgraph_metric_bindings_set",
      "loopgraph_measurement_jobs_claim",
      "loopgraph_measurement_jobs_complete",
      "loopgraph_connections_reconcile"
    ]) {
      await expectMcpToolDenied({
        projectRoot,
        exposure: "lifecycle_router",
        toolName
      });
    }

    const resourcesResponse = await handleLoopgraphMcpMessage({
      jsonrpc: "2.0",
      id: "router-resources",
      method: "resources/list"
    }, {
      projectRoot,
      exposure: "webhook_router"
    });
    const resources = (resourcesResponse as { result?: { resources?: Array<{ uri: string }> } }).result?.resources ?? [];
    expect(resources.map((resource) => resource.uri)).toEqual([
      "loopgraph://schemas/event-envelope",
      "loopgraph://schemas/routing-card",
      "loopgraph://schemas/routing-decision",
      "loopgraph://graph/company"
    ]);

    const loopResource = await handleLoopgraphMcpMessage({
      jsonrpc: "2.0",
      id: "router-loop-resource-denied",
      method: "resources/read",
      params: { uri: "loopgraph://loops/marketing_ads" }
    }, {
      projectRoot,
      exposure: "webhook_router"
    });
    expect(loopResource).toMatchObject({
      jsonrpc: "2.0",
      id: "router-loop-resource-denied",
      error: {
        code: -32002,
        message: "Resource not found",
        data: expect.stringContaining("unavailable for webhook_router exposure")
      }
    });
  });

  it("exposes app discovery and lifecycle only through the governed admin surface", async () => {
    const { projectRoot } = await createRoutingProject();
    const appToolNames = [
      "loopgraph_company_blueprints_search",
      "loopgraph_company_blueprint_get",
      "loopgraph_department_packs_search",
      "loopgraph_department_pack_get",
      "loopgraph_marketplace_search",
      "loopgraph_app_get",
      "loopgraph_app_onboarding_get",
      "loopgraph_app_install_plan",
      "loopgraph_app_install_apply",
      "loopgraph_app_install_status",
      "loopgraph_app_test",
      "loopgraph_app_historical_replay",
      "loopgraph_app_evaluation_label",
      "loopgraph_app_promotion_recommendation",
      "loopgraph_app_activate",
      "loopgraph_app_pause",
      "loopgraph_app_resume",
      "loopgraph_app_publisher_key_generate",
      "loopgraph_app_publisher_keys_get",
      "loopgraph_app_init",
      "loopgraph_app_capture",
      "loopgraph_app_validate",
      "loopgraph_app_pack",
      "loopgraph_app_sign",
      "loopgraph_app_publish",
      "loopgraph_app_release_status",
      "loopgraph_marketplace_sources_get",
      "loopgraph_marketplace_source_add",
      "loopgraph_marketplace_source_refresh"
    ];
    const adminNames = listLoopgraphMcpTools().map((tool) => tool.name);
    const webhookNames = listLoopgraphMcpTools({ exposure: "webhook_router" }).map((tool) => tool.name);
    const lifecycleNames = listLoopgraphMcpTools({ exposure: "lifecycle_router" }).map((tool) => tool.name);
    expect(adminNames).toEqual(expect.arrayContaining(appToolNames));
    expect(webhookNames).not.toEqual(expect.arrayContaining(appToolNames));
    expect(lifecycleNames).not.toEqual(expect.arrayContaining(appToolNames));

    const response = await handleLoopgraphMcpMessage({
      jsonrpc: "2.0",
      id: "marketplace-search",
      method: "tools/call",
      params: {
        name: "loopgraph_marketplace_search",
        arguments: { query: "inbound leads" }
      }
    }, { projectRoot });
    expect(response).toMatchObject({
      result: {
        structuredContent: {
          schemaVersion: "loopgraph-marketplace-search/v1alpha1",
          count: expect.any(Number)
        }
      }
    });
    expect(JSON.stringify(response)).toContain("loopgraph.sales.qualify-route-inbound-leads");
  });

  it("exposes semantic graph history only to trusted admin turns", async () => {
    const { projectRoot } = await createRoutingProject();
    const response = await handleLoopgraphMcpMessage({
      jsonrpc: "2.0",
      id: "graph-history",
      method: "tools/call",
      params: {
        name: "loopgraph_graph_history_get",
        arguments: { projectRoot: "/tmp/caller-project-must-be-rebound" }
      }
    }, {
      projectRoot,
      exposure: "admin"
    });

    expect(response).toMatchObject({
      jsonrpc: "2.0",
      id: "graph-history",
      result: {
        isError: false,
        structuredContent: {
          transactions: [],
          snapshots: [],
          approvals: [],
          promotions: []
        }
      }
    });
  });

  it("lists and reads project-bound Loopgraph MCP resources for Hermes", async () => {
    const { projectRoot } = await createRoutingProject();
    await handleLoopgraphMcpMessage({
      jsonrpc: "2.0",
      id: "start-resource-session",
      method: "tools/call",
      params: {
        name: "loopgraph_discovery_start",
        arguments: { projectRoot, sessionId: "session_resources", companyId: "company_1" }
      }
    }, { projectRoot });

    const resourcesResponse = await handleLoopgraphMcpMessage({
      jsonrpc: "2.0",
      id: "resources",
      method: "resources/list"
    }, { projectRoot });
    const listedResources = await listLoopgraphMcpResources({ projectRoot });
    const resourceUris = listedResources.map((resource) => resource.uri);

    expect(resourcesResponse).toMatchObject({
      jsonrpc: "2.0",
      id: "resources",
      result: {
        resources: expect.arrayContaining([
          expect.objectContaining({ uri: "loopgraph://schemas/loop-design-context" }),
          expect.objectContaining({ uri: "loopgraph://schemas/loop-design-proposal-set" }),
          expect.objectContaining({ uri: "loopgraph://schemas/event-envelope" }),
          expect.objectContaining({ uri: "loopgraph://schemas/routing-card" }),
          expect.objectContaining({ uri: "loopgraph://schemas/routing-decision" }),
          expect.objectContaining({ uri: "loopgraph://schemas/evidence-gap-set" }),
          expect.objectContaining({ uri: "loopgraph://schemas/hermes-design-task" }),
          expect.objectContaining({ uri: "loopgraph://schemas/loop-opportunity" }),
          expect.objectContaining({ uri: "loopgraph://schemas/graph-change-set" }),
          expect.objectContaining({ uri: "loopgraph://schemas/metric-sample" }),
          expect.objectContaining({ uri: "loopgraph://schemas/observed-outcome" }),
          expect.objectContaining({ uri: "loopgraph://schemas/value-ledger-entry" }),
          expect.objectContaining({ uri: "loopgraph://schemas/loop-controller-policy" }),
          expect.objectContaining({ uri: "loopgraph://schemas/loop-controller-run" }),
          expect.objectContaining({ uri: "loopgraph://schemas/graph-snapshot" }),
          expect.objectContaining({ uri: "loopgraph://schemas/graph-change-approval-receipt" }),
          expect.objectContaining({ uri: "loopgraph://schemas/graph-transaction" }),
          expect.objectContaining({ uri: "loopgraph://schemas/loop-promotion-receipt" }),
          expect.objectContaining({ uri: "loopgraph://schemas/promotion-rehearsal" }),
          expect.objectContaining({ uri: "loopgraph://schemas/metric-binding" }),
          expect.objectContaining({ uri: "loopgraph://schemas/measurement-job" }),
          expect.objectContaining({ uri: "loopgraph://schemas/connection-reconciliation" }),
          expect.objectContaining({ uri: "loopgraph://departments/marketing" }),
          expect.objectContaining({ uri: "loopgraph://discovery/session_resources" }),
          expect.objectContaining({ uri: "loopgraph://loops/marketing_ads" }),
          expect.objectContaining({ uri: "loopgraph://graph/company" })
        ])
      }
    });
    for (const uri of LOOPGRAPH_MCP_STATIC_RESOURCE_URIS) {
      expect(resourceUris).toContain(uri);
    }

    const marketing = resourceJson(await handleLoopgraphMcpMessage({
      jsonrpc: "2.0",
      id: "department-resource",
      method: "resources/read",
      params: { uri: "loopgraph://departments/marketing" }
    }, { projectRoot }));
    const proposalSchema = resourceJson(await handleLoopgraphMcpMessage({
      jsonrpc: "2.0",
      id: "proposal-schema-resource",
      method: "resources/read",
      params: { uri: "loopgraph://schemas/loop-design-proposal-set" }
    }, { projectRoot }));
    const evidenceGapSchema = resourceJson(await handleLoopgraphMcpMessage({
      jsonrpc: "2.0",
      id: "evidence-gap-schema-resource",
      method: "resources/read",
      params: { uri: "loopgraph://schemas/evidence-gap-set" }
    }, { projectRoot }));
    const designTaskSchema = resourceJson(await handleLoopgraphMcpMessage({
      jsonrpc: "2.0",
      id: "design-task-schema-resource",
      method: "resources/read",
      params: { uri: "loopgraph://schemas/hermes-design-task" }
    }, { projectRoot }));
    const opportunitySchema = resourceJson(await handleLoopgraphMcpMessage({
      jsonrpc: "2.0",
      id: "opportunity-schema-resource",
      method: "resources/read",
      params: { uri: "loopgraph://schemas/loop-opportunity" }
    }, { projectRoot }));
    const graphChangeSetSchema = resourceJson(await handleLoopgraphMcpMessage({
      jsonrpc: "2.0",
      id: "graph-change-set-schema-resource",
      method: "resources/read",
      params: { uri: "loopgraph://schemas/graph-change-set" }
    }, { projectRoot }));
    const metricSampleSchema = resourceJson(await handleLoopgraphMcpMessage({
      jsonrpc: "2.0",
      id: "metric-sample-schema-resource",
      method: "resources/read",
      params: { uri: "loopgraph://schemas/metric-sample" }
    }, { projectRoot }));
    const observedOutcomeSchema = resourceJson(await handleLoopgraphMcpMessage({
      jsonrpc: "2.0",
      id: "observed-outcome-schema-resource",
      method: "resources/read",
      params: { uri: "loopgraph://schemas/observed-outcome" }
    }, { projectRoot }));
    const valueLedgerSchema = resourceJson(await handleLoopgraphMcpMessage({
      jsonrpc: "2.0",
      id: "value-ledger-schema-resource",
      method: "resources/read",
      params: { uri: "loopgraph://schemas/value-ledger-entry" }
    }, { projectRoot }));
    const controllerPolicySchema = resourceJson(await handleLoopgraphMcpMessage({
      jsonrpc: "2.0",
      id: "controller-policy-schema-resource",
      method: "resources/read",
      params: { uri: "loopgraph://schemas/loop-controller-policy" }
    }, { projectRoot }));
    const controllerRunSchema = resourceJson(await handleLoopgraphMcpMessage({
      jsonrpc: "2.0",
      id: "controller-run-schema-resource",
      method: "resources/read",
      params: { uri: "loopgraph://schemas/loop-controller-run" }
    }, { projectRoot }));
    const graphSnapshotSchema = resourceJson(await handleLoopgraphMcpMessage({
      jsonrpc: "2.0",
      id: "graph-snapshot-schema-resource",
      method: "resources/read",
      params: { uri: "loopgraph://schemas/graph-snapshot" }
    }, { projectRoot }));
    const graphApprovalSchema = resourceJson(await handleLoopgraphMcpMessage({
      jsonrpc: "2.0",
      id: "graph-approval-schema-resource",
      method: "resources/read",
      params: { uri: "loopgraph://schemas/graph-change-approval-receipt" }
    }, { projectRoot }));
    const graphTransactionSchema = resourceJson(await handleLoopgraphMcpMessage({
      jsonrpc: "2.0",
      id: "graph-transaction-schema-resource",
      method: "resources/read",
      params: { uri: "loopgraph://schemas/graph-transaction" }
    }, { projectRoot }));
    const promotionReceiptSchema = resourceJson(await handleLoopgraphMcpMessage({
      jsonrpc: "2.0",
      id: "promotion-receipt-schema-resource",
      method: "resources/read",
      params: { uri: "loopgraph://schemas/loop-promotion-receipt" }
    }, { projectRoot }));
    const promotionRehearsalSchema = resourceJson(await handleLoopgraphMcpMessage({
      jsonrpc: "2.0",
      id: "promotion-rehearsal-schema-resource",
      method: "resources/read",
      params: { uri: "loopgraph://schemas/promotion-rehearsal" }
    }, { projectRoot }));
    const session = resourceJson(await handleLoopgraphMcpMessage({
      jsonrpc: "2.0",
      id: "session-resource",
      method: "resources/read",
      params: { uri: "loopgraph://discovery/session_resources" }
    }, { projectRoot }));
    const loop = resourceJson(await handleLoopgraphMcpMessage({
      jsonrpc: "2.0",
      id: "loop-resource",
      method: "resources/read",
      params: { uri: "loopgraph://loops/marketing_ads" }
    }, { projectRoot }));
    const graph = resourceJson(await handleLoopgraphMcpMessage({
      jsonrpc: "2.0",
      id: "graph-resource",
      method: "resources/read",
      params: { uri: "loopgraph://graph/company" }
    }, { projectRoot }));
    const companyCatalog = resourceJson(await handleLoopgraphMcpMessage({
      jsonrpc: "2.0",
      id: "company-loop-catalog-resource",
      method: "resources/read",
      params: { uri: "loopgraph://catalog/company-loops" }
    }, { projectRoot }));

    expect(marketing).toMatchObject({
      schemaVersion: "department-resource/v1alpha2",
      department: {
        id: "marketing",
        label: "Marketing"
      },
      operatingSkill: { departmentType: "marketing" }
    });
    expect((marketing as { prebuiltLoops: unknown[] }).prebuiltLoops.length).toBeGreaterThanOrEqual(5);
    expect(companyCatalog).toMatchObject({
      schemaVersion: "company-loop-library/v1alpha1"
    });
    expect((companyCatalog as { routerEvaluationQuestions: unknown[] }).routerEvaluationQuestions).toHaveLength(10);
    expect((companyCatalog as { departmentOperatingSkills: unknown[] }).departmentOperatingSkills).toHaveLength(9);
    expect((companyCatalog as { prebuiltLoops: unknown[] }).prebuiltLoops.length).toBeGreaterThanOrEqual(45);
    expect(JSON.stringify(proposalSchema)).toContain("LoopDesignProposalSet");
    expect(evidenceGapSchema).toMatchObject({
      schemaVersion: "mcp-schema-resource/v1alpha1",
      id: "evidence-gap-set"
    });
    expect(JSON.stringify(evidenceGapSchema)).toContain("EvidenceGapSet");
    expect(designTaskSchema).toMatchObject({
      schemaVersion: "mcp-schema-resource/v1alpha1",
      id: "hermes-design-task"
    });
    expect(JSON.stringify(designTaskSchema)).toContain("HermesDesignTask");
    expect(opportunitySchema).toMatchObject({
      schemaVersion: "mcp-schema-resource/v1alpha1",
      id: "loop-opportunity"
    });
    expect(JSON.stringify(opportunitySchema)).toContain("LoopOpportunity");
    expect(graphChangeSetSchema).toMatchObject({
      schemaVersion: "mcp-schema-resource/v1alpha1",
      id: "graph-change-set"
    });
    expect(JSON.stringify(graphChangeSetSchema)).toContain("GraphChangeSet");
    expect(JSON.stringify(metricSampleSchema)).toContain("MetricSample");
    expect(JSON.stringify(observedOutcomeSchema)).toContain("ObservedOutcome");
    expect(JSON.stringify(valueLedgerSchema)).toContain("ValueLedgerEntry");
    expect(JSON.stringify(controllerPolicySchema)).toContain("LoopControllerPolicy");
    expect(JSON.stringify(controllerRunSchema)).toContain("LoopControllerRun");
    expect(JSON.stringify(graphSnapshotSchema)).toContain("GraphSnapshot");
    expect(JSON.stringify(graphApprovalSchema)).toContain("GraphChangeApprovalReceipt");
    expect(JSON.stringify(graphTransactionSchema)).toContain("GraphTransaction");
    expect(JSON.stringify(promotionReceiptSchema)).toContain("LoopPromotionReceipt");
    expect(JSON.stringify(promotionRehearsalSchema)).toContain("PromotionRehearsal");
    expect(session).toMatchObject({
      id: "session_resources",
      activeStage: "workspace"
    });
    expect(loop).toMatchObject({
      schemaVersion: "loop-resource/v1alpha1",
      loop: {
        loopId: "marketing_ads",
        routingReady: true
      },
      spec: {
        metadata: {
          id: "marketing_ads",
          name: "Ads"
        }
      }
    });
    expect(graph).toMatchObject({
      schemaVersion: "graph-projection/v1alpha1",
      projection: "design",
      graphProjection: {
        nodes: expect.arrayContaining([
          expect.objectContaining({ id: "company_brain", label: "Hermes Brain" }),
          expect.objectContaining({ id: "department:marketing", label: "Marketing" }),
          expect.objectContaining({ id: "loop:marketing_ads", label: "Ads" })
        ])
      }
    });
  });

  it("does not expose caller-supplied routing catalogs on Hermes-facing routing tools", () => {
    const tools = new Map(listLoopgraphMcpTools().map((tool) => [tool.name, JSON.stringify(tool.inputSchema)]));

    for (const toolName of [
      "loopgraph_routing_catalog_get",
      "loopgraph_events_ingest",
      "loopgraph_events_replay",
      "loopgraph_routing_decision_submit",
      "loopgraph_routing_human_choice_submit"
    ] as const) {
      const schema = tools.get(toolName);
      expect(schema).toBeTruthy();
      expect(schema).not.toContain("routingCards");
      expect(schema).not.toContain("specPaths");
    }

    expect(tools.get("loopgraph_routing_catalog_get")).not.toContain("catalogVersion");
    expect(tools.get("loopgraph_events_ingest")).not.toContain("catalogVersion");
    expect(tools.get("loopgraph_events_replay")).not.toContain("catalogVersion");
    expect(tools.get("loopgraph_routing_human_choice_submit")).not.toContain("catalogVersion");
  });

  it("exposes project-bound local loop validate and simulate actions to Hermes", async () => {
    const { projectRoot } = await createRoutingProject();
    const fixturePath = path.join(projectRoot, "fixtures", "marketing-ads-happy.json");
    await mkdir(path.dirname(fixturePath), { recursive: true });
    await writeFile(fixturePath, `${JSON.stringify(marketingAdsFixture(), null, 2)}\n`);

    const validate = await handleLoopgraphMcpMessage({
      jsonrpc: "2.0",
      id: "validate",
      method: "tools/call",
      params: {
        name: "loopgraph_loops_validate",
        arguments: { projectRoot, loopId: "marketing_ads" }
      }
    }, { projectRoot });
    const simulate = await handleLoopgraphMcpMessage({
      jsonrpc: "2.0",
      id: "simulate",
      method: "tools/call",
      params: {
        name: "loopgraph_loops_simulate",
        arguments: { projectRoot, loopId: "marketing_ads", fixturePath }
      }
    }, { projectRoot });
    const runId = isMcpResultRecord(simulate) && typeof simulate.result?.structuredContent?.runId === "string"
      ? simulate.result.structuredContent.runId
      : "";
    const runs = await handleLoopgraphMcpMessage({
      jsonrpc: "2.0",
      id: "runs",
      method: "tools/call",
      params: {
        name: "loopgraph_runs_get",
        arguments: { projectRoot, runId, includeReviewPacket: true }
      }
    }, { projectRoot });

    expect(validate).toMatchObject({
      jsonrpc: "2.0",
      id: "validate",
      result: {
        isError: false,
        structuredContent: {
          valid: true,
          loopId: "marketing_ads",
          routing: { ready: true }
        }
      }
    });
    expect(simulate).toMatchObject({
      jsonrpc: "2.0",
      id: "simulate",
      result: {
        isError: false,
        structuredContent: {
          valid: true,
          loopId: "marketing_ads",
          status: "COMPLETED",
          reviewRequired: false
        }
      }
    });
    expect(runs).toMatchObject({
      jsonrpc: "2.0",
      id: "runs",
      result: {
        isError: false,
        structuredContent: {
          count: 1,
          runs: [expect.objectContaining({
            runId,
            loopId: "marketing_ads",
            status: "COMPLETED",
            reviewPacket: expect.objectContaining({ runId })
          })]
        }
      }
    });
  });

  it("records and reads project-bound metric evidence through trusted Hermes tools", async () => {
    const { projectRoot } = await createRoutingProject();
    const ingest = await handleLoopgraphMcpMessage({
      jsonrpc: "2.0",
      id: "metric-ingest",
      method: "tools/call",
      params: {
        name: "loopgraph_metric_samples_ingest",
        arguments: {
          projectRoot: path.join(projectRoot, "untrusted-other-root"),
          companyId: "company_1",
          departmentId: "marketing",
          loopId: "marketing_ads",
          metricDefinitionId: "metric_cac",
          metricKey: "cost_per_qualified_customer",
          value: 42,
          unit: "USD",
          window: {
            start: "2026-07-21T00:00:00.000Z",
            end: "2026-07-21T23:59:59.999Z"
          },
          observedAt: "2026-07-21T23:59:59.999Z",
          source: {
            type: "integration",
            sourceRef: "hermes://google-ads/report-42"
          },
          quality: {
            status: "verified"
          },
          truthStatus: "observed",
          evidenceRefs: ["hermes://google-ads/report-42"]
        }
      }
    }, {
      projectRoot,
      now: new Date("2026-07-22T00:00:00.000Z")
    });
    const get = await handleLoopgraphMcpMessage({
      jsonrpc: "2.0",
      id: "metric-get",
      method: "tools/call",
      params: {
        name: "loopgraph_metric_samples_get",
        arguments: {
          projectRoot: path.join(projectRoot, "untrusted-other-root"),
          loopId: "marketing_ads"
        }
      }
    }, { projectRoot });

    expect(ingest).toMatchObject({
      jsonrpc: "2.0",
      id: "metric-ingest",
      result: {
        isError: false,
        structuredContent: {
          duplicate: false,
          record: {
            loopId: "marketing_ads",
            value: 42,
            truthStatus: "observed"
          }
        }
      }
    });
    expect(get).toMatchObject({
      jsonrpc: "2.0",
      id: "metric-get",
      result: {
        isError: false,
        structuredContent: {
          samples: [expect.objectContaining({
            loopId: "marketing_ads",
            value: 42
          })]
        }
      }
    });
  });

  it("runs and reads the project-bound continuous controller through trusted Hermes tools", async () => {
    const { projectRoot } = await createRoutingProject();
    const run = await handleLoopgraphMcpMessage({
      jsonrpc: "2.0",
      id: "controller-run",
      method: "tools/call",
      params: {
        name: "loopgraph_controller_run",
        arguments: {
          projectRoot: path.join(projectRoot, "untrusted-other-root"),
          triggerType: "manual",
          triggerId: "mcp_controller_1",
          sourceRef: "test:mcp"
        }
      }
    }, {
      projectRoot,
      now: new Date("2026-07-29T18:00:00.000Z")
    });
    const get = await handleLoopgraphMcpMessage({
      jsonrpc: "2.0",
      id: "controller-runs-get",
      method: "tools/call",
      params: {
        name: "loopgraph_controller_runs_get",
        arguments: {
          projectRoot: path.join(projectRoot, "untrusted-other-root")
        }
      }
    }, { projectRoot });

    expect(run).toMatchObject({
      result: {
        isError: false,
        structuredContent: {
          duplicate: false,
          run: {
            trigger: { id: "mcp_controller_1" },
            status: "completed"
          }
        }
      }
    });
    expect(get).toMatchObject({
      result: {
        isError: false,
        structuredContent: {
          runs: [expect.objectContaining({
            trigger: expect.objectContaining({ id: "mcp_controller_1" })
          })]
        }
      }
    });
  });

  it("calls workspace and department read tools through tools/call", async () => {
    const { projectRoot } = await createRoutingProject();
    const workspaceResponse = await handleLoopgraphMcpMessage({
      jsonrpc: "2.0",
      id: "workspace",
      method: "tools/call",
      params: {
        name: "loopgraph_workspace_inspect",
        arguments: { projectRoot }
      }
    }, { projectRoot });
    const departmentsResponse = await handleLoopgraphMcpMessage({
      jsonrpc: "2.0",
      id: "departments",
      method: "tools/call",
      params: {
        name: "loopgraph_departments_list",
        arguments: {}
      }
    }, { projectRoot });

    expect(workspaceResponse).toMatchObject({
      jsonrpc: "2.0",
      id: "workspace",
      result: {
        isError: false,
        structuredContent: {
          exists: true,
          registeredSpecCount: 1,
          registeredDepartments: ["marketing"],
          routingReadySpecCount: 1
        }
      }
    });
    expect(departmentsResponse).toMatchObject({
      jsonrpc: "2.0",
      id: "departments",
      result: {
        isError: false,
        structuredContent: {
          count: 10,
          departments: expect.arrayContaining([
            expect.objectContaining({ id: "marketing", label: "Marketing" }),
            expect.objectContaining({ id: "ops_finance", aliases: ["operations_finance"] })
          ])
        }
      }
    });
  });

  it("runs the Hermes discovery question-bundle flow through tools/call", async () => {
    const projectRoot = await mkdtemp(path.join(tmpdir(), "loopgraph-mcp-discovery-"));
    const start = await handleLoopgraphMcpMessage({
      jsonrpc: "2.0",
      id: "start",
      method: "tools/call",
      params: {
        name: "loopgraph_discovery_start",
        arguments: { projectRoot, sessionId: "session_mcp", companyId: "company_1" }
      }
    }, { projectRoot });
    const confirmProject = await handleLoopgraphMcpMessage({
      jsonrpc: "2.0",
      id: "confirm-project",
      method: "tools/call",
      params: {
        name: "loopgraph_discovery_confirm_project_context",
        arguments: {
          projectRoot,
          sessionId: "session_mcp",
          expectedRevision: 0,
          displayName: "MCP Project",
          sourceOfTruth: "HubSpot defines qualified customers.",
          confirmedStack: true
        }
      }
    }, { projectRoot });
    expect(confirmProject).toMatchObject({
      result: {
        structuredContent: {
          session: {
            id: "session_mcp",
            projectProfileId: expect.stringMatching(/^project_/),
            revision: 1
          },
          projectProfile: {
            displayName: "MCP Project",
            confirmedByUser: true
          }
        }
      }
    });
    const select = await handleLoopgraphMcpMessage({
      jsonrpc: "2.0",
      id: "select",
      method: "tools/call",
      params: {
        name: "loopgraph_discovery_select_departments",
        arguments: {
          projectRoot,
          sessionId: "session_mcp",
          departments: ["marketing"],
          expectedRevision: 1
        }
      }
    }, { projectRoot });
    const next = await handleLoopgraphMcpMessage({
      jsonrpc: "2.0",
      id: "next",
      method: "tools/call",
      params: {
        name: "loopgraph_discovery_next_questions",
        arguments: { projectRoot, sessionId: "session_mcp" }
      }
    }, { projectRoot });
    const submit = await handleLoopgraphMcpMessage({
      jsonrpc: "2.0",
      id: "submit",
      method: "tools/call",
      params: {
        name: "loopgraph_discovery_submit_answers",
        arguments: {
          projectRoot,
          sessionId: "session_mcp",
          bundleId: "current_stack_sources",
          expectedRevision: 2,
          answers: {
            systems: ["Google Ads", "HubSpot"],
            source_of_truth: "HubSpot",
            safe_reads: ["campaign metrics"],
            manual_fallbacks: ["CSV"],
            existing_automations: []
          }
        }
      }
    }, { projectRoot });
    const designContext = await handleLoopgraphMcpMessage({
      jsonrpc: "2.0",
      id: "design-context",
      method: "tools/call",
      params: {
        name: "loopgraph_design_context_get",
        arguments: { projectRoot, sessionId: "session_mcp" }
      }
    }, { projectRoot });

    expect(start).toMatchObject({
      result: {
        isError: false,
        structuredContent: {
          id: "session_mcp",
          activeStage: "workspace",
          revision: 0
        }
      }
    });
    expect(select).toMatchObject({
      result: {
        isError: false,
        structuredContent: {
          activeDepartmentId: "marketing",
          activeQuestionBundleId: "current_stack_sources",
          revision: 2
        }
      }
    });
    expect(next).toMatchObject({
      result: {
        isError: false,
        structuredContent: {
          nextAction: "answer_bundle",
          bundle: expect.objectContaining({ id: "current_stack_sources" }),
          departmentBranchQuestions: expect.arrayContaining([expect.stringContaining("paid ads")])
        }
      }
    });
    expect(submit).toMatchObject({
      result: {
        isError: false,
        structuredContent: {
          activeQuestionBundleId: "biggest_recurring_problem",
          revision: 3,
          answers: expect.arrayContaining([
            expect.objectContaining({ questionId: "current_stack_sources.systems" })
          ])
        }
      }
    });
    expect(designContext).toMatchObject({
      result: {
        isError: false,
        structuredContent: {
          schemaVersion: "loop-design-context/v1alpha1",
          sessionId: "session_mcp",
          departmentType: "marketing",
          readiness: "needs_answers",
          deterministicCandidates: expect.arrayContaining([
            expect.objectContaining({ name: "Ads" }),
            expect.objectContaining({ name: "Content Creation" })
          ])
        }
      }
    });
  });

  it("calls the routing catalog tool through tools/call", async () => {
    const { projectRoot } = await createRoutingProject();
    const response = await handleLoopgraphMcpMessage({
      jsonrpc: "2.0",
      id: "call",
      method: "tools/call",
      params: {
        name: "loopgraph_routing_catalog_get",
        arguments: { projectRoot }
      }
    }, { projectRoot });

    expect(response).toMatchObject({
      jsonrpc: "2.0",
      id: "call",
      result: {
        isError: false,
        structuredContent: {
          count: 1,
          routingCards: [expect.objectContaining({ loopId: "marketing_ads" })]
        }
      }
    });
  });

  it("keeps tools/call bound to the installed project root", async () => {
    const { projectRoot } = await createRoutingProject();
    const otherProjectRoot = await mkdtemp(path.join(tmpdir(), "loopgraph-mcp-other-"));
    await mkdir(path.join(otherProjectRoot, ".loopgraph"), { recursive: true });
    await writeFile(path.join(otherProjectRoot, ".loopgraph", "workspace.json"), `${JSON.stringify({
      version: 1,
      demoCatalogEnabled: false,
      registeredSpecs: []
    }, null, 2)}\n`);

    const response = await handleLoopgraphMcpMessage({
      jsonrpc: "2.0",
      id: "bound-catalog",
      method: "tools/call",
      params: {
        name: "loopgraph_routing_catalog_get",
        arguments: { projectRoot: otherProjectRoot }
      }
    }, { projectRoot });

    expect(response).toMatchObject({
      jsonrpc: "2.0",
      id: "bound-catalog",
      result: {
        isError: false,
        structuredContent: {
          count: 1,
          routingCards: [expect.objectContaining({ loopId: "marketing_ads" })]
        }
      }
    });
  });

  it("keeps project inspection bound to the installed project root despite malicious MCP arguments", async () => {
    const { projectRoot } = await createRoutingProject();
    await writeFile(path.join(projectRoot, "package.json"), `${JSON.stringify({
      name: "installed-project",
      dependencies: {
        react: "^19.0.0"
      }
    }, null, 2)}\n`);
    const otherProjectRoot = await mkdtemp(path.join(tmpdir(), "loopgraph-mcp-project-inspect-other-"));
    await writeFile(path.join(otherProjectRoot, "package.json"), `${JSON.stringify({
      name: "other-project",
      scripts: {
        deploy: "deploy --token should-not-leak"
      },
      dependencies: {
        next: "^15.0.0",
        "secret-provider-sdk": "^1.0.0"
      }
    }, null, 2)}\n`);

    const response = await handleLoopgraphMcpMessage({
      jsonrpc: "2.0",
      id: "bound-project-inspect",
      method: "tools/call",
      params: {
        name: "loopgraph_project_inspect",
        arguments: { projectRoot: otherProjectRoot }
      }
    }, { projectRoot });

    expect(response).toMatchObject({
      jsonrpc: "2.0",
      id: "bound-project-inspect",
      result: {
        isError: false,
        structuredContent: {
          packageJson: {
            name: "installed-project",
            dependencies: [expect.objectContaining({ name: "react" })]
          },
          stack: {
            frameworks: ["React"]
          }
        }
      }
    });
    const serialized = JSON.stringify(response);
    expect(serialized).not.toContain("other-project");
    expect(serialized).not.toContain("secret-provider-sdk");
    expect(serialized).not.toContain("should-not-leak");
    expect(serialized).not.toContain("Next.js");
  });

  it("runs and reads a trusted Hermes routing evaluation batch through tools/call", async () => {
    const { projectRoot } = await createRoutingProject();
    const event = adsEvent("delivery_mcp_eval_1");
    const evaluate = await handleLoopgraphMcpMessage({
      jsonrpc: "2.0",
      id: "evaluate",
      method: "tools/call",
      params: {
        name: "loopgraph_routing_evaluation_run",
        arguments: {
          projectRoot,
          fixtures: [{
            fixtureId: "ads_mcp_eval",
            event,
            expectedAction: "route",
            expectedLoopIds: ["marketing_ads"]
          }]
        }
      }
    }, {
      projectRoot,
      now: new Date("2026-07-21T12:00:02.000Z")
    });
    const evaluations = await handleLoopgraphMcpMessage({
      jsonrpc: "2.0",
      id: "evaluations",
      method: "tools/call",
      params: {
        name: "loopgraph_routing_evaluations_get",
        arguments: { projectRoot, eventId: event.id }
      }
    }, { projectRoot });

    expect(evaluate).toMatchObject({
      jsonrpc: "2.0",
      id: "evaluate",
      result: {
        isError: false,
        structuredContent: {
          fixtureCount: 1,
          metrics: {
            truePositiveCount: 1,
            falseTriggerCount: 0,
            missedProblemCount: 0,
            precision: 1,
            recall: 1
          },
          gate: {
            passed: true,
            nextAllowedActivationMode: "recommend"
          }
        }
      }
    });
    expect(evaluations).toMatchObject({
      jsonrpc: "2.0",
      id: "evaluations",
      result: {
        isError: false,
        structuredContent: {
          count: 1,
          evaluations: [expect.objectContaining({
            fixtureId: "ads_mcp_eval",
            eventId: event.id,
            expectedAction: "route",
            actualAction: "route",
            passed: true
          })]
        }
      }
    });
  });

  it("ingests an event through tools/call without exposing unrestricted tools", async () => {
    const { projectRoot } = await createRoutingProject();
    const response = await handleLoopgraphMcpMessage({
      jsonrpc: "2.0",
      id: "ingest",
      method: "tools/call",
      params: {
        name: "loopgraph_events_ingest",
        arguments: {
          projectRoot,
          event: adsEvent("delivery_mcp_1")
        }
      }
    }, {
      projectRoot,
      now: new Date("2026-07-21T12:00:02.000Z")
    });

    expect(response).toMatchObject({
      jsonrpc: "2.0",
      id: "ingest",
      result: {
        isError: false,
        structuredContent: {
          duplicate: false,
          eligibleRoutes: [expect.objectContaining({
            card: expect.objectContaining({ loopId: "marketing_ads" })
          })]
        }
      }
    });
  });

  it("replays events and accepts human routing corrections through tools/call", async () => {
    const { projectRoot } = await createRoutingProject();
    const event = adsEvent("delivery_mcp_human_1");
    const ingestResponse = await handleLoopgraphMcpMessage({
      jsonrpc: "2.0",
      id: "ingest-human",
      method: "tools/call",
      params: {
        name: "loopgraph_events_ingest",
        arguments: { projectRoot, event }
      }
    }, {
      projectRoot,
      now: new Date("2026-07-21T12:00:02.000Z")
    });
    const catalogVersion = (ingestResponse as { result?: { structuredContent?: { catalogVersion?: string } } })
      .result?.structuredContent?.catalogVersion;
    expect(catalogVersion).toBeTruthy();

    const requestHuman = await handleLoopgraphMcpMessage({
      jsonrpc: "2.0",
      id: "request-human",
      method: "tools/call",
      params: {
        name: "loopgraph_routing_decision_submit",
        arguments: {
          projectRoot,
          decision: {
            schemaVersion: "routing-decision/v1alpha1",
            eventId: event.id,
            catalogVersion,
            action: "request_human",
            problem: {
              summary: "Campaign signal is ambiguous and needs a human route choice.",
              problemTypes: ["paid_acquisition_efficiency_drop"],
              subject: event.subject,
              severity: "medium",
              dedupeKeyInputs: [event.subject.id]
            },
            selectedRoutes: [],
            alternatives: [{
              loopId: "marketing_ads",
              confidence: 0.62,
              reasonSummary: "Likely Ads, but under threshold."
            }],
            modelMetadata: { hermesTaskId: "task_mcp_human_1" },
            policyVersion: "routing-policy/v1alpha1"
          }
        }
      }
    }, {
      projectRoot,
      now: new Date("2026-07-21T12:00:03.000Z")
    });
    const problemId = (requestHuman as { result?: { structuredContent?: { problem?: { id?: string } } } })
      .result?.structuredContent?.problem?.id;
    expect(problemId).toBeTruthy();

    const correction = await handleLoopgraphMcpMessage({
      jsonrpc: "2.0",
      id: "human-choice",
      method: "tools/call",
      params: {
        name: "loopgraph_routing_human_choice_submit",
        arguments: {
          projectRoot,
          eventId: event.id,
          problemId,
          action: "route",
          selectedLoopIds: ["marketing_ads"],
          reason: "Growth lead confirmed this is an Ads efficiency issue.",
          correctedBy: "Growth lead"
        }
      }
    }, {
      projectRoot,
      now: new Date("2026-07-21T12:02:00.000Z")
    });
    const replay = await handleLoopgraphMcpMessage({
      jsonrpc: "2.0",
      id: "replay",
      method: "tools/call",
      params: {
        name: "loopgraph_events_replay",
        arguments: {
          projectRoot,
          eventId: event.id
        }
      }
    }, {
      projectRoot,
      now: new Date("2026-07-21T12:05:00.000Z")
    });

    expect(correction).toMatchObject({
      result: {
        isError: false,
        structuredContent: {
          correction: expect.objectContaining({
            expectedAction: "route",
            expectedLoopIds: ["marketing_ads"]
          }),
          submission: expect.objectContaining({
            valid: true,
            routeCommits: [expect.objectContaining({ loopId: "marketing_ads", status: "shadow" })]
          })
        }
      }
    });
    expect(replay).toMatchObject({
      result: {
        isError: false,
        structuredContent: {
          duplicate: false,
          receipt: expect.objectContaining({ status: "replayed" }),
          eligibleRoutes: [expect.objectContaining({
            card: expect.objectContaining({ loopId: "marketing_ads" })
          })]
        }
      }
    });
  });

  it("does not respond to notifications", async () => {
    await expect(handleLoopgraphMcpMessage({
      jsonrpc: "2.0",
      method: "notifications/initialized"
    })).resolves.toBeNull();
  });
});
