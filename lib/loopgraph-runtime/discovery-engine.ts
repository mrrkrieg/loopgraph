import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import YAML from "yaml";
import { AccessRequirementSchema, type AccessRequirement } from "loopgraph/core";
import {
  BusinessDiscoverySessionSchema,
  type BusinessDiscoverySession,
  type CompanyDiscoveryProfile,
  type DepartmentProfile,
  type DiscoveryAnswer
} from "loopgraph/core";
import { LoopRecommendationSchema, type LoopRecommendation } from "loopgraph/core";
import { MetricDefinitionSchema, UndefinedMetricSchema, type MetricDefinition, type UndefinedMetric } from "loopgraph/core";
import type { ProcessInventoryItem } from "loopgraph/core";
import type { DailySummary } from "loopgraph/core";
import type { LoopSpec } from "loopgraph/core";
import { registerLoopSpec } from "../loop-engineering-builder/local-workspace";
import { getActiveLoopgraphProjectRoot, getLoopgraphRoot } from "./storage-resolver";
import { generateAccessPlan as planAccess } from "./access-planner";
import { generateDailySummary } from "./daily-summary-generator";
import { generateHumanRequirementPlan } from "./human-requirement-planner";
import { calculateLoopReadiness } from "./loop-readiness";
import { tryMaterializeLoopRecommendation } from "./loop-materializer";
import { generateMetricPlan as planMetrics } from "./metric-planner";
import {
  buildProcessInventory,
  inferDepartments,
  inferGoals,
  inferProcessGoalMappings
} from "./process-classifier";
import { recommendLoopsForSession } from "./loop-recommender";
import { loadDepartmentSkillPacks } from "./skill-pack-loader";

export { buildProcessInventory, inferDepartments, inferGoals };

export type StartDiscoverySessionInput = {
  id?: string;
  companyId?: string;
  companyProfile?: Partial<CompanyDiscoveryProfile>;
  departmentProfiles?: DepartmentProfile[];
  processInventory?: ProcessInventoryItem[];
  answers?: DiscoveryAnswer[];
  persist?: boolean;
};

export async function startDiscoverySession(
  input: StartDiscoverySessionInput = {},
  projectRoot = getActiveLoopgraphProjectRoot()
): Promise<BusinessDiscoverySession> {
  const now = new Date().toISOString();
  const companyId = input.companyId ?? input.companyProfile?.id ?? `company_${Date.now()}`;
  const session = BusinessDiscoverySessionSchema.parse({
    id: input.id ?? `session_${Date.now()}`,
    companyId,
    status: "started",
    companyProfile: input.companyProfile ? {
      id: companyId,
      departments: [],
      tools: [],
      bottlenecks: [],
      recurringWork: [],
      aiNeverActions: [],
      customerFacingOutputs: [],
      leadershipJudgment: [],
      ...input.companyProfile
    } : undefined,
    departmentProfiles: input.departmentProfiles ?? [],
    processInventory: input.processInventory ?? [],
    answers: input.answers ?? [],
    recommendedLoops: [],
    accessRequirements: [],
    metricDefinitions: [],
    undefinedMetrics: [],
    humanRequirements: [],
    createdLoopIds: [],
    createdAt: now,
    updatedAt: now
  });

  if (input.persist !== false) {
    await saveDiscoverySession(session, projectRoot);
  }
  return session;
}

export async function answerDiscoveryQuestion(
  sessionId: string,
  answer: Omit<DiscoveryAnswer, "id" | "answeredAt"> & Partial<Pick<DiscoveryAnswer, "id" | "answeredAt">>,
  projectRoot = getActiveLoopgraphProjectRoot()
) {
  const session = await loadDiscoverySession(sessionId, projectRoot);
  if (!session) throw new Error(`Discovery session not found: ${sessionId}`);
  const next = BusinessDiscoverySessionSchema.parse({
    ...session,
    status: nextStatusForScope(answer.scope),
    answers: [
      ...session.answers.filter((item) => item.questionId !== answer.questionId || item.departmentId !== answer.departmentId),
      {
        id: answer.id ?? `${sessionId}:${answer.questionId}`,
        answeredAt: answer.answeredAt ?? new Date().toISOString(),
        ...answer
      }
    ],
    updatedAt: new Date().toISOString()
  });
  await saveDiscoverySession(next, projectRoot);
  return next;
}

export async function runDiscoveryPipeline(
  session: BusinessDiscoverySession,
  projectRoot = getActiveLoopgraphProjectRoot()
): Promise<BusinessDiscoverySession> {
  const skillPacks = await loadDepartmentSkillPacks(projectRoot);
  const departmentProfiles = inferDepartments(session, skillPacks);
  const processInventory = buildProcessInventory({ ...session, departmentProfiles });
  const departmentGoals = inferGoals({ ...session, departmentProfiles, processInventory });
  const processGoalMappings = inferProcessGoalMappings({
    ...session,
    departmentProfiles,
    processInventory,
    departmentGoals
  }, departmentGoals);
  const baseSession = BusinessDiscoverySessionSchema.parse({
    ...session,
    departmentProfiles,
    processInventory,
    departmentGoals,
    processGoalMappings,
    status: "process_inventory",
    updatedAt: new Date().toISOString()
  });
  const recommendedLoops = await recommendLoops(baseSession, projectRoot);
  const accessRequirements = await generateAccessPlan(recommendedLoops, projectRoot, processInventory);
  const humanRequirements = generateHumanRequirementPlan(recommendedLoops);
  const metricPlan = await generateMetricPlan(recommendedLoops, accessRequirements, projectRoot);
  const enrichedLoops = attachPlansToRecommendations(
    recommendedLoops,
    accessRequirements,
    metricPlan.metricDefinitions,
    metricPlan.undefinedMetrics,
    humanRequirements
  );

  return BusinessDiscoverySessionSchema.parse({
    ...baseSession,
    status: "recommendations_ready",
    recommendedLoops: enrichedLoops,
    accessRequirements,
    metricDefinitions: metricPlan.metricDefinitions,
    undefinedMetrics: metricPlan.undefinedMetrics,
    humanRequirements,
    updatedAt: new Date().toISOString()
  });
}

export async function recommendLoops(
  session: BusinessDiscoverySession,
  projectRoot = getActiveLoopgraphProjectRoot()
): Promise<LoopRecommendation[]> {
  const skillPacks = await loadDepartmentSkillPacks(projectRoot);
  return recommendLoopsForSession(session, skillPacks);
}

export async function generateAccessPlan(
  recommendations: LoopRecommendation[],
  projectRoot = getActiveLoopgraphProjectRoot(),
  processes: ProcessInventoryItem[] = []
): Promise<AccessRequirement[]> {
  const skillPacks = await loadDepartmentSkillPacks(projectRoot);
  return planAccess(recommendations, skillPacks, processes);
}

export async function generateMetricPlan(
  recommendations: LoopRecommendation[],
  accessRequirements: AccessRequirement[] = [],
  projectRoot = getActiveLoopgraphProjectRoot()
) {
  const skillPacks = await loadDepartmentSkillPacks(projectRoot);
  return planMetrics(recommendations, skillPacks, accessRequirements);
}

export { generateHumanRequirementPlan };

export async function materializeAcceptedLoops(
  session: BusinessDiscoverySession,
  projectRoot = getActiveLoopgraphProjectRoot()
): Promise<{
  loopSpecs: LoopSpec[];
  session: BusinessDiscoverySession;
  errors: Record<string, string[]>;
}> {
  const loopSpecs: LoopSpec[] = [];
  const errors: Record<string, string[]> = {};
  const nextRecommendations: LoopRecommendation[] = [];
  const createdLoopIds = new Set(session.createdLoopIds);

  for (const recommendation of session.recommendedLoops) {
    if (recommendation.status !== "accepted" && recommendation.status !== "materialized") {
      nextRecommendations.push(recommendation);
      continue;
    }

    const departmentProfile = session.departmentProfiles.find((department) => department.id === recommendation.departmentId);
    if (!session.companyProfile || !departmentProfile) {
      errors[recommendation.id] = ["Missing company or department profile"];
      nextRecommendations.push({ ...recommendation, status: "needs_more_info", validationErrors: errors[recommendation.id] });
      continue;
    }

    const result = tryMaterializeLoopRecommendation({
      recommendation,
      companyProfile: session.companyProfile,
      departmentProfile,
      accessRequirements: session.accessRequirements.filter((item) => item.loopRecommendationId === recommendation.id),
      metricDefinitions: session.metricDefinitions.filter((item) => item.loopRecommendationId === recommendation.id),
      humanRequirements: session.humanRequirements.filter((item) => item.loopRecommendationId === recommendation.id)
    });

    if (!result.ok) {
      errors[recommendation.id] = result.errors;
      nextRecommendations.push({ ...recommendation, status: "needs_more_info", validationErrors: result.errors });
      continue;
    }

    const specPath = await writeMaterializedLoopSpec(result.spec, session.companyId, projectRoot);
    await registerLoopSpec(specPath, projectRoot);
    loopSpecs.push(result.spec);
    createdLoopIds.add(result.spec.metadata.id);
    nextRecommendations.push({
      ...recommendation,
      status: "materialized",
      validationErrors: []
    });
  }

  const nextSession = BusinessDiscoverySessionSchema.parse({
    ...session,
    status: errors && Object.keys(errors).length > 0 ? "ready_to_materialize" : "completed",
    recommendedLoops: nextRecommendations,
    createdLoopIds: Array.from(createdLoopIds).sort(),
    updatedAt: new Date().toISOString()
  });
  await saveDiscoverySession(nextSession, projectRoot);
  return { loopSpecs, session: nextSession, errors };
}

export function acceptRecommendation(
  session: BusinessDiscoverySession,
  recommendationId: string
) {
  return BusinessDiscoverySessionSchema.parse({
    ...session,
    recommendedLoops: session.recommendedLoops.map((recommendation) =>
      recommendation.id === recommendationId
        ? { ...recommendation, status: "accepted" }
        : recommendation
    ),
    updatedAt: new Date().toISOString()
  });
}

export function rejectRecommendation(
  session: BusinessDiscoverySession,
  recommendationId: string
) {
  return BusinessDiscoverySessionSchema.parse({
    ...session,
    recommendedLoops: session.recommendedLoops.map((recommendation) =>
      recommendation.id === recommendationId
        ? { ...recommendation, status: "rejected" }
        : recommendation
    ),
    updatedAt: new Date().toISOString()
  });
}

export async function buildDemoDiscoverySession(projectRoot = process.cwd()) {
  const fixturePath = path.join(projectRoot, "examples", "business-discovery", "acme-saas-answers.json");
  const fixture = JSON.parse(await readFile(fixturePath, "utf8")) as StartDiscoverySessionInput;
  const session = await startDiscoverySession({ ...fixture, persist: false }, projectRoot);
  return runDiscoveryPipeline(session, projectRoot);
}

export async function saveDiscoverySession(session: BusinessDiscoverySession, projectRoot = getActiveLoopgraphProjectRoot()) {
  await writeJson(path.join(discoveryRoot(projectRoot), "sessions", `${session.id}.json`), session);
  await Promise.all([
    ...session.recommendedLoops.map((item) => saveLoopRecommendation(item, projectRoot)),
    ...session.accessRequirements.map((item) => saveAccessRequirement(item, projectRoot)),
    ...session.metricDefinitions.map((item) => saveMetricDefinition(item, projectRoot)),
    ...session.undefinedMetrics.map((item) => saveUndefinedMetric(item, projectRoot))
  ]);
}

export async function loadDiscoverySession(sessionId: string, projectRoot = getActiveLoopgraphProjectRoot()) {
  return readJson(
    path.join(discoveryRoot(projectRoot), "sessions", `${sessionId}.json`),
    BusinessDiscoverySessionSchema
  );
}

export async function listDiscoverySessions(projectRoot = getActiveLoopgraphProjectRoot()) {
  return listJson(path.join(discoveryRoot(projectRoot), "sessions"), BusinessDiscoverySessionSchema);
}

export async function saveLoopRecommendation(item: LoopRecommendation, projectRoot = getActiveLoopgraphProjectRoot()) {
  await writeJson(path.join(rootDir(projectRoot, "recommendations"), `${safeFileId(item.id)}.json`), item);
}

export async function listLoopRecommendations(projectRoot = getActiveLoopgraphProjectRoot()) {
  return listJson(rootDir(projectRoot, "recommendations"), LoopRecommendationSchema);
}

export async function saveAccessRequirement(item: AccessRequirement, projectRoot = getActiveLoopgraphProjectRoot()) {
  await writeJson(path.join(rootDir(projectRoot, "access"), `${safeFileId(item.id)}.json`), item);
}

export async function listAccessRequirements(projectRoot = getActiveLoopgraphProjectRoot()) {
  return listJson(rootDir(projectRoot, "access"), AccessRequirementSchema);
}

export async function saveMetricDefinition(item: MetricDefinition, projectRoot = getActiveLoopgraphProjectRoot()) {
  await writeJson(path.join(rootDir(projectRoot, "metrics"), `${safeFileId(item.id)}.json`), item);
}

export async function listMetricDefinitions(projectRoot = getActiveLoopgraphProjectRoot()) {
  return listJson(rootDir(projectRoot, "metrics"), MetricDefinitionSchema);
}

export async function saveUndefinedMetric(item: UndefinedMetric, projectRoot = getActiveLoopgraphProjectRoot()) {
  await writeJson(path.join(rootDir(projectRoot, "undefined-metrics"), `${safeFileId(item.id)}.json`), item);
}

export async function listUndefinedMetrics(projectRoot = getActiveLoopgraphProjectRoot()) {
  return listJson(rootDir(projectRoot, "undefined-metrics"), UndefinedMetricSchema);
}

export async function saveDailySummary(summary: DailySummary, projectRoot = getActiveLoopgraphProjectRoot()) {
  await writeJson(path.join(rootDir(projectRoot, "daily-summary"), `${summary.date}.json`), summary);
}

export async function loadDailySummary(date: string, projectRoot = getActiveLoopgraphProjectRoot()) {
  return readJson(path.join(rootDir(projectRoot, "daily-summary"), `${date}.json`), undefined);
}

export async function generateDemoDailySummary(projectRoot = process.cwd()) {
  const session = await buildDemoDiscoverySession(projectRoot);
  const accepted = BusinessDiscoverySessionSchema.parse({
    ...session,
    recommendedLoops: session.recommendedLoops.map((item) => ({ ...item, status: "accepted" }))
  });
  const loopSpecs = accepted.recommendedLoops
    .map((recommendation) => {
      const departmentProfile = accepted.departmentProfiles.find((department) => department.id === recommendation.departmentId);
      if (!accepted.companyProfile || !departmentProfile) return undefined;
      const result = tryMaterializeLoopRecommendation({
        recommendation,
        companyProfile: accepted.companyProfile,
        departmentProfile,
        accessRequirements: accepted.accessRequirements.filter((item) => item.loopRecommendationId === recommendation.id),
        metricDefinitions: accepted.metricDefinitions.filter((item) => item.loopRecommendationId === recommendation.id),
        humanRequirements: accepted.humanRequirements.filter((item) => item.loopRecommendationId === recommendation.id)
      });
      return result.ok ? result.spec : undefined;
    })
    .filter((spec): spec is LoopSpec => Boolean(spec));

  const summary = generateDailySummary({
    companyId: accepted.companyId,
    loopSpecs,
    traces: [],
    cases: [],
    reviews: [],
    accessRequirements: accepted.accessRequirements,
    metricDefinitions: accepted.metricDefinitions,
    undefinedMetrics: accepted.undefinedMetrics,
    improvements: []
  });
  return { session: accepted, summary, loopSpecs };
}

function attachPlansToRecommendations(
  recommendations: LoopRecommendation[],
  accessRequirements: AccessRequirement[],
  metricDefinitions: MetricDefinition[],
  undefinedMetrics: UndefinedMetric[],
  humanRequirements: ReturnType<typeof generateHumanRequirementPlan>
) {
  return recommendations.map((recommendation) => {
    const next = LoopRecommendationSchema.parse({
      ...recommendation,
      accessRequirements: accessRequirements.filter((item) => item.loopRecommendationId === recommendation.id),
      metricDrafts: metricDefinitions.filter((item) => item.loopRecommendationId === recommendation.id),
      undefinedMetrics: undefinedMetrics.filter((item) => item.loopRecommendationId === recommendation.id),
      humanRequirements: humanRequirements.filter((item) => item.loopRecommendationId === recommendation.id)
    });
    return LoopRecommendationSchema.parse({
      ...next,
      readiness: calculateLoopReadiness(next)
    });
  });
}

async function writeMaterializedLoopSpec(spec: LoopSpec, companyId: string, projectRoot: string) {
  const specDir = path.join(discoveryRoot(projectRoot), "generated", companyId, spec.metadata.id);
  const specPath = path.join(specDir, "loopgraph.yaml");
  await mkdir(specDir, { recursive: true });
  await writeFile(specPath, YAML.stringify(spec));
  return specPath;
}

function nextStatusForScope(scope: DiscoveryAnswer["scope"]): BusinessDiscoverySession["status"] {
  const statusByScope: Record<DiscoveryAnswer["scope"], BusinessDiscoverySession["status"]> = {
    company: "company_questions",
    department: "department_questions",
    process: "process_inventory",
    goal: "goal_mapping",
    access: "access_mapping",
    metric: "metric_definition",
    human: "human_requirements"
  };
  return statusByScope[scope];
}

function discoveryRoot(projectRoot: string) {
  return path.join(getLoopgraphRoot(projectRoot), "discovery");
}

function rootDir(projectRoot: string, child: string) {
  return path.join(getLoopgraphRoot(projectRoot), child);
}

async function writeJson(filePath: string, data: unknown) {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(data, null, 2)}\n`);
}

async function readJson<T>(filePath: string, schema?: { parse(value: unknown): T }): Promise<T | undefined> {
  try {
    const parsed = JSON.parse(await readFile(filePath, "utf8"));
    return schema ? schema.parse(parsed) : parsed as T;
  } catch {
    return undefined;
  }
}

async function listJson<T>(dir: string, schema: { parse(value: unknown): T }) {
  try {
    const files = (await readdir(dir)).filter((file) => file.endsWith(".json")).sort();
    const items: T[] = [];
    for (const file of files) {
      const item = await readJson(path.join(dir, file), schema);
      if (item) items.push(item);
    }
    return items;
  } catch {
    return [];
  }
}

function safeFileId(id: string) {
  return id.replace(/[^a-zA-Z0-9_.-]+/g, "_");
}
