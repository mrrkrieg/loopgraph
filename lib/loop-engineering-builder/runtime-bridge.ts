import path from "node:path";
import { loadLoopSpecFromPath } from "../loopgraph-runtime/loader";
import { simulateLoop } from "../loopgraph-runtime/simulator";
import { FileStorageAdapter } from "../loopgraph-sdk/storage";
import type { LoopRunTrace } from "../loopgraph-core/trace";
import type { HumanReview, LoopRun, LoopRunStep } from "./types";

const HERO_LOOP_CONFIG: Record<string, { examplePath: string; defaultFixture: string }> = {
  "github-issue-triage": {
    examplePath: "examples/github-issue-triage",
    defaultFixture: "fixtures/github-issue-triage/security-issue.json"
  },
  "strategic-account-escalation": {
    examplePath: "examples/strategic-account-escalation",
    defaultFixture: "fixtures/strategic-account-escalation/enterprise-outage-near-renewal.json"
  },
  "loop_demo_marketing_campaign": {
    examplePath: "examples/github-issue-triage",
    defaultFixture: "fixtures/github-issue-triage/security-issue.json"
  }
};

export async function simulateHeroLoop(loopId: string, repoRoot = process.cwd()) {
  const config = HERO_LOOP_CONFIG[loopId];
  if (!config) return null;

  const loaded = await loadLoopSpecFromPath(path.join(repoRoot, config.examplePath));
  if (!loaded.ok) return null;

  const storage = new FileStorageAdapter(path.join(repoRoot, ".loopgraph"));
  const result = await simulateLoop({
    spec: loaded.spec,
    fixture: path.join(repoRoot, config.defaultFixture),
    storage
  });

  return {
    ...mapTraceToRunBundle(result.trace, loopId),
    trace: result.trace,
    escalationCase: result.escalationCase
  };
}

export function mapTraceToRunBundle(trace: LoopRunTrace, loopId: string) {
  const run: LoopRun = {
    id: trace.id,
    loopId,
    status: trace.status === "FAILED_VERIFICATION" || trace.status === "BLOCKED_BY_POLICY" ? "failed" : "completed",
    triggerType: trace.mode === "simulate" ? "event" : "manual",
    startedAt: trace.startedAt,
    completedAt: trace.completedAt,
    escalationRequired: trace.escalationCases.length > 0,
    humanReviewRequired: trace.status === "WAITING_FOR_REVIEW",
    inputSnapshot: {
      contextHash: trace.contextSnapshot.contentHash,
      idempotencyKey: trace.idempotencyKey,
      inputs: trace.inputs
    },
    outputSnapshot: {
      agentOutput: trace.agentOutput,
      preparedActions: trace.preparedActions
    },
    verificationResult: {
      policyDecisions: trace.policyDecisions,
      verificationResults: trace.verificationResults
    },
    error: trace.errors[0]?.message
  };

  const steps: LoopRunStep[] = trace.toolCalls.map((call, index) => ({
    id: call.id,
    loopRunId: trace.id,
    stepName: call.toolKey,
    stepType: index === 0 ? "observe" : "execute",
    status: "completed",
    input: call.input,
    output: (call.output ?? {}) as Record<string, unknown>,
    toolCalls: [call],
    startedAt: call.startedAt,
    completedAt: call.completedAt
  }));

  const review: HumanReview | undefined = trace.status === "WAITING_FOR_REVIEW"
    ? {
        id: `review_${trace.id}`,
        loopRunId: trace.id,
        loopId,
        reviewer: "approver",
        status: "pending",
        reason: trace.agentOutput?.verificationRequest.reason ?? "Prepared actions require approval",
        recommendation: trace.preparedActions.map((a) => `${a.label} (${a.fingerprint})`).join("; "),
        createdAt: trace.startedAt
      }
    : undefined;

  return { run, steps, review };
}

export async function listPersistedTraces(repoRoot = process.cwd()) {
  const storage = new FileStorageAdapter(path.join(repoRoot, ".loopgraph"));
  return storage.listRuns();
}

export async function getPersistedTrace(runId: string, repoRoot = process.cwd()) {
  const storage = new FileStorageAdapter(path.join(repoRoot, ".loopgraph"));
  return storage.getRun(runId);
}
