#!/usr/bin/env tsx
import "./load-env";
import { cp, mkdir } from "node:fs/promises";
import path from "node:path";
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
import type { LoopRunTrace } from "../lib/loopgraph-core/trace";

const program = new Command();
const repoRoot = path.resolve(__dirname, "..");
const storage = getStorageAdapter({ rootDir: getLoopgraphRoot(repoRoot) });

program.name("loopgraph").description("Loopgraph local validate/simulate CLI");

program
  .command("init")
  .argument("<template>", "github-issue-triage | strategic-account-escalation")
  .argument("[targetDir]", "Destination directory", ".")
  .action(async (template, targetDir) => {
    const source = path.join(repoRoot, "examples", template);
    const dest = path.resolve(targetDir);
    await mkdir(dest, { recursive: true });
    await cp(source, path.join(dest, template), { recursive: true });
    const fixtureSource = path.join(repoRoot, "fixtures", template);
    await cp(fixtureSource, path.join(dest, "fixtures", template), { recursive: true });
    console.log(`Initialized ${template} in ${dest}`);
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
