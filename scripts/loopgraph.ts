#!/usr/bin/env tsx
import { cp, mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { Command } from "commander";
import { loadLoopSpecFromPath } from "../lib/loopgraph-runtime/loader";
import { simulateLoop } from "../lib/loopgraph-runtime/simulator";
import { buildGraphFromSpecs } from "../lib/loopgraph-core/graph";
import { FileStorageAdapter } from "../lib/loopgraph-sdk/storage";
import { allMockAdapters } from "../lib/loopgraph-sdk/adapters/mock-adapters";
import { runAdapterConformance } from "../lib/loopgraph-sdk/conformance";
import { validateApprovalBinding } from "../lib/loopgraph-core/review";
import { consumeEscalationCase } from "../lib/loopgraph-runtime/management-consumer";
import type { LoopRunTrace } from "../lib/loopgraph-core/trace";

const program = new Command();
const repoRoot = path.resolve(__dirname, "..");
const storage = new FileStorageAdapter(path.join(repoRoot, ".loopgraph"));

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
      console.log("\nPrepared actions:");
      trace.preparedActions.forEach((action) => {
        console.log(`- ${action.label} fingerprint=${action.fingerprint} customerFacing=${action.customerFacing}`);
      });
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
    await applyReviewDecision(runId, "approved", options.actions.split(","), options.comment);
  });

review
  .command("reject")
  .argument("<runId>")
  .option("--comment <text>")
  .action(async (runId, options: { comment?: string }) => {
    await applyReviewDecision(runId, "rejected", [], options.comment);
  });

review
  .command("request-evidence")
  .argument("<runId>")
  .option("--comment <text>")
  .action(async (runId, options: { comment?: string }) => {
    await applyReviewDecision(runId, "request_evidence", [], options.comment);
  });

program
  .command("case")
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

async function applyReviewDecision(runId: string, status: "approved" | "rejected" | "request_evidence", fingerprints: string[], comment?: string) {
  const trace = await storage.getRun(runId);
  if (!trace) {
    console.error(`Trace not found: ${runId}`);
    process.exit(1);
  }

  for (const prepared of trace.preparedActions) {
    if (status === "approved" && prepared.requiresApproval && !validateApprovalBinding(prepared, fingerprints)) {
      console.error(`Missing approved fingerprint for ${prepared.toolKey}`);
      process.exit(1);
    }
  }

  const reviewRecord = {
    id: `review_${runId}`,
    runId,
    status,
    role: "approver" as const,
    approvedFingerprints: fingerprints,
    rejectedFingerprints: status === "rejected" ? trace.preparedActions.map((a) => a.fingerprint) : [],
    comment,
    createdAt: trace.startedAt,
    decidedAt: trace.startedAt
  };

  trace.humanReviews = [...trace.humanReviews, reviewRecord];
  trace.status = status === "approved" ? "APPROVED" : status === "rejected" ? "REJECTED" : "WAITING_FOR_REVIEW";
  if (status === "approved") {
    trace.status = "COMMITTED";
    trace.toolCalls = trace.toolCalls.map((call) => ({ ...call, status: "mock_committed" as const }));
    trace.status = "COMPLETED";
  }

  await storage.saveReview(reviewRecord);
  await storage.saveRun(trace);
  console.log(`Review ${status} recorded for ${runId}`);
}
