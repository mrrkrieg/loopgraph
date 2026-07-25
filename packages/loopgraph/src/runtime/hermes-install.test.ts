import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import YAML from "yaml";
import { describe, expect, it } from "vitest";
import { LOOPGRAPH_MCP_STATIC_RESOURCE_URIS } from "../mcp/server";
import {
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
        name: "loopgraph",
        command: process.execPath,
        args: [cliEntryPath, "mcp", "serve", "--project", projectRoot],
        tools: HERMES_LOOPGRAPH_MCP_TOOL_NAMES
      }
    });
    expect(result.supportingFilePaths.map((item) => path.relative(result.skillsDir, item))).toEqual([
      path.join("loopgraph", "references", "discovery-flow.md"),
      path.join("loopgraph", "references", "proposal-schema.md"),
      path.join("loopgraph", "references", "safety-and-approvals.md"),
      path.join("loopgraph", "examples", "marketing-ads-content.md"),
      path.join("loopgraph-event-router", "references", "routing-protocol.md"),
      path.join("loopgraph-event-router", "examples", "marketing-routing-events.md")
    ]);

    const mcpConfig = YAML.parse(await readFile(result.mcpConfigPath, "utf8")) as Record<string, unknown>;
    expect(mcpConfig).toMatchObject({
      mcp_servers: {
        loopgraph: {
          command: process.execPath,
          args: [cliEntryPath, "mcp", "serve", "--project", projectRoot],
          enabled: true,
          supports_parallel_tool_calls: false,
          tools: {
            include: HERMES_LOOPGRAPH_MCP_TOOL_NAMES,
            prompts: false,
            resources: true
          }
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
        name: "loopgraph",
        transport: "stdio",
        command: process.execPath,
        args: [cliEntryPath, "mcp", "serve", "--project", projectRoot],
        tools: HERMES_LOOPGRAPH_MCP_TOOL_NAMES,
        configPath: result.mcpConfigPath
      },
      skills: [
        {
          name: "loopgraph",
          version: HERMES_LOOPGRAPH_SKILL_VERSION,
          protocol: HERMES_LOOPGRAPH_DESIGN_SKILL_PROTOCOL_VERSION,
          path: result.skillPaths[0],
          assets: result.supportingFilePaths.slice(0, 4)
        },
        {
          name: "loopgraph-event-router",
          version: HERMES_LOOPGRAPH_SKILL_VERSION,
          protocol: HERMES_LOOPGRAPH_EVENT_ROUTER_SKILL_PROTOCOL_VERSION,
          path: result.skillPaths[1],
          assets: result.supportingFilePaths.slice(4)
        }
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
        hermesWebhookPlanning: true,
        hermesWebhookSync: true,
        hermesWebhookDoctor: true,
        hermesWebhookTest: true,
        liveExecution: false
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
    const discoveryReference = await readFile(result.supportingFilePaths[0]!, "utf8");
    const proposalReference = await readFile(result.supportingFilePaths[1]!, "utf8");
    const safetyReference = await readFile(result.supportingFilePaths[2]!, "utf8");
    const marketingExample = await readFile(result.supportingFilePaths[3]!, "utf8");
    const routingReference = await readFile(result.supportingFilePaths[4]!, "utf8");
    const routingExample = await readFile(result.supportingFilePaths[5]!, "utf8");
    expect(designSkill).toContain("name: loopgraph");
    expect(designSkill).toContain("start Loopgraph");
    expect(designSkill).toContain("Do not ask an open-ended question first");
    expect(designSkill).toContain("ask only for missing required fields");
    expect(designSkill).toContain(`skillProtocol: ${HERMES_LOOPGRAPH_DESIGN_SKILL_PROTOCOL_VERSION}`);
    expect(designSkill).toContain(`mcpProtocol: ${HERMES_LOOPGRAPH_MCP_PROTOCOL_VERSION}`);
    expect(designSkill).toContain("loopDesignProposalSetSchema: loop-design-proposal-set/v1alpha1");
    expect(designSkill).toContain("Loopgraph MCP server named `loopgraph`");
    expect(designSkill).toContain("loopgraph://schemas/loop-design-context");
    expect(designSkill).toContain("loopgraph://graph/company");
    expect(designSkill).toContain("references/discovery-flow.md");
    expect(designSkill).toContain("examples/marketing-ads-content.md");
    expect(designSkill).toContain("loopgraph_workspace_inspect");
    expect(designSkill).toContain("loopgraph_departments_list");
    expect(designSkill).toContain("loopgraph_project_inspect");
    expect(designSkill).toContain("loopgraph_design_context_get");
    expect(designSkill).toContain("loopgraph_design_submit");
    expect(designSkill).toContain("loopgraph_design_edit");
    expect(designSkill).toContain("loopgraph_connections_plan");
    expect(designSkill).toContain("loopgraph_connections_set_manual_fallback");
    expect(designSkill).toContain("loopgraph_loops_materialize");
    expect(designSkill).toContain("loopgraph_runs_get");
    expect(designSkill).toContain("loopgraph_loops_validate");
    expect(designSkill).toContain("loopgraph_loops_simulate");
    expect(designSkill).toContain("loopgraph_route_commit_simulate");
    expect(designSkill).toContain("loopgraph_route_jobs_get");
    expect(designSkill).toContain("loopgraph_routing_evaluation_run");
    expect(designSkill).toContain("loopgraph_routing_evaluations_get");
    expect(designSkill).toContain("loopgraph_lifecycle_events_get");
    expect(designSkill).toContain("loopgraph_review_submit");
    expect(designSkill).toContain("loopgraph_case_resolve");
    expect(designSkill).toContain("loopgraph_graph_get");
    expect(designSkill).toContain("loopgraph studio --project");
    expect(designSkill).toContain("loopgraph_hermes_webhooks_plan");
    expect(designSkill).toContain("loopgraph_hermes_webhooks_sync");
    expect(designSkill).toContain("loopgraph_hermes_webhooks_doctor");
    expect(designSkill).toContain("loopgraph_hermes_webhooks_test");
    expect(designSkill).toContain("only after the user explicitly asks to write or refresh");
    expect(designSkill).toContain("Do not point provider webhooks directly at Loopgraph");
    expect(designSkill).toContain("loopgraph_loops_list");
    expect(routerSkill).toContain("name: loopgraph-event-router");
    expect(routerSkill).toContain(`skillProtocol: ${HERMES_LOOPGRAPH_EVENT_ROUTER_SKILL_PROTOCOL_VERSION}`);
    expect(routerSkill).toContain(`mcpProtocol: ${HERMES_LOOPGRAPH_MCP_PROTOCOL_VERSION}`);
    expect(routerSkill).toContain("routingDecisionSchema: routing-decision/v1alpha1");
    expect(routerSkill).toContain("loopgraph://schemas/routing-decision");
    expect(routerSkill).toContain("--exposure webhook_router");
    expect(routerSkill).not.toContain("loopgraph://loops/{loopId}");
    expect(routerSkill).toContain("references/routing-protocol.md");
    expect(routerSkill).toContain("examples/marketing-routing-events.md");
    expect(routerSkill).toContain("loopgraph_events_ingest");
    expect(routerSkill).toContain("loopgraph_routing_decision_submit");
    expect(routerSkill).toContain("loopgraph_events_get");
    expect(routerSkill).toContain("loopgraph_problems_get");
    expect(routerSkill).toContain("loopgraph_routing_decision_get");
    expect(routerSkill).not.toContain("loopgraph_route_jobs_get");
    expect(routerSkill).not.toContain("loopgraph_lifecycle_events_get");
    expect(routerSkill).toContain("notification-only Loopgraph lifecycle events");
    expect(routerSkill).toContain("Do not call `loopgraph_route_commit_simulate` from an untrusted webhook turn");
    expect(routerSkill).toContain("Never bypass a rejected decision");
    expect(discoveryReference).toContain("present the department picker immediately");
    expect(discoveryReference).toContain("Ask exactly the next `QuestionBundle`");
    expect(proposalReference).toContain("routing contract with problem types");
    expect(proposalReference).toContain("Proposal set schema: `loop-design-proposal-set/v1alpha1`");
    expect(safetyReference).toContain("Provider webhooks terminate at Hermes");
    expect(marketingExample).toContain("Hermes Brain -> Marketing -> Ads");
    expect(routingReference).toContain("Call `loopgraph_events_ingest` first");
    expect(routingReference).toContain("Routing decision schema: `routing-decision/v1alpha1`");
    expect(routingReference).toContain("Submit exactly one schema-constrained decision");
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
          setup: "npm run loopgraph -- hermes setup --project .",
          doctor: "npm run loopgraph -- hermes doctor --project .",
          studio: "npm run loopgraph -- studio --project . --start",
          webhooksPlan: "npm run loopgraph -- hermes webhooks plan --project .",
          webhooksSync: "npm run loopgraph -- hermes webhooks sync --project .",
          webhooksDoctor: "npm run loopgraph -- hermes webhooks doctor --project .",
          eventTest: "npm run loopgraph -- events test --project . --fixture <event.json> --require-synced-manifest"
        },
        fromInstalledPackage: {
          setup: "loopgraph hermes setup --project ."
        },
        firstHermesPrompt: "start Loopgraph"
      },
      warnings: []
    });
    expect(result.install.mcpServer).toMatchObject({
      name: "loopgraph",
      command: process.execPath,
      args: [cliEntryPath, "mcp", "serve", "--project", projectRoot]
    });
    expect(result.doctor.ok).toBe(true);
    expect(result.nextSteps).toContain("Merge the generated non-secret MCP snippet into ~/.hermes/config.yaml.");
    expect(result.nextSteps).toContain("After accepting loops, plan and sync Hermes webhook route metadata from Loopgraph.");
    expect(result.safety).toContain("Provider webhooks should terminate at Hermes. Loopgraph receives normalized events through the Hermes event-router skill.");
    expect(JSON.stringify(result).toLowerCase()).not.toContain("api_key");
    expect(JSON.stringify(result).toLowerCase()).not.toContain("secret_value");
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
      `Hermes integration metadata is incompatible; run \`loopgraph hermes setup --project ${JSON.stringify(projectRoot)}\` to refresh the project-local skills and MCP contract.`
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
    expect(result.artifacts.length).toBe(10);
    expect(result.mcp.workspaceOk).toBe(true);
    expect(result.mcp.workspaceExists).toBe(false);
    expect(result.mcp.catalogOk).toBe(true);
    expect(result.warnings).toContain("Project-local Hermes integration artifacts are incomplete; run `loopgraph hermes setup --project <root>`.");
    expect(result.artifacts.every((artifact) => artifact.exists)).toBe(false);
  });
});
