import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  BusinessDiscoverySessionSchema,
  DiscoveryAnswerSchema,
  formatDepartmentType,
  getDepartmentBranchQuestions,
  getInitialQuestionQueue,
  getQuestionBundle,
  listQuestionBundleSummary,
  normalizeDepartmentType,
  type BusinessDiscoverySession,
  type DepartmentProfile,
  type DepartmentType,
  type DiscoveryAnswer,
  type ProjectInspectionReport,
  type ProjectProfile,
  type QuestionBundle
} from "../core";
import { buildProjectProfileFromInspection, inspectProjectManifests } from "./project-inspection";
import { getLoopgraphRoot } from "./storage-resolver";
import { initLoopgraphWorkspace } from "./workspace";

export type DiscoveryActor = "browser" | "hermes" | "cli" | "api";

export type StartDiscoverySessionInput = {
  projectRoot?: string;
  sessionId?: string;
  companyId?: string;
  companyName?: string;
  createdByActor?: DiscoveryActor;
  now?: Date;
};

export type SelectDiscoveryDepartmentsInput = {
  projectRoot?: string;
  sessionId: string;
  departments: string[];
  activeDepartment?: string;
  expectedRevision?: number;
  actor?: DiscoveryActor;
  now?: Date;
};

export type ConfirmDiscoveryProjectContextInput = {
  projectRoot?: string;
  sessionId: string;
  expectedRevision?: number;
  displayName?: string;
  companyDescription?: string;
  customerType?: string;
  primaryGoal?: string;
  northStarMetric?: string;
  sourceOfTruth?: string;
  additionalTools?: string[];
  confirmationNotes?: string;
  confirmedStack?: boolean;
  actor?: DiscoveryActor;
  now?: Date;
};

export type ConfirmDiscoveryProjectContextResult = {
  session: BusinessDiscoverySession;
  projectProfile: ProjectProfile;
  inspection: ProjectInspectionReport;
};

export type SubmitDiscoveryAnswersInput = {
  projectRoot?: string;
  sessionId: string;
  bundleId: string;
  answers: Record<string, unknown>;
  expectedRevision?: number;
  actor?: DiscoveryActor;
  now?: Date;
};

export type DiscoveryNextQuestionsResult = {
  sessionId: string;
  revision: number;
  activeStage: BusinessDiscoverySession["activeStage"];
  selectedDepartmentIds: DepartmentType[];
  activeDepartmentId?: DepartmentType;
  complete: boolean;
  bundle?: QuestionBundle;
  departmentBranchQuestions: string[];
  bundleSummary: ReturnType<typeof listQuestionBundleSummary>;
  answeredBundleCount: number;
  totalBundleCount: number;
  nextAction: "select_department" | "answer_bundle" | "design_context_ready";
};

export async function startHermesDiscoverySession(
  input: StartDiscoverySessionInput = {}
): Promise<BusinessDiscoverySession> {
  const projectRoot = path.resolve(input.projectRoot ?? process.cwd());
  const nowIso = (input.now ?? new Date()).toISOString();
  const actor = input.createdByActor ?? "hermes";
  await initLoopgraphWorkspace({ projectRoot, createdBy: actor, now: input.now });

  if (input.sessionId) {
    const existing = await loadDiscoverySession(input.sessionId, projectRoot);
    if (existing) return existing;
  }

  const companyId = input.companyId ?? `company_${Date.now()}`;
  const session = BusinessDiscoverySessionSchema.parse({
    id: input.sessionId ?? `session_${Date.now()}`,
    companyId,
    status: "started",
    activeStage: "workspace",
    revision: 0,
    createdByActor: actor,
    lastActor: actor,
    lastTransitionAt: nowIso,
    companyProfile: {
      id: companyId,
      name: input.companyName,
      departments: [],
      tools: [],
      bottlenecks: [],
      recurringWork: [],
      aiNeverActions: [],
      customerFacingOutputs: [],
      leadershipJudgment: []
    },
    departmentProfiles: [],
    processInventory: [],
    departmentGoals: [],
    processGoalMappings: [],
    answers: [],
    recommendedLoops: [],
    accessRequirements: [],
    metricDefinitions: [],
    undefinedMetrics: [],
    humanRequirements: [],
    createdLoopIds: [],
    createdAt: nowIso,
    updatedAt: nowIso
  });

  await saveDiscoverySession(session, projectRoot);
  return session;
}

export async function confirmDiscoveryProjectContext(
  input: ConfirmDiscoveryProjectContextInput
): Promise<ConfirmDiscoveryProjectContextResult> {
  const projectRoot = path.resolve(input.projectRoot ?? process.cwd());
  const session = await requireDiscoverySession(input.sessionId, projectRoot);
  assertExpectedRevision(session, input.expectedRevision);
  const nowIso = (input.now ?? new Date()).toISOString();
  const inspection = await inspectProjectManifests({ projectRoot });
  const displayName = input.displayName ??
    session.companyProfile?.name ??
    inspection.packageJson?.name ??
    path.basename(projectRoot);
  const projectProfile = buildProjectProfileFromInspection(inspection, {
    displayName,
    confirmedByUser: input.confirmedStack ?? true,
    confirmedAt: nowIso
  });
  const detectedTools = toolsFromProjectProfile(projectProfile);
  const additionalTools = uniqueStrings(input.additionalTools ?? []);
  const companyProfile = {
    ...(session.companyProfile ?? {
      id: session.companyId,
      departments: [],
      tools: [],
      bottlenecks: [],
      recurringWork: [],
      aiNeverActions: [],
      customerFacingOutputs: [],
      leadershipJudgment: []
    }),
    id: session.companyId,
    name: displayName,
    ...(input.companyDescription ? { description: input.companyDescription } : {}),
    ...(input.customerType ? { customerType: input.customerType } : {}),
    ...(input.primaryGoal ? { primaryGoal: input.primaryGoal } : {}),
    ...(input.northStarMetric ? { northStarMetric: input.northStarMetric } : {}),
    tools: uniqueStrings([
      ...(session.companyProfile?.tools ?? []),
      ...detectedTools,
      ...additionalTools
    ])
  };
  const projectAnswers = projectContextAnswers({
    session,
    projectProfile,
    inspection,
    sourceOfTruth: input.sourceOfTruth,
    confirmationNotes: input.confirmationNotes,
    nowIso
  });
  const projectQuestionIds = new Set(projectAnswers.map((answer) => answer.questionId));
  const next = BusinessDiscoverySessionSchema.parse({
    ...session,
    projectProfileId: projectProfile.projectRootId,
    projectProfile,
    companyProfile,
    answers: [
      ...session.answers.filter((answer) => !projectQuestionIds.has(answer.questionId)),
      ...projectAnswers
    ],
    status: session.status === "started" ? "company_questions" : session.status,
    activeStage: session.activeStage === "workspace" ? "department_selection" : session.activeStage,
    revision: session.revision + 1,
    lastActor: input.actor ?? "hermes",
    lastTransitionAt: nowIso,
    updatedAt: nowIso
  });

  await saveDiscoverySession(next, projectRoot);
  return { session: next, projectProfile, inspection };
}

export async function getDiscoverySession(
  sessionId: string,
  projectRoot = process.cwd()
): Promise<BusinessDiscoverySession | undefined> {
  return loadDiscoverySession(sessionId, path.resolve(projectRoot));
}

export async function listHermesDiscoverySessions(
  projectRoot = process.cwd()
): Promise<BusinessDiscoverySession[]> {
  const root = discoverySessionsRoot(path.resolve(projectRoot));
  let files: string[];
  try {
    files = await readdir(root);
  } catch {
    return [];
  }

  const sessions = await Promise.all(files
    .filter((file) => file.endsWith(".json"))
    .map(async (file) => {
      try {
        return BusinessDiscoverySessionSchema.parse(JSON.parse(await readFile(path.join(root, file), "utf8")));
      } catch {
        return undefined;
      }
    }));

  return sessions
    .filter((session): session is BusinessDiscoverySession => Boolean(session))
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || a.id.localeCompare(b.id));
}

export async function selectDiscoveryDepartments(
  input: SelectDiscoveryDepartmentsInput
): Promise<BusinessDiscoverySession> {
  const projectRoot = path.resolve(input.projectRoot ?? process.cwd());
  const session = await requireDiscoverySession(input.sessionId, projectRoot);
  assertExpectedRevision(session, input.expectedRevision);

  const selectedDepartmentIds = Array.from(new Set(input.departments.map((department) => {
    const normalized = normalizeDepartmentType(department);
    if (!normalized) throw new Error(`Unknown department type: ${department}`);
    return normalized;
  })));
  if (selectedDepartmentIds.length === 0) {
    throw new Error("Select at least one department before answering discovery questions.");
  }

  const activeDepartmentId = input.activeDepartment
    ? normalizeDepartmentType(input.activeDepartment)
    : selectedDepartmentIds[0];
  if (!activeDepartmentId || !selectedDepartmentIds.includes(activeDepartmentId)) {
    throw new Error("Active department must be one of the selected departments.");
  }

  const nowIso = (input.now ?? new Date()).toISOString();
  const next = BusinessDiscoverySessionSchema.parse({
    ...session,
    status: "department_questions",
    selectedDepartmentIds,
    activeDepartmentId,
    activeStage: "questions",
    activeQuestionBundleId: "current_stack_sources",
    questionQueue: getInitialQuestionQueue(activeDepartmentId),
    companyProfile: {
      ...(session.companyProfile ?? { id: session.companyId }),
      departments: selectedDepartmentIds
    },
    departmentProfiles: selectedDepartmentIds.map((departmentType) =>
      existingOrNewDepartmentProfile(session, departmentType)
    ),
    revision: session.revision + 1,
    lastActor: input.actor ?? "hermes",
    lastTransitionAt: nowIso,
    updatedAt: nowIso
  });
  await saveDiscoverySession(next, projectRoot);
  return next;
}

export async function getNextDiscoveryQuestions(input: {
  projectRoot?: string;
  sessionId: string;
}): Promise<DiscoveryNextQuestionsResult> {
  const projectRoot = path.resolve(input.projectRoot ?? process.cwd());
  const session = await requireDiscoverySession(input.sessionId, projectRoot);
  const activeDepartmentId = session.activeDepartmentId;

  if (!activeDepartmentId) {
    return {
      sessionId: session.id,
      revision: session.revision,
      activeStage: session.activeStage,
      selectedDepartmentIds: session.selectedDepartmentIds,
      complete: false,
      departmentBranchQuestions: [],
      bundleSummary: [],
      answeredBundleCount: 0,
      totalBundleCount: 0,
      nextAction: "select_department"
    };
  }

  const bundleSummary = listQuestionBundleSummary(activeDepartmentId);
  const activeQueueItem = session.questionQueue.find((item) => item.status === "active");
  const bundle = activeQueueItem ? getQuestionBundle(activeQueueItem.bundleId, activeDepartmentId) : undefined;
  const answeredBundleCount = session.questionQueue.filter((item) => item.status === "answered").length;
  const totalBundleCount = session.questionQueue.length;
  const complete = !bundle && totalBundleCount > 0 && answeredBundleCount === totalBundleCount;

  return {
    sessionId: session.id,
    revision: session.revision,
    activeStage: complete ? "design_context" : session.activeStage,
    selectedDepartmentIds: session.selectedDepartmentIds,
    activeDepartmentId,
    complete,
    ...(bundle ? { bundle } : {}),
    departmentBranchQuestions: getDepartmentBranchQuestions(activeDepartmentId),
    bundleSummary,
    answeredBundleCount,
    totalBundleCount,
    nextAction: complete ? "design_context_ready" : "answer_bundle"
  };
}

export async function submitDiscoveryAnswers(
  input: SubmitDiscoveryAnswersInput
): Promise<BusinessDiscoverySession> {
  const projectRoot = path.resolve(input.projectRoot ?? process.cwd());
  const session = await requireDiscoverySession(input.sessionId, projectRoot);
  assertExpectedRevision(session, input.expectedRevision);
  const activeDepartmentId = session.activeDepartmentId;
  if (!activeDepartmentId) {
    throw new Error("Select a department before submitting discovery answers.");
  }

  const activeQueueItem = session.questionQueue.find((item) => item.status === "active");
  if (!activeQueueItem || activeQueueItem.bundleId !== input.bundleId) {
    throw new Error(`Question bundle is not active: ${input.bundleId}`);
  }

  const bundle = getQuestionBundle(input.bundleId, activeDepartmentId);
  if (!bundle) {
    throw new Error(`Unknown question bundle: ${input.bundleId}`);
  }

  const nowIso = (input.now ?? new Date()).toISOString();
  const submittedAnswers = bundle.fields
    .filter((field) => Object.prototype.hasOwnProperty.call(input.answers, field.id))
    .map((field): DiscoveryAnswer => DiscoveryAnswerSchema.parse({
      id: `${session.id}:${activeDepartmentId}:${bundle.id}:${field.id}`,
      questionId: `${bundle.id}.${field.id}`,
      scope: field.scope,
      departmentId: departmentProfileId(session.companyId, activeDepartmentId),
      value: input.answers[field.id],
      valueType: field.valueType,
      source: "user",
      evidenceRefs: [],
      confirmedByUser: true,
      sensitivity: "internal",
      redactionApplied: false,
      answeredAt: nowIso
    }));

  const missingRequired = bundle.fields
    .filter((field) => field.required && !Object.prototype.hasOwnProperty.call(input.answers, field.id))
    .map((field) => field.id);
  if (missingRequired.length > 0) {
    throw new Error(`Missing required discovery answer(s): ${missingRequired.join(", ")}`);
  }

  const nextQueue = advanceQuestionQueue(session.questionQueue, input.bundleId);
  const nextActive = nextQueue.find((item) => item.status === "active");
  const complete = nextQueue.length > 0 && nextQueue.every((item) => item.status === "answered");
  const next = BusinessDiscoverySessionSchema.parse({
    ...session,
    answers: [
      ...session.answers.filter((answer) => !submittedAnswers.some((item) =>
        item.questionId === answer.questionId && item.departmentId === answer.departmentId
      )),
      ...submittedAnswers
    ],
    questionQueue: nextQueue,
    activeQuestionBundleId: nextActive?.bundleId,
    activeStage: complete ? "design_context" : "questions",
    status: complete ? "recommendations_ready" : "department_questions",
    revision: session.revision + 1,
    lastActor: input.actor ?? "hermes",
    lastTransitionAt: nowIso,
    updatedAt: nowIso
  });
  await saveDiscoverySession(next, projectRoot);
  return next;
}

export async function saveDiscoverySession(
  session: BusinessDiscoverySession,
  projectRoot = process.cwd()
): Promise<void> {
  const filePath = discoverySessionPath(session.id, projectRoot);
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(session, null, 2)}\n`);
}

async function loadDiscoverySession(
  sessionId: string,
  projectRoot = process.cwd()
): Promise<BusinessDiscoverySession | undefined> {
  try {
    return BusinessDiscoverySessionSchema.parse(JSON.parse(await readFile(discoverySessionPath(sessionId, projectRoot), "utf8")));
  } catch {
    return undefined;
  }
}

async function requireDiscoverySession(
  sessionId: string,
  projectRoot: string
): Promise<BusinessDiscoverySession> {
  const session = await loadDiscoverySession(sessionId, projectRoot);
  if (!session) throw new Error(`Discovery session not found: ${sessionId}`);
  return session;
}

function assertExpectedRevision(session: BusinessDiscoverySession, expectedRevision?: number): void {
  if (expectedRevision !== undefined && session.revision !== expectedRevision) {
    throw new Error(`Discovery session revision mismatch: expected ${expectedRevision}, found ${session.revision}`);
  }
}

function existingOrNewDepartmentProfile(
  session: BusinessDiscoverySession,
  departmentType: DepartmentType
): DepartmentProfile {
  const existing = session.departmentProfiles.find((department) => department.departmentType === departmentType);
  if (existing) return existing;
  return {
    id: departmentProfileId(session.companyId, departmentType),
    companyId: session.companyId,
    departmentType,
    name: formatDepartmentType(departmentType),
    ownerRole: departmentType === "management" ? "Leadership" : `${formatDepartmentType(departmentType)} owner`,
    tools: [],
    painPoints: [],
    riskTolerance: "medium",
    answers: {}
  };
}

function departmentProfileId(companyId: string, departmentType: DepartmentType): string {
  return `${companyId}:${departmentType}`;
}

function projectContextAnswers(input: {
  session: BusinessDiscoverySession;
  projectProfile: ProjectProfile;
  inspection: ProjectInspectionReport;
  sourceOfTruth?: string;
  confirmationNotes?: string;
  nowIso: string;
}): DiscoveryAnswer[] {
  const evidenceRefs = input.inspection.evidence.map((item) => `project_inspection:${item.kind}:${item.path}`);
  const answers: DiscoveryAnswer[] = [
    DiscoveryAnswerSchema.parse({
      id: `${input.session.id}:project_context:detected_stack`,
      questionId: "project_context.detected_stack",
      scope: "company",
      value: {
        repoType: input.projectProfile.repoType,
        languages: input.projectProfile.languages,
        frameworks: input.projectProfile.frameworks,
        packageManagers: input.projectProfile.packageManagers,
        datastores: input.projectProfile.datastores,
        deploymentTargets: input.projectProfile.deploymentTargets,
        detectedIntegrationHints: input.projectProfile.detectedIntegrationHints
      },
      valueType: "object",
      source: "project_detector",
      evidenceRefs,
      confidence: evidenceRefs.length > 0 ? 0.8 : 0.4,
      confirmedByUser: input.projectProfile.confirmedByUser,
      sensitivity: "internal",
      redactionApplied: false,
      answeredAt: input.nowIso
    })
  ];

  if (input.sourceOfTruth) {
    answers.push(DiscoveryAnswerSchema.parse({
      id: `${input.session.id}:project_context:source_of_truth`,
      questionId: "project_context.source_of_truth",
      scope: "company",
      value: input.sourceOfTruth,
      valueType: "text",
      source: "user",
      evidenceRefs: [],
      confirmedByUser: true,
      sensitivity: "internal",
      redactionApplied: false,
      answeredAt: input.nowIso
    }));
  }

  if (input.confirmationNotes) {
    answers.push(DiscoveryAnswerSchema.parse({
      id: `${input.session.id}:project_context:confirmation_notes`,
      questionId: "project_context.confirmation_notes",
      scope: "company",
      value: input.confirmationNotes,
      valueType: "text",
      source: "user",
      evidenceRefs: [],
      confirmedByUser: true,
      sensitivity: "internal",
      redactionApplied: false,
      answeredAt: input.nowIso
    }));
  }

  return answers;
}

function toolsFromProjectProfile(profile: ProjectProfile): string[] {
  return uniqueStrings([
    ...profile.languages,
    ...profile.frameworks,
    ...profile.packageManagers,
    ...profile.datastores,
    ...profile.deploymentTargets,
    ...profile.detectedIntegrationHints
  ]);
}

function uniqueStrings(values: string[]): string[] {
  return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean))).sort();
}

function advanceQuestionQueue(
  queue: BusinessDiscoverySession["questionQueue"],
  answeredBundleId: string
): BusinessDiscoverySession["questionQueue"] {
  let activatedNext = false;
  return queue.map((item) => {
    if (item.bundleId === answeredBundleId) {
      return { ...item, status: "answered" as const };
    }
    if (!activatedNext && item.status === "pending") {
      activatedNext = true;
      return { ...item, status: "active" as const };
    }
    return item;
  });
}

function discoverySessionPath(sessionId: string, projectRoot: string): string {
  return path.join(discoverySessionsRoot(projectRoot), `${safeFileId(sessionId)}.json`);
}

function discoverySessionsRoot(projectRoot: string): string {
  return path.join(getLoopgraphRoot(projectRoot), "discovery", "sessions");
}

function safeFileId(value: string): string {
  return value.replace(/[^a-zA-Z0-9_.:-]/g, "_");
}
