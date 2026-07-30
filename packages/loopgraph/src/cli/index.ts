import { cp, mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import YAML from "yaml";
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
import {
  cancelRouteJob,
  FileRoutingStore,
  retryRouteJob
} from "../runtime/routing-store";

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

const cliEntryFile = fileURLToPath(import.meta.url);
const packageRoot = resolvePackageRoot(cliEntryFile);
const templatesRoot = path.join(packageRoot, "templates");

const program = new Command();
const storage = getStorageAdapter({ rootDir: getLoopgraphRoot(process.cwd()) });

program.name("loopgraph").description("Loopgraph validate/simulate CLI");

async function runHermesSetup(options: { project: string; scope: string; json?: boolean }): Promise<void> {
  const scope = parseHermesScope(options.scope);
  const result = await setupHermesIntegration({
    projectRoot: path.resolve(options.project),
    scope,
    cliEntryPath: cliEntryFile,
    nodeCommand: process.execPath
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

hermes
  .command("setup")
  .description("Initialize, install, and check the project-local Hermes Brain integration")
  .option("--project <root>", "Explicit project root", process.cwd())
  .option("--scope <scope>", "Install scope (project)", "project")
  .option("--json", "Print the setup result as JSON")
  .action(async (options: { project: string; scope: string; json?: boolean }) => {
    await runHermesSetup(options);
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
