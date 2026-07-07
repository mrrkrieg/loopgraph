#!/usr/bin/env tsx
import "./load-env";
import { cp, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import YAML from "yaml";
import { Command } from "commander";
import { loadLoopSpecFromPath } from "../lib/loopgraph-runtime/loader";
import { simulateLoop } from "../lib/loopgraph-runtime/simulator";
import { executeLoop, isExecuteEnabled } from "../lib/loopgraph-runtime/executor";
import { buildGraphFromSpecs } from "../lib/loopgraph-core/graph";
import { allMockAdapters } from "../lib/loopgraph-sdk/adapters/mock-adapters";
import { runAdapterConformance } from "../lib/loopgraph-sdk/conformance";
import { consumeEscalationCase } from "../lib/loopgraph-runtime/management-consumer";
import { applyReviewDecision, ReviewServiceError } from "../lib/loopgraph-runtime/review-service";
import { formatReviewPacket } from "../lib/loopgraph-runtime/review-packet";
import { listEscalationCases, resolveCase } from "../lib/loopgraph-runtime/case-service";
import { getStorageAdapter, getLoopgraphRoot } from "../lib/loopgraph-runtime/storage-resolver";
import {
  acceptRecommendation,
  answerDiscoveryQuestion,
  buildDemoDiscoverySession,
  generateDemoDailySummary,
  listUndefinedMetrics,
  loadDiscoverySession,
  materializeAcceptedLoops,
  runDiscoveryPipeline,
  saveDailySummary,
  saveDiscoverySession,
  startDiscoverySession
} from "../lib/loopgraph-runtime/discovery-engine";
import {
  loadDepartmentSkillPack,
  loadDepartmentSkillPacks,
  validateDepartmentSkillPackReferences
} from "../lib/loopgraph-runtime/skill-pack-loader";
import { createSpecFromTemplate } from "../lib/loop-engineering-builder/template-spec";
import { getDepartmentTemplates, getTemplateById, getTemplateCatalog } from "../lib/loop-engineering-builder/templates";
import { registerLoopSpec } from "../lib/loop-engineering-builder/local-workspace";
import type { LoopRunTrace } from "../lib/loopgraph-core/trace";

const program = new Command();
const repoRoot = path.resolve(__dirname, "..");
const storage = getStorageAdapter({ rootDir: getLoopgraphRoot(repoRoot) });

program.name("loopgraph").description("Loopgraph local validate/simulate CLI");

program
  .command("init")
  .argument("<template>", "Template id")
  .argument("[targetDir]", "Destination directory", ".")
  .option("--register", "Register the initialized spec in .loopgraph/workspace.json")
  .action(async (templateId, targetDir, options: { register?: boolean }) => {
    const template = getTemplateById(templateId);
    if (!template) {
      console.error(`Unknown template: ${templateId}`);
      process.exit(1);
    }

    const dest = path.resolve(targetDir);
    const outputDir = path.join(dest, template.id);
    await mkdir(dest, { recursive: true });

    if (template.runtimeLevel === "runnable" && template.examplePath) {
      const source = path.join(repoRoot, template.examplePath);
      await cp(source, outputDir, { recursive: true, force: true });
      const fixtureSource = path.join(repoRoot, "fixtures", template.id);
      try {
        await cp(fixtureSource, path.join(dest, "fixtures", template.id), { recursive: true, force: true });
      } catch {
        // Some runnable examples, such as management review, do not need fixtures yet.
      }
    } else {
      await mkdir(outputDir, { recursive: true });
      const spec = createSpecFromTemplate(template.id);
      await writeFile(path.join(outputDir, "loopgraph.yaml"), YAML.stringify(spec));
    }

    const specPath = path.join(outputDir, "loopgraph.yaml");
    if (options.register) {
      const entry = await registerLoopSpec(specPath, repoRoot);
      console.log(`Registered ${entry.name} (${entry.id})`);
    }
    console.log(`Initialized ${template.id} in ${outputDir}`);
  });

const templates = program.command("templates").description("Template catalog commands");

templates
  .command("list")
  .option("--json", "Print raw JSON")
  .action((options: { json?: boolean }) => {
    const catalog = getTemplateCatalog();
    if (options.json) {
      console.log(JSON.stringify(catalog, null, 2));
      return;
    }

    for (const department of getDepartmentTemplates()) {
      console.log(`\n${department.name}`);
      for (const template of department.commonLoops) {
        console.log(`- ${template.id} [${template.runtimeLevel}] ${template.name}`);
      }
    }
  });

const skills = program.command("skills").description("Department skill pack commands");

skills
  .command("list")
  .option("--json", "Print raw JSON")
  .action(async (options: { json?: boolean }) => {
    const packs = await loadDepartmentSkillPacks(repoRoot);
    const errors = packs.flatMap(validateDepartmentSkillPackReferences);
    if (options.json) {
      console.log(JSON.stringify({ packs, errors }, null, 2));
      return;
    }
    for (const pack of packs) {
      console.log(`- ${pack.id} (${pack.departmentType}) ${pack.loopBlueprints.length} loops`);
    }
    if (errors.length > 0) {
      console.error(`\nValidation errors:\n- ${errors.join("\n- ")}`);
      process.exit(1);
    }
  });

skills
  .command("show")
  .argument("<skillId>", "Skill pack id or department type")
  .action(async (skillId) => {
    const pack = await loadDepartmentSkillPack(skillId, repoRoot);
    if (!pack) {
      console.error(`Unknown skill pack: ${skillId}`);
      process.exit(1);
    }
    console.log(JSON.stringify(pack, null, 2));
  });

const discovery = program.command("discovery").description("Business discovery commands");

discovery
  .command("start")
  .option("--fixture <file>", "Discovery fixture JSON path")
  .option("--recommend", "Run the deterministic recommendation pipeline immediately")
  .action(async (options: { fixture?: string; recommend?: boolean }) => {
    const input = options.fixture
      ? JSON.parse(await readFile(path.resolve(options.fixture), "utf8"))
      : {};
    const session = await startDiscoverySession(input, repoRoot);
    const next = options.recommend ? await runDiscoveryPipeline(session, repoRoot) : session;
    await saveDiscoverySession(next, repoRoot);
    console.log(JSON.stringify({
      sessionId: next.id,
      status: next.status,
      companyId: next.companyId,
      recommendations: next.recommendedLoops.map((item) => item.name)
    }, null, 2));
  });

discovery
  .command("answer")
  .argument("<sessionId>")
  .requiredOption("--question <id>", "Question id")
  .requiredOption("--value <value>", "Answer value")
  .option("--scope <scope>", "Answer scope", "company")
  .option("--department <id>", "Department id")
  .action(async (sessionId, options: { question: string; value: string; scope: string; department?: string }) => {
    const session = await answerDiscoveryQuestion(sessionId, {
      questionId: options.question,
      scope: options.scope as "company",
      departmentId: options.department,
      value: options.value
    }, repoRoot);
    console.log(`Recorded ${options.question} on ${session.id} (${session.status})`);
  });

discovery
  .command("recommend")
  .argument("<sessionId>")
  .action(async (sessionId) => {
    const session = await loadDiscoverySession(sessionId, repoRoot);
    if (!session) {
      console.error(`Discovery session not found: ${sessionId}`);
      process.exit(1);
    }
    const next = await runDiscoveryPipeline(session, repoRoot);
    await saveDiscoverySession(next, repoRoot);
    console.log(JSON.stringify(next.recommendedLoops.map((item) => ({
      id: item.id,
      name: item.name,
      readiness: item.readiness.level,
      blockers: item.readiness.blockers
    })), null, 2));
  });

discovery
  .command("materialize")
  .argument("<sessionId>")
  .option("--accept-all", "Accept all recommended loops before materializing")
  .action(async (sessionId, options: { acceptAll?: boolean }) => {
    const loaded = await loadDiscoverySession(sessionId, repoRoot);
    if (!loaded) {
      console.error(`Discovery session not found: ${sessionId}`);
      process.exit(1);
    }
    const session = options.acceptAll
      ? loaded.recommendedLoops.reduce((next, recommendation) => acceptRecommendation(next, recommendation.id), loaded)
      : loaded;
    const result = await materializeAcceptedLoops(session, repoRoot);
    console.log(JSON.stringify({
      createdLoopIds: result.session.createdLoopIds,
      errors: result.errors
    }, null, 2));
  });

const metricsCmd = program.command("metrics").description("Metric planning commands");

metricsCmd
  .command("undefined")
  .action(async () => {
    const stored = await listUndefinedMetrics(repoRoot);
    const metrics = stored.length > 0 ? stored : (await buildDemoDiscoverySession(repoRoot)).undefinedMetrics;
    console.log(JSON.stringify(metrics, null, 2));
  });

const dailySummary = program.command("daily-summary").description("Daily summary commands");

dailySummary
  .command("generate")
  .action(async () => {
    const { summary } = await generateDemoDailySummary(repoRoot);
    await saveDailySummary(summary, repoRoot);
    console.log(JSON.stringify({
      id: summary.id,
      companyHealth: summary.companyHealth,
      netSavedMinutes: summary.netSavedMinutes,
      loops: summary.loops.map((loop) => ({ name: loop.loopName, status: loop.status }))
    }, null, 2));
  });

templates
  .command("show")
  .argument("<templateId>", "Template id")
  .action((templateId) => {
    const template = getTemplateById(templateId);
    if (!template) {
      console.error(`Unknown template: ${templateId}`);
      process.exit(1);
    }
    console.log(JSON.stringify(template, null, 2));
  });

program
  .command("register")
  .argument("<specPath>", "Path to loopgraph.yaml or example directory")
  .action(async (specPath) => {
    const entry = await registerLoopSpec(specPath, repoRoot);
    console.log(`Registered ${entry.name} (${entry.id}) from ${entry.path}`);
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
  .option("--comment <text>")
  .action(async (runId, options: { actions: string; comment?: string }) => {
    await runReviewDecision(runId, "approved", options.actions.split(",").filter(Boolean), options.comment);
  });

review
  .command("reject")
  .argument("<runId>")
  .option("--comment <text>")
  .action(async (runId, options: { comment?: string }) => {
    await runReviewDecision(runId, "rejected", [], options.comment);
  });

review
  .command("request-evidence")
  .argument("<runId>")
  .option("--comment <text>")
  .action(async (runId, options: { comment?: string }) => {
    await runReviewDecision(runId, "request_evidence", [], options.comment);
  });

review
  .command("reassign")
  .argument("<runId>")
  .requiredOption("--to <role>", "Role or owner to reassign to")
  .option("--comment <text>")
  .action(async (runId, options: { to: string; comment?: string }) => {
    await runReviewDecision(runId, "reassigned", [], options.comment, options.to);
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
    const raw = await import("node:fs/promises").then((fs) => fs.readFile(path.resolve(options.event), "utf8"));
    const payload = JSON.parse(raw) as Record<string, unknown>;
    const eventId = String(payload.eventId ?? payload.id ?? `evt_${Date.now()}`);
    const execution = await executeLoop({
      spec: result.spec,
      triggerPayload: payload,
      eventId,
      storage
    });
    console.log(execution.summary);
  });

const caseCmd = program.command("case").description("Escalation case commands");

caseCmd
  .command("list")
  .action(async () => {
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
  console.log(JSON.stringify({
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
  }, null, 2));
}

async function runReviewDecision(
  runId: string,
  status: "approved" | "rejected" | "request_evidence" | "reassigned",
  fingerprints: string[],
  comment?: string,
  reassignedTo?: string
) {
  try {
    const result = await applyReviewDecision(storage, {
      runId,
      status,
      approvedFingerprints: fingerprints,
      comment,
      reassignedTo
    });
    console.log(`Review ${status} recorded for ${runId} (trace status=${result.trace.status})`);
  } catch (error) {
    console.error(error instanceof ReviewServiceError ? error.message : String(error));
    process.exit(1);
  }
}
