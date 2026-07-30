import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import YAML from "yaml";
import { getLoopgraphRoot } from "../loopgraph-runtime/storage-resolver";
import {
  loadLoopSpecFromPath,
  type LoopSpecRegistryStore
} from "loopgraph/runtime";
import type { LoopSpec } from "loopgraph/core";
import { createSpecFromTemplate } from "./template-spec";
import { validateLoopSpec as validateFlatLoopSpec, type LoopSpec as FlatLoopSpec } from "./loop-spec-schema";
import { createDefaultAnswers, generateQuestions, type AnswerMap, type QuestionGroup } from "./question-engine";
import { getDepartmentTemplate, getTemplateById } from "./templates";
import type {
  DepartmentKey,
  LoopgraphWorkspaceRegistry,
  RegisteredLoopSpec
} from "./types";

export type LoadedRegisteredLoopSpec = RegisteredLoopSpec & {
  sourcePath: string;
  spec: LoopSpec;
};

const defaultRegistry: LoopgraphWorkspaceRegistry = {
  version: 1,
  registeredSpecs: [],
  demoCatalogEnabled: true
};

export function getLocalProjectRoot(projectRoot?: string) {
  return path.resolve(projectRoot ?? process.env.LOOPGRAPH_PROJECT_ROOT ?? process.cwd());
}

export function getWorkspaceRegistryPath(projectRoot = getLocalProjectRoot()) {
  return path.join(getLoopgraphRoot(getLocalProjectRoot(projectRoot)), "workspace.json");
}

export async function readWorkspaceRegistry(projectRoot = getLocalProjectRoot()): Promise<LoopgraphWorkspaceRegistry> {
  try {
    const raw = await readFile(getWorkspaceRegistryPath(getLocalProjectRoot(projectRoot)), "utf8");
    const parsed = JSON.parse(raw) as Partial<LoopgraphWorkspaceRegistry>;
    return {
      version: 1,
      registeredSpecs: Array.isArray(parsed.registeredSpecs) ? parsed.registeredSpecs : [],
      demoCatalogEnabled: parsed.demoCatalogEnabled ?? true
    };
  } catch {
    return defaultRegistry;
  }
}

export async function writeWorkspaceRegistry(
  registry: LoopgraphWorkspaceRegistry,
  projectRoot = getLocalProjectRoot()
) {
  const registryPath = getWorkspaceRegistryPath(getLocalProjectRoot(projectRoot));
  await mkdir(path.dirname(registryPath), { recursive: true });
  await writeFile(registryPath, `${JSON.stringify(registry, null, 2)}\n`);
}

export async function registerLoopSpec(specPath: string, projectRoot = getLocalProjectRoot()) {
  const resolvedProjectRoot = getLocalProjectRoot(projectRoot);
  const absoluteSpecPath = path.resolve(resolvedProjectRoot, specPath);
  const loaded = await loadLoopSpecFromPath(absoluteSpecPath);
  if (!loaded.ok) {
    throw new Error(`Cannot register LoopSpec:\n- ${loaded.errors.join("\n- ")}`);
  }

  const registry = await readWorkspaceRegistry(resolvedProjectRoot);
  const entry = entryFromSpec(loaded.spec, loaded.sourcePath, resolvedProjectRoot);
  const nextEntries = [
    ...registry.registeredSpecs.filter(
      (item) => item.id !== entry.id && resolveRegisteredPath(item.path, resolvedProjectRoot) !== loaded.sourcePath
    ),
    entry
  ].sort((left, right) => left.name.localeCompare(right.name));

  await writeWorkspaceRegistry({
    ...registry,
    registeredSpecs: nextEntries
  }, resolvedProjectRoot);

  return entry;
}

export async function getRegisteredLoopSpecs(projectRoot = getLocalProjectRoot()): Promise<LoadedRegisteredLoopSpec[]> {
  const resolvedProjectRoot = getLocalProjectRoot(projectRoot);
  const registry = await readWorkspaceRegistry(resolvedProjectRoot);
  const specs: LoadedRegisteredLoopSpec[] = [];

  for (const entry of registry.registeredSpecs) {
    const sourcePath = resolveRegisteredPath(entry.path, resolvedProjectRoot);
    const loaded = await loadLoopSpecFromPath(sourcePath);
    if (loaded.ok) {
      specs.push({
        ...entry,
        sourcePath: loaded.sourcePath,
        spec: loaded.spec
      });
    }
  }

  return specs;
}

export async function getRegisteredLoopSpecsFromStore(
  store: LoopSpecRegistryStore,
  projectRoot = getLocalProjectRoot()
): Promise<LoadedRegisteredLoopSpec[]> {
  return (await store.listActiveLoopSpecs(projectRoot)).map((artifact) => ({
    ...artifact.entry,
    templateId: artifact.entry.templateId ?? "hermes-design",
    department: studioDepartmentKey(artifact.entry.department),
    sourcePath: artifact.sourceRef ?? artifact.entry.path,
    spec: artifact.spec
  }));
}

export async function createLocalDesignStudioSpec(input: {
  templateId: string;
  name?: string;
  goal?: string;
  projectRoot?: string;
  answers?: AnswerMap;
  questionGroups?: QuestionGroup[];
}) {
  const projectRoot = getLocalProjectRoot(input.projectRoot);
  const template = getTemplateById(input.templateId);
  if (!template) {
    throw new Error(`Unknown template: ${input.templateId}`);
  }

  const id = uniqueLoopId(input.name || template.name);
  const goal = input.goal ?? template.goal ?? "";
  const answers = input.answers ?? createDefaultAnswers(template.department, input.templateId, goal);
  const questionGroups = input.questionGroups ?? generateQuestions(template.department, input.templateId, goal);
  const spec = withStudioLogic(createSpecFromTemplate(input.templateId, {
    id,
    name: input.name || template.name,
    goal
  }), answers, questionGroups);
  const specDir = path.join(getLoopgraphRoot(projectRoot), "design-studio", id);
  const specPath = path.join(specDir, "loopgraph.yaml");
  await mkdir(specDir, { recursive: true });
  await writeFile(specPath, YAML.stringify(spec));
  const entry = await registerLoopSpec(specPath, projectRoot);

  return {
    id,
    spec,
    path: specPath,
    entry
  };
}

export async function unregisterLoopSpec(loopId: string, projectRoot = getLocalProjectRoot()) {
  const resolvedProjectRoot = getLocalProjectRoot(projectRoot);
  const registry = await readWorkspaceRegistry(resolvedProjectRoot);
  const nextEntries = registry.registeredSpecs.filter((item) => item.id !== loopId);

  if (nextEntries.length === registry.registeredSpecs.length) {
    return false;
  }

  await writeWorkspaceRegistry({
    ...registry,
    registeredSpecs: nextEntries
  }, resolvedProjectRoot);

  return true;
}

export async function updateLocalLoopLogic(input: {
  loopId: string;
  answers: AnswerMap;
  questionGroups: QuestionGroup[];
  generatedSpec?: FlatLoopSpec;
  projectRoot?: string;
}) {
  const projectRoot = getLocalProjectRoot(input.projectRoot);
  const registry = await readWorkspaceRegistry(projectRoot);
  const entry = registry.registeredSpecs.find((item) => item.id === input.loopId);

  if (!entry) {
    return false;
  }

  const sourcePath = resolveRegisteredPath(entry.path, projectRoot);
  const loaded = await loadLoopSpecFromPath(sourcePath);
  if (!loaded.ok) {
    throw new Error(`Cannot update LoopSpec logic:\n- ${loaded.errors.join("\n- ")}`);
  }

  const spec = withStudioLogic(loaded.spec, input.answers, input.questionGroups, input.generatedSpec);
  await writeFile(sourcePath, YAML.stringify(spec));

  return true;
}

export function getStudioAnswers(spec: LoopSpec): AnswerMap {
  const extension = spec.studioExtension as Record<string, unknown> | undefined;
  const answers = recordOfStrings(extension?.answers);

  if (Object.keys(answers).length > 0) {
    return answers;
  }

  const questionGroups = Array.isArray(extension?.questionGroups) ? extension.questionGroups : [];
  return questionGroups.reduce<AnswerMap>((allAnswers, group) => {
    if (!isRecord(group) || !Array.isArray(group.questions)) {
      return allAnswers;
    }

    for (const question of group.questions) {
      if (!isRecord(question) || typeof question.questionKey !== "string") {
        continue;
      }
      allAnswers[question.questionKey] = String(question.answer ?? "");
    }

    return allAnswers;
  }, {});
}

export function getStudioGeneratedSpec(spec: LoopSpec): FlatLoopSpec | undefined {
  const extension = spec.studioExtension as Record<string, unknown> | undefined;

  if (!extension?.generatedSpec) {
    return undefined;
  }

  try {
    return validateFlatLoopSpec(extension.generatedSpec);
  } catch {
    return undefined;
  }
}

function entryFromSpec(spec: LoopSpec, sourcePath: string, projectRoot: string): RegisteredLoopSpec {
  const templateId = getTemplateId(spec);
  const department = getDepartmentKey(String(spec.topology?.department ?? "custom"));

  return {
    id: spec.metadata.id,
    name: spec.metadata.name,
    path: toRegistryPath(sourcePath, projectRoot),
    templateId,
    department,
    addedAt: new Date().toISOString()
  };
}

function getTemplateId(spec: LoopSpec) {
  const fromExtension = spec.studioExtension?.templateId;
  if (typeof fromExtension === "string" && fromExtension.length > 0) {
    return fromExtension;
  }
  return spec.metadata.labels?.templateId ?? spec.metadata.id;
}

function getDepartmentKey(value: string): DepartmentKey {
  return getDepartmentTemplate(value as DepartmentKey) ? (value as DepartmentKey) : "custom";
}

function studioDepartmentKey(value: string): DepartmentKey {
  if (value === "ops_finance") return "operations_finance";
  if (value === "hr_talent") return "hr";
  if (value === "legal_compliance") return "legal_security";
  return getDepartmentKey(value);
}

function toRegistryPath(sourcePath: string, projectRoot: string) {
  const relativePath = path.relative(projectRoot, sourcePath);
  return relativePath.startsWith("..") ? sourcePath : relativePath;
}

function resolveRegisteredPath(sourcePath: string, projectRoot: string) {
  return path.isAbsolute(sourcePath) ? sourcePath : path.resolve(projectRoot, sourcePath);
}

function withStudioLogic(
  spec: LoopSpec,
  answers: AnswerMap,
  questionGroups: QuestionGroup[],
  generatedSpec?: FlatLoopSpec
): LoopSpec {
  return {
    ...spec,
    studioExtension: {
      ...(spec.studioExtension ?? {}),
      answers,
      questionGroups: questionSnapshot(questionGroups, answers),
      ...(generatedSpec ? { generatedSpec } : {})
    }
  };
}

function questionSnapshot(questionGroups: QuestionGroup[], answers: AnswerMap) {
  return questionGroups.map((group) => ({
    section: group.section,
    questions: group.questions.map((question) => ({
      section: question.section,
      questionKey: question.questionKey,
      question: question.question,
      helpText: question.helpText,
      required: question.required,
      answerType: question.answerType,
      options: question.options,
      sortOrder: question.sortOrder,
      answer: answers[question.questionKey] ?? ""
    }))
  }));
}

function recordOfStrings(value: unknown): AnswerMap {
  if (!isRecord(value)) {
    return {};
  }

  return Object.fromEntries(
    Object.entries(value).map(([key, answer]) => [key, String(answer ?? "")])
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function uniqueLoopId(name: string) {
  const suffix = Date.now().toString(36);
  return `${slug(name)}-${suffix}`;
}

function slug(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
}
