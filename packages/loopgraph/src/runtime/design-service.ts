import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import {
  DESIGN_RUN_SCHEMA_VERSION,
  LOOP_DESIGN_CONTEXT_SCHEMA_VERSION,
  LOOP_DESIGN_PROPOSAL_SET_SCHEMA_VERSION,
  BusinessDiscoverySessionSchema,
  contentHash,
  designRunSchema,
  formatDepartmentType,
  getDepartmentBranchQuestions,
  loopDesignContextSchema,
  loopDesignProposalSchema,
  loopDesignProposalSetSchema,
  normalizeDepartmentType,
  type BusinessDiscoverySession,
  type DepartmentType,
  type DesignRun,
  type DiscoveryAnswer,
  type LoopDesignContext,
  type LoopDesignProposal,
  type LoopDesignProposalSet
} from "../core";
import { getDiscoverySession, saveDiscoverySession } from "./discovery-session";
import { inspectProjectManifests } from "./project-inspection";
import { getLoopgraphRoot } from "./storage-resolver";
import { inspectLoopgraphWorkspace } from "./workspace";

export type BuildLoopDesignContextInput = {
  projectRoot?: string;
  sessionId: string;
  department?: string;
};

export type GenerateLoopDesignInput = BuildLoopDesignContextInput & {
  maxProposals?: number;
  reasoningProfile?: "standard" | "high";
  allowNovelDesigns?: boolean;
  redactionPolicy?: LoopDesignRedactionPolicy;
  timeoutMs?: number;
  repairAttemptLimit?: number;
  now?: Date;
};

export type SubmitLoopDesignInput = {
  projectRoot?: string;
  sessionId: string;
  department?: string;
  proposalSet: unknown;
  providerName?: string;
  modelIdentifier?: string;
  reasoningProfile?: "standard" | "high";
  providerMetadata?: Record<string, unknown>;
  now?: Date;
};

export type LoopDesignProviderMode = DesignRun["providerMode"];
export type LoopDesignReasoningProfile = "standard" | "high";
export type LoopDesignRedactionPolicy = "safe_summary_only" | "bounded_context_without_secrets";

export type LoopDesignProviderOptions = {
  reasoningProfile?: LoopDesignReasoningProfile;
  maxProposals?: number;
  allowNovelDesigns?: boolean;
  providerMode?: LoopDesignProviderMode;
  redactionPolicy?: LoopDesignRedactionPolicy;
  timeoutMs?: number;
  repairAttemptLimit?: number;
};

export type ResolvedLoopDesignProviderOptions = Required<LoopDesignProviderOptions>;

export type LoopDesignProviderMetadata = Record<string, unknown> & {
  providerName?: string;
  modelIdentifier?: string;
  requestedReasoningProfile?: LoopDesignReasoningProfile;
  actualReasoningProfile?: LoopDesignReasoningProfile;
  warnings?: string[];
};

export type LoopDesignProviderOutput = {
  proposalSet: unknown;
  metadata?: LoopDesignProviderMetadata;
};

export interface LoopDesignProvider {
  id: string;
  mode: LoopDesignProviderMode;
  design(
    context: LoopDesignContext,
    options: ResolvedLoopDesignProviderOptions
  ): Promise<LoopDesignProviderOutput>;
}

export type GenerateLoopDesignWithProviderInput = BuildLoopDesignContextInput & LoopDesignProviderOptions & {
  provider: LoopDesignProvider;
  now?: Date;
};

const DEFAULT_LOOP_DESIGN_MAX_PROPOSALS = 2;
const DEFAULT_LOOP_DESIGN_TIMEOUT_MS = 120_000;
const DEFAULT_LOOP_DESIGN_REPAIR_ATTEMPT_LIMIT = 1;

export const loopDesignProposalEditSchema = z.object({
  shortName: z.string().min(1).optional(),
  goal: z.string().min(1).optional(),
  businessOutcome: z.string().min(1).optional(),
  reasoningSummary: z.string().min(1).optional(),
  triggerType: z.enum(["event", "schedule", "manual", "webhook"]).optional(),
  triggerDescription: z.string().min(1).optional(),
  triggerCadence: z.string().min(1).optional(),
  workItem: z.string().min(1).optional(),
  observedSignals: z.array(z.string().min(1)).optional(),
  contextSources: z.array(z.string().min(1)).optional(),
  routineSteps: loopDesignProposalSchema.shape.routineSteps.optional(),
  proposedActions: loopDesignProposalSchema.shape.proposedActions.optional(),
  verifiers: loopDesignProposalSchema.shape.verifiers.optional(),
  metricsPrimary: z.string().min(1).optional(),
  metricsLeading: z.string().min(1).optional(),
  metricsGuardrails: z.array(z.string().min(1)).optional(),
  metricsBaselineState: z.string().min(1).optional(),
  ownerRole: z.string().min(1).optional(),
  reviewerRoles: z.array(z.string().min(1)).optional(),
  escalationConditions: z.array(z.string().min(1)).optional(),
  forbiddenActions: z.array(z.string().min(1)).optional(),
  connectorRequirements: loopDesignProposalSchema.shape.connectorRequirements.optional(),
  manualFallbacks: z.array(z.string().min(1)).optional(),
  requiredFromUser: loopDesignProposalSchema.shape.requiredFromUser.optional(),
  routingProblemTypes: z.array(z.string().min(1)).optional(),
  routingMinimumConfidence: z.number().min(0).max(1).optional(),
  routingActivationMode: z.enum(["shadow", "recommend", "simulate", "execute_with_approval", "autonomous_low_risk"]).optional()
}).strict();

export type LoopDesignProposalEdit = z.infer<typeof loopDesignProposalEditSchema>;

export type EditLoopDesignProposalInput = {
  projectRoot?: string;
  designRunId: string;
  proposalId: string;
  expectedOutputHash?: string;
  updates: unknown;
  editedBy?: string;
  now?: Date;
};

export type LoopDesignSubmissionResult = {
  valid: boolean;
  errors: string[];
  designRun: DesignRun;
  proposalSet?: LoopDesignProposalSet;
  proposalSetPath: string;
  designRunPath: string;
};

export async function buildLoopDesignContext(
  input: BuildLoopDesignContextInput
): Promise<LoopDesignContext> {
  const projectRoot = path.resolve(input.projectRoot ?? process.cwd());
  const session = await requireSession(input.sessionId, projectRoot);
  const departmentType = resolveDesignDepartment(session, input.department);
  const workspace = await inspectLoopgraphWorkspace({ projectRoot });
  const projectInspection = await inspectProjectManifests({ projectRoot });
  const confirmedAnswers = session.answers
    .filter((answer) => answer.confirmedByUser)
    .filter((answer) => !answer.departmentId || answer.departmentId === `${session.companyId}:${departmentType}`)
    .map((answer) => ({
      answerId: answer.id,
      questionId: answer.questionId,
      bundleId: answer.questionId.split(".")[0] ?? answer.questionId,
      fieldId: answer.questionId.split(".").slice(1).join(".") || answer.questionId,
      valueType: answer.valueType,
      value: answer.value,
      evidenceRefs: answer.evidenceRefs
    }));
  const answeredBundleIds = new Set(confirmedAnswers.map((answer) => answer.bundleId));
  const requiredBundles = [
    "current_stack_sources",
    "biggest_recurring_problem",
    "automation_boundaries",
    "ideal_outcome_proof",
    "ownership_rollout"
  ];
  const missingBundles = requiredBundles.filter((bundleId) => !answeredBundleIds.has(bundleId));
  const blockers = missingBundles.map((bundleId) => `Question bundle not answered: ${bundleId}`);
  const connectorStatus = inferConnectorStatus(session.answers);
  const existingLoops = workspace.registry.registeredSpecs.map((spec) => ({
    loopId: spec.id,
    name: spec.name,
    department: spec.department,
    routingReady: false
  }));
  const contextWithoutHash = {
    schemaVersion: LOOP_DESIGN_CONTEXT_SCHEMA_VERSION,
    sessionId: session.id,
    companyId: session.companyId,
    departmentType,
    readiness: blockers.length === 0 ? "ready_for_design" as const : "needs_answers" as const,
    blockers,
    projectSummary: {
      projectRootId: workspace.registry.projectRootId,
      displayName: workspace.registry.displayName,
      registeredSpecCount: workspace.registeredSpecCount,
      registeredDepartments: workspace.registeredDepartments,
      routingReadySpecCount: workspace.routingReadySpecCount
    },
    projectInspection,
    confirmedAnswers,
    departmentBranchQuestions: getDepartmentBranchQuestions(departmentType),
    deterministicCandidates: deterministicCandidatesForDepartment(departmentType),
    connectorStatus,
    existingLoops,
    companyBoundaries: answerArray(session.answers, "automation_boundaries.forbidden_actions"),
    outputSchema: {
      proposalSetSchemaVersion: LOOP_DESIGN_PROPOSAL_SET_SCHEMA_VERSION,
      privateReasoningAllowed: false as const
    }
  };

  return loopDesignContextSchema.parse({
    ...contextWithoutHash,
    contextHash: `ctx_${contentHash(contextWithoutHash)}`
  });
}

export async function generateDeterministicLoopDesign(
  input: GenerateLoopDesignInput
): Promise<LoopDesignSubmissionResult> {
  return generateLoopDesignWithProvider({
    ...input,
    provider: new DeterministicLoopDesignProvider()
  });
}

export class DeterministicLoopDesignProvider implements LoopDesignProvider {
  id = "loopgraph-deterministic";
  mode = "deterministic" as const;

  async design(
    context: LoopDesignContext,
    options: ResolvedLoopDesignProviderOptions
  ): Promise<LoopDesignProviderOutput> {
    const proposalSet = loopDesignProposalSetSchema.parse({
      schemaVersion: LOOP_DESIGN_PROPOSAL_SET_SCHEMA_VERSION,
      sessionId: context.sessionId,
      departmentType: context.departmentType,
      providerMode: this.mode,
      reasoningProfile: options.reasoningProfile,
      proposals: proposalCandidates(context).slice(0, options.maxProposals),
      globalAssumptions: [
        "Generated by deterministic fallback so the local open-source flow works without a model key.",
        "Hermes-hosted high reasoning can submit an edited proposal set through the same validation path."
      ]
    });

    return {
      proposalSet,
      metadata: {
        providerName: this.id,
        requestedReasoningProfile: options.reasoningProfile,
        actualReasoningProfile: "standard",
        warnings: [
          "Deterministic fallback did not invoke a model; use Hermes-hosted or embedded mode for high-reasoning design."
        ]
      }
    };
  }
}

export async function generateLoopDesignWithProvider(
  input: GenerateLoopDesignWithProviderInput
): Promise<LoopDesignSubmissionResult> {
  const projectRoot = path.resolve(input.projectRoot ?? process.cwd());
  const context = await buildLoopDesignContext(input);
  if (context.readiness !== "ready_for_design") {
    throw new Error(`Design context is not ready:\n- ${context.blockers.join("\n- ")}`);
  }

  const options = resolveLoopDesignProviderOptions(input.provider.mode, input);
  if (input.provider.mode !== options.providerMode) {
    throw new Error(`LoopDesignProvider mode mismatch: provider ${input.provider.id} is ${input.provider.mode}, options requested ${options.providerMode}`);
  }

  const providerContext = applyLoopDesignRedactionPolicy(context, options.redactionPolicy);
  const output = await callLoopDesignProviderWithTimeout(input.provider, providerContext, options);
  const proposalSet = loopDesignProposalSetSchema.parse({
    ...(output.proposalSet as Record<string, unknown>),
    sessionId: context.sessionId,
    departmentType: context.departmentType,
    providerMode: input.provider.mode,
    reasoningProfile: options.reasoningProfile
  });
  const metadata = sanitizeProviderMetadata(output.metadata);

  return persistDesignSubmission({
    projectRoot,
    context,
    proposalSet,
    providerMode: input.provider.mode,
    providerName: metadata.providerName ?? input.provider.id,
    modelIdentifier: metadata.modelIdentifier,
    reasoningProfile: options.reasoningProfile,
    now: input.now,
    metadata: {
      provider: {
        id: input.provider.id,
        mode: input.provider.mode,
        requestedReasoningProfile: options.reasoningProfile,
        actualReasoningProfile: metadata.actualReasoningProfile,
        maxProposals: options.maxProposals,
        allowNovelDesigns: options.allowNovelDesigns,
        redactionPolicy: options.redactionPolicy,
        timeoutMs: options.timeoutMs,
        repairAttemptLimit: options.repairAttemptLimit,
        warnings: metadata.warnings ?? []
      },
      providerMetadata: metadata
    }
  });
}

export async function submitLoopDesignProposalSet(
  input: SubmitLoopDesignInput
): Promise<LoopDesignSubmissionResult> {
  const projectRoot = path.resolve(input.projectRoot ?? process.cwd());
  const context = await buildLoopDesignContext({
    projectRoot,
    sessionId: input.sessionId,
    department: input.department
  });
  const proposalSet = loopDesignProposalSetSchema.parse({
    ...(input.proposalSet as Record<string, unknown>),
    sessionId: input.sessionId,
    departmentType: context.departmentType,
    providerMode: "hermes_host",
    reasoningProfile: input.reasoningProfile ?? "high"
  });

  return persistDesignSubmission({
    projectRoot,
    context,
    proposalSet,
    providerMode: "hermes_host",
    providerName: input.providerName ?? "hermes",
    modelIdentifier: input.modelIdentifier,
    reasoningProfile: input.reasoningProfile ?? "high",
    now: input.now,
    metadata: {
      provider: {
        id: input.providerName ?? "hermes",
        mode: "hermes_host",
        requestedReasoningProfile: input.reasoningProfile ?? "high",
        actualReasoningProfile: input.reasoningProfile ?? "high",
        redactionPolicy: "safe_summary_only",
        warnings: [
          "Hermes-hosted mode records high reasoning as requested because Loopgraph receives the structured result, not the model's hidden reasoning trace."
        ]
      },
      ...(input.providerMetadata ? { providerMetadata: input.providerMetadata } : {})
    }
  });
}

export async function editLoopDesignProposal(
  input: EditLoopDesignProposalInput
): Promise<LoopDesignSubmissionResult> {
  const projectRoot = path.resolve(input.projectRoot ?? process.cwd());
  const baseDesignRun = await readDesignRun(projectRoot, input.designRunId);
  if (!baseDesignRun) throw new Error(`Design run not found: ${input.designRunId}`);
  if (input.expectedOutputHash && baseDesignRun.outputHash !== input.expectedOutputHash) {
    throw new Error(`Design run output hash mismatch: expected ${input.expectedOutputHash}, found ${baseDesignRun.outputHash ?? "none"}`);
  }

  const baseProposalSet = await readLoopDesignProposalSet(projectRoot, input.designRunId);
  if (!baseProposalSet) throw new Error(`Proposal set not found for design run: ${input.designRunId}`);
  const proposalIndex = baseProposalSet.proposals.findIndex((proposal) => proposal.proposalId === input.proposalId);
  if (proposalIndex < 0) throw new Error(`Proposal not found in design run: ${input.proposalId}`);

  const edit = loopDesignProposalEditSchema.parse(input.updates);
  const context = await buildLoopDesignContext({
    projectRoot,
    sessionId: baseDesignRun.sessionId,
    department: baseDesignRun.departmentType
  });
  const editedProposal = applyLoopDesignProposalEdit(baseProposalSet.proposals[proposalIndex]!, edit);
  const proposals = baseProposalSet.proposals.map((proposal, index) =>
    index === proposalIndex ? editedProposal : proposal
  );
  const proposalSet = loopDesignProposalSetSchema.parse({
    ...baseProposalSet,
    proposals,
    globalAssumptions: Array.from(new Set([
      ...baseProposalSet.globalAssumptions,
      `Proposal ${input.proposalId} was edited through ${input.editedBy ?? "browser"} and revalidated before materialization.`
    ]))
  });

  return persistDesignSubmission({
    projectRoot,
    context,
    proposalSet,
    providerMode: baseDesignRun.providerMode,
    providerName: `${input.editedBy ?? "browser"}-editor`,
    modelIdentifier: baseDesignRun.modelIdentifier,
    reasoningProfile: baseDesignRun.reasoningProfile,
    now: input.now,
    metadata: {
      editOfDesignRunId: input.designRunId,
      editedProposalId: input.proposalId,
      editedFields: Object.keys(edit).sort()
    }
  });
}

function resolveLoopDesignProviderOptions(
  providerMode: LoopDesignProviderMode,
  input: LoopDesignProviderOptions
): ResolvedLoopDesignProviderOptions {
  return {
    reasoningProfile: input.reasoningProfile ?? "high",
    maxProposals: clampInteger(input.maxProposals, 1, 5, DEFAULT_LOOP_DESIGN_MAX_PROPOSALS),
    allowNovelDesigns: input.allowNovelDesigns ?? false,
    providerMode: input.providerMode ?? providerMode,
    redactionPolicy: input.redactionPolicy ?? "safe_summary_only",
    timeoutMs: clampInteger(input.timeoutMs, 1_000, 600_000, DEFAULT_LOOP_DESIGN_TIMEOUT_MS),
    repairAttemptLimit: clampInteger(
      input.repairAttemptLimit,
      0,
      DEFAULT_LOOP_DESIGN_REPAIR_ATTEMPT_LIMIT,
      DEFAULT_LOOP_DESIGN_REPAIR_ATTEMPT_LIMIT
    )
  };
}

function applyLoopDesignRedactionPolicy(
  context: LoopDesignContext,
  redactionPolicy: LoopDesignRedactionPolicy
): LoopDesignContext {
  if (redactionPolicy === "safe_summary_only") {
    return context;
  }
  return context;
}

async function callLoopDesignProviderWithTimeout(
  provider: LoopDesignProvider,
  context: LoopDesignContext,
  options: ResolvedLoopDesignProviderOptions
): Promise<LoopDesignProviderOutput> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    const timeoutPromise = new Promise<LoopDesignProviderOutput>((_resolve, reject) => {
      timeout = setTimeout(() => {
        reject(new Error(`LoopDesignProvider ${provider.id} timed out after ${options.timeoutMs}ms`));
      }, options.timeoutMs);
    });
    return await Promise.race([
      provider.design(context, options),
      timeoutPromise
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

function sanitizeProviderMetadata(metadata?: LoopDesignProviderMetadata): LoopDesignProviderMetadata {
  if (!metadata) return {};
  return Object.fromEntries(
    Object.entries(metadata).filter((entry) => entry[1] !== undefined)
  ) as LoopDesignProviderMetadata;
}

function clampInteger(value: number | undefined, min: number, max: number, fallback: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, Math.trunc(value)));
}

export function validateLoopDesignProposalSet(
  proposalSet: LoopDesignProposalSet,
  context: LoopDesignContext
): string[] {
  const errors: string[] = [];
  const proposalIds = new Set<string>();
  const loopSpecIds = new Set<string>();
  const existingLoopIds = new Set(context.existingLoops.map((loop) => loop.loopId));

  for (const proposal of proposalSet.proposals) {
    if (proposalIds.has(proposal.proposalId)) errors.push(`Duplicate proposalId: ${proposal.proposalId}`);
    proposalIds.add(proposal.proposalId);
    if (loopSpecIds.has(proposal.loopSpecId)) errors.push(`Duplicate loopSpecId: ${proposal.loopSpecId}`);
    loopSpecIds.add(proposal.loopSpecId);
    if (existingLoopIds.has(proposal.loopSpecId)) errors.push(`Proposal duplicates an existing loop: ${proposal.loopSpecId}`);
    if (proposal.department !== context.departmentType) {
      errors.push(`Proposal ${proposal.proposalId} department does not match design context`);
    }
    if (!proposal.ownerRole.trim()) errors.push(`Proposal ${proposal.proposalId} is missing an owner`);
    if (!proposal.metrics.primary.trim()) errors.push(`Proposal ${proposal.proposalId} is missing a primary metric`);
    if (proposal.metrics.guardrails.length === 0) errors.push(`Proposal ${proposal.proposalId} is missing a guardrail metric`);
    if (proposal.verifiers.length === 0) errors.push(`Proposal ${proposal.proposalId} is missing verification rules`);
    if (proposal.connectorRequirements.length > 0 && proposal.manualFallbacks.length === 0) {
      errors.push(`Proposal ${proposal.proposalId} has connector requirements but no manual fallback`);
    }
    for (const action of proposal.proposedActions) {
      if ((action.customerFacing || ["high", "critical"].includes(action.riskLevel)) && !action.requiresApproval) {
        errors.push(`Proposal ${proposal.proposalId} action ${action.key} requires explicit approval`);
      }
    }
    if (proposal.routing.minimumConfidence < 0.5) {
      errors.push(`Proposal ${proposal.proposalId} routing confidence threshold is too low`);
    }
  }

  return errors;
}

function applyLoopDesignProposalEdit(
  proposal: LoopDesignProposal,
  edit: LoopDesignProposalEdit
): LoopDesignProposal {
  const trigger: LoopDesignProposal["trigger"] = {
    ...proposal.trigger,
    ...(edit.triggerType ? { type: edit.triggerType } : {}),
    ...(edit.triggerDescription ? { description: edit.triggerDescription } : {}),
    ...(edit.triggerCadence ? { cadence: edit.triggerCadence } : {})
  };
  const metrics: LoopDesignProposal["metrics"] = {
    primary: edit.metricsPrimary ?? proposal.metrics.primary,
    guardrails: edit.metricsGuardrails ?? proposal.metrics.guardrails
  };
  const leading = edit.metricsLeading ?? proposal.metrics.leading;
  if (leading) metrics.leading = leading;
  const baselineState = edit.metricsBaselineState ?? proposal.metrics.baselineState;
  if (baselineState) metrics.baselineState = baselineState;
  const connectorRequirements = edit.connectorRequirements ?? proposal.connectorRequirements;
  const priorConnectorRoutingCapabilities = new Set(proposal.connectorRequirements
    .filter((requirement) => requirement.requiredFor !== "design")
    .map((requirement) => requirement.capability));
  const preservedRoutingConnections = proposal.routing.requiredConnections.filter((capability) =>
    !priorConnectorRoutingCapabilities.has(capability)
  );
  const shortName = edit.shortName ?? proposal.shortName;
  const next = loopDesignProposalSchema.parse({
    ...proposal,
    ...(edit.shortName ? { shortName } : {}),
    ...(edit.goal ? { goal: edit.goal } : {}),
    ...(edit.businessOutcome ? { businessOutcome: edit.businessOutcome } : {}),
    ...(edit.reasoningSummary ? { reasoningSummary: edit.reasoningSummary } : {}),
    trigger,
    ...(edit.workItem ? { workItem: edit.workItem } : {}),
    ...(edit.observedSignals ? { observedSignals: edit.observedSignals } : {}),
    ...(edit.contextSources ? { contextSources: edit.contextSources } : {}),
    ...(edit.routineSteps ? { routineSteps: edit.routineSteps } : {}),
    ...(edit.proposedActions ? { proposedActions: edit.proposedActions } : {}),
    ...(edit.verifiers ? { verifiers: edit.verifiers } : {}),
    metrics,
    ...(edit.ownerRole ? { ownerRole: edit.ownerRole } : {}),
    ...(edit.reviewerRoles ? { reviewerRoles: edit.reviewerRoles } : {}),
    ...(edit.escalationConditions ? { escalationConditions: edit.escalationConditions } : {}),
    ...(edit.forbiddenActions ? { forbiddenActions: edit.forbiddenActions } : {}),
    connectorRequirements,
    ...(edit.manualFallbacks ? { manualFallbacks: edit.manualFallbacks } : {}),
    ...(edit.requiredFromUser ? { requiredFromUser: edit.requiredFromUser } : {}),
    topologyPreview: topologyPreview(
      formatDepartmentType(proposal.department),
      shortName,
      proposal.loopSpecId,
      connectorRequirements.map((requirement) => requirement.capability)
    ),
    routing: {
      ...proposal.routing,
      ...(edit.routingProblemTypes ? { problemTypes: edit.routingProblemTypes } : {}),
      ...(edit.routingMinimumConfidence !== undefined ? { minimumConfidence: edit.routingMinimumConfidence } : {}),
      ...(edit.routingActivationMode ? { activationMode: edit.routingActivationMode } : {}),
      requiredConnections: uniqueStrings([
        ...preservedRoutingConnections,
        ...connectorRequirements
          .filter((requirement) => requirement.requiredFor !== "design")
          .map((requirement) => requirement.capability)
      ])
    }
  });
  return next;
}

async function persistDesignSubmission(input: {
  projectRoot: string;
  context: LoopDesignContext;
  proposalSet: LoopDesignProposalSet;
  providerMode: DesignRun["providerMode"];
  providerName?: string;
  modelIdentifier?: string;
  reasoningProfile: "standard" | "high";
  now?: Date;
  metadata?: Record<string, unknown>;
}): Promise<LoopDesignSubmissionResult> {
  const nowIso = (input.now ?? new Date()).toISOString();
  const errors = validateLoopDesignProposalSet(input.proposalSet, input.context);
  const proposalSet = loopDesignProposalSetSchema.parse({
    ...input.proposalSet,
    validationSummary: {
      valid: errors.length === 0,
      errors
    }
  });
  const designRun = designRunSchema.parse({
    schemaVersion: DESIGN_RUN_SCHEMA_VERSION,
    id: `design_${contentHash({ contextHash: input.context.contextHash, proposalSet, at: nowIso })}`,
    sessionId: input.context.sessionId,
    departmentType: input.context.departmentType,
    providerMode: input.providerMode,
    providerName: input.providerName,
    modelIdentifier: input.modelIdentifier,
    reasoningProfile: input.reasoningProfile,
    promptVersion: "loop-design-prompt/v1alpha1",
    inputHash: input.context.contextHash,
    outputHash: `out_${contentHash(proposalSet)}`,
    startedAt: nowIso,
    completedAt: nowIso,
    validationAttempts: 1,
    validationErrors: errors,
    finalProposalIds: errors.length === 0 ? proposalSet.proposals.map((proposal) => proposal.proposalId) : [],
    metadata: {
      ...(input.metadata ?? {}),
      proposalCount: proposalSet.proposals.length
    }
  });
  const designRunPath = designRunFilePath(input.projectRoot, designRun.id);
  const proposalSetPath = proposalSetFilePath(input.projectRoot, designRun.id);
  await writeJson(designRunPath, designRun);
  await writeJson(proposalSetPath, proposalSet);
  await appendDesignRunToSession(input.projectRoot, input.context.sessionId, designRun.id);

  return {
    valid: errors.length === 0,
    errors,
    designRun,
    ...(errors.length === 0 ? { proposalSet } : {}),
    proposalSetPath,
    designRunPath
  };
}

function deterministicCandidatesForDepartment(departmentType: DepartmentType): LoopDesignContext["deterministicCandidates"] {
  if (departmentType === "marketing") {
    return [
      {
        id: "marketing_ads",
        name: "Ads",
        whyCandidate: "Marketing answers commonly split paid acquisition monitoring from content production.",
        expectedRoutingProblemTypes: ["paid_acquisition_efficiency_drop"],
        requiredCapabilities: ["ads.read", "crm.read", "analytics.read"]
      },
      {
        id: "marketing_content_creation",
        name: "Content Creation",
        whyCandidate: "Content work has different sources, approvals, and routing signals than paid ads.",
        expectedRoutingProblemTypes: ["approved_content_work_item"],
        requiredCapabilities: ["content_repository.read", "content_repository.draft_write", "cms.draft"]
      }
    ];
  }

  if (departmentType === "legal_compliance") {
    return [{
      id: "legal_compliance_evidence_review",
      name: "Legal / Compliance Evidence Review",
      whyCandidate: "Sensitive compliance work should start as an evidence packet and expert-review loop, not autonomous legal judgment.",
      expectedRoutingProblemTypes: ["legal_compliance_review_required"],
      requiredCapabilities: ["policy_repository.read", "compliance_evidence.read", "contract_repository.read"]
    }];
  }

  if (departmentType === "hr_talent") {
    return [{
      id: "hr_talent_evidence_review",
      name: "HR / Talent Evidence Review",
      whyCandidate: "Sensitive people workflows need data minimization, human judgment, and strict blocking for employment decisions.",
      expectedRoutingProblemTypes: ["hr_talent_review_required"],
      requiredCapabilities: ["ats.read", "hris.read", "people_policy.read"]
    }];
  }

  return [{
    id: `${departmentType}_operating_loop`,
    name: `${formatDepartmentType(departmentType)} Operating Loop`,
    whyCandidate: "A first loop should make one recurring workflow observable, reviewable, and measurable.",
    expectedRoutingProblemTypes: [`${departmentType}_recurring_work`],
    requiredCapabilities: ["manual_input", "trace.write"]
  }];
}

function proposalCandidates(context: LoopDesignContext): LoopDesignProposal[] {
  if (context.departmentType === "marketing") return marketingProposals(context);
  if (isSensitiveDepartment(context.departmentType)) return [sensitiveDepartmentProposal(context)];
  return [genericDepartmentProposal(context)];
}

function isSensitiveDepartment(departmentType: DepartmentType): boolean {
  return departmentType === "hr_talent" || departmentType === "legal_compliance";
}

function marketingProposals(context: LoopDesignContext): LoopDesignProposal[] {
  const owner = answerString(context.confirmedAnswers, "ownership_rollout.loop_owner_role") || "Marketing owner";
  const reviewers = answerStringArray(context.confirmedAnswers, "ownership_rollout.reviewer_roles", ["Marketing lead"]);
  const escalations = answerStringArray(context.confirmedAnswers, "ownership_rollout.escalation_conditions", ["Confidence is low", "Approval threshold is crossed"]);
  const forbiddenActions = answerStringArray(context.confirmedAnswers, "automation_boundaries.forbidden_actions", ["No publishing or budget changes without approval"]);
  const manualFallbacks = answerStringArray(context.confirmedAnswers, "current_stack_sources.manual_fallbacks", ["Manual CSV/JSON export"]);
  const contextSources = answerStringArray(context.confirmedAnswers, "current_stack_sources.systems", ["Ads platform", "CRM", "Analytics"]);
  const primaryMetric = answerString(context.confirmedAnswers, "ideal_outcome_proof.primary_outcome_metric") || "Cost per qualified lead/customer";
  const guardrail = answerString(context.confirmedAnswers, "ideal_outcome_proof.guardrail_metric") || "Qualified conversion quality must not decline";
  const verificationRules = answerStringArray(context.confirmedAnswers, "ideal_outcome_proof.verification_rules", ["Output cites approved evidence"]);
  const rolloutStage = normalizeRollout(answerString(context.confirmedAnswers, "ownership_rollout.initial_autonomy_level"));
  const routingPreferences = routingPreferencesFromAnswers(context);
  const routingPolicy = routingPolicyFromPreferences(routingPreferences);

  return [
    {
      proposalId: "proposal_marketing_ads",
      loopSpecId: "marketing_ads",
      shortName: "Ads",
      department: "marketing",
      goal: `Improve ${primaryMetric} by catching paid acquisition problems early.`,
      businessOutcome: "Paid campaigns get faster, safer recommendations without optimizing for low-quality proxy metrics.",
      reasoningSummary: "The answers identify paid acquisition systems, downstream qualification, approval thresholds, and measurement guardrails; this should be a separate loop from content because the triggers, risks, and required connectors differ.",
      assumptions: [
        "Campaign IDs are stable across ads and downstream reporting.",
        "Manual export can provide enough evidence before connectors are live.",
        ...routingPreferenceAssumptions(routingPreferences)
      ],
      openQuestions: [],
      alternativesConsidered: ["A generic marketing loop was rejected because spend decisions need tighter approval and routing rules."],
      evidenceRefs: evidenceRefsForBundle(context, ["current_stack_sources", "biggest_recurring_problem", "ideal_outcome_proof"]),
      trigger: {
        type: "event",
        description: routingTriggerDescription(
          "A campaign performance anomaly or scheduled detector event arrives through Hermes.",
          routingPreferences
        )
      },
      workItem: "One campaign, channel, or audience segment with a qualified-efficiency anomaly.",
      observedSignals: uniqueStrings([
        "Spend delta",
        "Cost per qualified lead/customer delta",
        "Qualified conversion delta",
        "Sample size",
        ...routingPreferences.requiredEvidence
      ]),
      contextSources,
      routineSteps: [
        step("observe", "Observe campaign evidence", "system", "Read the normalized campaign event and available downstream quality evidence."),
        step("assess", "Assess qualified efficiency", "agent", "Compare spend movement against qualified conversion and guardrail metrics."),
        step("prepare", "Prepare recommendation", "agent", "Draft a pause, continue, scale, or investigate recommendation with evidence."),
        step("verify", "Verify policy and metrics", "system", "Check required evidence, guardrails, and approval thresholds."),
        step("review", "Request approval", "human", "Route spend or audience changes to the configured reviewer before action.")
      ],
      proposedActions: [
        { key: "draft_campaign_recommendation", label: "Draft campaign recommendation", riskLevel: "low", requiresApproval: false, customerFacing: false },
        { key: "request_budget_or_audience_change", label: "Request budget/audience change", riskLevel: "high", requiresApproval: true, customerFacing: false }
      ],
      verifiers: verificationRules.map((rule) => ({ type: "evidence" as const, description: rule })),
      metrics: { primary: primaryMetric, guardrails: [guardrail], baselineState: answerString(context.confirmedAnswers, "ideal_outcome_proof.baseline_target") },
      ownerRole: owner,
      reviewerRoles: reviewers,
      escalationConditions: escalations,
      forbiddenActions,
      connectorRequirements: [
        { capability: "ads.read", reason: "Read campaign spend, audience, and creative performance.", requiredFor: "routing" },
        { capability: "crm.read", reason: "Verify qualified lead/customer quality.", requiredFor: "execution" },
        { capability: "analytics.read", reason: "Check activation or downstream guardrails.", requiredFor: "execution" }
      ],
      manualFallbacks,
      readinessTarget: "simulation_ready",
      rolloutStage,
      requiredFromUser: [
        { type: "connection", label: "Connect ads read data or provide fixture export", reason: "The loop needs spend and campaign signals." },
        { type: "connection", label: "Connect qualified outcome source or provide manual CSV", reason: "The loop should not optimize on spend-only proxy metrics." },
        { type: "policy", label: "Confirm spend-change approval threshold", reason: "Budget and audience changes are high-risk actions." }
      ],
      topologyPreview: topologyPreview("Marketing", "Ads", "marketing_ads", ["Ads platform", "CRM"]),
      routing: {
        schemaVersion: "routing-contract/v1alpha1",
        problemTypes: ["paid_acquisition_efficiency_drop"],
        accepts: [{
          sourcePattern: "google_ads*",
          eventTypePattern: "campaign.*",
          subjectTypes: ["campaign"],
          requiredFields: ["signals.spendDeltaPct", "signals.costPerQualifiedCustomerDeltaPct"],
          reason: "Campaign anomaly includes spend and qualified-cost evidence."
        }],
        excludes: [{
          sourcePattern: "*",
          eventTypePattern: "content.*",
          subjectTypes: ["content_brief"],
          reason: "Content briefs belong to the Content Creation loop."
        }],
        inputMapping: {
          campaignId: "subject.id",
          spendDeltaPct: "signals.spendDeltaPct",
          costPerQualifiedCustomerDeltaPct: "signals.costPerQualifiedCustomerDeltaPct"
        },
        priority: 20,
        minimumConfidence: 0.8,
        ambiguityPolicy: routingPolicy.ambiguityPolicy,
        fanoutPolicy: routingPolicy.fanoutPolicy,
        cooldown: routingPolicy.cooldown,
        concurrency: routingPolicy.concurrency,
        lifecycleEvents: routingPolicy.lifecycleEvents,
        examples: routingExamplesFor(
          routingPreferences,
          "Campaign spend or qualified-efficiency anomaly arrives from Hermes.",
          "Approved content brief or unrelated content work item."
        ),
        activationMode: rolloutStage
      }
    },
    {
      proposalId: "proposal_marketing_content_creation",
      loopSpecId: "marketing_content_creation",
      shortName: "Content Creation",
      department: "marketing",
      goal: "Create evidence-backed content drafts that stay inside brand and claims policy.",
      businessOutcome: "Content work becomes easier to start, review, and improve without unsafe publishing automation.",
      reasoningSummary: "The answers separate content production from paid acquisition because it has different work items, evidence sources, review steps, and publishing boundaries.",
      assumptions: [
        "Approved evidence and reviewer identity are present before the loop drafts content.",
        "Publishing remains approval-gated.",
        ...routingPreferenceAssumptions(routingPreferences)
      ],
      openQuestions: [],
      alternativesConsidered: ["Combining content and ads was rejected because content drafts should route on approved briefs rather than campaign anomalies."],
      evidenceRefs: evidenceRefsForBundle(context, ["current_stack_sources", "automation_boundaries", "ownership_rollout"]),
      trigger: {
        type: "event",
        description: routingTriggerDescription(
          "An approved content brief or calendar item arrives through Hermes.",
          routingPreferences
        )
      },
      workItem: "One approved content brief with evidence, audience, channel, and reviewer context.",
      observedSignals: uniqueStrings([
        "Approved evidence references",
        "Target channel",
        "Reviewer",
        "Brand/claims constraints",
        ...routingPreferences.requiredEvidence
      ]),
      contextSources,
      routineSteps: [
        step("observe", "Observe approved brief", "system", "Read the normalized content brief and approved evidence references."),
        step("draft", "Draft content asset", "agent", "Prepare channel-specific content with cited evidence."),
        step("verify", "Verify claims and brand", "system", "Check evidence coverage, forbidden claims, and channel requirements."),
        step("review", "Route editorial review", "human", "Ask the configured reviewer before anything is published."),
        step("learn", "Capture outcome", "system", "Record review changes and eventual performance for the next draft.")
      ],
      proposedActions: [
        { key: "draft_content_asset", label: "Draft content asset", riskLevel: "medium", requiresApproval: true, customerFacing: true },
        { key: "prepare_review_packet", label: "Prepare review packet", riskLevel: "low", requiresApproval: false, customerFacing: false }
      ],
      verifiers: verificationRules.map((rule) => ({ type: "evidence" as const, description: rule })),
      metrics: { primary: "Approved draft cycle time", guardrails: [guardrail], baselineState: answerString(context.confirmedAnswers, "ideal_outcome_proof.baseline_target") },
      ownerRole: owner,
      reviewerRoles: reviewers,
      escalationConditions: escalations,
      forbiddenActions,
      connectorRequirements: [
        { capability: "content_repository.read", reason: "Read approved briefs and evidence.", requiredFor: "routing" },
        { capability: "content_repository.draft_write", reason: "Write drafts for review without publishing.", requiredFor: "simulation" },
        { capability: "cms.draft", reason: "Optionally create CMS drafts after approval policy is configured.", requiredFor: "execution" }
      ],
      manualFallbacks,
      readinessTarget: "simulation_ready",
      rolloutStage,
      requiredFromUser: [
        { type: "connection", label: "Connect content repository or use local Markdown", reason: "The loop needs approved briefs and evidence sources." },
        { type: "policy", label: "Confirm claims and brand review rules", reason: "Customer-facing content needs explicit review boundaries." },
        { type: "approval", label: "Assign reviewer", reason: "Publishing and claims must remain human-approved." }
      ],
      topologyPreview: topologyPreview("Marketing", "Content Creation", "marketing_content_creation", ["Content repository", "CMS draft"]),
      routing: {
        schemaVersion: "routing-contract/v1alpha1",
        problemTypes: ["approved_content_work_item"],
        accepts: [{
          sourcePattern: "notion*",
          eventTypePattern: "content.*",
          subjectTypes: ["content_brief"],
          requiredFields: ["approvedEvidenceRefs", "reviewer"],
          reason: "An approved content brief has evidence and reviewer context."
        }],
        excludes: [{
          sourcePattern: "google_ads*",
          eventTypePattern: "campaign.*",
          subjectTypes: ["campaign"],
          reason: "Campaign efficiency problems are owned by Ads."
        }],
        inputMapping: {
          briefId: "subject.id",
          evidenceRefs: "approvedEvidenceRefs",
          reviewer: "reviewer"
        },
        priority: 10,
        minimumConfidence: 0.75,
        ambiguityPolicy: routingPolicy.ambiguityPolicy,
        fanoutPolicy: routingPolicy.fanoutPolicy,
        cooldown: routingPolicy.cooldown,
        concurrency: routingPolicy.concurrency,
        lifecycleEvents: routingPolicy.lifecycleEvents,
        examples: routingExamplesFor(
          routingPreferences,
          "Approved content brief arrives through Hermes with evidence and reviewer context.",
          "Campaign spend anomaly or unapproved content idea."
        ),
        activationMode: rolloutStage
      }
    }
  ].map((proposal) => loopDesignProposalSchema.parse(proposal));
}

function genericDepartmentProposal(context: LoopDesignContext): LoopDesignProposal {
  const departmentLabel = formatDepartmentType(context.departmentType);
  const routingPreferences = routingPreferencesFromAnswers(context);
  const routingPolicy = routingPolicyFromPreferences(routingPreferences);
  const isCustomDepartment = context.departmentType === "custom";
  const sourcePattern = isCustomDepartment ? "custom_app*" : "manual*";
  const eventTypePattern = isCustomDepartment ? "custom_work_item.*" : "work_item.*";
  const triggerType = isCustomDepartment ? "event" : "manual";
  const rolloutStage = normalizeRollout(answerString(context.confirmedAnswers, "ownership_rollout.initial_autonomy_level"));
  return loopDesignProposalSchema.parse({
    proposalId: `proposal_${context.departmentType}_operating_loop`,
    loopSpecId: `${context.departmentType}_operating_loop`,
    shortName: `${departmentLabel} Operating Loop`,
    department: context.departmentType,
    goal: `Make one recurring ${departmentLabel} workflow observable, reviewable, and measurable.`,
    businessOutcome: "The team gets a safe first loop with explicit ownership, evidence, and review controls.",
    reasoningSummary: "The deterministic fallback proposes a conservative operating loop until a department-specific design is submitted by Hermes high reasoning.",
    assumptions: [
      "The user will refine this proposal before materialization.",
      ...routingPreferenceAssumptions(routingPreferences)
    ],
    openQuestions: context.blockers,
    alternativesConsidered: [],
    evidenceRefs: context.confirmedAnswers.map((answer) => answer.answerId),
    trigger: {
      type: triggerType,
      description: routingTriggerDescription(
        isCustomDepartment
          ? "A custom application event arrives through Hermes."
          : "Manual or scheduled work item intake.",
        routingPreferences
      )
    },
    workItem: `One recurring ${departmentLabel} work item.`,
    observedSignals: uniqueStrings(["Work item", "Owner", "Status", "Evidence", ...routingPreferences.requiredEvidence]),
    contextSources: answerStringArray(context.confirmedAnswers, "current_stack_sources.systems", ["Manual input"]),
    routineSteps: [
      step("observe", "Observe work item", "system", "Capture the work item and current evidence."),
      step("prepare", "Prepare recommendation", "agent", "Draft a safe next action with evidence."),
      step("review", "Review output", "human", "Ask the owner before any risky action.")
    ],
    proposedActions: [{ key: "draft_next_action", label: "Draft next action", riskLevel: "low", requiresApproval: false, customerFacing: false }],
    verifiers: [{ type: "evidence", description: "Output cites the supplied evidence." }],
    metrics: { primary: answerString(context.confirmedAnswers, "ideal_outcome_proof.primary_outcome_metric") || "Cycle time", guardrails: [answerString(context.confirmedAnswers, "ideal_outcome_proof.guardrail_metric") || "Quality must not decline"] },
    ownerRole: answerString(context.confirmedAnswers, "ownership_rollout.loop_owner_role") || `${departmentLabel} owner`,
    reviewerRoles: answerStringArray(context.confirmedAnswers, "ownership_rollout.reviewer_roles", [`${departmentLabel} owner`]),
    escalationConditions: answerStringArray(context.confirmedAnswers, "ownership_rollout.escalation_conditions", ["Low confidence"]),
    forbiddenActions: answerStringArray(context.confirmedAnswers, "automation_boundaries.forbidden_actions", []),
    connectorRequirements: [{ capability: "manual_input", reason: "Use manual data before provider connectors are ready.", requiredFor: "simulation" }],
    manualFallbacks: ["Manual JSON/CSV fixture"],
    readinessTarget: "simulation_ready",
    rolloutStage,
    requiredFromUser: [{ type: "sample_data", label: "Provide one synthetic or redacted sample", reason: "The loop needs a starter fixture for simulation." }],
    topologyPreview: topologyPreview(departmentLabel, `${departmentLabel} Operating Loop`, `${context.departmentType}_operating_loop`, ["Manual input"]),
    routing: {
      schemaVersion: "routing-contract/v1alpha1",
      problemTypes: [`${context.departmentType}_recurring_work`],
      accepts: [{ sourcePattern, eventTypePattern, subjectTypes: ["work_item"], requiredFields: ["summary"] }],
      inputMapping: { workItemId: "subject.id", summary: "summary" },
      ambiguityPolicy: routingPolicy.ambiguityPolicy,
      fanoutPolicy: routingPolicy.fanoutPolicy,
      cooldown: routingPolicy.cooldown,
      concurrency: routingPolicy.concurrency,
      lifecycleEvents: routingPolicy.lifecycleEvents,
      examples: routingExamplesFor(
        routingPreferences,
        "Recurring work item arrives with the required summary and evidence.",
        "One-off request, test item, or already-handled work."
      ),
      minimumConfidence: 0.8,
      activationMode: rolloutStage
    }
  });
}

function sensitiveDepartmentProposal(context: LoopDesignContext): LoopDesignProposal {
  const departmentLabel = formatDepartmentType(context.departmentType);
  const legal = context.departmentType === "legal_compliance";
  const loopSpecId = legal ? "legal_compliance_evidence_review" : "hr_talent_evidence_review";
  const proposalId = `proposal_${loopSpecId}`;
  const shortName = legal ? "Legal / Compliance Evidence Review" : "HR / Talent Evidence Review";
  const routingPreferences = routingPreferencesFromAnswers(context);
  const contextSources = answerStringArray(context.confirmedAnswers, "current_stack_sources.systems", legal
    ? ["Policy repository", "Compliance evidence store", "Contract repository"]
    : ["ATS", "HRIS", "People policy repository"]);
  const manualFallbacks = answerStringArray(context.confirmedAnswers, "current_stack_sources.manual_fallbacks", [
    "Synthetic or redacted evidence packet"
  ]);
  const forbiddenActions = uniqueStrings([
    ...answerStringArray(context.confirmedAnswers, "automation_boundaries.forbidden_actions", []),
    ...(legal
      ? ["no legal interpretation without expert approval", "no risk acceptance", "no contract change", "no external send"]
      : ["no automated ranking", "no rejection or hiring decision", "no compensation or employment decision", "no sensitive-data exposure"])
  ]);
  const reviewerRoles = answerStringArray(context.confirmedAnswers, "ownership_rollout.reviewer_roles", legal
    ? ["Legal counsel", "Compliance owner"]
    : ["People leader", "HR policy reviewer"]);
  const ownerRole = answerString(context.confirmedAnswers, "ownership_rollout.loop_owner_role") ||
    (legal ? "Compliance owner" : "People operations owner");
  const requestedRollout = answerString(context.confirmedAnswers, "ownership_rollout.initial_autonomy_level");
  const strictBlockingAssumptions = [
    `Requested initial autonomy "${requestedRollout ?? "shadow"}" is capped at shadow for ${departmentLabel} until expert review policy and connector readiness are proven.`,
    "Hermes may classify and propose a route, but Loopgraph must validate the registered routing card and keep live execution blocked while the loop is shadow-only.",
    "Sensitive raw payloads should be excluded from model context; only approved, redacted evidence references should enter the loop."
  ];
  const defaultRequiredEvidence = legal
    ? ["approvedSourceRefs", "expertReviewer", "redactionConfirmed"]
    : ["approvedEvidenceRefs", "humanReviewer", "protectedDataExcluded"];
  const requiredFields = uniqueStrings([
    ...defaultRequiredEvidence,
    ...routingPreferences.requiredEvidence
      .map((item) => item.replace(/[^a-zA-Z0-9_.]+/g, ""))
      .filter(Boolean)
  ]).slice(0, 6);
  const sourcePattern = legal ? "vanta*" : "ats*";
  const eventTypePattern = legal ? "questionnaire.*" : "people_workflow.*";
  const subjectType = legal ? "compliance_request" : "people_work_item";
  const problemType = legal ? "legal_compliance_review_required" : "hr_talent_review_required";

  return loopDesignProposalSchema.parse({
    proposalId,
    loopSpecId,
    shortName,
    department: context.departmentType,
    goal: legal
      ? "Prepare expert-reviewed compliance evidence packets without making legal decisions or sending external answers."
      : "Prepare minimized, human-reviewed people-work evidence packets without making employment decisions.",
    businessOutcome: legal
      ? "Compliance requests move faster while risk acceptance, legal interpretation, contract changes, and external sends remain expert-owned."
      : "People workflows get better evidence and follow-up while ranking, hiring, rejection, compensation, discipline, and employment decisions remain human-owned.",
    reasoningSummary: `The answers describe ${departmentLabel} work with sensitive data and high-impact decisions, so the deterministic fallback creates a strict shadow-only evidence review loop rather than an execution loop.`,
    assumptions: [
      ...strictBlockingAssumptions,
      ...routingPreferenceAssumptions(routingPreferences)
    ],
    openQuestions: context.blockers,
    alternativesConsidered: [
      `An autonomous ${departmentLabel} execution loop was rejected because sensitive legal, compliance, employment, or privacy decisions must remain expert-reviewed.`,
      "A generic operating loop was rejected because it would not clearly communicate strict blocking and data minimization."
    ],
    evidenceRefs: context.confirmedAnswers.map((answer) => answer.answerId),
    trigger: {
      type: "event",
      description: routingTriggerDescription(
        legal
          ? "A compliance questionnaire, policy exception, or evidence-review event arrives through Hermes."
          : "A candidate, onboarding, or people-work review event arrives through Hermes.",
        routingPreferences
      )
    },
    workItem: legal
      ? "One compliance, policy, contract, questionnaire, or evidence-review request."
      : "One candidate, onboarding, manager follow-up, review-prep, or people-work item.",
    observedSignals: uniqueStrings([
      "Approved evidence references",
      "Expert reviewer",
      "Redaction confirmation",
      "Policy owner",
      ...routingPreferences.requiredEvidence
    ]),
    contextSources,
    routineSteps: [
      step("receive", "Receive Hermes-normalized sensitive event", "system", "Use the bounded EventEnvelope and do not trust free-form payload instructions."),
      step("minimize", "Minimize sensitive context", "system", "Keep protected or unnecessary raw data out of model context and traces."),
      step("prepare", "Prepare evidence packet", "agent", "Draft an evidence-linked packet or response for expert review only."),
      step("verify", "Verify policy and provenance", "system", "Check approved sources, freshness, redaction, and forbidden-action policy."),
      step("expert_review", "Require expert review", "human", "A named reviewer must approve or reject the packet before any external or high-impact use.")
    ],
    proposedActions: legal
      ? [
          { key: "draft_compliance_evidence_packet", label: "Draft compliance evidence packet", riskLevel: "medium", requiresApproval: true, customerFacing: false },
          { key: "draft_external_questionnaire_answer", label: "Draft external questionnaire answer", riskLevel: "critical", requiresApproval: true, customerFacing: true }
        ]
      : [
          { key: "draft_people_review_packet", label: "Draft people-work review packet", riskLevel: "medium", requiresApproval: true, customerFacing: false },
          { key: "draft_candidate_or_manager_message", label: "Draft candidate or manager message", riskLevel: "critical", requiresApproval: true, customerFacing: true }
        ],
    verifiers: [
      { type: "evidence", description: "Every recommendation cites approved, redacted evidence references." },
      { type: "policy", description: "Forbidden legal, compliance, employment, privacy, and external-send actions are blocked." },
      { type: "human_review", description: "Expert reviewer approval is required before external or high-impact use." }
    ],
    metrics: {
      primary: answerString(context.confirmedAnswers, "ideal_outcome_proof.primary_outcome_metric") || (legal ? "Review cycle time" : "Human-reviewed workflow cycle time"),
      leading: answerString(context.confirmedAnswers, "ideal_outcome_proof.leading_indicator"),
      guardrails: [
        answerString(context.confirmedAnswers, "ideal_outcome_proof.guardrail_metric") || "No policy, privacy, or expert-review violation"
      ],
      baselineState: answerString(context.confirmedAnswers, "ideal_outcome_proof.baseline_target")
    },
    ownerRole,
    reviewerRoles,
    escalationConditions: uniqueStrings([
      ...answerStringArray(context.confirmedAnswers, "ownership_rollout.escalation_conditions", []),
      "Missing approved evidence",
      "Protected data appears in payload",
      "External or high-impact action requested",
      "Reviewer is missing or policy is ambiguous"
    ]),
    forbiddenActions,
    connectorRequirements: legal
      ? [
          { capability: "policy_repository.read", reason: "Read approved policy and control text only.", requiredFor: "routing" },
          { capability: "compliance_evidence.read", reason: "Read approved evidence references or redacted exports.", requiredFor: "execution" },
          { capability: "contract_repository.read", reason: "Check approved contract or questionnaire context when supplied.", requiredFor: "execution" }
        ]
      : [
          { capability: "ats.read", reason: "Read approved candidate/workflow status only.", requiredFor: "routing" },
          { capability: "hris.read", reason: "Read approved onboarding or people-system status only.", requiredFor: "execution" },
          { capability: "people_policy.read", reason: "Check approved people-policy constraints.", requiredFor: "execution" }
        ],
    manualFallbacks,
    readinessTarget: "simulation_ready",
    rolloutStage: "shadow",
    requiredFromUser: [
      { type: "policy", label: "Confirm sensitive-data redaction policy", reason: "Protected or privileged data must stay out of model context and traces." },
      { type: "approval", label: "Assign expert reviewer", reason: "Expert review is mandatory for sensitive outputs." },
      { type: "sample_data", label: "Provide redacted sample event and evidence packet", reason: "The loop should be simulated before any connector is enabled." }
    ],
    topologyPreview: topologyPreview(
      departmentLabel,
      shortName,
      loopSpecId,
      legal ? ["Policy repository", "Compliance evidence", "Expert review"] : ["ATS", "HRIS", "People policy"]
    ),
    routing: {
      schemaVersion: "routing-contract/v1alpha1",
      problemTypes: [problemType],
      accepts: [{
        sourcePattern,
        eventTypePattern,
        subjectTypes: [subjectType],
        requiredFields,
        reason: legal
          ? "Compliance request has approved sources, expert reviewer, and redaction confirmation."
          : "People-work item has approved evidence, human reviewer, and protected-data exclusion."
      }],
      excludes: [
        {
          sourcePattern: "*",
          eventTypePattern: "decision.*",
          subjectTypes: [subjectType],
          reason: "Decision requests must be handled by a human owner, not automatically routed as evidence-prep work."
        }
      ],
      inputMapping: {
        workItemId: "subject.id",
        approvedEvidenceRefs: requiredFields[0] ?? "approvedEvidenceRefs",
        reviewer: requiredFields[1] ?? "expertReviewer"
      },
      priority: 30,
      minimumConfidence: 0.9,
      ambiguityPolicy: "request_human",
      fanoutPolicy: { mode: "none", maxRoutes: 1, requiresIndependentProblems: true },
      cooldown: { seconds: 0, dedupeWindowSeconds: 86400 },
      concurrency: { maxActive: 1, strategy: "reject" },
      lifecycleEvents: routingPolicyFromPreferences(routingPreferences).lifecycleEvents,
      examples: routingExamplesFor(
        routingPreferences,
        legal
          ? "Compliance questionnaire request includes approvedSourceRefs, expertReviewer, and redactionConfirmed."
          : "People-work review event includes approvedEvidenceRefs, humanReviewer, and protectedDataExcluded.",
        "Any request asking Hermes or Loopgraph to make a final legal, compliance, hiring, rejection, compensation, discipline, access, or external-send decision."
      ),
      activationMode: "shadow"
    }
  });
}

type RoutingAnswerPreferences = {
  eventSourcesSubjects?: string;
  problemSignal?: string;
  requiredEvidence: string[];
  ignoreConditions: string[];
  completionSignals: string[];
  failureSignals: string[];
  repeatPolicy?: string;
  ambiguityPolicy?: string;
  fanoutPolicy?: string;
  urgencyPriority?: string;
};

function routingPreferencesFromAnswers(context: LoopDesignContext): RoutingAnswerPreferences {
  return {
    eventSourcesSubjects: answerString(context.confirmedAnswers, "current_stack_sources.event_sources_subjects"),
    problemSignal: answerString(context.confirmedAnswers, "biggest_recurring_problem.problem_signal"),
    requiredEvidence: answerStringArray(context.confirmedAnswers, "biggest_recurring_problem.required_evidence", []),
    ignoreConditions: answerStringArray(context.confirmedAnswers, "automation_boundaries.ignore_conditions", []),
    completionSignals: answerStringArray(context.confirmedAnswers, "ideal_outcome_proof.completion_signal", []),
    failureSignals: answerStringArray(context.confirmedAnswers, "ideal_outcome_proof.failure_signal", []),
    repeatPolicy: answerString(context.confirmedAnswers, "ownership_rollout.repeat_policy"),
    ambiguityPolicy: answerString(context.confirmedAnswers, "automation_boundaries.ambiguity_policy"),
    fanoutPolicy: answerString(context.confirmedAnswers, "automation_boundaries.fanout_policy"),
    urgencyPriority: answerString(context.confirmedAnswers, "ownership_rollout.urgency_priority")
  };
}

function routingPolicyFromPreferences(
  preferences: RoutingAnswerPreferences
): Pick<LoopDesignProposal["routing"], "ambiguityPolicy" | "fanoutPolicy" | "cooldown" | "concurrency" | "lifecycleEvents"> {
  const repeatPolicy = preferences.repeatPolicy?.toLowerCase() ?? "";
  const queueRepeated = repeatPolicy.includes("queue");
  const rejectRepeated = repeatPolicy.includes("cooldown") || repeatPolicy.includes("ignore");
  const allowNewWork = repeatPolicy.includes("new");

  return {
    ambiguityPolicy: normalizeAmbiguityPolicy(preferences.ambiguityPolicy),
    fanoutPolicy: normalizeFanoutPolicy(preferences.fanoutPolicy),
    cooldown: rejectRepeated
      ? { seconds: 1800, dedupeWindowSeconds: 3600 }
      : { seconds: 0, dedupeWindowSeconds: allowNewWork ? 0 : 3600 },
    concurrency: {
      maxActive: 1,
      strategy: queueRepeated ? "queue" : rejectRepeated ? "reject" : "append_evidence"
    },
    lifecycleEvents: [
      "loop.route.accepted",
      "loop.run.started",
      "loop.run.completed",
      "loop.review.required",
      "loop.run.failed",
      "loop.escalation.created",
      "loop.outcome.recorded",
      "loop.problem.unhandled"
    ]
  };
}

function normalizeAmbiguityPolicy(value?: string): LoopDesignProposal["routing"]["ambiguityPolicy"] {
  const normalized = value?.toLowerCase().trim() ?? "";
  if (normalized.includes("defer")) return "defer";
  if (normalized.includes("triage")) return "route_to_triage";
  if (normalized.includes("ignore")) return "ignore";
  return "request_human";
}

function normalizeFanoutPolicy(value?: string): LoopDesignProposal["routing"]["fanoutPolicy"] {
  const normalized = value?.toLowerCase().trim() ?? "";
  if (normalized.includes("ordered")) {
    return { mode: "declared_ordered", maxRoutes: 2, requiresIndependentProblems: true };
  }
  if (normalized.includes("independent") || normalized.includes("multiple") || normalized.includes("fan")) {
    return { mode: "independent_only", maxRoutes: 2, requiresIndependentProblems: true };
  }
  return { mode: "none", maxRoutes: 1, requiresIndependentProblems: true };
}

function routingPreferenceAssumptions(preferences: RoutingAnswerPreferences): string[] {
  return [
    preferences.eventSourcesSubjects ? `Hermes event source and subject intent: ${preferences.eventSourcesSubjects}` : undefined,
    preferences.problemSignal ? `Routing problem signal: ${preferences.problemSignal}` : undefined,
    preferences.requiredEvidence.length > 0 ? `Required routing evidence: ${preferences.requiredEvidence.join("; ")}` : undefined,
    preferences.ignoreConditions.length > 0 ? `Routing ignore conditions: ${preferences.ignoreConditions.join("; ")}` : undefined,
    preferences.completionSignals.length > 0 ? `Completion signals: ${preferences.completionSignals.join("; ")}` : undefined,
    preferences.failureSignals.length > 0 ? `Failure signals that should return to Hermes: ${preferences.failureSignals.join("; ")}` : undefined,
    preferences.repeatPolicy ? `Repeat policy: ${preferences.repeatPolicy}` : undefined,
    preferences.urgencyPriority ? `Urgency and priority: ${preferences.urgencyPriority}` : undefined
  ].filter((item): item is string => Boolean(item));
}

function routingTriggerDescription(defaultDescription: string, preferences: RoutingAnswerPreferences): string {
  const details = [
    preferences.problemSignal ? `User-described problem signal: ${preferences.problemSignal}` : undefined,
    preferences.eventSourcesSubjects ? `Source/subject: ${preferences.eventSourcesSubjects}` : undefined
  ].filter(Boolean);
  return details.length > 0 ? `${defaultDescription} ${details.join(" ")}` : defaultDescription;
}

function routingExamplesFor(
  preferences: RoutingAnswerPreferences,
  defaultShouldRoute: string,
  defaultShouldNotRoute: string
): LoopDesignProposal["routing"]["examples"] {
  return {
    shouldRoute: uniqueStrings([
      preferences.problemSignal,
      ...preferences.requiredEvidence.map((item) => `Event includes ${item}`),
      defaultShouldRoute
    ].filter((item): item is string => Boolean(item))),
    shouldNotRoute: uniqueStrings([
      ...preferences.ignoreConditions,
      defaultShouldNotRoute
    ])
  };
}

function step(
  id: string,
  label: string,
  actor: "agent" | "human" | "system",
  description: string
) {
  return { id, label, actor, description };
}

function topologyPreview(departmentLabel: string, loopLabel: string, loopId: string, connectors: string[]) {
  const departmentId = `department:${departmentLabel.toLowerCase().replace(/[^a-z0-9]+/g, "_")}`;
  return {
    nodes: [
      { id: "company_brain", label: "Hermes Brain", type: "company_brain" as const },
      { id: departmentId, label: departmentLabel, type: "department" as const },
      { id: `loop:${loopId}`, label: loopLabel, type: "loop" as const },
      ...connectors.map((connector) => ({
        id: `connector:${connector.toLowerCase().replace(/[^a-z0-9]+/g, "_")}`,
        label: connector,
        type: "connector" as const
      }))
    ],
    edges: [
      { source: "company_brain", target: departmentId, label: "structural", executable: false },
      { source: departmentId, target: `loop:${loopId}`, label: "workflow", executable: false },
      ...connectors.map((connector) => ({
        source: `connector:${connector.toLowerCase().replace(/[^a-z0-9]+/g, "_")}`,
        target: `loop:${loopId}`,
        label: "required data",
        executable: false
      }))
    ]
  };
}

function inferConnectorStatus(answers: DiscoveryAnswer[]): LoopDesignContext["connectorStatus"] {
  const safeReads = answerArray(answers, "current_stack_sources.safe_reads");
  const manualFallbacks = answerArray(answers, "current_stack_sources.manual_fallbacks");
  const systems = answerArray(answers, "current_stack_sources.systems");
  return [
    ...systems.map((system) => ({
      capability: `${system.toLowerCase().replace(/[^a-z0-9]+/g, "_")}.read`,
      status: "missing" as const,
      sourceAnswerIds: answerIds(answers, "current_stack_sources.systems")
    })),
    ...safeReads.map((item) => ({
      capability: item,
      status: manualFallbacks.length > 0 ? "manual_fallback" as const : "missing" as const,
      sourceAnswerIds: answerIds(answers, "current_stack_sources.safe_reads")
    }))
  ];
}

function answerString(answers: LoopDesignContext["confirmedAnswers"], questionId: string): string | undefined {
  const value = answers.find((answer) => answer.questionId === questionId)?.value;
  return typeof value === "string" && value.trim().length > 0 ? value : undefined;
}

function answerStringArray(
  answers: LoopDesignContext["confirmedAnswers"],
  questionId: string,
  fallback: string[] = []
): string[] {
  const value = answers.find((answer) => answer.questionId === questionId)?.value;
  if (Array.isArray(value)) return value.map(String).filter(Boolean);
  if (typeof value === "string" && value.trim()) return [value];
  return fallback;
}

function answerArray(answers: DiscoveryAnswer[], questionId: string): string[] {
  const value = answers.find((answer) => answer.questionId === questionId)?.value;
  if (Array.isArray(value)) return value.map(String).filter(Boolean);
  if (typeof value === "string" && value.trim()) return [value];
  return [];
}

function answerIds(answers: DiscoveryAnswer[], questionId: string): string[] {
  return answers.filter((answer) => answer.questionId === questionId).map((answer) => answer.id);
}

function evidenceRefsForBundle(context: LoopDesignContext, bundleIds: string[]): string[] {
  return context.confirmedAnswers
    .filter((answer) => bundleIds.includes(answer.bundleId))
    .map((answer) => answer.answerId);
}

function normalizeRollout(value?: string): LoopDesignProposal["rolloutStage"] {
  if (value === "recommend" || value === "simulate" || value === "execute_with_approval" || value === "autonomous_low_risk") {
    return value;
  }
  return "shadow";
}

async function requireSession(sessionId: string, projectRoot: string): Promise<BusinessDiscoverySession> {
  const session = await getDiscoverySession(sessionId, projectRoot);
  if (!session) throw new Error(`Discovery session not found: ${sessionId}`);
  return session;
}

function resolveDesignDepartment(session: BusinessDiscoverySession, requested?: string): DepartmentType {
  if (requested) {
    const normalized = normalizeDepartmentType(requested);
    const match = normalized ? session.selectedDepartmentIds.find((department) => department === normalized) : undefined;
    if (match) return match;
    throw new Error(`Department is not selected in discovery session: ${requested}`);
  }
  if (!session.activeDepartmentId) throw new Error("Discovery session has no active department.");
  return session.activeDepartmentId;
}

async function appendDesignRunToSession(projectRoot: string, sessionId: string, designRunId: string): Promise<void> {
  const session = await requireSession(sessionId, projectRoot);
  const next = BusinessDiscoverySessionSchema.parse({
    ...session,
    designRunIds: Array.from(new Set([...session.designRunIds, designRunId])),
    revision: session.revision + 1,
    activeStage: "proposal_review" as const,
    updatedAt: new Date().toISOString()
  });
  await saveDiscoverySession(next, projectRoot);
}

function designRunFilePath(projectRoot: string, designRunId: string): string {
  return path.join(getLoopgraphRoot(projectRoot), "discovery", "design-runs", `${safeFileId(designRunId)}.json`);
}

function proposalSetFilePath(projectRoot: string, designRunId: string): string {
  return path.join(getLoopgraphRoot(projectRoot), "discovery", "proposals", `${safeFileId(designRunId)}.json`);
}

async function writeJson(filePath: string, data: unknown): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(data, null, 2)}\n`);
}

export async function readDesignRun(projectRoot: string, designRunId: string): Promise<DesignRun | undefined> {
  try {
    return designRunSchema.parse(JSON.parse(await readFile(designRunFilePath(projectRoot, designRunId), "utf8")));
  } catch {
    return undefined;
  }
}

export async function readLoopDesignProposalSet(
  projectRoot: string,
  designRunId: string
): Promise<LoopDesignProposalSet | undefined> {
  try {
    return loopDesignProposalSetSchema.parse(JSON.parse(await readFile(proposalSetFilePath(projectRoot, designRunId), "utf8")));
  } catch {
    return undefined;
  }
}

function safeFileId(value: string): string {
  return value.replace(/[^a-zA-Z0-9_.:-]/g, "_");
}

function uniqueStrings(values: string[]): string[] {
  return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean)));
}
