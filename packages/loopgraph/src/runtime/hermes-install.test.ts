import { lstat, mkdtemp, readFile, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import YAML from "yaml";
import { describe, expect, it } from "vitest";
import { LOOPGRAPH_MCP_STATIC_RESOURCE_URIS } from "../mcp/server";
import { DEPARTMENT_OPERATING_SKILLS, DEPARTMENT_OPERATING_SKILL_PROTOCOL_VERSION } from "../core";
import {
  activateHermesIntegration,
  deactivateHermesIntegration,
  doctorHermesIntegration,
  HERMES_LOOPGRAPH_DESIGN_SKILL_PROTOCOL_VERSION,
  HERMES_LOOPGRAPH_EVENT_ROUTER_SKILL_PROTOCOL_VERSION,
  HERMES_LOOPGRAPH_INTEGRATION_VERSION,
  HERMES_LOOPGRAPH_MCP_PROTOCOL_VERSION,
  HERMES_LOOPGRAPH_MCP_TOOL_NAMES,
  HERMES_LOOPGRAPH_PROTOCOL_VERSIONS,
  HERMES_LOOPGRAPH_SKILL_VERSION,
  installHermesIntegration,
  setupHermesIntegration
} from "./hermes-install";

async function temporaryProjectRoot(): Promise<string> {
  return mkdtemp(path.join(tmpdir(), "loopgraph-hermes-"));
}

async function readJsonFile(filePath: string): Promise<Record<string, unknown>> {
  return JSON.parse(await readFile(filePath, "utf8")) as Record<string, unknown>;
}

describe("Hermes integration installer", () => {
  it("writes project-local Hermes MCP, skill, and install-state artifacts", async () => {
    const projectRoot = await temporaryProjectRoot();
    const cliEntryPath = path.join(projectRoot, "dist", "cli.js");

    const result = await installHermesIntegration({
      projectRoot,
      cliEntryPath,
      nodeCommand: process.execPath,
      now: new Date("2026-07-21T12:00:00.000Z")
    });

    expect(result).toMatchObject({
      projectRoot,
      scope: "project",
      firstPrompt: "start Loopgraph",
      protocols: HERMES_LOOPGRAPH_PROTOCOL_VERSIONS,
      mcpServer: {
        name: "loopgraph_admin",
        exposure: "admin",
        command: process.execPath,
        args: [cliEntryPath, "mcp", "serve", "--project", projectRoot, "--exposure", "admin"],
        tools: HERMES_LOOPGRAPH_MCP_TOOL_NAMES
      }
    });
    expect(result.mcpServers.map((server) => ({
      name: server.name,
      exposure: server.exposure,
      args: server.args.slice(-2)
    }))).toEqual([
      { name: "loopgraph_admin", exposure: "admin", args: ["--exposure", "admin"] },
      { name: "loopgraph_webhook_router", exposure: "webhook_router", args: ["--exposure", "webhook_router"] },
      { name: "loopgraph_lifecycle_router", exposure: "lifecycle_router", args: ["--exposure", "lifecycle_router"] }
    ]);
    expect(result.supportingFilePaths.map((item) => path.relative(result.skillsDir, item))).toEqual([
      path.join("loopgraph", "references", "discovery-flow.md"),
      path.join("loopgraph", "references", "proposal-schema.md"),
      path.join("loopgraph", "references", "safety-and-approvals.md"),
      path.join("loopgraph", "examples", "product-feedback-release.md"),
      path.join("loopgraph", "examples", "marketing-ads-content.md"),
      path.join("loopgraph-event-router", "references", "routing-protocol.md"),
      path.join("loopgraph-event-router", "examples", "product-routing-events.md"),
      path.join("loopgraph-event-router", "examples", "marketing-routing-events.md")
    ]);

    const mcpConfig = YAML.parse(await readFile(result.mcpConfigPath, "utf8")) as Record<string, unknown>;
    expect(mcpConfig).toMatchObject({
      mcp_servers: {
        loopgraph_admin: {
          command: process.execPath,
          args: [cliEntryPath, "mcp", "serve", "--project", projectRoot, "--exposure", "admin"],
          enabled: true,
          supports_parallel_tool_calls: false,
          tools: {
            include: HERMES_LOOPGRAPH_MCP_TOOL_NAMES,
            prompts: false,
            resources: true
          }
        },
        loopgraph_webhook_router: {
          command: process.execPath,
          args: [cliEntryPath, "mcp", "serve", "--project", projectRoot, "--exposure", "webhook_router"]
        },
        loopgraph_lifecycle_router: {
          command: process.execPath,
          args: [cliEntryPath, "mcp", "serve", "--project", projectRoot, "--exposure", "lifecycle_router"]
        }
      },
      skills: {
        external_dirs: [result.skillsDir]
      }
    });

    expect(result.installStatePath).toBe(path.join(projectRoot, ".loopgraph", "hermes", "install.json"));
    const installState = await readJsonFile(result.installStatePath);
    expect(installState).toMatchObject({
      schemaVersion: HERMES_LOOPGRAPH_INTEGRATION_VERSION,
      scope: "project",
      installedAt: "2026-07-21T12:00:00.000Z",
      protocols: HERMES_LOOPGRAPH_PROTOCOL_VERSIONS,
      mcpServer: {
        name: "loopgraph_admin",
        exposure: "admin",
        transport: "stdio",
        command: process.execPath,
        args: [cliEntryPath, "mcp", "serve", "--project", projectRoot, "--exposure", "admin"],
        tools: HERMES_LOOPGRAPH_MCP_TOOL_NAMES,
        configPath: result.mcpConfigPath
      },
      skills: [
        {
          name: "loopgraph",
          version: HERMES_LOOPGRAPH_SKILL_VERSION,
          protocol: HERMES_LOOPGRAPH_DESIGN_SKILL_PROTOCOL_VERSION,
          path: result.skillPaths[0],
          assets: result.supportingFilePaths.slice(0, 5)
        },
        {
          name: "loopgraph-event-router",
          version: HERMES_LOOPGRAPH_SKILL_VERSION,
          protocol: HERMES_LOOPGRAPH_EVENT_ROUTER_SKILL_PROTOCOL_VERSION,
          path: result.skillPaths[1],
          assets: result.supportingFilePaths.slice(5)
        },
        ...DEPARTMENT_OPERATING_SKILLS.map((skill, index) => ({
          name: `loopgraph-department-${skill.departmentType.replace(/_/g, "-")}`,
          version: HERMES_LOOPGRAPH_SKILL_VERSION,
          protocol: DEPARTMENT_OPERATING_SKILL_PROTOCOL_VERSION,
          path: result.skillPaths[index + 2]
        }))
      ],
      capabilities: {
        routingCatalog: true,
        workspaceInspect: true,
        departmentsList: true,
        discoverySessions: true,
        projectInspection: true,
        designContext: true,
        designSubmit: true,
        designEdit: true,
        connectionPlan: true,
        manualConnectionFallbacks: true,
        loopMaterialization: true,
        eventIngest: true,
        routingDecisionSubmit: true,
        routingHistory: true,
        routeJobs: true,
        routingEvaluation: true,
        lifecycleEvents: true,
        graphProjection: true,
        semanticGraphTransactions: true,
        graphPromotion: true,
        graphLifecycle: true,
        graphRollback: true,
        hermesWebhookPlanning: true,
        hermesWebhookSync: true,
        hermesWebhookDoctor: true,
        hermesWebhookTest: true,
        departmentOperatingSkills: true,
        sharedLearningPlaybooks: true,
        liveExecution: true
      },
      lastDoctor: null
    });
    expect(JSON.stringify(installState).toLowerCase()).not.toContain("api_key");
    expect(JSON.stringify(installState).toLowerCase()).not.toContain("secret");

    const workspace = await readJsonFile(path.join(projectRoot, ".loopgraph", "workspace.json"));
    expect(workspace).toMatchObject({
      schemaVersion: "workspace/v1alpha1",
      projectRoot,
      demoCatalogEnabled: false,
      registeredSpecs: []
    });

    const designSkill = await readFile(result.skillPaths[0], "utf8");
    const routerSkill = await readFile(result.skillPaths[1], "utf8");
    const productSkill = await readFile(result.skillPaths[2], "utf8");
    const discoveryReference = await readFile(result.supportingFilePaths[0]!, "utf8");
    const proposalReference = await readFile(result.supportingFilePaths[1]!, "utf8");
    const safetyReference = await readFile(result.supportingFilePaths[2]!, "utf8");
    const productExample = await readFile(result.supportingFilePaths[3]!, "utf8");
    const marketingExample = await readFile(result.supportingFilePaths[4]!, "utf8");
    const routingReference = await readFile(result.supportingFilePaths[5]!, "utf8");
    const productRoutingExample = await readFile(result.supportingFilePaths[6]!, "utf8");
    const routingExample = await readFile(result.supportingFilePaths[7]!, "utf8");
    expect(designSkill).toContain("name: loopgraph");
    expect(productSkill).toContain("name: loopgraph-department-product");
    expect(productSkill).toContain("## How Hermes approaches work");
    expect(productSkill).toContain("## Shared-learning playbooks");
    expect(designSkill).toContain("start Loopgraph");
    expect(designSkill).toContain("Do not ask an open-ended question first");
    expect(designSkill).toContain("Recommend Product as the easiest first example");
    expect(designSkill).toContain("ask only for missing required fields");
    expect(designSkill).toContain(`skillProtocol: ${HERMES_LOOPGRAPH_DESIGN_SKILL_PROTOCOL_VERSION}`);
    expect(designSkill).toContain(`mcpProtocol: ${HERMES_LOOPGRAPH_MCP_PROTOCOL_VERSION}`);
    expect(designSkill).toContain("loopDesignProposalSetSchema: loop-design-proposal-set/v1alpha1");
    expect(designSkill).toContain("Loopgraph MCP server named `loopgraph_admin`");
    expect(designSkill).toContain("Never use the webhook or lifecycle profiles");
    expect(designSkill).toContain("loopgraph://schemas/loop-design-context");
    expect(designSkill).toContain("loopgraph://graph/company");
    expect(designSkill).toContain("references/discovery-flow.md");
    expect(designSkill).toContain("examples/product-feedback-release.md");
    expect(designSkill).toContain("examples/marketing-ads-content.md");
    expect(designSkill).toContain("loopgraph_workspace_inspect");
    expect(designSkill).toContain("loopgraph_departments_list");
    expect(designSkill).toContain("loopgraph_project_inspect");
    expect(designSkill).toContain("loopgraph_design_context_get");
    expect(designSkill).toContain("loopgraph_design_submit");
    expect(designSkill).toContain("loopgraph_design_edit");
    expect(designSkill).toContain("loopgraph_hermes_design_tasks_get");
    expect(designSkill).toContain("loopgraph_evidence_gaps_get");
    expect(designSkill).toContain("loopgraph_evidence_gap_answer");
    expect(designSkill).toContain("never more than three at once");
    expect(designSkill).toContain("loopgraph://schemas/evidence-gap-set");
    expect(designSkill).toContain("loopgraph://schemas/hermes-design-task");
    expect(designSkill).toContain("loopgraph_connections_plan");
    expect(designSkill).toContain("loopgraph_connections_set_manual_fallback");
    expect(designSkill).toContain("loopgraph_connections_register");
    expect(designSkill).toContain("loopgraph_connections_health_report");
    expect(designSkill).toContain("loopgraph_connections_get");
    expect(designSkill).toContain("loopgraph_metric_bindings_set");
    expect(designSkill).toContain("loopgraph_metric_bindings_get");
    expect(designSkill).toContain("loopgraph_measurements_schedule");
    expect(designSkill).toContain("loopgraph_measurement_jobs_claim");
    expect(designSkill).toContain("loopgraph_measurement_jobs_complete");
    expect(designSkill).toContain("loopgraph_measurement_jobs_fail");
    expect(designSkill).toContain("loopgraph_connections_reconcile");
    expect(designSkill).toContain("loopgraph_connections_reconciliations_get");
    expect(designSkill).toContain("Keep provider credentials in Hermes");
    expect(designSkill).toContain("loopgraph://schemas/metric-binding");
    expect(designSkill).toContain("loopgraph://schemas/measurement-job");
    expect(designSkill).toContain("loopgraph://schemas/connection-reconciliation");
    expect(designSkill).toContain("loopgraph_loops_materialize");
    expect(designSkill).toContain("loopgraph_runs_get");
    expect(designSkill).toContain("loopgraph_loops_validate");
    expect(designSkill).toContain("loopgraph_loops_simulate");
    expect(designSkill).toContain("loopgraph_route_commit_simulate");
    expect(designSkill).toContain("loopgraph_route_jobs_get");
    expect(designSkill).toContain("loopgraph_routing_evaluation_run");
    expect(designSkill).toContain("loopgraph_routing_evaluations_get");
    expect(designSkill).toContain("loopgraph_lifecycle_events_get");
    expect(designSkill).toContain("loopgraph_controller_run");
    expect(designSkill).toContain("loopgraph_controller_runs_get");
    expect(designSkill).toContain("loopgraph_controller_policy_get");
    expect(designSkill).toContain("loopgraph_controller_policy_set");
    expect(designSkill).toContain("loopgraph://schemas/loop-controller-policy");
    expect(designSkill).toContain("loopgraph://schemas/loop-controller-run");
    expect(designSkill).toContain("loopgraph://schemas/graph-snapshot");
    expect(designSkill).toContain("loopgraph://schemas/graph-change-approval-receipt");
    expect(designSkill).toContain("loopgraph://schemas/graph-transaction");
    expect(designSkill).toContain("loopgraph://schemas/loop-promotion-receipt");
    expect(designSkill).toContain("loopgraph://schemas/promotion-rehearsal");
    expect(designSkill).toContain("loopgraph_graph_change_decide");
    expect(designSkill).toContain("loopgraph_graph_change_apply");
    expect(designSkill).toContain("loopgraph_graph_history_get");
    expect(designSkill).toContain("loopgraph_promotion_rehearsal_run");
    expect(designSkill).toContain("loopgraph_promotion_rehearsals_get");
    expect(designSkill).toContain("loopgraph_loop_promotion_approve");
    expect(designSkill).toContain("loopgraph_loop_promote");
    expect(designSkill).toContain("loopgraph_loop_lifecycle_approve");
    expect(designSkill).toContain("loopgraph_loop_lifecycle_set");
    expect(designSkill).toContain("loopgraph_graph_rollback_approve");
    expect(designSkill).toContain("loopgraph_graph_rollback");
    expect(designSkill).toContain("Never substitute direct materialization");
    expect(designSkill).toContain("Never reinterpret a review, pause, retirement, or failed policy receipt as permission to act");
    expect(designSkill).toContain("loopgraph_review_submit");
    expect(designSkill).toContain("loopgraph_case_resolve");
    expect(designSkill).toContain("loopgraph_graph_get");
    expect(designSkill).toContain("loopgraph start --project");
    expect(designSkill).toContain("loopgraph_hermes_webhooks_plan");
    expect(designSkill).toContain("loopgraph_hermes_webhooks_sync");
    expect(designSkill).toContain("loopgraph_hermes_webhooks_doctor");
    expect(designSkill).toContain("loopgraph_hermes_webhooks_test");
    expect(designSkill).toContain("loopgraph_hermes_webhooks_prepare");
    expect(designSkill).toContain("loopgraph_hermes_webhooks_activation_status");
    expect(designSkill).toContain("Never request the token in chat");
    expect(designSkill).toContain("only after the user explicitly asks to write or refresh");
    expect(designSkill).toContain("Do not point provider webhooks directly at Loopgraph");
    expect(designSkill).toContain("loopgraph_loops_list");
    expect(designSkill).toContain("## Loopgraph Apps");
    expect(designSkill).toContain("loopgraph_marketplace_search");
    expect(designSkill).toContain("loopgraph_app_onboarding_save");
    expect(designSkill).toContain("loopgraph_app_onboarding_reset");
    expect(designSkill).toContain("confirmReset: true");
    expect(designSkill).toContain("draft.applied");
    expect(designSkill).toContain("confirmPresetChange: true");
    expect(designSkill).toContain("complete current non-secret snapshot");
    expect(designSkill).toContain("loopgraph_app_install_plan");
    expect(designSkill).toContain("loopgraph_app_historical_replay");
    expect(designSkill).toContain("loopgraph_app_update_plan");
    expect(designSkill).toContain("loopgraph_app_uninstall");
    expect(designSkill).toContain("loopgraph_app_operation_action_reconcile");
    expect(designSkill).toContain("do not call commit again");
    expect(designSkill).toContain("without repeating the provider write");
    expect(designSkill).toContain("never authorizes activation");
    expect(routerSkill).toContain("name: loopgraph-event-router");
    expect(routerSkill).toContain(`skillProtocol: ${HERMES_LOOPGRAPH_EVENT_ROUTER_SKILL_PROTOCOL_VERSION}`);
    expect(routerSkill).toContain(`mcpProtocol: ${HERMES_LOOPGRAPH_MCP_PROTOCOL_VERSION}`);
    expect(routerSkill).toContain("routingDecisionSchema: routing-decision/v1alpha1");
    expect(routerSkill).toContain("loopgraph://schemas/routing-decision");
    expect(routerSkill).toContain("--exposure webhook_router");
    expect(routerSkill).toContain("server named `loopgraph_webhook_router`");
    expect(routerSkill).toContain("Do not use `loopgraph_admin`");
    expect(routerSkill).not.toContain("loopgraph://loops/{loopId}");
    expect(routerSkill).toContain("references/routing-protocol.md");
    expect(routerSkill).toContain("examples/product-routing-events.md");
    expect(routerSkill).toContain("examples/marketing-routing-events.md");
    expect(routerSkill).toContain("loopgraph_events_ingest");
    expect(routerSkill).toContain("loopgraph_routing_decision_submit");
    expect(routerSkill).toContain("loopgraph_events_get");
    expect(routerSkill).toContain("loopgraph_problems_get");
    expect(routerSkill).toContain("loopgraph_routing_decision_get");
    expect(routerSkill).not.toContain("loopgraph_route_jobs_get");
    expect(routerSkill).not.toContain("loopgraph_lifecycle_events_get");
    expect(routerSkill).not.toContain("loopgraph_graph_change_apply");
    expect(routerSkill).not.toContain("loopgraph_graph_rollback");
    expect(routerSkill).toContain("notification-only Loopgraph lifecycle events");
    expect(routerSkill).toContain("Do not call `loopgraph_route_commit_simulate` from an untrusted webhook turn");
    expect(routerSkill).toContain("Never bypass a rejected decision");
    expect(discoveryReference).toContain("present the department picker immediately");
    expect(discoveryReference).toContain("Ask exactly the next `QuestionBundle`");
    expect(proposalReference).toContain("routing contract with problem types");
    expect(proposalReference).toContain("Proposal set schema: `loop-design-proposal-set/v1alpha1`");
    expect(safetyReference).toContain("Provider webhooks terminate at Hermes");
    expect(safetyReference).toContain("content-bound approval receipts");
    expect(safetyReference).toContain("Do not expose graph transaction tools");
    expect(productExample).toContain("Hermes Brain -> Product -> Feedback Clustering");
    expect(productExample).toContain("Release Learning");
    expect(marketingExample).toContain("Hermes Brain -> Marketing -> Ads");
    expect(routingReference).toContain("Call `loopgraph_events_ingest` first");
    expect(routingReference).toContain("Routing decision schema: `routing-decision/v1alpha1`");
    expect(routingReference).toContain("Submit exactly one schema-constrained decision");
    expect(productRoutingExample).toContain("feedback.repeated_theme_detected");
    expect(productRoutingExample).toContain("request product-owner review");
    expect(routingExample).toContain("Ambiguous landing-page event");
    expect(routingExample).toContain("Do not submit a second route decision");
  });

  it("doctors the local Hermes integration and records the result", async () => {
    const projectRoot = await temporaryProjectRoot();
    await installHermesIntegration({
      projectRoot,
      cliEntryPath: path.join(projectRoot, "dist", "cli.js"),
      nodeCommand: process.execPath
    });

    const result = await doctorHermesIntegration({
      projectRoot,
      hermesVersionCheck: async () => "hermes 1.0.0"
    });

    expect(result).toMatchObject({
      ok: true,
      hermesAvailable: true,
      hermesVersion: "hermes 1.0.0",
      installed: true,
      mcp: {
        ok: true,
        serverName: "loopgraph",
        tools: HERMES_LOOPGRAPH_MCP_TOOL_NAMES,
        missingTools: [],
        resources: expect.arrayContaining([...LOOPGRAPH_MCP_STATIC_RESOURCE_URIS]),
        missingResources: [],
        workspaceOk: true,
        workspaceExists: true,
        catalogOk: true,
        catalogCount: 0
      },
      compatibility: {
        ok: true,
        installSchema: {
          expected: HERMES_LOOPGRAPH_INTEGRATION_VERSION,
          actual: HERMES_LOOPGRAPH_INTEGRATION_VERSION,
          ok: true
        }
      },
      warnings: []
    });
    expect(result.compatibility.protocols.every((item) => item.ok)).toBe(true);
    expect(result.compatibility.skills.every((item) => item.ok)).toBe(true);
    expect(result.artifacts.every((artifact) => artifact.exists)).toBe(true);

    const installState = await readJsonFile(path.join(projectRoot, ".loopgraph", "hermes", "install.json"));
    expect(installState).toMatchObject({
      lastDoctor: {
        ok: true,
        hermesAvailable: true,
        mcpTools: HERMES_LOOPGRAPH_MCP_TOOL_NAMES,
        mcpResources: expect.arrayContaining([...LOOPGRAPH_MCP_STATIC_RESOURCE_URIS]),
        warnings: []
      }
    });
  });

  it("runs guided setup as the smooth Hermes onboarding path", async () => {
    const projectRoot = await temporaryProjectRoot();
    const cliEntryPath = path.join(projectRoot, "dist", "cli.js");

    const result = await setupHermesIntegration({
      projectRoot,
      cliEntryPath,
      nodeCommand: process.execPath,
      hermesVersionCheck: async () => "hermes 1.0.0",
      now: new Date("2026-07-21T12:00:00.000Z")
    });

    expect(result).toMatchObject({
      ok: true,
      localReady: true,
      hermesReady: true,
      projectRoot,
      hermesConfig: {
        generatedSnippetPath: path.join(projectRoot, ".loopgraph", "hermes", "mcp.loopgraph.yaml"),
        targetConfigPath: "~/.hermes/config.yaml",
        skillsDir: path.join(projectRoot, ".loopgraph", "hermes", "skills")
      },
      commandUsage: {
        fromClone: {
          setup: "npm run loopgraph -- setup --project . --activate",
          doctor: "npm run loopgraph -- hermes doctor --project .",
          studio: "npm run loopgraph -- start --project .",
          webhooksPlan: "npm run loopgraph -- hermes webhooks plan --project .",
          webhooksSync: "npm run loopgraph -- hermes webhooks sync --project .",
          webhooksDoctor: "npm run loopgraph -- hermes webhooks doctor --project .",
          eventTest: "npm run loopgraph -- events test --project . --fixture <event.json> --require-synced-manifest"
        },
        fromInstalledPackage: {
          setup: "loopgraph setup --project . --activate"
        },
        firstHermesPrompt: "start Loopgraph"
      },
      warnings: []
    });
    expect(result.install.mcpServer).toMatchObject({
      name: "loopgraph_admin",
      command: process.execPath,
      args: [cliEntryPath, "mcp", "serve", "--project", projectRoot, "--exposure", "admin"]
    });
    expect(result.doctor.ok).toBe(true);
    expect(result.nextSteps).toContain("Merge the generated non-secret MCP snippet into ~/.hermes/config.yaml.");
    expect(result.nextSteps).toContain("After accepting loops, plan and sync Hermes webhook route metadata from Loopgraph.");
    expect(result.safety).toContain("Provider webhooks should terminate at Hermes. Loopgraph receives normalized events through the Hermes event-router skill.");
    expect(JSON.stringify(result).toLowerCase()).not.toContain("api_key");
    expect(JSON.stringify(result).toLowerCase()).not.toContain("secret_value");
  });

  it("activates every scoped MCP server and the GitHub skill in one setup command", async () => {
    const projectRoot = await temporaryProjectRoot();
    const commands: Array<{ command: string; args: string[] }> = [];
    const result = await setupHermesIntegration({
      projectRoot,
      cliEntryPath: path.join(projectRoot, "dist", "cli.js"),
      nodeCommand: process.execPath,
      hermesVersionCheck: async () => "hermes 1.0.0",
      activate: true,
      commandRunner: async (command, args) => { commands.push({ command, args }); }
    });

    expect(result.activation).toMatchObject({ applied: true });
    expect(result.activation?.receiptPath).toBe(path.join(projectRoot, ".loopgraph", "hermes", "activation.json"));
    expect(commands).toHaveLength(6);
    expect(commands.filter((command) => command.args.slice(0, 2).join(" ") === "mcp add")).toHaveLength(3);
    expect(commands).toContainEqual({ command: "hermes", args: ["skills", "tap", "add", "mrrkrieg/loopgraph"] });
    expect(commands).toContainEqual({ command: "hermes", args: ["skills", "install", "mrrkrieg/loopgraph/skills/loopgraph"] });
    expect(commands).toContainEqual({ command: "hermes", args: ["skills", "install", "mrrkrieg/loopgraph/skills/loopgraph-event-router"] });
    expect(result.nextSteps).not.toContain("Merge the generated non-secret MCP snippet into ~/.hermes/config.yaml.");
    const doctor = await doctorHermesIntegration({
      projectRoot,
      hermesVersionCheck: async () => "hermes 1.0.0"
    });
    expect(doctor.activation).toMatchObject({ applied: true, current: true });
  });

  it("disconnects only Loopgraph MCP registrations and removes the local activation claim", async () => {
    const projectRoot = await temporaryProjectRoot();
    const activated = await setupHermesIntegration({
      projectRoot,
      cliEntryPath: path.join(projectRoot, "dist", "cli.js"),
      nodeCommand: process.execPath,
      hermesVersionCheck: async () => "hermes 1.0.0",
      activate: true,
      commandRunner: async () => undefined
    });
    const commands: Array<{ command: string; args: string[] }> = [];

    const result = await deactivateHermesIntegration({
      projectRoot,
      commandRunner: async (command, args) => { commands.push({ command, args }); }
    });

    expect(result).toMatchObject({
      projectRoot,
      disconnected: true,
      activationReceiptPath: activated.activation?.receiptPath,
      activationReceiptRemoved: true
    });
    expect(commands).toEqual([
      { command: "hermes", args: ["mcp", "remove", "loopgraph_admin"] },
      { command: "hermes", args: ["mcp", "remove", "loopgraph_webhook_router"] },
      { command: "hermes", args: ["mcp", "remove", "loopgraph_lifecycle_router"] }
    ]);
    await expect(readFile(activated.activation!.receiptPath, "utf8")).rejects.toMatchObject({ code: "ENOENT" });
    const doctor = await doctorHermesIntegration({
      projectRoot,
      hermesVersionCheck: async () => "hermes 1.0.0"
    });
    expect(doctor.activation).toMatchObject({ applied: false, current: false });
  });

  it("rejects an activation receipt that does not prove both scoped skills", async () => {
    const projectRoot = await temporaryProjectRoot();
    const activated = await setupHermesIntegration({
      projectRoot,
      cliEntryPath: path.join(projectRoot, "dist", "cli.js"),
      nodeCommand: process.execPath,
      hermesVersionCheck: async () => "hermes 1.0.0",
      activate: true,
      commandRunner: async () => undefined
    });
    const receipt = JSON.parse(await readFile(activated.activation!.receiptPath, "utf8")) as Record<string, unknown>;
    receipt.skills = ["mrrkrieg/loopgraph/skills/loopgraph"];
    await writeFile(activated.activation!.receiptPath, `${JSON.stringify(receipt)}\n`);

    const doctor = await doctorHermesIntegration({
      projectRoot,
      hermesVersionCheck: async () => "hermes 1.0.0"
    });
    expect(doctor.activation).toMatchObject({ applied: false, current: false });
  });

  it("preserves the activation receipt when Hermes disconnect is incomplete", async () => {
    const projectRoot = await temporaryProjectRoot();
    const activated = await setupHermesIntegration({
      projectRoot,
      cliEntryPath: path.join(projectRoot, "dist", "cli.js"),
      nodeCommand: process.execPath,
      hermesVersionCheck: async () => "hermes 1.0.0",
      activate: true,
      commandRunner: async () => undefined
    });

    await expect(deactivateHermesIntegration({
      projectRoot,
      commandRunner: async (_command, args) => {
        if (args.at(-1) === "loopgraph_webhook_router") throw new Error("simulated removal failure");
      }
    })).rejects.toThrow("The activation receipt was preserved");
    expect(JSON.parse(await readFile(activated.activation!.receiptPath, "utf8"))).toMatchObject({
      schemaVersion: "hermes-loopgraph-activation/v1alpha2"
    });
  });

  it.skipIf(process.platform === "win32")("atomically replaces an activation receipt symlink without changing its target", async () => {
    const projectRoot = await temporaryProjectRoot();
    const install = await installHermesIntegration({
      projectRoot,
      cliEntryPath: path.join(projectRoot, "dist", "cli.js"),
      nodeCommand: process.execPath
    });
    const outsidePath = path.join(projectRoot, "outside.txt");
    await writeFile(outsidePath, "keep\n");
    await symlink(outsidePath, install.activationReceiptPath);

    await activateHermesIntegration(install, async () => undefined, new Date("2026-08-17T13:00:00.000Z"));

    expect(await readFile(outsidePath, "utf8")).toBe("keep\n");
    const receiptStat = await lstat(install.activationReceiptPath);
    expect(receiptStat.isSymbolicLink()).toBe(false);
    expect(receiptStat.mode & 0o777).toBe(0o600);
  });

  it("keeps setup local-ready while warning when the Hermes CLI is not installed", async () => {
    const projectRoot = await temporaryProjectRoot();

    const result = await setupHermesIntegration({
      projectRoot,
      cliEntryPath: path.join(projectRoot, "dist", "cli.js"),
      nodeCommand: process.execPath,
      hermesVersionCheck: async () => null
    });

    expect(result.localReady).toBe(true);
    expect(result.hermesReady).toBe(false);
    expect(result.warnings).toContain("Hermes CLI was not found on PATH; install Hermes before using the generated config.");
    expect(result.nextSteps[0]).toBe("Install Hermes Agent, then confirm `hermes --version` works before starting the first Loopgraph prompt.");
  });

  it("reports stale Hermes skill or schema contracts as incompatible", async () => {
    const projectRoot = await temporaryProjectRoot();
    await installHermesIntegration({
      projectRoot,
      cliEntryPath: path.join(projectRoot, "dist", "cli.js"),
      nodeCommand: process.execPath
    });
    const installStatePath = path.join(projectRoot, ".loopgraph", "hermes", "install.json");
    const installState = await readJsonFile(installStatePath);
    const skills = installState.skills as Array<Record<string, unknown>>;
    const protocols = installState.protocols as Record<string, unknown>;
    skills[0]!.version = "0.0.0";
    skills[1]!.protocol = "loopgraph-event-router-skill/v0";
    protocols.loopDesignProposalSet = "loop-design-proposal-set/v0";
    await writeFile(installStatePath, `${JSON.stringify(installState, null, 2)}\n`);

    const result = await doctorHermesIntegration({
      projectRoot,
      hermesVersionCheck: async () => "hermes 1.0.0"
    });

    expect(result.ok).toBe(false);
    expect(result.installed).toBe(true);
    expect(result.mcp.ok).toBe(true);
    expect(result.compatibility.ok).toBe(false);
    expect(result.compatibility.protocols).toContainEqual(expect.objectContaining({
      name: "loopDesignProposalSet",
      expected: HERMES_LOOPGRAPH_PROTOCOL_VERSIONS.loopDesignProposalSet,
      actual: "loop-design-proposal-set/v0",
      ok: false
    }));
    expect(result.compatibility.skills).toContainEqual(expect.objectContaining({
      name: "loopgraph",
      expectedVersion: HERMES_LOOPGRAPH_SKILL_VERSION,
      actualVersion: "0.0.0",
      versionOk: false,
      protocolOk: true,
      ok: false
    }));
    expect(result.compatibility.skills).toContainEqual(expect.objectContaining({
      name: "loopgraph-event-router",
      actualProtocol: "loopgraph-event-router-skill/v0",
      versionOk: true,
      protocolOk: false,
      ok: false
    }));
    expect(result.warnings).toContain(
      `Hermes integration metadata is incompatible; run \`loopgraph setup --project <root>\` to refresh the project-local skills and MCP contract. Advanced recovery: \`loopgraph hermes setup --project ${JSON.stringify(projectRoot)}\`.`
    );

    const afterDoctor = await readJsonFile(installStatePath);
    expect(afterDoctor.lastDoctor).toBeNull();
  });

  it("reports missing project-local artifacts before install", async () => {
    const projectRoot = await temporaryProjectRoot();

    const result = await doctorHermesIntegration({
      projectRoot,
      hermesVersionCheck: async () => "hermes 1.0.0"
    });

    expect(result.ok).toBe(false);
    expect(result.installed).toBe(false);
    expect(result.compatibility.ok).toBe(false);
    expect(result.compatibility.installSchema).toMatchObject({
      expected: HERMES_LOOPGRAPH_INTEGRATION_VERSION,
      ok: false
    });
    expect(result.artifacts.length).toBe(12 + DEPARTMENT_OPERATING_SKILLS.length);
    expect(result.mcp.workspaceOk).toBe(true);
    expect(result.mcp.workspaceExists).toBe(false);
    expect(result.mcp.catalogOk).toBe(true);
    expect(result.warnings).toContain("Project-local Hermes integration artifacts are incomplete; run `loopgraph hermes setup --project <root>`.");
    expect(result.artifacts.every((artifact) => artifact.exists)).toBe(false);
  });
});
