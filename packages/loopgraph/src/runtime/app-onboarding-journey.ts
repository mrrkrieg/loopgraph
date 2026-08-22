import {
  APP_ONBOARDING_SCHEMA_VERSION,
  appOnboardingJourneySchema,
  type AppActivationApprovalReceipt,
  type AppEvalRun,
  type AppFieldMappingPlan,
  type AppInstallPlan,
  type AppOnboardingJourney,
  type AppOnboardingDraft,
  type AppReadiness,
  type AppSetupDefinition,
  type LoopPackManifest,
  type MarketplaceApp,
  type MarketplaceAppVersion,
  type WorkspaceAppInstallation
} from "../core";
import type { AppLifecycleOperation } from "./app-installation-store";

type JourneyInput = {
  workspaceId: string;
  app: MarketplaceApp;
  selectedVersion: MarketplaceAppVersion;
  manifest: LoopPackManifest;
  setupQuestions: AppSetupDefinition["questions"];
  presetId?: string;
  plan?: AppInstallPlan;
  mappingPlan?: AppFieldMappingPlan;
  installation?: WorkspaceAppInstallation;
  readiness?: AppReadiness;
  evaluations?: AppEvalRun[];
  activationApprovals?: AppActivationApprovalReceipt[];
  lifecycleOperation?: AppLifecycleOperation;
  onboardingDraft?: AppOnboardingDraft;
  draftApplied?: boolean;
  resumedFromDraft?: boolean;
  now?: Date;
};

type StepId = AppOnboardingJourney["steps"][number]["id"];
type StepStatus = AppOnboardingJourney["steps"][number]["status"];

const STEP_LABELS: Array<{ id: StepId; label: string }> = [
  { id: "select", label: "Choose stack" },
  { id: "connect", label: "Connect systems" },
  { id: "configure", label: "Answer gaps" },
  { id: "map", label: "Confirm fields" },
  { id: "review", label: "Review install" },
  { id: "test", label: "Rehearse" },
  { id: "shadow", label: "Activate shadow" },
  { id: "operate", label: "Operate and learn" }
];

export function deriveAppOnboardingJourney(input: JourneyInput): AppOnboardingJourney {
  const now = input.now ?? new Date();
  const evaluations = input.evaluations?.filter((run) =>
    !input.installation || run.installationId === input.installation.id
  ) ?? [];
  const latestSynthetic = [...evaluations].reverse().find((run) => run.level === "synthetic");
  const latestReplay = [...evaluations].reverse().find((run) => run.level === "historical_replay");
  const syntheticStatus = latestSynthetic?.status === "passed"
    ? "passed" as const
    : latestSynthetic
      ? "failed" as const
      : "not_run" as const;
  const historicalReplayStatus = latestReplay?.status === "passed"
    ? "passed" as const
    : latestReplay
      ? "failed" as const
      : "not_run" as const;
  const pendingShadowApproval = input.installation
    ? [...(input.activationApprovals ?? [])].reverse().find((approval) =>
        approval.installationId === input.installation!.id &&
        approval.artifactDigest === input.installation!.artifactDigest &&
        approval.fromState === input.installation!.state &&
        approval.requestedMode === "shadow" &&
        !approval.consumedAt &&
        Date.parse(approval.expiresAt) > now.getTime())
    : undefined;
  const recovery = input.lifecycleOperation?.status === "completed" ? undefined : input.lifecycleOperation;

  const missingConfiguration = input.plan?.missingConfigurationKeys.filter((key) =>
    !key.startsWith("mapping:") && !key.startsWith("mapping_confirmation:")
  ) ?? [];
  const missingConfigurationKeys = new Set(missingConfiguration.map(stripConfirmationPrefix));
  const connectionGaps = input.plan?.capabilityResolutions.filter((resolution) =>
    resolution.required && !["connected", "reusable"].includes(resolution.status)
  ) ?? [];
  const mappingGaps = input.mappingPlan?.requirements.filter((requirement) =>
    requirement.missingRequiredFields.length > 0 || requirement.unverifiedRequiredFields.length > 0
  ) ?? [];
  const permissionGaps = input.plan?.permissions.filter((permission) => permission.decision === "unresolved") ?? [];
  const questions = input.setupQuestions
    .filter((question) => missingConfigurationKeys.has(question.key))
    .map((question) => ({
      key: question.key,
      prompt: question.prompt,
      why: question.why,
      valueType: question.valueType,
      requirement: question.requirement === "optional" ? "optional" as const : "required" as const,
      confirmationRequired: missingConfiguration.includes(`confirmation:${question.key}`),
      ...(input.plan?.configuration.values[question.key] === undefined
        ? {}
        : { currentValue: input.plan.configuration.values[question.key] })
    }));
  const blockers: AppOnboardingJourney["blockers"] = [
    ...connectionGaps.map((gap) => ({
      kind: "connection" as const,
      id: gap.capability,
      summary: gap.reason ?? `${gap.capability} is ${gap.status}.`,
      remediation: gap.executor === "unavailable"
        ? "Choose a supported connector preset or install a reviewed bounded adapter for the declared provider operation."
        : "Connect the declared provider through the Hermes Connector Broker with only the required capability and scopes."
    })),
    ...missingConfiguration.map((key) => ({
      kind: "configuration" as const,
      id: key,
      summary: key.startsWith("confirmation:")
        ? `${stripConfirmationPrefix(key)} was inferred and needs confirmation.`
        : `${stripConfirmationPrefix(key)} is missing.`,
      remediation: "Ask the matching setup question and submit only the confirmed company answer."
    })),
    ...mappingGaps.flatMap((requirement) => [
      ...requirement.missingRequiredFields.map((field) => ({
        kind: "mapping" as const,
        id: `${requirement.objectType}:${field}`,
        summary: `${requirement.providerId} field mapping for ${requirement.objectType}.${field} is missing.`,
        remediation: "Inspect the bounded provider schema and ask the operator to confirm the exact logical-to-provider field."
      })),
      ...requirement.unverifiedRequiredFields.map((field) => ({
        kind: "mapping" as const,
        id: `${requirement.objectType}:${field}:confirmation`,
        summary: `${requirement.providerId} field mapping for ${requirement.objectType}.${field} is not confirmed.`,
        remediation: "Require explicit operator confirmation; a similarity suggestion is never approval."
      }))
    ]),
    ...permissionGaps.map((permission) => ({
      kind: "permission" as const,
      id: permission.capability,
      summary: `${permission.capability} has no explicit permission decision.`,
      remediation: "Show the authority, purpose, and risk, then require an accountable operator decision."
    }))
  ];

  const decision = decideStage({
    presetId: input.presetId,
    plan: input.plan,
    installation: input.installation,
    syntheticStatus,
    connectionGaps: connectionGaps.length,
    configurationGaps: missingConfiguration.length,
    mappingGaps: mappingGaps.length,
    permissionGaps: permissionGaps.length,
    activationApprovalReceiptId: pendingShadowApproval?.id,
    lifecycleOperation: recovery
  });
  if (recovery) {
    blockers.unshift({
      kind: "lifecycle",
      id: recovery.id,
      summary: `${recovery.action} is ${recovery.status.replace(/_/g, " ")}.`,
      remediation: recovery.action === "install"
        ? "Retry the exact previously approved install request; do not generate or approve a different plan for this App."
        : recovery.action === "activate"
          ? "Retry activation with the exact recorded approval receipt and target mode; do not create a replacement approval."
          : recovery.action === "pause" || recovery.action === "resume"
            ? `Retry the exact recorded ${recovery.action} request; do not start another lifecycle action until its LoopSpec state is reconciled.`
          : recovery.action === "update"
            ? "Retry the exact recorded update plan with the same actor and permission approvals; do not create a replacement plan or start another lifecycle action."
          : recovery.action === "rollback"
            ? "Retry the exact recorded rollback request with the same actor; do not select another revision or start another lifecycle action."
          : "Retry the uninstall with the same installation and artifact digest after accountable confirmation."
    });
  }
  if (decision.stage === "resolve_test_failures") {
    blockers.push({
      kind: "test",
      id: latestSynthetic?.id ?? "synthetic-conformance",
      summary: "The latest write-blocked conformance run failed.",
      remediation: "Inspect the failed scenarios and repair configuration, mappings, routing, policy, or generated assets before rerunning."
    });
  }
  if (decision.stage === "unavailable" && input.installation) {
    blockers.push({
      kind: "lifecycle",
      id: input.installation.state,
      summary: `The installed app is ${input.installation.state}.`,
      remediation: "Inspect the lifecycle receipts and resolve the explicit app state before attempting another transition."
    });
  }

  const steps = buildSteps(decision.currentStep, input, {
    syntheticStatus,
    connectionReady: connectionGaps.length === 0,
    configurationReady: missingConfiguration.length === 0,
    mappingReady: mappingGaps.length === 0,
    permissionReady: permissionGaps.length === 0
  });

  return appOnboardingJourneySchema.parse({
    schemaVersion: APP_ONBOARDING_SCHEMA_VERSION,
    workspaceId: input.workspaceId,
    app: {
      id: input.app.id,
      name: input.app.name,
      version: input.selectedVersion.version,
      department: input.app.department,
      presets: input.manifest.presets.map(({ id, name, description }) => ({ id, name, description })),
      ...(input.presetId ? { presetId: input.presetId } : {})
    },
    ...(input.installation ? { installationId: input.installation.id } : {}),
    ...(input.onboardingDraft ? {
      draft: {
        id: input.onboardingDraft.id,
        revision: input.onboardingDraft.revision,
        presetId: input.onboardingDraft.presetId,
        savedAt: input.onboardingDraft.updatedAt,
        savedBy: input.onboardingDraft.updatedBy,
        answerKeys: Object.keys(input.onboardingDraft.configuration).sort(),
        applied: input.draftApplied ?? true,
        resumed: input.resumedFromDraft ?? false
      }
    } : {}),
    stage: decision.stage,
    headline: decision.headline,
    progress: {
      completed: steps.filter((step) => step.status === "complete").length,
      total: steps.length
    },
    steps,
    questions,
    blockers,
    ...(input.plan ? { plan: input.plan } : {}),
    ...(input.mappingPlan ? { mappingPlan: input.mappingPlan } : {}),
    ...(input.installation ? { installation: input.installation } : {}),
    ...(input.readiness ? { readiness: input.readiness } : {}),
    ...(recovery ? {
      recovery: {
        operationId: recovery.id,
        action: recovery.action,
        status: recovery.status,
        targetArtifactDigest: recovery.targetArtifactDigest,
        startedAt: recovery.startedAt,
        updatedAt: recovery.updatedAt,
        affected: {
          loops: recovery.desired.loopIds.length,
          fieldMappings: recovery.desired.fieldMappingIds.length,
          companyContextValues: recovery.desired.companyContextKeys.length
        }
      }
    } : {}),
    evidence: {
      syntheticStatus,
      historicalReplayStatus,
      providerWritesBlocked:
        !input.installation || ["simulation", "shadow", "recommend"].includes(input.installation.mode)
    },
    nextAction: decision.nextAction,
    generatedAt: now.toISOString()
  });
}

function decideStage(input: {
  presetId?: string;
  plan?: AppInstallPlan;
  installation?: WorkspaceAppInstallation;
  syntheticStatus: "not_run" | "passed" | "failed";
  connectionGaps: number;
  configurationGaps: number;
  mappingGaps: number;
  permissionGaps: number;
  activationApprovalReceiptId?: string;
  lifecycleOperation?: AppLifecycleOperation;
}): {
  stage: AppOnboardingJourney["stage"];
  currentStep: StepId;
  headline: string;
  nextAction: AppOnboardingJourney["nextAction"];
} {
  if (input.lifecycleOperation) {
    const action = input.lifecycleOperation.action;
    return {
      stage: "recover_lifecycle",
      currentStep: action === "install" ? "review" : "operate",
      headline: action === "install"
        ? "An exact App installation was interrupted and must be resumed before another plan can be applied."
        : action === "activate"
          ? "App activation was interrupted and its exact approved transition must be reconciled before another lifecycle action can run."
            : action === "pause" || action === "resume"
              ? `App ${action} was interrupted and its exact rollout transition must be reconciled before another lifecycle action can run.`
              : action === "configure"
                ? "App configuration was interrupted and its exact confirmed-value request must be reconciled before another lifecycle action can run."
              : action === "update"
                ? "An App update was interrupted and its exact reviewed plan, permission approvals, and source or target topology must be reconciled before another lifecycle action can run."
              : action === "rollback"
                ? "App rollback was interrupted and its exact source and target revisions must be reconciled before another lifecycle action can run."
                : "App removal was interrupted and must be reconciled before another lifecycle action can run.",
      nextAction: {
        kind: "retry_exact_request",
        summary: action === "install"
          ? "Retry the exact previously approved install request. Loopgraph will replay only unfinished idempotent work."
          : action === "activate"
            ? "Retry the exact recorded activation receipt and target mode. Loopgraph will reconcile LoopSpec state and consume authority only once."
            : action === "pause" || action === "resume"
              ? `Retry the exact recorded ${action} request. Loopgraph will reconcile only the pinned owned LoopSpecs and complete the state transition once.`
              : action === "configure"
                ? "Retry the exact confirmed configuration request as the same actor. Loopgraph will compare only bounded digests in the recovery journal and return the original receipt after completion."
              : action === "update"
                ? "Retry the exact reviewed update plan as the same actor with the recorded permission approvals. Loopgraph will replay only unfinished idempotent work, even if the plan window has since expired."
              : action === "rollback"
                ? "Retry the exact rollback request as the same actor. Loopgraph will accept only the recorded source installation and exact source or target LoopSpec topology."
                : "Repeat the uninstall confirmation with the same accountable actor and exact original reason. Loopgraph will accept only the recorded installation revision and pre-removal or post-removal LoopSpec topology.",
        requiresHumanConfirmation: true,
        input: {
          operationId: input.lifecycleOperation.id,
          action,
          installationId: input.lifecycleOperation.installationId,
          targetArtifactDigest: input.lifecycleOperation.targetArtifactDigest,
          ...(input.lifecycleOperation.activation ? {
            approvalReceiptId: input.lifecycleOperation.activation.approvalReceiptId,
            mode: input.lifecycleOperation.activation.targetMode
          } : input.lifecycleOperation.rollout ? {
            targetState: input.lifecycleOperation.rollout.targetState,
            mode: input.lifecycleOperation.rollout.targetMode
          } : input.lifecycleOperation.configure ? {
            fromUpdatedAt: input.lifecycleOperation.configure.fromUpdatedAt,
            sourceConfigurationDigest: input.lifecycleOperation.configure.sourceConfigurationDigest,
            valuesDigest: input.lifecycleOperation.configure.valuesDigest,
            targetConfigurationDigest: input.lifecycleOperation.configure.targetConfigurationDigest
          } : input.lifecycleOperation.uninstall ? {
            reasonDigest: input.lifecycleOperation.uninstall.reasonDigest,
            fromUpdatedAt: input.lifecycleOperation.uninstall.fromUpdatedAt,
            remainingLoopIds: input.lifecycleOperation.uninstall.remainingLoopIds
          } : input.lifecycleOperation.update ? {
            planDigest: input.lifecycleOperation.update.planDigest,
            fromUpdatedAt: input.lifecycleOperation.update.fromUpdatedAt,
            sourceArtifactDigest: input.lifecycleOperation.update.sourceArtifactDigest,
            approvedPermissionCapabilities: input.lifecycleOperation.update.approvedPermissionCapabilities,
            sourceLoopIds: input.lifecycleOperation.update.sourceLoopIds,
            targetLoopIds: input.lifecycleOperation.update.targetLoopIds
          } : input.lifecycleOperation.rollback ? {
            fromUpdatedAt: input.lifecycleOperation.rollback.fromUpdatedAt,
            sourceArtifactDigest: input.lifecycleOperation.rollback.sourceArtifactDigest,
            sourceLoopIds: input.lifecycleOperation.rollback.sourceLoopIds,
            targetLoopIds: input.lifecycleOperation.rollback.targetLoopIds
          } : {})
        }
      }
    };
  }
  const installationId = input.installation?.id;
  if (input.installation) {
    if (input.installation.state === "paused") {
      return toolDecision("resume", "operate", "This app is paused. Review why, then resume its last safe non-live mode.", "loopgraph_app_resume", installationId!, true);
    }
    if (["revoked", "uninstalling", "deprecated"].includes(input.installation.state)) {
      return {
        stage: "unavailable",
        currentStep: "operate",
        headline: `This app is ${input.installation.state} and cannot advance through onboarding.`,
        nextAction: { kind: "none", summary: "Resolve the governed lifecycle state before continuing.", requiresHumanConfirmation: true }
      };
    }
    if (input.installation.state === "broken" || input.syntheticStatus === "failed") {
      return {
        stage: "resolve_test_failures",
        currentStep: "test",
        headline: "Conformance found a problem. Hermes should explain the failed scenarios before changing anything.",
        nextAction: { kind: "inspect_failures", summary: "Inspect the latest failed scenarios, correct the smallest accountable cause, and rerun conformance.", requiresHumanConfirmation: false }
      };
    }
    if (input.syntheticStatus !== "passed" || ["ready_to_test", "rolled_back"].includes(input.installation.state)) {
      return toolDecision("run_conformance", "test", "Run deterministic conformance with every provider write blocked.", "loopgraph_app_test", installationId!, false);
    }
    if (input.installation.state === "simulation_passed") {
      return input.activationApprovalReceiptId
        ? toolDecision("activate_shadow", "shadow", "Shadow activation has an exact, unexpired approval receipt and is ready to be applied with provider writes still blocked.", "loopgraph_app_activate", installationId!, false, { mode: "shadow", approvalReceiptId: input.activationApprovalReceiptId })
        : toolDecision("activate_shadow", "shadow", "Rehearsal passed. An accountable operator must approve the exact shadow transition before Hermes can activate it.", "loopgraph_app_activation_approve", installationId!, true, { mode: "shadow" });
    }
    if (["shadow", "recommend", "execute_with_approval", "live"].includes(input.installation.state)) {
      return {
        stage: "operate",
        currentStep: "operate",
        headline: "The app is running. Monitor incoming events, Hermes decisions, review burden, and measured outcomes.",
        nextAction: { kind: "monitor", summary: "Operate from evidence and use replay, labels, and outcomes before considering another promotion.", requiresHumanConfirmation: false }
      };
    }
    return {
      stage: "unavailable",
      currentStep: "operate",
      headline: `The app is ${input.installation.state}; inspect its lifecycle receipts before continuing.`,
      nextAction: { kind: "none", summary: "No automatic transition is safe from the current lifecycle state.", requiresHumanConfirmation: true }
    };
  }

  if (!input.presetId || !input.plan) {
    return {
      stage: "choose_preset",
      currentStep: "select",
      headline: "Choose the provider stack that matches the company before Loopgraph creates an install plan.",
      nextAction: { kind: "choose_preset", summary: "Present the declared presets and ask the user to choose one.", requiresHumanConfirmation: true }
    };
  }
  if (input.connectionGaps > 0) {
    return {
      stage: "connect_systems",
      currentStep: "connect",
      headline: `Connect ${input.connectionGaps} required capability ${input.connectionGaps === 1 ? "binding" : "bindings"} through the Hermes Connector Broker.`,
      nextAction: { kind: "connect_providers", summary: "Prepare only the declared providers and least-privilege scopes, then re-read this journey.", requiresHumanConfirmation: true }
    };
  }
  if (input.configurationGaps > 0) {
    return {
      stage: "answer_questions",
      currentStep: "configure",
      headline: `Answer only the ${input.configurationGaps} unresolved company-specific ${input.configurationGaps === 1 ? "item" : "items"}.`,
      nextAction: { kind: "answer_questions", summary: "Ask only the returned questions, preserve explicit unknowns, then regenerate the exact plan.", requiresHumanConfirmation: true }
    };
  }
  if (input.mappingGaps > 0) {
    return {
      stage: "confirm_mappings",
      currentStep: "map",
      headline: `Confirm ${input.mappingGaps} provider object ${input.mappingGaps === 1 ? "mapping" : "mappings"} against bounded schema metadata.`,
      nextAction: { kind: "confirm_mappings", summary: "Show suggestions with reasons, but require the operator to confirm every required field mapping.", requiresHumanConfirmation: true }
    };
  }
  if (input.permissionGaps > 0) {
    return {
      stage: "review_install",
      currentStep: "review",
      headline: "Resolve every permission decision before installation.",
      nextAction: { kind: "review_plan", summary: "Review the exact authority, risk, graph diff, and rollback boundary.", requiresHumanConfirmation: true }
    };
  }
  return toolDecision("review_install", "review", "The exact plan is ready. Review the graph, permissions, tests, and digest before atomic installation.", "loopgraph_app_install_apply", undefined, true, { planDigest: input.plan.planDigest });
}

function toolDecision(
  stage: AppOnboardingJourney["stage"],
  currentStep: StepId,
  headline: string,
  toolName: string,
  installationId: string | undefined,
  requiresHumanConfirmation: boolean,
  extraInput: Record<string, unknown> = {}
) {
  return {
    stage,
    currentStep,
    headline,
    nextAction: {
      kind: "call_tool" as const,
      summary: headline,
      toolName,
      requiresHumanConfirmation,
      input: {
        ...(installationId ? { installationId } : {}),
        ...extraInput
      }
    }
  };
}

function buildSteps(
  currentStep: StepId,
  input: JourneyInput,
  readiness: {
    syntheticStatus: "not_run" | "passed" | "failed";
    connectionReady: boolean;
    configurationReady: boolean;
    mappingReady: boolean;
    permissionReady: boolean;
  }
): AppOnboardingJourney["steps"] {
  const installed = Boolean(input.installation);
  const shadowActive = Boolean(input.installation && ["shadow", "recommend", "execute_with_approval", "live", "paused"].includes(input.installation.state));
  const completeByStep: Record<StepId, boolean> = {
    select: Boolean(input.presetId),
    connect: installed || readiness.connectionReady,
    configure: installed || readiness.configurationReady,
    map: installed || readiness.mappingReady,
    review: installed,
    test: readiness.syntheticStatus === "passed",
    shadow: shadowActive,
    operate: false
  };
  const summaries: Record<StepId, string> = {
    select: input.presetId ? `Selected ${input.presetId}.` : "Choose one declared provider recipe.",
    connect: completeByStep.connect ? "Required capabilities are bound." : "Required provider capabilities are still missing or degraded.",
    configure: completeByStep.configure ? "Required company context is confirmed." : "Only unresolved setup questions remain.",
    map: completeByStep.map ? "Required provider fields are confirmed." : "Provider field mappings still require review.",
    review: completeByStep.review ? "The immutable install transaction was applied." : readiness.permissionReady ? "Review the exact graph, permissions, tests, and digest." : "Explicit permission decisions are required.",
    test: completeByStep.test ? "The latest write-blocked conformance run passed." : readiness.syntheticStatus === "failed" ? "The latest write-blocked conformance run failed." : "Write-blocked conformance has not passed yet.",
    shadow: completeByStep.shadow ? "Shadow routing is active." : "Shadow activation requires a passing rehearsal and human confirmation.",
    operate: shadowActive ? "Monitor decisions, review burden, and outcomes." : "Operation begins after safe shadow activation."
  };
  const currentIndex = STEP_LABELS.findIndex((step) => step.id === currentStep);
  return STEP_LABELS.map((step, index) => {
    let status: StepStatus;
    if (step.id === currentStep) status = "current";
    else if (completeByStep[step.id]) status = "complete";
    else if (index < currentIndex) status = "blocked";
    else status = "pending";
    return { ...step, status, summary: summaries[step.id] };
  });
}

function stripConfirmationPrefix(value: string) {
  return value.startsWith("confirmation:") ? value.slice("confirmation:".length) : value;
}
