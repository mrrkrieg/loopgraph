import { cp, mkdir, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Command } from "commander";
import { loadLoopSpecFromPath } from "../runtime/loader";
import { simulateLoop } from "../runtime/simulator";
import { executeLoop, isExecuteEnabled } from "../runtime/executor";
import { buildGraphFromSpecs } from "../core/graph";
import { allMockAdapters } from "../sdk/adapters/mock-adapters";
import { runAdapterConformance } from "../sdk/conformance";
import { consumeEscalationCase } from "../runtime/management-consumer";
import { applyReviewDecision, ReviewServiceError } from "../runtime/review-service";
import { formatReviewPacket } from "../runtime/review-packet";
import { listEscalationCases, resolveCase } from "../runtime/case-service";
import { getStorageAdapter, getLoopgraphRoot } from "../runtime/storage-resolver";
import type { LoopRunTrace } from "../core/trace";
import type { LoopControllerTriggerType } from "../core";
import { normalizeLoopgraphMcpExposure, runLoopgraphMcpStdioServer } from "../mcp/server";
import {
  doctorHermesIntegration,
  installHermesIntegration,
  setupHermesIntegration,
  type HermesInstallScope,
  type HermesSetupResult
} from "../runtime/hermes-install";
import {
  doctorHermesWebhookRoutes,
  planHermesWebhookRoutes,
  syncHermesWebhookRoutes,
  testHermesWebhookFixture
} from "../runtime/hermes-webhooks";
import { initLoopgraphWorkspace, inspectLoopgraphWorkspace } from "../runtime/workspace";
import { prepareLoopgraphStudio, type LoopgraphStudioPlan } from "../runtime/studio";
import {
  runHermesLocalRouteTest,
  runHermesRoutingEvaluation,
  type RoutingEvaluationFixtureInput
} from "../runtime/routing-simulation";
import {
  loopgraph_events_replay,
  loopgraph_route_commit_simulate,
  loopgraph_routing_human_choice_submit
} from "../runtime/routing-tools";
import {
  listLoopOpportunities,
  scanLoopOpportunities
} from "../runtime/loop-opportunity-engine";
import { runRouteJobWorker } from "../runtime/route-job-worker";
import { FileLoopControllerStore } from "../runtime/loop-controller-store";
import { enqueueLoopControllerTrigger } from "../runtime/loop-controller-triggers";
import { runLoopControllerScheduler } from "../runtime/loop-controller-scheduler";
import {
  cancelRouteJob,
  FileRoutingStore,
  retryRouteJob
} from "../runtime/routing-store";
import {
  callLoopgraphSemanticGraphTool,
  type LoopgraphSemanticGraphToolName
} from "../runtime/semantic-graph-tools";
import {
  callLoopgraphMeasurementTool,
  type LoopgraphMeasurementToolName
} from "../runtime/measurement-tools";
import {
  callLoopgraphConnectionTool,
  type LoopgraphConnectionToolName
} from "../runtime/connection-tools";
import { PROVIDER_ONBOARDING_CATALOG, prepareProviderInstallation } from "../runtime/provider-onboarding";
import { normalizeProviderEvent } from "../runtime/provider-normalizers";
import { providerIdSchema } from "../core/provider-onboarding";
import {
  callLoopgraphAppTool,
  type LoopgraphAppToolName
} from "../runtime/app-tools";

const HERO_TEMPLATES = [
  {
    id: "github-issue-triage",
    name: "GitHub Issue Triage",
    dir: "github-issue-triage"
  },
  {
    id: "strategic-account-escalation",
    name: "Strategic Account Escalation",
    dir: "strategic-account-escalation"
  },
  {
    id: "support-ticket-triage",
    name: "Support Ticket Triage",
    dir: "support-ticket-triage"
  }
] as const;

function resolvePackageRoot(fromFile: string): string {
  let dir = path.dirname(fromFile);
  for (let depth = 0; depth < 4; depth += 1) {
    if (existsSync(path.join(dir, "templates"))) {
      return dir;
    }
    dir = path.dirname(dir);
  }
  throw new Error("Could not locate loopgraph package templates directory");
}

function parseIntegerOption(value: string): number {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed)) throw new Error(`Expected an integer, received: ${value}`);
  return parsed;
}

const cliEntryFile = fileURLToPath(import.meta.url);
const packageRoot = resolvePackageRoot(cliEntryFile);
const templatesRoot = path.join(packageRoot, "templates");

const program = new Command();
const storage = getStorageAdapter({ rootDir: getLoopgraphRoot(process.cwd()) });

program.name("loopgraph").description("Loopgraph validate/simulate CLI");

async function runHermesSetup(options: { project: string; scope: string; json?: boolean; activate?: boolean }): Promise<void> {
  const scope = parseHermesScope(options.scope);
  const result = await setupHermesIntegration({
    projectRoot: path.resolve(options.project),
    scope,
    cliEntryPath: cliEntryFile,
    nodeCommand: process.execPath,
    activate: Boolean(options.activate)
  });
  if (options.json) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    printHermesSetupResult(result);
  }
  if (!result.localReady) process.exit(1);
}

async function runHermesInstall(options: { project: string; scope: string }): Promise<void> {
  const scope = parseHermesScope(options.scope);
  const result = await installHermesIntegration({
    projectRoot: path.resolve(options.project),
    scope,
    cliEntryPath: cliEntryFile,
    nodeCommand: process.execPath
  });
  console.log(JSON.stringify(result, null, 2));
}

async function runHermesDoctor(options: { project: string }): Promise<void> {
  const result = await doctorHermesIntegration({
    projectRoot: path.resolve(options.project)
  });
  console.log(JSON.stringify(result, null, 2));
  if (!result.ok) process.exit(1);
}

const workspace = program.command("workspace").description("Local Loopgraph workspace commands");
const events = program.command("events").description("Hermes-normalized event utilities");
const opportunities = program.command("opportunities").description("Detect missing or weak loops from durable operating evidence");
const worker = program.command("worker").description("Run and operate the durable Hermes route-job worker");
const controller = program.command("controller").description("Run the durable Hermes Brain continuous-improvement controller");
const measurements = program.command("measurements").description("Bind metrics and operate Hermes evidence collection");
const measurementBindings = measurements.command("bindings").description("Manage exact provider metric bindings");
const measurementJobs = measurements.command("jobs").description("Operate durable Hermes measurement jobs");
const connections = program.command("connections").description("Register and reconcile non-secret Hermes connector metadata");
const graph = program.command("graph").description("Review and apply semantic company graph transactions");
const graphChange = graph.command("change").description("Approve and apply add, update, split, merge, or retire change sets");
const graphPromotion = graph.command("promotion").description("Approve and apply ordered loop activation-mode promotions");
const graphLifecycle = graph.command("lifecycle").description("Approve and apply loop pause or resume transactions");
const graphRollback = graph.command("rollback").description("Approve and apply exact graph transaction rollback");
const apps = program.command("apps").alias("app").description("Discover, build, publish, install, test, and operate Loopgraph Apps through the shared Hermes service");

apps
  .command("search")
  .description("Search the local-first app marketplace by outcome, department, or capability")
  .argument("[query]", "Business outcome or app terms")
  .option("--project <root>", "Explicit project root", process.cwd())
  .option("--department <department>", "Filter by department")
  .option("--capability <capability>", "Filter by required logical capability")
  .option("--limit <count>", "Maximum results", "20")
  .action(async (query: string | undefined, options: { project: string; department?: string; capability?: string; limit: string }) => {
    await printAppTool("loopgraph_marketplace_search", {
      projectRoot: options.project,
      query,
      department: options.department,
      capability: options.capability,
      limit: parsePositiveInteger(options.limit, "Marketplace result limit")
    });
  });

apps
  .command("get")
  .description("Inspect one app version, its permissions, presets, modules, and provenance")
  .argument("<app-id>", "Marketplace app ID")
  .option("--project <root>", "Explicit project root", process.cwd())
  .option("--version <version>", "Exact version")
  .action(async (appId: string, options: { project: string; version?: string }) => {
    await printAppTool("loopgraph_app_get", { projectRoot: options.project, appId, version: options.version });
  });

apps
  .command("plan")
  .description("Create a read-only exact install plan; missing connections, mappings, and answers are returned as blockers")
  .argument("<app-id>", "Marketplace app ID")
  .requiredOption("--preset <preset>", "Provider preset ID")
  .option("--project <root>", "Explicit project root", process.cwd())
  .option("--version <range>", "Semantic version or range", "latest")
  .option("--config <path>", "JSON object with confirmed installation answers")
  .option("--mapping <ids...>", "Confirmed field mapping IDs")
  .option("--module <ids...>", "Selected optional module IDs")
  .option("--workspace <id>", "Workspace ID; defaults to the local project identity")
  .option("--company <id>", "Company ID; defaults to workspace ID")
  .option("--actor <id>", "Accountable planner identity", "cli")
  .action(async (appId: string, options: { project: string; preset: string; version: string; config?: string; mapping?: string[]; module?: string[]; workspace?: string; company?: string; actor: string }) => {
    await printAppTool("loopgraph_app_install_plan", {
      projectRoot: options.project,
      workspaceId: options.workspace,
      companyId: options.company,
      appId,
      versionRange: options.version,
      presetId: options.preset,
      selectedModules: options.module,
      configuration: options.config ? await readJsonRecord(path.resolve(options.config)) : {},
      fieldMappingIds: options.mapping ?? [],
      actor: options.actor
    });
  });

apps
  .command("install")
  .description("Atomically apply an exact unexpired plan JSON produced by apps plan")
  .requiredOption("--plan <path>", "Install plan JSON file")
  .option("--project <root>", "Explicit project root", process.cwd())
  .option("--workspace <id>", "Workspace ID")
  .option("--company <id>", "Company ID")
  .option("--actor <id>", "Accountable installer identity", "cli")
  .action(async (options: { plan: string; project: string; workspace?: string; company?: string; actor: string }) => {
    await printAppTool("loopgraph_app_install_apply", {
      projectRoot: options.project,
      workspaceId: options.workspace,
      companyId: options.company,
      plan: await readJsonRecord(path.resolve(options.plan)),
      actor: options.actor
    });
  });

apps
  .command("status")
  .description("Inspect installed apps, evidence-derived readiness, evaluations, and exact lockfile")
  .option("--project <root>", "Explicit project root", process.cwd())
  .option("--installation <id>", "One installation ID")
  .option("--workspace <id>", "Workspace ID")
  .option("--company <id>", "Company ID")
  .action(async (options: { project: string; installation?: string; workspace?: string; company?: string }) => {
    await printAppTool("loopgraph_app_install_status", { projectRoot: options.project, installationId: options.installation, workspaceId: options.workspace, companyId: options.company });
  });

for (const action of ["test", "pause", "resume"] as const) {
  apps
    .command(action)
    .description(action === "test" ? "Run write-blocked synthetic app conformance" : `${action === "pause" ? "Pause" : "Resume"} an installed app without deleting shared company assets`)
    .argument("<installation-id>", "Installed app ID")
    .option("--project <root>", "Explicit project root", process.cwd())
    .option("--workspace <id>", "Workspace ID")
    .option("--company <id>", "Company ID")
    .option("--actor <id>", "Accountable actor identity", "cli")
    .action(async (installationId: string, options: { project: string; workspace?: string; company?: string; actor: string }) => {
      const tool = action === "test" ? "loopgraph_app_test" : action === "pause" ? "loopgraph_app_pause" : "loopgraph_app_resume";
      await printAppTool(tool, { projectRoot: options.project, installationId, workspaceId: options.workspace, companyId: options.company, actor: options.actor });
    });
}

apps
  .command("activate")
  .description("Promote a tested app to shadow, recommend, or execute-with-approval")
  .argument("<installation-id>", "Installed app ID")
  .requiredOption("--mode <mode>", "shadow, recommend, or execute_with_approval")
  .option("--project <root>", "Explicit project root", process.cwd())
  .option("--workspace <id>", "Workspace ID")
  .option("--company <id>", "Company ID")
  .option("--actor <id>", "Accountable actor identity", "cli")
  .action(async (installationId: string, options: { mode: string; project: string; workspace?: string; company?: string; actor: string }) => {
    await printAppTool("loopgraph_app_activate", { projectRoot: options.project, installationId, mode: options.mode, workspaceId: options.workspace, companyId: options.company, actor: options.actor });
  });

apps
  .command("replay")
  .description("Run a bounded, read-only historical replay without enabling provider writes")
  .argument("<installation-id>", "Installed app ID")
  .requiredOption("--dataset <path>", "JSON object containing from, to, and normalized historical events")
  .option("--project <root>", "Explicit project root", process.cwd())
  .option("--workspace <id>", "Workspace ID")
  .option("--company <id>", "Company ID")
  .option("--actor <id>", "Accountable replay requester", "cli")
  .action(async (installationId: string, options: { dataset: string; project: string; workspace?: string; company?: string; actor: string }) => {
    const dataset = await readJsonRecord(path.resolve(options.dataset));
    await printAppTool("loopgraph_app_historical_replay", {
      ...dataset,
      projectRoot: options.project,
      installationId,
      workspaceId: options.workspace,
      companyId: options.company,
      actor: options.actor
    });
  });

apps
  .command("label")
  .description("Label one replay decision as correct, incomplete, or false positive")
  .argument("<run-id>", "Evaluation run ID")
  .argument("<scenario-id>", "Replay scenario ID")
  .requiredOption("--label <label>", "correct, incomplete, or false_positive")
  .option("--minutes <number>", "Review time in minutes", "0")
  .option("--notes <text>", "Optional reviewer note")
  .option("--project <root>", "Explicit project root", process.cwd())
  .option("--workspace <id>", "Workspace ID")
  .option("--company <id>", "Company ID")
  .option("--actor <id>", "Accountable reviewer identity", "cli")
  .action(async (runId: string, scenarioId: string, options: { label: string; minutes: string; notes?: string; project: string; workspace?: string; company?: string; actor: string }) => {
    await printAppTool("loopgraph_app_evaluation_label", {
      projectRoot: options.project,
      workspaceId: options.workspace,
      companyId: options.company,
      runId,
      scenarioId,
      label: options.label,
      reviewMinutes: Number(options.minutes),
      notes: options.notes,
      actor: options.actor
    });
  });

apps
  .command("recommendation")
  .description("Derive a non-activating promotion recommendation from app quality evidence")
  .argument("<installation-id>", "Installed app ID")
  .option("--project <root>", "Explicit project root", process.cwd())
  .option("--workspace <id>", "Workspace ID")
  .option("--company <id>", "Company ID")
  .action(async (installationId: string, options: { project: string; workspace?: string; company?: string }) => {
    await printAppTool("loopgraph_app_promotion_recommendation", {
      projectRoot: options.project,
      workspaceId: options.workspace,
      companyId: options.company,
      installationId
    });
  });

apps
  .command("configure")
  .description("Apply confirmed setup values against an exact configuration digest")
  .argument("<installation-id>", "Installed app ID")
  .requiredOption("--values <path>", "JSON object containing confirmed configuration values")
  .requiredOption("--expected <digest>", "Current configuration digest from apps diff")
  .option("--project <root>", "Explicit project root", process.cwd())
  .option("--actor <id>", "Accountable configurer identity", "cli")
  .action(async (installationId: string, options: { values: string; expected: string; project: string; actor: string }) => {
    await printAppTool("loopgraph_app_configure", {
      projectRoot: options.project,
      installationId,
      values: await readJsonRecord(path.resolve(options.values)),
      expectedConfigurationDigest: options.expected,
      actor: options.actor
    });
  });

apps
  .command("overlay")
  .description("Apply a version-bound customization overlay without mutating the base app")
  .argument("<installation-id>", "Installed app ID")
  .requiredOption("--file <path>", "JSON object containing an operations array")
  .requiredOption("--expected <digest>", "Current installed artifact digest")
  .option("--revision <number>", "Expected overlay revision", "0")
  .option("--project <root>", "Explicit project root", process.cwd())
  .option("--actor <id>", "Accountable editor identity", "cli")
  .action(async (installationId: string, options: { file: string; expected: string; revision: string; project: string; actor: string }) => {
    const overlay = await readJsonRecord(path.resolve(options.file));
    await printAppTool("loopgraph_app_overlay_apply", {
      projectRoot: options.project,
      installationId,
      operations: overlay.operations,
      expectedArtifactDigest: options.expected,
      expectedOverlayRevision: Number(options.revision),
      actor: options.actor
    });
  });

apps
  .command("repair")
  .description("Recompile the exact pinned app and return it to write-blocked testing")
  .argument("<installation-id>", "Installed app ID")
  .option("--project <root>", "Explicit project root", process.cwd())
  .option("--actor <id>", "Accountable repair identity", "cli")
  .action(async (installationId: string, options: { project: string; actor: string }) => {
    await printAppTool("loopgraph_app_repair", { projectRoot: options.project, installationId, actor: options.actor });
  });

apps
  .command("duplicate")
  .description("Create a namespaced private derived app with an optional initial overlay")
  .argument("<installation-id>", "Installed app ID")
  .requiredOption("--id <private-app-id>", "Stable private derived app ID")
  .option("--overlay <path>", "JSON object containing an operations array")
  .option("--project <root>", "Explicit project root", process.cwd())
  .option("--actor <id>", "Accountable duplicator identity", "cli")
  .action(async (installationId: string, options: { id: string; overlay?: string; project: string; actor: string }) => {
    const overlay = options.overlay ? await readJsonRecord(path.resolve(options.overlay)) : {};
    await printAppTool("loopgraph_app_duplicate", {
      projectRoot: options.project,
      installationId,
      derivedAppId: options.id,
      overlayOperations: overlay.operations ?? [],
      actor: options.actor
    });
  });

apps
  .command("diff")
  .description("Show base version, private overlay, revision history, and update availability")
  .argument("<installation-id>", "Installed app ID")
  .option("--project <root>", "Explicit project root", process.cwd())
  .action(async (installationId: string, options: { project: string }) => {
    await printAppTool("loopgraph_app_diff", { projectRoot: options.project, installationId });
  });

apps
  .command("update-plan")
  .description("Create a graph, permission, and three-way-overlay update plan")
  .argument("<installation-id>", "Installed app ID")
  .option("--version <range>", "Target semantic version or range", "latest")
  .option("--project <root>", "Explicit project root", process.cwd())
  .option("--actor <id>", "Accountable planner identity", "cli")
  .action(async (installationId: string, options: { version: string; project: string; actor: string }) => {
    await printAppTool("loopgraph_app_update_plan", { projectRoot: options.project, installationId, versionRange: options.version, actor: options.actor });
  });

apps
  .command("update")
  .description("Apply an exact unexpired app update plan after reviewing permission changes")
  .requiredOption("--plan <path>", "Update plan JSON file")
  .option("--approve <capabilities...>", "Explicitly approved changed permission capabilities")
  .option("--project <root>", "Explicit project root", process.cwd())
  .option("--actor <id>", "Accountable updater identity", "cli")
  .action(async (options: { plan: string; approve?: string[]; project: string; actor: string }) => {
    await printAppTool("loopgraph_app_update_apply", {
      projectRoot: options.project,
      plan: await readJsonRecord(path.resolve(options.plan)),
      approvedPermissionCapabilities: options.approve ?? [],
      actor: options.actor
    });
  });

for (const action of ["rollback", "detach"] as const) {
  apps
    .command(action)
    .description(action === "rollback" ? "Restore the exact prior installation revision" : "Pin a local immutable snapshot and stop upstream updates")
    .argument("<installation-id>", "Installed app ID")
    .requiredOption("--expected <digest>", "Current installed artifact digest")
    .option("--project <root>", "Explicit project root", process.cwd())
    .option("--actor <id>", "Accountable actor identity", "cli")
    .action(async (installationId: string, options: { expected: string; project: string; actor: string }) => {
      await printAppTool(action === "rollback" ? "loopgraph_app_rollback" : "loopgraph_app_detach", {
        projectRoot: options.project,
        installationId,
        expectedArtifactDigest: options.expected,
        actor: options.actor
      });
    });
}

apps
  .command("uninstall")
  .description("Remove installation-owned assets while preserving shared resources and evidence")
  .argument("<installation-id>", "Installed app ID")
  .requiredOption("--expected <digest>", "Current installed artifact digest")
  .requiredOption("--reason <text>", "Accountable uninstall reason")
  .option("--yes", "Explicitly confirm the uninstall")
  .option("--project <root>", "Explicit project root", process.cwd())
  .option("--actor <id>", "Accountable uninstaller identity", "cli")
  .action(async (installationId: string, options: { expected: string; reason: string; yes?: boolean; project: string; actor: string }) => {
    if (!options.yes) throw new Error("apps uninstall requires --yes");
    await printAppTool("loopgraph_app_uninstall", {
      projectRoot: options.project,
      installationId,
      expectedArtifactDigest: options.expected,
      reason: options.reason,
      confirmed: true,
      actor: options.actor
    });
  });

apps
  .command("keygen")
  .description("Generate a project-confined Ed25519 publisher key and print only its public trust material")
  .argument("<publisher-id>", "Stable publisher ID")
  .option("--id <key-id>", "Stable publisher key ID")
  .option("--project <root>", "Explicit project root", process.cwd())
  .action(async (publisherId: string, options: { id?: string; project: string }) => {
    await printAppTool("loopgraph_app_publisher_key_generate", { projectRoot: options.project, publisherId, keyId: options.id });
  });

apps
  .command("keys")
  .description("List publisher public keys and private-key availability without printing private key material")
  .option("--project <root>", "Explicit project root", process.cwd())
  .action(async (options: { project: string }) => {
    await printAppTool("loopgraph_app_publisher_keys_get", { projectRoot: options.project });
  });

apps
  .command("init")
  .description("Scaffold a complete private app with Hermes routing, setup, policy, connector, outcomes, and conformance")
  .argument("<destination>", "Project-confined destination directory")
  .requiredOption("--id <app-id>", "Stable app ID")
  .requiredOption("--name <name>", "Human-readable app name")
  .requiredOption("--department <department>", "Department type")
  .requiredOption("--publisher <publisher-id>", "Stable publisher ID")
  .option("--publisher-name <name>", "Human-readable publisher name")
  .option("--summary <text>", "Short business outcome summary")
  .option("--project <root>", "Explicit project root", process.cwd())
  .action(async (destination: string, options: { id: string; name: string; department: string; publisher: string; publisherName?: string; summary?: string; project: string }) => {
    await printAppTool("loopgraph_app_init", {
      projectRoot: options.project,
      destination,
      appId: options.id,
      name: options.name,
      department: options.department,
      publisherId: options.publisher,
      publisherName: options.publisherName,
      summary: options.summary
    });
  });

apps
  .command("capture")
  .description("Capture an installed app as a parameterized private pack without configuration or credential values")
  .argument("<installation-id>", "Installed app ID")
  .argument("<destination>", "Project-confined destination directory")
  .requiredOption("--id <app-id>", "New private app ID")
  .requiredOption("--name <name>", "Human-readable app name")
  .requiredOption("--publisher <publisher-id>", "Stable publisher ID")
  .option("--publisher-name <name>", "Human-readable publisher name")
  .option("--version <version>", "Initial exact semantic version", "0.1.0")
  .option("--workspace <id>", "Workspace ID")
  .option("--project <root>", "Explicit project root", process.cwd())
  .action(async (installationId: string, destination: string, options: { id: string; name: string; publisher: string; publisherName?: string; version: string; workspace?: string; project: string }) => {
    await printAppTool("loopgraph_app_capture", {
      projectRoot: options.project,
      installationId,
      destination,
      derivedAppId: options.id,
      name: options.name,
      publisherId: options.publisher,
      publisherName: options.publisherName,
      version: options.version,
      workspaceId: options.workspace
    });
  });

apps
  .command("validate")
  .description("Validate, compile, secret-scan, and run the write-blocked publisher conformance suite")
  .argument("<pack-root>", "LoopPack directory")
  .option("--project <root>", "Explicit project root", process.cwd())
  .action(async (packRoot: string, options: { project: string }) => {
    const result = await callLoopgraphAppTool("loopgraph_app_validate", { projectRoot: path.resolve(options.project), packRoot });
    console.log(JSON.stringify(result, null, 2));
    if (isRecord(result) && result.ok === false) process.exitCode = 1;
  });

apps
  .command("pack")
  .description("Create a verified content-addressed LoopPack archive")
  .argument("<pack-root>", "LoopPack directory")
  .argument("<destination>", "Project-confined archive path")
  .option("--project <root>", "Explicit project root", process.cwd())
  .action(async (packRoot: string, destination: string, options: { project: string }) => {
    await printAppTool("loopgraph_app_pack", { projectRoot: options.project, packRoot, destination });
  });

apps
  .command("sign")
  .description("Sign the exact immutable pack digest with a project-confined publisher key")
  .argument("<pack-root>", "LoopPack directory")
  .requiredOption("--key <key-id>", "Publisher key ID")
  .option("--project <root>", "Explicit project root", process.cwd())
  .action(async (packRoot: string, options: { key: string; project: string }) => {
    await printAppTool("loopgraph_app_sign", { projectRoot: options.project, packRoot, keyId: options.key });
  });

apps
  .command("publish")
  .description("Publish a signed immutable version to a trusted project-local private catalog")
  .argument("<pack-root>", "LoopPack directory")
  .requiredOption("--catalog <catalog-id>", "Private catalog ID")
  .option("--project <root>", "Explicit project root", process.cwd())
  .action(async (packRoot: string, options: { catalog: string; project: string }) => {
    await printAppTool("loopgraph_app_publish", { projectRoot: options.project, packRoot, catalogId: options.catalog });
  });

for (const releaseAction of ["deprecate", "revoke"] as const) {
  apps
    .command(releaseAction)
    .description(`${releaseAction === "deprecate" ? "Deprecate" : "Revoke"} an exact published app version`)
    .argument("<app-id>", "Published app ID")
    .requiredOption("--version <version>", "Exact published version")
    .requiredOption("--catalog <catalog-id>", "Private catalog ID")
    .requiredOption("--message <text>", "Accountable status explanation")
    .option("--project <root>", "Explicit project root", process.cwd())
    .action(async (appId: string, options: { version: string; catalog: string; message: string; project: string }) => {
      await printAppTool("loopgraph_app_release_status", {
        projectRoot: options.project,
        catalogId: options.catalog,
        appId,
        version: options.version,
        status: releaseAction === "deprecate" ? "deprecated" : "revoked",
        message: options.message
      });
    });
}

apps
  .command("sources")
  .description("List official, local, and private signed marketplace sources")
  .option("--project <root>", "Explicit project root", process.cwd())
  .action(async (options: { project: string }) => {
    await printAppTool("loopgraph_marketplace_sources_get", { projectRoot: options.project });
  });

apps
  .command("source-add")
  .description("Register a catalog source from a JSON contract; signed sources must pin exact public keys")
  .requiredOption("--file <path>", "Marketplace catalog source JSON")
  .option("--project <root>", "Explicit project root", process.cwd())
  .action(async (options: { file: string; project: string }) => {
    await printAppTool("loopgraph_marketplace_source_add", {
      projectRoot: options.project,
      source: await readJsonRecord(path.resolve(options.file))
    });
  });

apps
  .command("source-refresh")
  .description("Revalidate and refresh one marketplace source")
  .argument("<source-id>", "Marketplace source ID")
  .option("--project <root>", "Explicit project root", process.cwd())
  .action(async (sourceId: string, options: { project: string }) => {
    await printAppTool("loopgraph_marketplace_source_refresh", { projectRoot: options.project, sourceId });
  });

measurementBindings
  .command("set")
  .description("Create or revise one exact metric-to-provider binding from a JSON contract")
  .requiredOption("--file <path>", "Metric binding JSON file")
  .option("--project <root>", "Explicit project root", process.cwd())
  .action(async (options: { file: string; project: string }) => {
    await printMeasurementTool(
      "loopgraph_metric_bindings_set",
      await readJsonRecord(path.resolve(options.file)),
      options.project
    );
  });

measurementBindings
  .command("list")
  .description("List metric bindings, optionally for one loop")
  .option("--project <root>", "Explicit project root", process.cwd())
  .option("--loop <id>", "Filter by loop ID")
  .option("--binding <id>", "Read one binding")
  .action(async (options: { project: string; loop?: string; binding?: string }) => {
    await printMeasurementTool("loopgraph_metric_bindings_get", {
      loopId: options.loop,
      bindingId: options.binding
    }, options.project);
  });

measurements
  .command("schedule")
  .description("Create idempotent due measurement jobs from enabled bindings")
  .option("--project <root>", "Explicit project root", process.cwd())
  .option("--binding <id>", "Schedule one binding")
  .option("--backfill <windows>", "Number of aligned windows to consider", "1")
  .option("--max-attempts <count>", "Maximum collection attempts", "3")
  .action(async (options: {
    project: string;
    binding?: string;
    backfill: string;
    maxAttempts: string;
  }) => {
    await printMeasurementTool("loopgraph_measurements_schedule", {
      bindingId: options.binding,
      backfillWindows: parsePositiveInteger(options.backfill, "Measurement backfill"),
      maxAttempts: parsePositiveInteger(options.maxAttempts, "Measurement max attempts")
    }, options.project);
  });

measurementJobs
  .command("list")
  .description("Inspect measurement jobs, results, leases, and failures")
  .option("--project <root>", "Explicit project root", process.cwd())
  .option("--job <id>", "Read one job")
  .option("--loop <id>", "Filter by loop")
  .option("--binding <id>", "Filter by binding")
  .option("--connection <id>", "Filter by connector instance")
  .option("--status <status>", "Filter by job status")
  .action(async (options: {
    project: string;
    job?: string;
    loop?: string;
    binding?: string;
    connection?: string;
    status?: string;
  }) => {
    await printMeasurementTool("loopgraph_measurement_jobs_get", {
      jobId: options.job,
      loopId: options.loop,
      bindingId: options.binding,
      connectionInstanceId: options.connection,
      status: options.status
    }, options.project);
  });

measurementJobs
  .command("claim")
  .description("Claim due jobs for a trusted Hermes metric collector")
  .requiredOption("--by <id>", "Stable collector identity")
  .option("--project <root>", "Explicit project root", process.cwd())
  .option("--connection <id>", "Only claim jobs for one connector")
  .option("--limit <count>", "Maximum claims", "20")
  .option("--lease-seconds <seconds>", "Lease duration", "300")
  .action(async (options: {
    project: string;
    by: string;
    connection?: string;
    limit: string;
    leaseSeconds: string;
  }) => {
    await printMeasurementTool("loopgraph_measurement_jobs_claim", {
      claimedBy: options.by,
      connectionInstanceId: options.connection,
      limit: parsePositiveInteger(options.limit, "Measurement claim limit"),
      leaseSeconds: parsePositiveInteger(options.leaseSeconds, "Measurement lease seconds")
    }, options.project);
  });

measurementJobs
  .command("complete")
  .description("Complete a claimed job from a JSON result containing jobId, leaseToken, value, observedAt, and evidenceRefs")
  .requiredOption("--file <path>", "Measurement result JSON file")
  .option("--project <root>", "Explicit project root", process.cwd())
  .action(async (options: { file: string; project: string }) => {
    await printMeasurementTool(
      "loopgraph_measurement_jobs_complete",
      await readJsonRecord(path.resolve(options.file)),
      options.project
    );
  });

measurementJobs
  .command("fail")
  .description("Fail or dead-letter a claimed measurement job")
  .requiredOption("--job <id>", "Measurement job ID")
  .requiredOption("--lease <token>", "Opaque claim lease token")
  .requiredOption("--code <code>", "Stable failure code")
  .requiredOption("--message <text>", "Auditable failure explanation")
  .option("--project <root>", "Explicit project root", process.cwd())
  .option("--no-retry", "Move directly to dead letter")
  .action(async (options: {
    project: string;
    job: string;
    lease: string;
    code: string;
    message: string;
    retry: boolean;
  }) => {
    await printMeasurementTool("loopgraph_measurement_jobs_fail", {
      jobId: options.job,
      leaseToken: options.lease,
      code: options.code,
      message: options.message,
      retryable: options.retry
    }, options.project);
  });

connections
  .command("register")
  .description("Register non-secret connector metadata from JSON; credentials remain in Hermes")
  .requiredOption("--file <path>", "Connection instance JSON file")
  .option("--project <root>", "Explicit project root", process.cwd())
  .action(async (options: { file: string; project: string }) => {
    await printConnectionTool(
      "loopgraph_connections_register",
      await readJsonRecord(path.resolve(options.file)),
      options.project
    );
  });

connections
  .command("health")
  .description("Record a non-secret Hermes connector health receipt from JSON")
  .requiredOption("--file <path>", "Connection health receipt JSON file")
  .option("--project <root>", "Explicit project root", process.cwd())
  .action(async (options: { file: string; project: string }) => {
    await printConnectionTool(
      "loopgraph_connections_health_report",
      await readJsonRecord(path.resolve(options.file)),
      options.project
    );
  });

connections
  .command("list")
  .description("List registered connection metadata and health receipts")
  .option("--project <root>", "Explicit project root", process.cwd())
  .option("--connection <id>", "Read one connector instance")
  .action(async (options: { project: string; connection?: string }) => {
    await printConnectionTool("loopgraph_connections_get", {
      instanceId: options.connection
    }, options.project);
  });

connections
  .command("reconcile")
  .description("Reconcile metric bindings, scopes, health, Hermes routes, and overdue jobs")
  .option("--project <root>", "Explicit project root", process.cwd())
  .option("--health-stale-hours <hours>", "Health evidence staleness threshold", "24")
  .option("--overdue-hours <hours>", "Measurement overdue threshold", "24")
  .action(async (options: {
    project: string;
    healthStaleHours: string;
    overdueHours: string;
  }) => {
    await printMeasurementTool("loopgraph_connections_reconcile", {
      healthStaleAfterHours: parsePositiveInteger(options.healthStaleHours, "Health stale hours"),
      measurementOverdueAfterHours: parsePositiveInteger(options.overdueHours, "Measurement overdue hours")
    }, options.project);
  });

connections
  .command("reports")
  .description("Read durable connection reconciliation reports")
  .option("--project <root>", "Explicit project root", process.cwd())
  .option("--report <id>", "Read one report")
  .action(async (options: { project: string; report?: string }) => {
    await printMeasurementTool("loopgraph_connections_reconciliations_get", {
      reportId: options.report
    }, options.project);
  });

graph
  .command("history")
  .description("Read semantic graph snapshots, approvals, transactions, promotions, and rollbacks")
  .option("--project <root>", "Explicit project root", process.cwd())
  .option("--transaction <id>", "Read one transaction")
  .option("--snapshot <id>", "Read one graph snapshot")
  .option("--approval <id>", "Read one graph approval receipt")
  .option("--promotion <id>", "Read one loop promotion receipt")
  .option("--change-set <id>", "Filter approval receipts by graph change set")
  .option("--loop <id>", "Filter promotion receipts by loop")
  .action(async (options: {
    project: string;
    transaction?: string;
    snapshot?: string;
    approval?: string;
    promotion?: string;
    changeSet?: string;
    loop?: string;
  }) => {
    await printSemanticGraphTool("loopgraph_graph_history_get", {
      transactionId: options.transaction,
      snapshotId: options.snapshot,
      approvalReceiptId: options.approval,
      promotionReceiptId: options.promotion,
      changeSetId: options.changeSet,
      loopId: options.loop
    }, options.project);
  });

graphChange
  .command("decide")
  .description("Record an accountable approval or rejection for an exact graph change set")
  .argument("<changeSetId>", "Graph change set ID")
  .requiredOption("--decision <decision>", "approved or rejected")
  .option("--approved-changes <ids>", "Comma-separated approved change IDs; defaults to all operations")
  .requiredOption("--actor <id>", "Accountable actor ID")
  .requiredOption("--role <role>", "Accountable actor role")
  .requiredOption("--policy <version>", "Approval policy version")
  .requiredOption("--reason <reason>", "Human-readable decision reason")
  .option("--evidence <refs>", "Comma-separated evidence references")
  .option("--project <root>", "Explicit project root", process.cwd())
  .action(async (changeSetId: string, options: {
    decision: string;
    approvedChanges?: string;
    actor: string;
    role: string;
    policy: string;
    reason: string;
    evidence?: string;
    project: string;
  }) => {
    await printSemanticGraphTool("loopgraph_graph_change_decide", {
      changeSetId,
      decision: options.decision,
      approvedChangeIds: commaSeparated(options.approvedChanges),
      actorId: options.actor,
      actorRole: options.role,
      policyVersion: options.policy,
      reason: options.reason,
      evidenceRefs: commaSeparated(options.evidence)
    }, options.project);
  });

graphChange
  .command("apply")
  .description("Atomically apply an approved semantic graph change set")
  .argument("<changeSetId>", "Graph change set ID")
  .requiredOption("--approval <id>", "Exact graph approval receipt ID")
  .option("--design-run <id>", "Validated design run ID")
  .option("--proposals <ids>", "Comma-separated accepted proposal IDs")
  .option("--proposal-map <json>", "JSON object mapping change IDs to accepted proposal ID arrays")
  .requiredOption("--by <id>", "Actor initiating the transaction")
  .option("--project <root>", "Explicit project root", process.cwd())
  .action(async (changeSetId: string, options: {
    approval: string;
    designRun?: string;
    proposals?: string;
    proposalMap?: string;
    by: string;
    project: string;
  }) => {
    await printSemanticGraphTool("loopgraph_graph_change_apply", {
      changeSetId,
      approvalReceiptId: options.approval,
      designRunId: options.designRun,
      acceptedProposalIds: commaSeparated(options.proposals),
      proposalIdsByChangeId: parseStringArrayRecord(options.proposalMap),
      initiatedBy: options.by
    }, options.project);
  });

graphPromotion
  .command("rehearse")
  .description("Run and persist the complete promotion gate against the current LoopSpec and graph")
  .argument("<loopId>", "Registered LoopSpec ID")
  .requiredOption("--to <mode>", "The next ordered activation mode")
  .option("--by <id>", "Actor or service generating the rehearsal", "loopgraph-cli")
  .option("--valid-for <seconds>", "Validity window in seconds", parseIntegerOption)
  .option("--project <root>", "Explicit project root", process.cwd())
  .action(async (loopId: string, options: {
    to: string;
    by: string;
    validFor?: number;
    project: string;
  }) => {
    await printSemanticGraphTool("loopgraph_promotion_rehearsal_run", {
      loopId,
      targetMode: options.to,
      generatedBy: options.by,
      validForSeconds: options.validFor
    }, options.project);
  });

graphPromotion
  .command("approve")
  .description("Approve the next ordered activation mode for one loop")
  .argument("<loopId>", "Registered LoopSpec ID")
  .requiredOption("--to <mode>", "simulate, shadow, recommend, execute_with_approval, or autonomous_low_risk")
  .requiredOption("--actor <id>", "Accountable actor ID")
  .requiredOption("--role <role>", "Accountable actor role")
  .requiredOption("--policy <version>", "Promotion policy version")
  .requiredOption("--reason <reason>", "Human-readable decision reason")
  .requiredOption("--rehearsal <id>", "Passing promotion rehearsal report ID")
  .option("--evidence <refs>", "Comma-separated evidence references")
  .option("--project <root>", "Explicit project root", process.cwd())
  .action(async (loopId: string, options: {
    to: string;
    actor: string;
    role: string;
    policy: string;
    reason: string;
    rehearsal: string;
    evidence?: string;
    project: string;
  }) => {
    await printSemanticGraphTool("loopgraph_loop_promotion_approve", {
      loopId,
      nextMode: options.to,
      actorId: options.actor,
      actorRole: options.role,
      policyVersion: options.policy,
      reason: options.reason,
      rehearsalReportId: options.rehearsal,
      evidenceRefs: commaSeparated(options.evidence)
    }, options.project);
  });

graphPromotion
  .command("apply")
  .description("Apply an approved promotion with durable gate evidence")
  .argument("<loopId>", "Registered LoopSpec ID")
  .requiredOption("--to <mode>", "Approved next activation mode")
  .requiredOption("--approval <id>", "Exact promotion approval receipt ID")
  .requiredOption("--rehearsal <id>", "Passing rehearsal report bound to the approval")
  .option("--gate-evidence <refs>", "Additional durable evidence references")
  .requiredOption("--by <id>", "Actor initiating the transaction")
  .option("--project <root>", "Explicit project root", process.cwd())
  .action(async (loopId: string, options: {
    to: string;
    approval: string;
    rehearsal: string;
    gateEvidence?: string;
    by: string;
    project: string;
  }) => {
    await printSemanticGraphTool("loopgraph_loop_promote", {
      loopId,
      nextMode: options.to,
      approvalReceiptId: options.approval,
      rehearsalReportId: options.rehearsal,
      gateEvidenceRefs: commaSeparated(options.gateEvidence),
      initiatedBy: options.by
    }, options.project);
  });

graphLifecycle
  .command("approve")
  .description("Approve pausing or resuming one registered loop")
  .argument("<loopId>", "Registered LoopSpec ID")
  .requiredOption("--status <status>", "active or paused")
  .requiredOption("--actor <id>", "Accountable actor ID")
  .requiredOption("--role <role>", "Accountable actor role")
  .requiredOption("--policy <version>", "Lifecycle policy version")
  .requiredOption("--reason <reason>", "Human-readable decision reason")
  .option("--evidence <refs>", "Comma-separated evidence references")
  .option("--project <root>", "Explicit project root", process.cwd())
  .action(async (loopId: string, options: {
    status: string;
    actor: string;
    role: string;
    policy: string;
    reason: string;
    evidence?: string;
    project: string;
  }) => {
    await printSemanticGraphTool("loopgraph_loop_lifecycle_approve", {
      loopId,
      nextStatus: options.status,
      actorId: options.actor,
      actorRole: options.role,
      policyVersion: options.policy,
      reason: options.reason,
      evidenceRefs: commaSeparated(options.evidence)
    }, options.project);
  });

graphLifecycle
  .command("apply")
  .description("Apply an approved loop pause or resume transaction")
  .argument("<loopId>", "Registered LoopSpec ID")
  .requiredOption("--status <status>", "active or paused")
  .requiredOption("--approval <id>", "Exact lifecycle approval receipt ID")
  .requiredOption("--by <id>", "Actor initiating the transaction")
  .option("--project <root>", "Explicit project root", process.cwd())
  .action(async (loopId: string, options: {
    status: string;
    approval: string;
    by: string;
    project: string;
  }) => {
    await printSemanticGraphTool("loopgraph_loop_lifecycle_set", {
      loopId,
      nextStatus: options.status,
      approvalReceiptId: options.approval,
      initiatedBy: options.by
    }, options.project);
  });

graphRollback
  .command("approve")
  .description("Approve restoring the exact base snapshot of a graph transaction")
  .argument("<transactionId>", "Committed graph transaction ID")
  .requiredOption("--actor <id>", "Accountable actor ID")
  .requiredOption("--role <role>", "Accountable actor role")
  .requiredOption("--policy <version>", "Rollback policy version")
  .requiredOption("--reason <reason>", "Human-readable decision reason")
  .option("--evidence <refs>", "Comma-separated evidence references")
  .option("--project <root>", "Explicit project root", process.cwd())
  .action(async (transactionId: string, options: {
    actor: string;
    role: string;
    policy: string;
    reason: string;
    evidence?: string;
    project: string;
  }) => {
    await printSemanticGraphTool("loopgraph_graph_rollback_approve", {
      transactionId,
      actorId: options.actor,
      actorRole: options.role,
      policyVersion: options.policy,
      reason: options.reason,
      evidenceRefs: commaSeparated(options.evidence)
    }, options.project);
  });

graphRollback
  .command("apply")
  .description("Restore an exact pre-transaction graph snapshot")
  .argument("<transactionId>", "Committed graph transaction ID")
  .requiredOption("--approval <id>", "Exact rollback approval receipt ID")
  .requiredOption("--by <id>", "Actor initiating the rollback")
  .option("--project <root>", "Explicit project root", process.cwd())
  .action(async (transactionId: string, options: {
    approval: string;
    by: string;
    project: string;
  }) => {
    await printSemanticGraphTool("loopgraph_graph_rollback", {
      transactionId,
      approvalReceiptId: options.approval,
      initiatedBy: options.by
    }, options.project);
  });

workspace
  .command("init")
  .description("Initialize a project-local .loopgraph workspace")
  .option("--project <root>", "Explicit project root", process.cwd())
  .option("--display-name <name>", "Workspace display name")
  .option("--demo-catalog", "Enable demo catalog content in an otherwise empty workspace")
  .action(async (options: { project: string; displayName?: string; demoCatalog?: boolean }) => {
    const registry = await initLoopgraphWorkspace({
      projectRoot: path.resolve(options.project),
      displayName: options.displayName,
      demoCatalogEnabled: Boolean(options.demoCatalog),
      createdBy: "cli"
    });
    console.log(JSON.stringify(registry, null, 2));
  });

opportunities
  .command("scan")
  .description("Scan once or continuously for explainable loop opportunities and governed Hermes design tasks")
  .option("--project <root>", "Explicit project root", process.cwd())
  .option("--qualify-threshold <score>", "Minimum score to qualify an opportunity", "45")
  .option("--auto-design-threshold <score>", "Minimum score to start a draft Hermes design task", "65")
  .option("--no-auto-start-design", "Detect and score without starting Hermes design tasks")
  .option("--watch", "Keep scanning the local workspace on an interval")
  .option("--interval <seconds>", "Watch interval in seconds", "900")
  .action(async (options: {
    project: string;
    qualifyThreshold: string;
    autoDesignThreshold: string;
    autoStartDesign: boolean;
    watch?: boolean;
    interval: string;
  }) => {
    const projectRoot = path.resolve(options.project);
    const qualifyThreshold = Number(options.qualifyThreshold);
    const autoDesignThreshold = Number(options.autoDesignThreshold);
    const intervalSeconds = Number(options.interval);
    if (!Number.isFinite(qualifyThreshold) || !Number.isFinite(autoDesignThreshold)) {
      throw new Error("Opportunity thresholds must be finite numbers from 0 to 100.");
    }
    if (!Number.isFinite(intervalSeconds) || intervalSeconds < 30) {
      throw new Error("Opportunity watch interval must be at least 30 seconds.");
    }
    const runScan = async () => {
      const result = await scanLoopOpportunities({
        projectRoot,
        thresholds: {
          qualify: qualifyThreshold,
          autoDesign: autoDesignThreshold
        },
        autoStartDesign: options.autoStartDesign
      });
      console.log(JSON.stringify(result, null, 2));
    };
    await runScan();
    if (!options.watch) return;
    const intervalMs = intervalSeconds * 1000;
    console.error(`Watching ${projectRoot} for loop opportunities every ${intervalMs / 1000} seconds.`);
    await new Promise<void>((resolve, reject) => {
      const timer = setInterval(() => {
        void runScan().catch((error) => {
          clearInterval(timer);
          reject(error);
        });
      }, intervalMs);
      process.once("SIGINT", () => {
        clearInterval(timer);
        resolve();
      });
      process.once("SIGTERM", () => {
        clearInterval(timer);
        resolve();
      });
    });
  });

controller
  .command("run")
  .description("Evaluate durable evidence and take the next policy-bounded loop action")
  .option("--project <root>", "Explicit project root", process.cwd())
  .option("--trigger-type <type>", "manual, schedule, routing_event, route_job, review, outcome_window, connector_health, or management_cycle", "manual")
  .option("--trigger-id <id>", "Stable idempotency identity for this trigger")
  .option("--source-ref <ref>", "Auditable source reference", "loopgraph-cli")
  .option("--watch", "Keep running controller cycles on an interval")
  .option("--interval <seconds>", "Watch interval in seconds", "900")
  .action(async (options: {
    project: string;
    triggerType: string;
    triggerId?: string;
    sourceRef: string;
    watch?: boolean;
    interval: string;
  }) => {
    const projectRoot = path.resolve(options.project);
    const intervalSeconds = Number(options.interval);
    if (!Number.isFinite(intervalSeconds) || intervalSeconds < 30) {
      throw new Error("Controller watch interval must be at least 30 seconds.");
    }
    let sequence = 0;
    const runOnce = async () => {
      const triggerId = options.triggerId ?? `${options.triggerType}_${Date.now()}_${sequence++}`;
      const enqueue = await enqueueLoopControllerTrigger({
        projectRoot,
        type: options.triggerType as LoopControllerTriggerType,
        triggerId,
        sourceRef: options.sourceRef,
        requestedBy: "loopgraph-cli"
      });
      const scheduler = await runLoopControllerScheduler({ projectRoot, limit: 20 });
      console.log(JSON.stringify({ enqueue, scheduler }, null, 2));
    };
    await runOnce();
    if (!options.watch) return;
    await new Promise<void>((resolve, reject) => {
      const timer = setInterval(() => {
        void runOnce().catch((error) => {
          clearInterval(timer);
          reject(error);
        });
      }, intervalSeconds * 1000);
      process.once("SIGINT", () => {
        clearInterval(timer);
        resolve();
      });
      process.once("SIGTERM", () => {
        clearInterval(timer);
        resolve();
      });
    });
  });

controller
  .command("status")
  .description("Show the current policy, checkpoint, and recent controller decisions")
  .option("--project <root>", "Explicit project root", process.cwd())
  .option("--limit <count>", "Maximum recent runs to show", "10")
  .action(async (options: { project: string; limit: string }) => {
    const projectRoot = path.resolve(options.project);
    const limit = parsePositiveInteger(options.limit, "Controller status limit");
    const store = new FileLoopControllerStore(getLoopgraphRoot(projectRoot));
    const [policy, checkpoint, runs, triggers] = await Promise.all([
      store.readPolicy(),
      store.readCheckpoint(),
      store.listRuns(),
      store.listTriggers()
    ]);
    console.log(JSON.stringify({
      policy,
      checkpoint,
      runs: runs.slice(0, limit),
      triggers: triggers.slice(-limit)
    }, null, 2));
  });

opportunities
  .command("list")
  .description("List persisted loop opportunities and their score explanations")
  .option("--project <root>", "Explicit project root", process.cwd())
  .option("--minimum-score <score>", "Only show opportunities at or above this score")
  .action(async (options: { project: string; minimumScore?: string }) => {
    const minimumScore = options.minimumScore === undefined ? undefined : Number(options.minimumScore);
    const result = await listLoopOpportunities(path.resolve(options.project), {
      minimumScore: minimumScore !== undefined && Number.isFinite(minimumScore) ? minimumScore : undefined
    });
    console.log(JSON.stringify({ opportunities: result }, null, 2));
  });

worker
  .command("run")
  .description("Claim due route jobs and execute each governed LoopSpec through its configured activation mode")
  .option("--project <root>", "Explicit project root", process.cwd())
  .option("--worker-id <id>", "Stable worker identity", `worker_${process.pid}`)
  .option("--limit <count>", "Maximum jobs per poll", "10")
  .option("--lease-seconds <seconds>", "Lease duration for each claimed job", "300")
  .option("--watch", "Keep polling until interrupted")
  .option("--interval <seconds>", "Watch polling interval in seconds", "5")
  .action(async (options: {
    project: string;
    workerId: string;
    limit: string;
    leaseSeconds: string;
    watch?: boolean;
    interval: string;
  }) => {
    const projectRoot = path.resolve(options.project);
    const limit = parsePositiveInteger(options.limit, "Worker limit");
    const leaseSeconds = parsePositiveInteger(options.leaseSeconds, "Worker lease seconds");
    const intervalSeconds = parsePositiveInteger(options.interval, "Worker interval seconds");
    const runOnce = async () => {
      const result = await runRouteJobWorker({
        projectRoot,
        workerId: options.workerId,
        limit,
        leaseSeconds
      });
      console.log(JSON.stringify(result, null, 2));
    };
    await runOnce();
    if (!options.watch) return;
    await new Promise<void>((resolve, reject) => {
      const timer = setInterval(() => {
        void runOnce().catch((error) => {
          clearInterval(timer);
          reject(error);
        });
      }, intervalSeconds * 1000);
      process.once("SIGINT", () => {
        clearInterval(timer);
        resolve();
      });
      process.once("SIGTERM", () => {
        clearInterval(timer);
        resolve();
      });
    });
  });

worker
  .command("retry")
  .description("Explicitly requeue one failed or dead-letter route job")
  .requiredOption("--job <id>", "Route job ID")
  .requiredOption("--reason <text>", "Auditable retry reason")
  .option("--project <root>", "Explicit project root", process.cwd())
  .option("--by <name>", "Operator requesting the retry", "operator")
  .action(async (options: { project: string; job: string; reason: string; by: string }) => {
    const projectRoot = path.resolve(options.project);
    const job = await retryRouteJob({
      store: new FileRoutingStore(getLoopgraphRoot(projectRoot)),
      jobId: options.job,
      reason: options.reason,
      requestedBy: options.by
    });
    console.log(JSON.stringify(job, null, 2));
  });

worker
  .command("cancel")
  .description("Cancel one non-completed route job")
  .requiredOption("--job <id>", "Route job ID")
  .requiredOption("--reason <text>", "Auditable cancellation reason")
  .option("--project <root>", "Explicit project root", process.cwd())
  .option("--by <name>", "Operator cancelling the job", "operator")
  .action(async (options: { project: string; job: string; reason: string; by: string }) => {
    const projectRoot = path.resolve(options.project);
    const job = await cancelRouteJob({
      store: new FileRoutingStore(getLoopgraphRoot(projectRoot)),
      jobId: options.job,
      reason: options.reason,
      cancelledBy: options.by
    });
    console.log(JSON.stringify(job, null, 2));
  });

workspace
  .command("inspect")
  .description("Inspect the project-local .loopgraph workspace")
  .option("--project <root>", "Explicit project root", process.cwd())
  .action(async (options: { project: string }) => {
    const result = await inspectLoopgraphWorkspace({
      projectRoot: path.resolve(options.project)
    });
    console.log(JSON.stringify(result, null, 2));
  });

program
  .command("studio")
  .description("Prepare or start the local Loopgraph Hermes Brain studio for an explicit project root")
  .option("--project <root>", "Explicit project root", process.cwd())
  .option("--host <host>", "Host for the local Next.js studio", "localhost")
  .option("--port <port>", "Port for the local Next.js studio", "3000")
  .option("--start", "Start the local studio dev server from a Loopgraph repository clone")
  .option("--json", "Print the launch plan as JSON")
  .action(async (options: { project: string; host: string; port: string; start?: boolean; json?: boolean }) => {
    const plan = await prepareLoopgraphStudio({
      projectRoot: path.resolve(options.project),
      host: options.host,
      port: options.port,
      searchRoots: [
        process.cwd(),
        packageRoot,
        path.resolve(packageRoot, "..", "..")
      ]
    });

    if (options.json) {
      console.log(JSON.stringify(plan, null, 2));
    } else {
      printStudioPlan(plan);
    }

    if (!options.start) return;

    if (!plan.start) {
      console.error("Cannot start the studio app from this installation.");
      console.error("Run this command from a Loopgraph repository clone that contains app/brain/page.tsx.");
      process.exit(1);
    }

    await startStudioServer(plan);
  });

const mcp = program.command("mcp").description("Model Context Protocol server commands");

mcp
  .command("serve")
  .description("Run the Loopgraph stdio MCP server")
  .option("--project <root>", "Explicit project root", process.cwd())
  .option("--stdio", "Use stdio transport")
  .option("--exposure <profile>", "Tool exposure profile: admin, webhook_router, or lifecycle_router", "admin")
  .action(async (options: { project: string; stdio?: boolean; exposure?: string }) => {
    await runLoopgraphMcpStdioServer({
      projectRoot: path.resolve(options.project),
      exposure: normalizeLoopgraphMcpExposure(options.exposure)
    });
  });

const hermes = program.command("hermes").description("Hermes integration utilities");
const hermesWebhooks = hermes.command("webhooks").description("Hermes webhook gateway route planning");
const hermesEvents = hermes.command("events").description("Hermes durable event utilities");
const hermesRouting = hermes.command("routing").description("Hermes local routing tests");
const hermesProviders = hermes.command("providers").description("Hermes-owned OAuth, subscriptions, and event normalization");

hermes
  .command("setup")
  .description("Initialize, install, and check the project-local Hermes Brain integration")
  .option("--project <root>", "Explicit project root", process.cwd())
  .option("--scope <scope>", "Install scope (project)", "project")
  .option("--activate", "Register MCP servers and the GitHub-hosted skill with Hermes")
  .option("--json", "Print the setup result as JSON")
  .action(async (options: { project: string; scope: string; json?: boolean; activate?: boolean }) => {
    await runHermesSetup(options);
  });

hermesProviders
  .command("list")
  .description("List executable provider onboarding profiles without secrets")
  .action(() => console.log(JSON.stringify({ providers: PROVIDER_ONBOARDING_CATALOG }, null, 2)));

hermesProviders
  .command("prepare")
  .description("Prepare OAuth/app installation state for Hermes to complete in its credential store")
  .requiredOption("--provider <id>", "Provider ID")
  .requiredOption("--workspace <id>", "Workspace ID")
  .requiredOption("--company <id>", "Company ID")
  .option("--redirect-uri <url>", "Hermes OAuth callback URL")
  .action((options: { provider: string; workspace: string; company: string; redirectUri?: string }) => {
    const result = prepareProviderInstallation({ providerId: providerIdSchema.parse(options.provider), workspaceId: options.workspace, companyId: options.company, redirectUri: options.redirectUri });
    console.log(JSON.stringify({
      ...result,
      nextAction: "Open consent through the broker OAuth start endpoint."
    }, null, 2));
  });

hermesProviders
  .command("normalize")
  .description("Normalize one verified provider fixture into the EventEnvelope Hermes submits to Loopgraph")
  .requiredOption("--provider <id>", "Provider ID")
  .requiredOption("--input <file>", "Provider fixture JSON")
  .requiredOption("--workspace <id>", "Workspace ID")
  .requiredOption("--company <id>", "Company ID")
  .requiredOption("--delivery <id>", "Stable provider delivery ID")
  .option("--verified", "Mark signature verification complete")
  .action(async (options: { provider: string; input: string; workspace: string; company: string; delivery: string; verified?: boolean }) => {
    const payload = JSON.parse(await readFile(path.resolve(options.input), "utf8")) as unknown;
    const event = normalizeProviderEvent({ providerId: providerIdSchema.parse(options.provider), workspaceId: options.workspace, companyId: options.company, sourceRoute: `hermes-${options.provider}`, deliveryId: options.delivery, signatureVerified: Boolean(options.verified), signer: options.verified ? options.provider : undefined }, payload);
    console.log(JSON.stringify(event, null, 2));
  });

hermes
  .command("install")
  .description("Install the project-local Hermes Brain integration")
  .option("--project <root>", "Explicit project root", process.cwd())
  .option("--scope <scope>", "Install scope (project)", "project")
  .action(async (options: { project: string; scope: string }) => {
    await runHermesInstall(options);
  });

hermes
  .command("doctor")
  .description("Verify the project-local Hermes Brain integration")
  .option("--project <root>", "Explicit project root", process.cwd())
  .action(async (options: { project: string }) => {
    await runHermesDoctor(options);
  });

hermesWebhooks
  .command("plan")
  .description("Plan non-secret Hermes webhook routes from registered Loopgraph routing contracts")
  .option("--project <root>", "Explicit project root", process.cwd())
  .action(async (options: { project: string }) => {
    const result = await planHermesWebhookRoutes({
      projectRoot: path.resolve(options.project)
    });
    console.log(JSON.stringify(result, null, 2));
  });

hermesWebhooks
  .command("sync")
  .description("Write the project-local non-secret Hermes route manifest from registered Loopgraph routing contracts")
  .option("--project <root>", "Explicit project root", process.cwd())
  .option("--dry-run", "Preview the manifest and diff summary without writing .loopgraph/hermes-routes.json")
  .action(async (options: { project: string; dryRun?: boolean }) => {
    const result = await syncHermesWebhookRoutes({
      projectRoot: path.resolve(options.project),
      dryRun: Boolean(options.dryRun)
    });
    console.log(JSON.stringify(result, null, 2));
  });

hermesWebhooks
  .command("doctor")
  .description("Verify the project-local Hermes route manifest matches registered Loopgraph routing contracts")
  .option("--project <root>", "Explicit project root", process.cwd())
  .action(async (options: { project: string }) => {
    const result = await doctorHermesWebhookRoutes({
      projectRoot: path.resolve(options.project)
    });
    console.log(JSON.stringify(result, null, 2));
    if (!result.ok) process.exit(1);
  });

hermesWebhooks
  .command("test")
  .description("Test a normalized fixture against planned Hermes routes and local Loopgraph shadow routing")
  .requiredOption("--fixture <file>", "EventEnvelope JSON path or generated Loopgraph fixture JSON path")
  .option("--project <root>", "Explicit project root", process.cwd())
  .option("--source <pattern>", "Require the fixture source to match this source pattern")
  .option("--expected-action <action>", "Expected route action")
  .option("--expected-loop <loopId>", "Expected selected loop ID; may be repeated by using --expected-loops")
  .option("--expected-loops <ids>", "Comma-separated expected selected loop IDs")
  .option("--require-synced-manifest", "Require .loopgraph/hermes-routes.json to match the current route plan")
  .action(async (options: HermesWebhookFixtureCliOptions) => {
    await runHermesWebhookFixtureTest(options);
  });

hermesEvents
  .command("test")
  .description("Test a normalized event fixture as if it arrived through Hermes")
  .requiredOption("--fixture <file>", "EventEnvelope JSON path or generated Loopgraph fixture JSON path")
  .option("--project <root>", "Explicit project root", process.cwd())
  .option("--source <pattern>", "Require the fixture source to match this source pattern")
  .option("--expected-action <action>", "Expected route action")
  .option("--expected-loop <loopId>", "Expected selected loop ID; may be repeated by using --expected-loops")
  .option("--expected-loops <ids>", "Comma-separated expected selected loop IDs")
  .option("--require-synced-manifest", "Require .loopgraph/hermes-routes.json to match the current route plan")
  .action(async (options: HermesWebhookFixtureCliOptions) => {
    await runHermesWebhookFixtureTest(options);
  });

hermesRouting
  .command("test")
  .description("Ingest a normalized Hermes event or generated fixture and commit a local shadow routing decision")
  .requiredOption("--event <file>", "EventEnvelope JSON path or generated Loopgraph fixture JSON path")
  .option("--project <root>", "Explicit project root", process.cwd())
  .option("--expected-loop <loopId>", "Fail if the local shadow route does not select this loop")
  .option("--replay", "Replay the event instead of treating a matching receipt as a duplicate")
  .action(async (options: { event: string; project: string; expectedLoop?: string; replay?: boolean }) => {
    const result = await runHermesLocalRouteTest({
      projectRoot: path.resolve(options.project),
      event: path.resolve(options.event),
      expectedLoopId: options.expectedLoop,
      replay: Boolean(options.replay)
    });
    console.log(JSON.stringify(result, null, 2));
    if (!result.valid) process.exit(1);
  });

hermesRouting
  .command("evaluate")
  .description("Run a trusted Hermes routing fixture batch and report the shadow-to-recommend promotion gate")
  .requiredOption("--fixtures <file>", "JSON fixture array, or an object with a fixtures array")
  .option("--project <root>", "Explicit project root", process.cwd())
  .action(async (options: { fixtures: string; project: string }) => {
    const fixtures = await readRoutingEvaluationFixtures(path.resolve(options.fixtures));
    const result = await runHermesRoutingEvaluation({
      projectRoot: path.resolve(options.project),
      fixtures
    });
    console.log(JSON.stringify(result, null, 2));
    if (!result.gate.passed) process.exit(1);
  });

hermesRouting
  .command("simulate")
  .description("Run a validated Hermes route commit through local Loopgraph simulation and link the trace")
  .requiredOption("--route-commit <id>", "Route commit ID to simulate")
  .option("--project <root>", "Explicit project root", process.cwd())
  .option("--by <name>", "Human/operator approving the local simulation", "operator")
  .action(async (options: { routeCommit: string; project: string; by: string }) => {
    const result = await loopgraph_route_commit_simulate({
      projectRoot: path.resolve(options.project),
      routeCommitId: options.routeCommit,
      simulatedBy: options.by
    });
    console.log(JSON.stringify(result, null, 2));
    if (!result.valid) process.exit(1);
  });

hermesEvents
  .command("replay")
  .description("Replay a stored normalized Hermes event through durable ingest without raw payloads")
  .requiredOption("--event-id <id>", "Event ID or receipt ID to replay")
  .option("--project <root>", "Explicit project root", process.cwd())
  .action(async (options: { eventId: string; project: string }) => {
    const result = await loopgraph_events_replay({
      projectRoot: path.resolve(options.project),
      eventId: options.eventId
    });
    console.log(JSON.stringify(result, null, 2));
  });

events
  .command("test")
  .description("Test a normalized event fixture through the Hermes route plan and local shadow router")
  .requiredOption("--fixture <file>", "EventEnvelope JSON path or generated Loopgraph fixture JSON path")
  .option("--project <root>", "Explicit project root", process.cwd())
  .option("--source <pattern>", "Require the fixture source to match this source pattern")
  .option("--expected-action <action>", "Expected route action")
  .option("--expected-loop <loopId>", "Expected selected loop ID; may be repeated by using --expected-loops")
  .option("--expected-loops <ids>", "Comma-separated expected selected loop IDs")
  .option("--require-synced-manifest", "Require .loopgraph/hermes-routes.json to match the current route plan")
  .action(async (options: HermesWebhookFixtureCliOptions) => {
    await runHermesWebhookFixtureTest(options);
  });

hermesRouting
  .command("choose")
  .description("Submit a human-reviewed routing correction and validated decision")
  .requiredOption("--event-id <id>", "Event ID or receipt ID being corrected")
  .option("--project <root>", "Explicit project root", process.cwd())
  .option("--action <action>", "route, unhandled, defer, or ignore", "route")
  .option("--loops <ids>", "Comma-separated loop IDs for action=route")
  .option("--problem-id <id>", "Existing business problem ID")
  .option("--attempt-id <id>", "Routing attempt ID that requested human choice")
  .requiredOption("--reason <text>", "Human-readable correction reason")
  .option("--by <name>", "Human/operator making the correction", "operator")
  .option("--confidence <score>", "Human confidence from 0 to 1", "1")
  .action(async (options: {
    eventId: string;
    project: string;
    action: string;
    loops?: string;
    problemId?: string;
    attemptId?: string;
    reason: string;
    by: string;
    confidence: string;
  }) => {
    const action = parseHumanChoiceAction(options.action);
    const result = await loopgraph_routing_human_choice_submit({
      projectRoot: path.resolve(options.project),
      eventId: options.eventId,
      action,
      selectedLoopIds: splitCsv(options.loops),
      problemId: options.problemId,
      routeAttemptId: options.attemptId,
      reason: options.reason,
      correctedBy: options.by,
      confidence: Number(options.confidence)
    });
    console.log(JSON.stringify(result, null, 2));
    if (!result.submission.valid) process.exit(1);
  });

program
  .command("init")
  .argument("<template>", "Template id (hero templates: github-issue-triage, strategic-account-escalation, support-ticket-triage)")
  .argument("[targetDir]", "Destination directory", ".")
  .action(async (templateId, targetDir) => {
    const template = HERO_TEMPLATES.find((entry) => entry.id === templateId);
    if (!template) {
      console.error(`Unknown template: ${templateId}`);
      console.error(`Available: ${HERO_TEMPLATES.map((entry) => entry.id).join(", ")}`);
      process.exit(1);
    }

    const dest = path.resolve(targetDir);
    const outputDir = path.join(dest, template.id);
    const source = path.join(templatesRoot, template.dir);
    await mkdir(dest, { recursive: true });
    await cp(source, outputDir, { recursive: true, force: true });

    const fixtureSource = path.join(templatesRoot, "fixtures", template.id);
    try {
      await cp(fixtureSource, path.join(dest, "fixtures", template.id), { recursive: true, force: true });
    } catch {
      // Consumer repos may supply their own fixtures.
    }

    console.log(`Initialized ${template.id} in ${outputDir}`);
  });

const templates = program.command("templates").description("Hero template catalog");

templates.command("list").action(() => {
  for (const template of HERO_TEMPLATES) {
    console.log(`- ${template.id}: ${template.name}`);
  }
});

templates
  .command("show")
  .argument("<templateId>")
  .action(async (templateId) => {
    const template = HERO_TEMPLATES.find((entry) => entry.id === templateId);
    if (!template) {
      console.error(`Unknown template: ${templateId}`);
      process.exit(1);
    }
    const specPath = path.join(templatesRoot, template.dir, "loopgraph.yaml");
    const raw = await readFile(specPath, "utf8");
    console.log(raw);
  });

program
  .command("validate")
  .argument("<specPath>", "Path to loopgraph.yaml or example directory")
  .action(async (specPath) => {
    const result = await loadLoopSpecFromPath(path.resolve(specPath));
    if (!result.ok) {
      console.error(result.errors.join("\n"));
      process.exit(1);
    }
    console.log(`Valid: ${result.spec.metadata.name} (${result.spec.metadata.id}@${result.spec.metadata.version})`);
  });

program
  .command("simulate")
  .argument("<specPath>", "Path to loopgraph.yaml or example directory")
  .requiredOption("--fixture <file>", "Fixture JSON path")
  .action(async (specPath, options: { fixture: string }) => {
    const result = await loadLoopSpecFromPath(path.resolve(specPath));
    if (!result.ok) {
      console.error(result.errors.join("\n"));
      process.exit(1);
    }
    const simulation = await simulateLoop({
      spec: result.spec,
      fixture: path.resolve(options.fixture),
      storage
    });
    console.log(simulation.summary);
    if (simulation.escalationCase) {
      console.log(`caseId=${simulation.escalationCase.id} severity=${simulation.escalationCase.severity}`);
    }
  });

program
  .command("trace")
  .argument("<runId>", "Run ID")
  .option("--review", "Interactive review summary")
  .action(async (runId, options: { review?: boolean }) => {
    const trace = await storage.getRun(runId);
    if (!trace) {
      console.error(`Trace not found: ${runId}`);
      process.exit(1);
    }
    printTrace(trace);
    if (options.review && trace.status === "WAITING_FOR_REVIEW") {
      const caseItem = trace.escalationCases[0]
        ? await storage.getEscalationCase(trace.escalationCases[0])
        : null;
      console.log("\n" + formatReviewPacket(trace, caseItem));
    }
  });

program
  .command("export-graph")
  .argument("<specPath>", "Path to loopgraph.yaml or example directory")
  .action(async (specPath) => {
    const result = await loadLoopSpecFromPath(path.resolve(specPath));
    if (!result.ok) {
      console.error(result.errors.join("\n"));
      process.exit(1);
    }
    const graph = buildGraphFromSpecs({ specs: [result.spec] });
    console.log(JSON.stringify(graph, null, 2));
  });

program
  .command("adapter")
  .command("test")
  .argument("[adapterId]", "Adapter id (default: all mocks)")
  .action(async (adapterId?: string) => {
    const adapters = adapterId ? allMockAdapters.filter((a) => a.id === adapterId) : allMockAdapters;
    let failed = false;
    for (const adapter of adapters) {
      const errors = await runAdapterConformance(adapter);
      if (errors.length) {
        failed = true;
        console.error(`FAIL ${adapter.id}:\n- ${errors.join("\n- ")}`);
      } else {
        console.log(`PASS ${adapter.id}`);
      }
    }
    if (failed) process.exit(1);
  });

const review = program.command("review").description("Review commands");

review
  .command("approve")
  .argument("<runId>")
  .requiredOption("--actions <fingerprints>", "Comma-separated fingerprints")
  .requiredOption("--by <reviewerId>", "Auditable reviewer identity")
  .requiredOption("--role <role>", "Reviewer role allowed by the LoopSpec")
  .option("--project <root>", "Explicit project root", process.cwd())
  .option("--comment <text>")
  .action(async (runId, options: { actions: string; by: string; role: string; project: string; comment?: string }) => {
    await runReviewDecision(runId, "approved", options.actions.split(",").filter(Boolean), options.by, options.role, options.project, options.comment);
  });

review
  .command("reject")
  .argument("<runId>")
  .requiredOption("--by <reviewerId>", "Auditable reviewer identity")
  .requiredOption("--role <role>", "Reviewer role allowed by the LoopSpec")
  .option("--project <root>", "Explicit project root", process.cwd())
  .option("--comment <text>")
  .action(async (runId, options: { by: string; role: string; project: string; comment?: string }) => {
    await runReviewDecision(runId, "rejected", [], options.by, options.role, options.project, options.comment);
  });

review
  .command("request-evidence")
  .argument("<runId>")
  .requiredOption("--by <reviewerId>", "Auditable reviewer identity")
  .requiredOption("--role <role>", "Reviewer role allowed by the LoopSpec")
  .option("--project <root>", "Explicit project root", process.cwd())
  .option("--comment <text>")
  .action(async (runId, options: { by: string; role: string; project: string; comment?: string }) => {
    await runReviewDecision(runId, "request_evidence", [], options.by, options.role, options.project, options.comment);
  });

review
  .command("reassign")
  .argument("<runId>")
  .requiredOption("--to <role>", "Role or owner to reassign to")
  .requiredOption("--by <reviewerId>", "Auditable reviewer identity")
  .requiredOption("--role <role>", "Reviewer role allowed by the LoopSpec")
  .option("--project <root>", "Explicit project root", process.cwd())
  .option("--comment <text>")
  .action(async (runId, options: { to: string; by: string; role: string; project: string; comment?: string }) => {
    await runReviewDecision(runId, "reassigned", [], options.by, options.role, options.project, options.comment, options.to);
  });

review
  .command("packet")
  .argument("<runId>", "Run ID")
  .action(async (runId) => {
    const trace = await storage.getRun(runId);
    if (!trace) {
      console.error(`Trace not found: ${runId}`);
      process.exit(1);
    }
    const caseItem = trace.escalationCases[0]
      ? await storage.getEscalationCase(trace.escalationCases[0])
      : null;
    console.log(formatReviewPacket(trace, caseItem));
  });

program
  .command("execute")
  .argument("<specPath>", "Path to loopgraph.yaml or example directory")
  .requiredOption("--event <file>", "Trigger event JSON path")
  .action(async (specPath, options: { event: string }) => {
    if (!isExecuteEnabled()) {
      console.error("Execute mode disabled. Set LOOPGRAPH_EXECUTE_ENABLED=true");
      process.exit(1);
    }
    const result = await loadLoopSpecFromPath(path.resolve(specPath));
    if (!result.ok) {
      console.error(result.errors.join("\n"));
      process.exit(1);
    }
    const raw = await readFile(path.resolve(options.event), "utf8");
    const payload = JSON.parse(raw) as Record<string, unknown>;
    const eventId = String(payload.eventId ?? payload.id ?? `evt_${Date.now()}`);
    const execution = await executeLoop({
      spec: result.spec,
      triggerPayload: payload,
      eventId,
      storage,
      projectRoot: process.cwd(),
      invokedBy: {
        actor: "cli",
        source: "loopgraph.execute"
      }
    });
    console.log(execution.summary);
  });

const caseCmd = program.command("case").description("Escalation case commands");

caseCmd.command("list").action(async () => {
  const cases = await listEscalationCases(storage);
  console.log(JSON.stringify(cases, null, 2));
});

caseCmd
  .command("resolve")
  .argument("<caseId>")
  .requiredOption("--summary <text>", "Resolution summary")
  .action(async (caseId, options: { summary: string }) => {
    const updated = await resolveCase(storage, caseId, {
      resolutionSummary: options.summary,
      resolvedAt: new Date().toISOString()
    }, {
      projectRoot: process.cwd()
    });
    console.log(JSON.stringify(updated, null, 2));
  });

caseCmd
  .command("show")
  .argument("<caseId>")
  .action(async (caseId) => {
    const caseItem = await storage.getEscalationCase(caseId);
    if (!caseItem) {
      console.error(`Case not found: ${caseId}`);
      process.exit(1);
    }
    console.log(JSON.stringify(caseItem, null, 2));
    console.log("\nManagement plan:");
    console.log(JSON.stringify(consumeEscalationCase(caseItem), null, 2));
  });

program.parseAsync(process.argv).catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});

function printTrace(trace: LoopRunTrace) {
  console.log(
    JSON.stringify(
      {
        id: trace.id,
        loopId: trace.loopId,
        status: trace.status,
        mode: trace.mode,
        idempotencyKey: trace.idempotencyKey,
        contextHash: trace.contextSnapshot.contentHash,
        policyDecisions: trace.policyDecisions,
        verificationResults: trace.verificationResults,
        preparedActions: trace.preparedActions,
        escalationCases: trace.escalationCases,
        humanReviews: trace.humanReviews
      },
      null,
      2
    )
  );
}

async function runReviewDecision(
  runId: string,
  status: "approved" | "rejected" | "request_evidence" | "reassigned",
  fingerprints: string[],
  reviewerId: string,
  roleValue: string,
  projectRootValue: string,
  comment?: string,
  reassignedTo?: string
) {
  try {
    const allowedRoles = ["approver", "reviewer", "owner", "teacher", "executor", "accountability_holder"] as const;
    if (!allowedRoles.includes(roleValue as (typeof allowedRoles)[number])) {
      throw new ReviewServiceError(`Unsupported reviewer role: ${roleValue}`);
    }
    const projectRoot = path.resolve(projectRootValue);
    const reviewStorage = getStorageAdapter({ rootDir: getLoopgraphRoot(projectRoot) });
    const result = await applyReviewDecision(reviewStorage, {
      runId,
      status,
      approvedFingerprints: fingerprints,
      reviewerId,
      role: roleValue as (typeof allowedRoles)[number],
      comment,
      reassignedTo
    }, {
      projectRoot
    });
    console.log(`Review ${status} recorded for ${runId} (trace status=${result.trace.status})`);
  } catch (error) {
    console.error(error instanceof ReviewServiceError ? error.message : String(error));
    process.exit(1);
  }
}

function parseHermesScope(scope: string): HermesInstallScope {
  if (scope === "project") return scope;
  console.error(`Unsupported Hermes install scope: ${scope}`);
  console.error("Use --scope project. The installer only writes local .loopgraph/hermes artifacts.");
  process.exit(1);
}

function parseHumanChoiceAction(action: string): "route" | "unhandled" | "defer" | "ignore" {
  if (action === "route" || action === "unhandled" || action === "defer" || action === "ignore") return action;
  console.error(`Unsupported human routing action: ${action}`);
  console.error("Use one of: route, unhandled, defer, ignore.");
  process.exit(1);
}

type HermesWebhookFixtureCliOptions = {
  fixture: string;
  project: string;
  source?: string;
  expectedAction?: string;
  expectedLoop?: string;
  expectedLoops?: string;
  requireSyncedManifest?: boolean;
};

async function runHermesWebhookFixtureTest(options: HermesWebhookFixtureCliOptions): Promise<void> {
  const expectedLoopIds = [
    ...splitCsv(options.expectedLoops),
    ...(options.expectedLoop ? [options.expectedLoop] : [])
  ];
  const result = await testHermesWebhookFixture({
    projectRoot: path.resolve(options.project),
    fixture: path.resolve(options.fixture),
    sourcePattern: options.source,
    expectedAction: options.expectedAction ? parseRoutingDecisionAction(options.expectedAction) : undefined,
    expectedLoopIds,
    requireSyncedManifest: Boolean(options.requireSyncedManifest)
  });
  console.log(JSON.stringify(result, null, 2));
  if (!result.valid) process.exit(1);
}

function parseRoutingDecisionAction(action: string): "route" | "append_evidence" | "ignore" | "defer" | "request_human" | "unhandled" {
  if (
    action === "route" ||
    action === "append_evidence" ||
    action === "ignore" ||
    action === "defer" ||
    action === "request_human" ||
    action === "unhandled"
  ) {
    return action;
  }
  console.error(`Unsupported routing action: ${action}`);
  console.error("Use one of: route, append_evidence, ignore, defer, request_human, unhandled.");
  process.exit(1);
}

function splitCsv(value?: string): string[] {
  return (value ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function commaSeparated(value?: string): string[] {
  return splitCsv(value);
}

function parseStringArrayRecord(value?: string): Record<string, string[]> {
  if (!value) return {};
  const parsed = JSON.parse(value) as unknown;
  if (!isRecord(parsed)) {
    throw new Error("--proposal-map must be a JSON object mapping change IDs to proposal ID arrays.");
  }
  return Object.fromEntries(Object.entries(parsed).map(([changeId, proposalIds]) => {
    if (!Array.isArray(proposalIds) || proposalIds.some((proposalId) => typeof proposalId !== "string" || !proposalId.trim())) {
      throw new Error(`--proposal-map value for ${changeId} must be an array of non-empty proposal IDs.`);
    }
    return [changeId, proposalIds.map((proposalId) => proposalId.trim())];
  }));
}

async function printSemanticGraphTool(
  name: LoopgraphSemanticGraphToolName,
  input: Record<string, unknown>,
  projectRoot: string
): Promise<void> {
  const result = await callLoopgraphSemanticGraphTool(name, {
    ...input,
    projectRoot: path.resolve(projectRoot)
  });
  console.log(JSON.stringify(result, null, 2));
}

async function printMeasurementTool(
  name: LoopgraphMeasurementToolName,
  input: Record<string, unknown>,
  projectRoot: string
): Promise<void> {
  const result = await callLoopgraphMeasurementTool(name, {
    ...input,
    projectRoot: path.resolve(projectRoot)
  });
  console.log(JSON.stringify(result, null, 2));
}

async function printConnectionTool(
  name: LoopgraphConnectionToolName,
  input: Record<string, unknown>,
  projectRoot: string
): Promise<void> {
  const result = await callLoopgraphConnectionTool(name, {
    ...input,
    projectRoot: path.resolve(projectRoot)
  });
  console.log(JSON.stringify(result, null, 2));
}

async function printAppTool(
  name: LoopgraphAppToolName,
  input: Record<string, unknown>
): Promise<void> {
  const projectRoot = typeof input.projectRoot === "string" ? input.projectRoot : process.cwd();
  const result = await callLoopgraphAppTool(name, {
    ...input,
    projectRoot: path.resolve(projectRoot)
  });
  console.log(JSON.stringify(result, null, 2));
}

async function readJsonRecord(filePath: string): Promise<Record<string, unknown>> {
  const parsed = JSON.parse(await readFile(filePath, "utf8")) as unknown;
  if (!isRecord(parsed)) {
    throw new Error(`Expected a JSON object in ${filePath}`);
  }
  return parsed;
}

function parsePositiveInteger(value: string, label: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new Error(`${label} must be a positive integer.`);
  }
  return parsed;
}

async function readRoutingEvaluationFixtures(filePath: string): Promise<RoutingEvaluationFixtureInput[]> {
  const parsed = JSON.parse(await readFile(filePath, "utf8")) as unknown;
  if (Array.isArray(parsed)) return parsed as RoutingEvaluationFixtureInput[];
  if (isRecord(parsed) && Array.isArray(parsed.fixtures)) {
    return parsed.fixtures as RoutingEvaluationFixtureInput[];
  }
  throw new Error("Routing evaluation fixtures file must be a JSON array or an object with a fixtures array.");
}

function printHermesSetupResult(result: HermesSetupResult): void {
  console.log("Loopgraph Hermes setup complete");
  console.log(`Project: ${result.projectRoot}`);
  console.log(`Local Loopgraph contract: ${result.localReady ? "ready" : "needs attention"}`);
  console.log(`Hermes CLI: ${result.doctor.hermesAvailable ? result.doctor.hermesVersion ?? "available" : "not detected on PATH"}`);
  console.log("");
  console.log("Generated local files");
  console.log(`- Install state: ${result.install.installStatePath}`);
  console.log(`- Hermes MCP snippet: ${result.hermesConfig.generatedSnippetPath}`);
  console.log(`- Hermes skills directory: ${result.hermesConfig.skillsDir}`);
  console.log("");
  console.log("Connect Hermes");
  console.log(`1. Merge the snippet into ${result.hermesConfig.targetConfigPath}.`);
  console.log("2. Confirm Hermes loads `loopgraph_admin`, `loopgraph_webhook_router`, and `loopgraph_lifecycle_router` with their generated exposure profiles.");
  console.log(`3. In Hermes, run: ${result.commandUsage.firstHermesPrompt}`);
  console.log("");
  console.log("Useful clone commands");
  console.log(`- Re-check setup: ${result.commandUsage.fromClone.doctor}`);
  console.log(`- Open local graph: ${result.commandUsage.fromClone.studio}`);
  console.log(`- Plan webhook routes: ${result.commandUsage.fromClone.webhooksPlan}`);
  console.log(`- Sync route manifest: ${result.commandUsage.fromClone.webhooksSync}`);
  console.log(`- Test a normalized fixture: ${result.commandUsage.fromClone.eventTest}`);
  console.log("");
  console.log("Safety boundary");
  for (const item of result.safety) {
    console.log(`- ${item}`);
  }
  if (result.warnings.length > 0) {
    console.log("");
    console.log("Warnings");
    for (const warning of result.warnings) {
      console.log(`- ${warning}`);
    }
  }
}

function printStudioPlan(plan: LoopgraphStudioPlan): void {
  console.log("Loopgraph studio prepared");
  console.log(`Project: ${plan.projectRoot}`);
  console.log(`Workspace: ${plan.workspaceRoot}`);
  console.log(`URL: ${plan.url}`);
  if (plan.start) {
    console.log(`App root: ${plan.start.cwd}`);
    console.log(`Environment: LOOPGRAPH_PROJECT_ROOT=${plan.start.env.LOOPGRAPH_PROJECT_ROOT}`);
    console.log(`Start: ${plan.start.command} ${plan.start.args.join(" ")}`);
  } else {
    console.log("Start: unavailable from this package installation");
  }
  for (const action of plan.nextActions) {
    console.log(`- ${action}`);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

async function startStudioServer(plan: LoopgraphStudioPlan): Promise<void> {
  if (!plan.start) return;
  const child = spawn(plan.start.command, plan.start.args, {
    cwd: plan.start.cwd,
    stdio: "inherit",
    env: {
      ...process.env,
      ...plan.start.env
    }
  });

  await new Promise<void>((resolve, reject) => {
    child.on("error", reject);
    child.on("exit", (code, signal) => {
      if (signal) {
        resolve();
        return;
      }
      if (code && code !== 0) {
        reject(new Error(`Studio server exited with code ${code}`));
        return;
      }
      resolve();
    });
  });
}
