import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  BusinessDiscoverySessionSchema,
  DiscoveryAnswerSchema,
  EVIDENCE_GAP_SCHEMA_VERSION,
  EVIDENCE_GAP_SET_SCHEMA_VERSION,
  contentHash,
  evidenceGapSchema,
  evidenceGapSetSchema,
  getUniversalQuestionBundles,
  type BusinessDiscoverySession,
  type DiscoveryAnswer,
  type EvidenceGap,
  type EvidenceGapRequiredFor,
  type EvidenceGapSet
} from "../core";
import {
  getDiscoverySession,
  saveDiscoverySession
} from "./discovery-session";
import { getLoopgraphRoot } from "./storage-resolver";

export type CompileEvidenceGapsInput = {
  projectRoot?: string;
  sessionId: string;
  additionalGaps?: EvidenceGap[];
  now?: Date;
};

export type EvidenceGapQuestion = {
  gapId: string;
  questionId?: string;
  prompt: string;
  valueType: NonNullable<EvidenceGap["question"]>["valueType"];
  options?: string[];
  examples: string[];
  reason: string;
  requiredFor: EvidenceGapRequiredFor[];
  blocking: boolean;
};

export type SubmitEvidenceGapAnswerInput = {
  projectRoot?: string;
  sessionId: string;
  gapId: string;
  answer: unknown;
  expectedRevision?: number;
  answeredBy?: "user" | "hermes" | "browser" | "api";
  evidenceRefs?: string[];
  now?: Date;
};

export async function compileEvidenceGaps(
  input: CompileEvidenceGapsInput
): Promise<EvidenceGapSet> {
  const projectRoot = path.resolve(input.projectRoot ?? process.cwd());
  const session = await requireSession(input.sessionId, projectRoot);
  const department = session.activeDepartmentId;
  if (!department) {
    throw new Error("Select an active department before compiling evidence gaps.");
  }

  const nowIso = (input.now ?? new Date()).toISOString();
  const existing = await readEvidenceGapSet(session.id, projectRoot);
  const answers = new Map(session.answers
    .filter((answer) => answer.confirmedByUser)
    .map((answer) => [answer.questionId, answer]));
  const derived = getUniversalQuestionBundles(department).flatMap((bundle) =>
    bundle.fields
      .filter((field) => field.required)
      .filter((field) => !hasMeaningfulAnswer(answers.get(`${bundle.id}.${field.id}`)))
      .map((field) => createGap({
        session,
        department,
        field: `${bundle.id}.${field.id}`,
        questionId: `${bundle.id}.${field.id}`,
        reason: `${field.label} is required before Loopgraph can compile a safe loop design.`,
        requiredFor: normalizeRequiredFor(field.requiredFor),
        resolution: "ask_user",
        blocking: field.requiredFor.includes("design") || field.requiredFor.includes("candidate_generation"),
        question: {
          prompt: field.prompt,
          valueType: field.valueType,
          options: field.options,
          examples: bundle.examples
        },
        nowIso
      }))
  );

  derived.push(...conditionalGaps(session, answers, nowIso));
  const nextById = new Map<string, EvidenceGap>();
  for (const gap of [...derived, ...(input.additionalGaps ?? [])]) {
    const parsed = evidenceGapSchema.parse({
      ...gap,
      sessionId: session.id,
      companyId: session.companyId,
      department,
      updatedAt: nowIso
    });
    const prior = existing?.gaps.find((item) => item.id === parsed.id);
    const answer = parsed.questionId ? answers.get(parsed.questionId) : undefined;
    nextById.set(parsed.id, evidenceGapSchema.parse({
      ...parsed,
      status: hasMeaningfulAnswer(answer)
        ? "resolved"
        : prior?.status === "asked"
          ? "asked"
          : parsed.status,
      answerRef: hasMeaningfulAnswer(answer) ? answer?.id : parsed.answerRef,
      createdAt: prior?.createdAt ?? parsed.createdAt
    }));
  }

  for (const prior of existing?.gaps ?? []) {
    if (nextById.has(prior.id)) continue;
    nextById.set(prior.id, evidenceGapSchema.parse({
      ...prior,
      status: prior.status === "waived" ? "waived" : "resolved",
      updatedAt: nowIso
    }));
  }

  const set = evidenceGapSetSchema.parse({
    schemaVersion: EVIDENCE_GAP_SET_SCHEMA_VERSION,
    sessionId: session.id,
    companyId: session.companyId,
    revision: session.revision,
    generatedAt: nowIso,
    gaps: [...nextById.values()].sort(compareGaps)
  });
  await saveEvidenceGapSet(set, projectRoot);
  return set;
}

export async function getNextEvidenceGapQuestions(input: {
  projectRoot?: string;
  sessionId: string;
  limit?: number;
  requiredFor?: EvidenceGapRequiredFor;
}): Promise<{
  sessionId: string;
  revision: number;
  blockingGapCount: number;
  openGapCount: number;
  completeForDesign: boolean;
  questions: EvidenceGapQuestion[];
}> {
  const set = await compileEvidenceGaps(input);
  const limit = Math.max(1, Math.min(3, input.limit ?? 3));
  const open = set.gaps
    .filter((gap) => ["open", "asked"].includes(gap.status))
    .filter((gap) => !input.requiredFor || gap.requiredFor.includes(input.requiredFor))
    .sort(compareGaps);
  const questions = open
    .filter((gap): gap is EvidenceGap & { question: NonNullable<EvidenceGap["question"]> } =>
      gap.resolution === "ask_user" && Boolean(gap.question)
    )
    .slice(0, limit)
    .map((gap) => ({
      gapId: gap.id,
      ...(gap.questionId ? { questionId: gap.questionId } : {}),
      prompt: gap.question.prompt,
      valueType: gap.question.valueType,
      ...(gap.question.options ? { options: gap.question.options } : {}),
      examples: gap.question.examples,
      reason: gap.reason,
      requiredFor: gap.requiredFor,
      blocking: gap.blocking
    }));

  return {
    sessionId: set.sessionId,
    revision: set.revision,
    blockingGapCount: set.gaps.filter(isOpenBlockingGap).length,
    openGapCount: set.gaps.filter((gap) => ["open", "asked"].includes(gap.status)).length,
    completeForDesign: !set.gaps.some((gap) =>
      isOpenBlockingGap(gap) && gap.requiredFor.includes("design")
    ),
    questions
  };
}

export async function submitEvidenceGapAnswer(
  input: SubmitEvidenceGapAnswerInput
): Promise<{
  session: BusinessDiscoverySession;
  gaps: EvidenceGapSet;
  nextQuestions: Awaited<ReturnType<typeof getNextEvidenceGapQuestions>>;
}> {
  const projectRoot = path.resolve(input.projectRoot ?? process.cwd());
  const session = await requireSession(input.sessionId, projectRoot);
  if (input.expectedRevision !== undefined && input.expectedRevision !== session.revision) {
    throw new Error(`Discovery session revision mismatch: expected ${input.expectedRevision}, found ${session.revision}`);
  }
  const current = await compileEvidenceGaps({
    projectRoot,
    sessionId: session.id,
    now: input.now
  });
  const gap = current.gaps.find((item) => item.id === input.gapId);
  if (!gap) throw new Error(`Evidence gap not found: ${input.gapId}`);
  if (!gap.question || !gap.questionId) {
    throw new Error(`Evidence gap ${input.gapId} cannot be resolved with a direct answer.`);
  }
  if (!hasMeaningfulValue(input.answer)) {
    throw new Error(`Evidence gap answer is empty: ${input.gapId}`);
  }

  const nowIso = (input.now ?? new Date()).toISOString();
  const answer = DiscoveryAnswerSchema.parse({
    id: `${session.id}:${gap.questionId}`,
    questionId: gap.questionId,
    scope: discoveryScopeForGap(gap),
    departmentId: `${session.companyId}:${session.activeDepartmentId}`,
    value: input.answer,
    valueType: gap.question.valueType,
    source: "user",
    evidenceRefs: input.evidenceRefs ?? [],
    confidence: 1,
    confirmedByUser: true,
    sensitivity: "internal",
    redactionApplied: false,
    answeredAt: nowIso
  });
  const nextSession = BusinessDiscoverySessionSchema.parse({
    ...session,
    answers: [
      ...session.answers.filter((item) =>
        item.questionId !== answer.questionId || item.departmentId !== answer.departmentId
      ),
      answer
    ],
    revision: session.revision + 1,
    lastActor: input.answeredBy === "browser" ? "browser" : input.answeredBy === "api" ? "api" : "hermes",
    lastTransitionAt: nowIso,
    updatedAt: nowIso
  });
  await saveDiscoverySession(nextSession, projectRoot);
  const gaps = await compileEvidenceGaps({
    projectRoot,
    sessionId: session.id,
    now: input.now
  });
  return {
    session: nextSession,
    gaps,
    nextQuestions: await getNextEvidenceGapQuestions({
      projectRoot,
      sessionId: session.id,
      limit: 3
    })
  };
}

export async function mergeHermesEvidenceGaps(input: {
  projectRoot?: string;
  sessionId: string;
  gaps: EvidenceGap[];
  now?: Date;
}): Promise<EvidenceGapSet> {
  return compileEvidenceGaps({
    projectRoot: input.projectRoot,
    sessionId: input.sessionId,
    additionalGaps: input.gaps,
    now: input.now
  });
}

export async function readEvidenceGapSet(
  sessionId: string,
  projectRoot = process.cwd()
): Promise<EvidenceGapSet | undefined> {
  try {
    const raw = await readFile(evidenceGapSetPath(sessionId, path.resolve(projectRoot)), "utf8");
    return evidenceGapSetSchema.parse(JSON.parse(raw));
  } catch {
    return undefined;
  }
}

async function saveEvidenceGapSet(set: EvidenceGapSet, projectRoot: string): Promise<void> {
  const filePath = evidenceGapSetPath(set.sessionId, projectRoot);
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(set, null, 2)}\n`);
}

function evidenceGapSetPath(sessionId: string, projectRoot: string): string {
  return path.join(
    getLoopgraphRoot(projectRoot),
    "discovery",
    "evidence-gaps",
    `${encodeURIComponent(sessionId)}.json`
  );
}

function conditionalGaps(
  session: BusinessDiscoverySession,
  answers: Map<string, DiscoveryAnswer>,
  nowIso: string
): EvidenceGap[] {
  const department = session.activeDepartmentId!;
  const gaps: EvidenceGap[] = [];
  if (!hasMeaningfulAnswer(answers.get("ideal_outcome_proof.baseline_target"))) {
    gaps.push(createGap({
      session,
      department,
      field: "ideal_outcome_proof.baseline_target",
      questionId: "ideal_outcome_proof.baseline_target",
      reason: "An observed baseline or a baseline-collection plan is required before measured value can be claimed.",
      requiredFor: ["execution"],
      resolution: "ask_user",
      blocking: false,
      question: {
        prompt: "What baseline and target should this loop use, or how should Loopgraph collect the baseline during shadow mode?",
        valueType: "text",
        examples: ["Reduce activation recovery time from five days to two days."]
      },
      nowIso
    }));
  }
  if (
    !hasMeaningfulAnswer(answers.get("current_stack_sources.event_sources_subjects")) &&
    !hasMeaningfulAnswer(answers.get("biggest_recurring_problem.problem_signal"))
  ) {
    gaps.push(createGap({
      session,
      department,
      field: "current_stack_sources.event_sources_subjects",
      questionId: "current_stack_sources.event_sources_subjects",
      reason: "Hermes needs a stable event source and business subject before the loop can be routed reliably.",
      requiredFor: ["routing"],
      resolution: "ask_user",
      blocking: false,
      question: {
        prompt: "Which system should alert Hermes, and what stable object identifies the affected campaign, account, customer, issue, or process?",
        valueType: "text",
        examples: ["PostHog alert for workspace_id", "GitHub issue event for repository/issue number"]
      },
      nowIso
    }));
  }
  if (!hasMeaningfulAnswer(answers.get("ideal_outcome_proof.completion_signal"))) {
    gaps.push(createGap({
      session,
      department,
      field: "ideal_outcome_proof.completion_signal",
      questionId: "ideal_outcome_proof.completion_signal",
      reason: "A completion signal is needed to distinguish work performed from a business problem actually resolved.",
      requiredFor: ["execution"],
      resolution: "ask_user",
      blocking: false,
      question: {
        prompt: "Which downstream event, verified output, or metric change proves the business problem was handled?",
        valueType: "string_array",
        examples: ["Activation returned above target", "Approved issue was closed after verification"]
      },
      nowIso
    }));
  }
  return gaps;
}

function createGap(input: {
  session: BusinessDiscoverySession;
  department: NonNullable<BusinessDiscoverySession["activeDepartmentId"]>;
  field: string;
  questionId?: string;
  reason: string;
  requiredFor: string[];
  resolution: EvidenceGap["resolution"];
  blocking: boolean;
  question?: EvidenceGap["question"];
  nowIso: string;
}): EvidenceGap {
  const id = `gap_${contentHash({
    sessionId: input.session.id,
    department: input.department,
    field: input.field,
    requiredFor: input.requiredFor
  })}`;
  return evidenceGapSchema.parse({
    schemaVersion: EVIDENCE_GAP_SCHEMA_VERSION,
    id,
    sessionId: input.session.id,
    companyId: input.session.companyId,
    department: input.department,
    scope: scopeForField(input.field),
    field: input.field,
    ...(input.questionId ? { questionId: input.questionId } : {}),
    reason: input.reason,
    requiredFor: input.requiredFor,
    resolution: input.resolution,
    status: "open",
    blocking: input.blocking,
    confidence: 1,
    evidenceRefs: [],
    ...(input.question ? { question: input.question } : {}),
    createdAt: input.nowIso,
    updatedAt: input.nowIso
  });
}

function hasMeaningfulAnswer(answer?: DiscoveryAnswer): boolean {
  return Boolean(answer && hasMeaningfulValue(answer.value));
}

function hasMeaningfulValue(value: unknown): boolean {
  if (value === undefined || value === null) return false;
  if (typeof value === "string") return value.trim().length > 0;
  if (typeof value === "number") return Number.isFinite(value);
  if (typeof value === "boolean") return true;
  if (Array.isArray(value)) return value.some(hasMeaningfulValue);
  if (typeof value === "object") return Object.keys(value as Record<string, unknown>).length > 0;
  return false;
}

function scopeForField(field: string): EvidenceGap["scope"] {
  if (field.includes("metric") || field.includes("baseline") || field.includes("completion_signal")) return "metric";
  if (field.includes("owner") || field.includes("reviewer")) return "department";
  if (field.includes("boundary") || field.includes("forbidden") || field.includes("autonomy")) return "policy";
  if (field.includes("source") || field.includes("system") || field.includes("safe_reads")) return "connection";
  if (field.includes("problem") || field.includes("process") || field.includes("trigger")) return "problem";
  return "loop";
}

function discoveryScopeForGap(gap: EvidenceGap): DiscoveryAnswer["scope"] {
  if (gap.scope === "company") return "company";
  if (gap.scope === "connection") return "access";
  if (gap.scope === "metric") return "metric";
  if (gap.scope === "policy" || gap.scope === "department") return "human";
  if (gap.scope === "problem" || gap.scope === "loop") return "process";
  return "process";
}

function isOpenBlockingGap(gap: EvidenceGap): boolean {
  return gap.blocking && ["open", "asked"].includes(gap.status);
}

function compareGaps(left: EvidenceGap, right: EvidenceGap): number {
  if (left.blocking !== right.blocking) return left.blocking ? -1 : 1;
  const leftStage = Math.min(...left.requiredFor.map(stageOrder));
  const rightStage = Math.min(...right.requiredFor.map(stageOrder));
  return leftStage - rightStage || left.field.localeCompare(right.field);
}

function stageOrder(stage: EvidenceGapRequiredFor): number {
  return {
    problem_classification: 0,
    design: 1,
    simulation: 2,
    routing: 3,
    execution: 4
  }[stage];
}

function normalizeRequiredFor(
  stages: Array<"candidate_generation" | "design" | "materialization" | "execution">
): EvidenceGapRequiredFor[] {
  const normalized = stages.map((stage): EvidenceGapRequiredFor => {
    if (stage === "candidate_generation") return "problem_classification";
    if (stage === "materialization") return "simulation";
    return stage;
  });
  return Array.from(new Set(normalized.length > 0 ? normalized : ["design"]));
}

async function requireSession(sessionId: string, projectRoot: string): Promise<BusinessDiscoverySession> {
  const session = await getDiscoverySession(sessionId, projectRoot);
  if (!session) throw new Error(`Discovery session not found: ${sessionId}`);
  return session;
}
