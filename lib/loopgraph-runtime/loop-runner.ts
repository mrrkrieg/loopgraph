import type { LoopSpec } from "../loopgraph-core/loop-spec";
import type { LoopRunTrace } from "../loopgraph-core/trace";
import type { EscalationCase } from "../loopgraph-core/escalation";
import { idempotencyKey, loopSpecHash, runId } from "../loopgraph-core/hash";
import { prepareActionsFromProposed, evaluatePolicy, buildEscalationCaseFromPolicy, shouldCreateEscalationCase } from "../loopgraph-core/policy";
import { compileContextSnapshot } from "./context-compiler";
import { runVerifiers, allVerifiersPassed } from "./verifier-runner";
import { loadFixture, type SimulationFixture } from "./fixture-loader";
import type { StorageAdapter } from "../loopgraph-sdk/adapters";
import { getAssessmentProvider } from "../loopgraph-sdk/providers";
import { assertTransition } from "./state-machine";

export type RunLoopInput = {
  spec: LoopSpec;
  mode: "simulate" | "execute";
  fixture?: SimulationFixture | string;
  triggerPayload?: Record<string, unknown>;
  eventId: string;
  startedAt: string;
  storage: StorageAdapter;
};

export type RunLoopResult = {
  trace: LoopRunTrace;
  escalationCase?: EscalationCase;
  summary: string;
};

export async function runLoop(input: RunLoopInput): Promise<RunLoopResult> {
  const fixture =
    input.fixture === undefined
      ? undefined
      : typeof input.fixture === "string"
        ? await loadFixture(input.fixture)
        : input.fixture;

  const payload = fixture ?? input.triggerPayload ?? {};
  const specHash = loopSpecHash(input.spec);
  const idem = idempotencyKey({
    loopSpecVersion: input.spec.metadata.version,
    triggerSource: input.spec.trigger.source,
    sourceEventId: input.eventId
  });
  const traceId = runId({ loopSpecHash: specHash, idempotencyKey: idem });
  const startedAt = input.startedAt;

  let status: LoopRunTrace["status"] = "VALIDATED";
  assertTransition("DRAFT", status);
  status = "READY";
  assertTransition("VALIDATED", status);
  status = input.mode === "execute" ? "SIMULATING" : "SIMULATING";
  assertTransition("READY", status);

  const contextSnapshot = await compileContextSnapshot({
    spec: input.spec,
    fixture: (fixture ?? payload) as SimulationFixture,
    mode: input.mode
  });

  const provider = getAssessmentProvider(input.mode);
  const agentOutput = await provider.generate({
    spec: input.spec,
    context: contextSnapshot,
    fixture: fixture ?? (input.triggerPayload as SimulationFixture | undefined),
    triggerPayload: input.triggerPayload
  });

  status = "PROPOSED_ACTIONS";
  const preparedActions = prepareActionsFromProposed(agentOutput.proposedActions);
  status = "VERIFYING";
  const policyDecisions = evaluatePolicy(input.spec, agentOutput, preparedActions);
  const verificationResults = runVerifiers({ spec: input.spec, output: agentOutput, preparedActions });

  const blocked = policyDecisions.some((d) => d.matched && d.action === "block");
  const needsReview = policyDecisions.some((d) => d.requiresReview) || preparedActions.some((a) => a.requiresApproval);
  const verificationFailed = !allVerifiersPassed(verificationResults);

  let escalationCase: EscalationCase | undefined;
  if (shouldCreateEscalationCase(policyDecisions) || agentOutput.escalationRequest?.required) {
    escalationCase = buildEscalationCaseFromPolicy({
      spec: input.spec,
      runId: traceId,
      output: agentOutput,
      preparedActions,
      decisions: policyDecisions,
      simulatedAt: startedAt
    }) ?? undefined;

    if (escalationCase && fixture) {
      if (input.spec.metadata.id === "strategic-account-escalation") {
        escalationCase.affectedEntities.accountName = String(fixture.account?.name ?? "Unknown account");
        escalationCase.affectedEntities.accountId = String(fixture.account?.id ?? "unknown");
        escalationCase.businessImpact = String(fixture.businessImpact?.summary ?? escalationCase.businessImpact);
      }
      if (input.spec.metadata.id === "github-issue-triage") {
        escalationCase.affectedEntities.repository = String(fixture.repo?.name ?? "unknown/repo");
      }
      await input.storage.saveEscalationCase(escalationCase);
    } else if (escalationCase) {
      await input.storage.saveEscalationCase(escalationCase);
    }
  }

  if (blocked) status = "BLOCKED_BY_POLICY";
  else if (verificationFailed) status = "FAILED_VERIFICATION";
  else if (needsReview) status = "WAITING_FOR_REVIEW";
  else status = "COMPLETED";

  const trace: LoopRunTrace = {
    id: traceId,
    loopId: input.spec.metadata.id,
    loopSpecVersion: input.spec.metadata.version,
    loopSpecHash: specHash,
    mode: input.mode,
    status,
    trigger: {
      type: input.spec.trigger.type,
      source: input.spec.trigger.source,
      event: input.spec.trigger.event,
      eventId: input.eventId,
      receivedAt: startedAt
    },
    idempotencyKey: idem,
    contextSnapshot,
    inputs: Object.entries(payload).slice(0, 5).map(([key, value]) => ({ key, value, source: input.mode })),
    agentOutput,
    proposedActions: agentOutput.proposedActions,
    preparedActions,
    toolCalls: preparedActions.map((action) => ({
      id: `tool_${action.id}`,
      toolKey: action.toolKey,
      input: action.payload,
      output: { mock: input.mode === "simulate" },
      status: "completed" as const,
      startedAt,
      completedAt: startedAt
    })),
    policyDecisions,
    verificationResults,
    escalationCases: escalationCase ? [escalationCase.id] : [],
    humanReviews: [],
    outputs: [{ id: "output_1", type: "assessment", content: agentOutput }],
    metrics: [],
    errors: [],
    startedAt,
    completedAt: startedAt,
    latencyMs: 0,
    estimatedCost: 0
  };

  await input.storage.saveRun(trace);

  return {
    trace,
    escalationCase,
    summary: [
      `runId=${trace.id}`,
      `status=${trace.status}`,
      `mode=${trace.mode}`,
      `reviewRequired=${needsReview ? "yes" : "no"}`,
      `escalationCase=${escalationCase?.id ?? "none"}`,
      `contextHash=${contextSnapshot.contentHash}`,
      `fingerprints=${preparedActions.length}`,
      `evidencePassed=${verificationResults.find((v) => v.verifierId.includes("evidence"))?.passed ?? "n/a"}`
    ].join(" ")
  };
}
