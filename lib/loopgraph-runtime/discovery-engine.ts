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
import {
  DailySummarySchema,
  humanReviewTraceSchema,
  metricSampleSchema,
  observedOutcomeSchema,
  valueLedgerEntrySchema,
  type DailySummary,
  type HumanReviewTrace,
  type MetricSample,
  type ObservedOutcome,
  type ValueLedgerEntry
} from "loopgraph/core";
import type { LoopSpec } from "loopgraph/core";
import {
  FileOutcomeStore,
  loadLoopSpecFromPath,
  readLoopgraphWorkspace,
  resolveExistingProjectPath
} from "loopgraph/runtime";
import { registerLoopSpec } from "../loop-engineering-builder/local-workspace";
import {
  getActiveLoopgraphProjectRoot,
  getLoopgraphRoot,
  getStorageAdapter
} from "./storage-resolver";
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
  return readJson(path.join(rootDir(projectRoot, "daily-summary"), `${date}.json`), DailySummarySchema);
}

export async function generateProjectDailySummary(
  projectRoot = getActiveLoopgraphProjectRoot(),
  date = new Date().toISOString().slice(0, 10)
) {
  const resolvedProjectRoot = path.resolve(projectRoot);
  const workspace = await readLoopgraphWorkspace(resolvedProjectRoot);
  const [accessRequirements, metricDefinitions, undefinedMetrics, sessions] = await Promise.all([
    listAccessRequirements(resolvedProjectRoot),
    listMetricDefinitions(resolvedProjectRoot),
    listUndefinedMetrics(resolvedProjectRoot),
    listDiscoverySessions(resolvedProjectRoot)
  ]);
  const loopSpecs = (await Promise.all(workspace.registeredSpecs.map(async (entry) => {
    try {
      const specPath = await resolveExistingProjectPath(
        resolvedProjectRoot,
        entry.path,
        "registered LoopSpec"
      );
      const loaded = await loadLoopSpecFromPath(specPath);
      return loaded.ok ? loaded.spec : undefined;
    } catch {
      return undefined;
    }
  }))).filter((spec): spec is LoopSpec => Boolean(spec));
  const storage = getStorageAdapter({
    rootDir: getLoopgraphRoot(resolvedProjectRoot),
    forceFile: true
  });
  const [runRefs, caseRefs, reviews] = await Promise.all([
    storage.listRuns(),
    storage.listCases(),
    listJson<HumanReviewTrace>(
      path.join(getLoopgraphRoot(resolvedProjectRoot), "reviews"),
      humanReviewTraceSchema
    )
  ]);
  const [traces, cases] = await Promise.all([
    Promise.all(runRefs.map((run) => storage.getRun(run.id))),
    Promise.all(caseRefs.map((caseItem) => storage.getEscalationCase(caseItem.id)))
  ]);
  const outcomeStore = new FileOutcomeStore(getLoopgraphRoot(resolvedProjectRoot));
  const [metricSamples, observedOutcomes, valueLedgerEntries] = await Promise.all([
    outcomeStore.listMetricSamples(),
    outcomeStore.listObservedOutcomes(),
    outcomeStore.listValueLedgerEntries()
  ]);
  const companyId = metricDefinitions[0]?.companyId ??
    metricSamples[0]?.companyId ??
    observedOutcomes[0]?.companyId ??
    valueLedgerEntries[0]?.companyId ??
    sessions[0]?.companyId ??
    workspace.projectRootId;
  const summary = generateDailySummary({
    companyId,
    loopSpecs,
    traces: traces.filter((trace): trace is NonNullable<typeof trace> => Boolean(trace)),
    cases: cases.filter((caseItem): caseItem is NonNullable<typeof caseItem> => Boolean(caseItem)),
    reviews,
    accessRequirements,
    metricDefinitions,
    undefinedMetrics,
    improvements: [],
    metricSamples,
    observedOutcomes,
    valueLedgerEntries,
    date
  });
  return { summary, loopSpecs };
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
  const evidence = buildDemoOutcomeEvidence(accepted, loopSpecs);

  const summary = generateDailySummary({
    companyId: accepted.companyId,
    loopSpecs,
    traces: [],
    cases: [],
    reviews: [],
    accessRequirements: accepted.accessRequirements,
    metricDefinitions: accepted.metricDefinitions,
    undefinedMetrics: accepted.undefinedMetrics,
    improvements: [],
    metricSamples: evidence.metricSamples,
    observedOutcomes: evidence.observedOutcomes,
    valueLedgerEntries: evidence.valueLedgerEntries
  });
  return { session: accepted, summary, loopSpecs };
}

function buildDemoOutcomeEvidence(
  session: BusinessDiscoverySession,
  loopSpecs: LoopSpec[]
): {
  metricSamples: MetricSample[];
  observedOutcomes: ObservedOutcome[];
  valueLedgerEntries: ValueLedgerEntry[];
} {
  const today = new Date().toISOString().slice(0, 10);
  const prior = new Date(`${today}T00:00:00.000Z`);
  prior.setUTCDate(prior.getUTCDate() - 30);
  const baselineWindow = {
    start: prior.toISOString(),
    end: prior.toISOString().replace("00:00:00.000Z", "23:59:59.999Z")
  };
  const evaluationWindow = {
    start: `${today}T00:00:00.000Z`,
    end: `${today}T23:59:59.999Z`
  };
  const metricSamples: MetricSample[] = [];
  const observedOutcomes: ObservedOutcome[] = [];
  const valueLedgerEntries: ValueLedgerEntry[] = [];

  loopSpecs.forEach((spec, index) => {
    const definition = session.metricDefinitions.find((metric) =>
      metric.loopId === spec.metadata.id ||
      metric.loopRecommendationId === spec.metadata.labels?.recommendationId
    );
    if (!definition) return;
    const desiredDirection = definition.desiredDirection ?? "increase";
    const baselineValue = definition.baselineValue ?? 100;
    const observedValue = desiredDirection === "decrease"
      ? baselineValue * 0.85
      : desiredDirection === "target"
        ? definition.target ?? baselineValue
        : desiredDirection === "maintain"
          ? baselineValue
          : baselineValue * 1.15;
    const absoluteDelta = observedValue - baselineValue;
    const relativeDeltaPct = baselineValue === 0
      ? undefined
      : (absoluteDelta / Math.abs(baselineValue)) * 100;
    const outcomeStatus = desiredDirection === "target"
      ? "target_met"
      : desiredDirection === "maintain"
        ? "unchanged"
        : "improved";
    const unit = definition.unit ?? defaultMetricUnit(definition.type);
    const baselineId = `preview_sample_${spec.metadata.id}_baseline`;
    const observedId = `preview_sample_${spec.metadata.id}_observed`;
    metricSamples.push(
      metricSampleSchema.parse({
        schemaVersion: "metric-sample/v1alpha1",
        id: baselineId,
        idempotencyKey: baselineId,
        workspaceId: "hosted_preview",
        companyId: session.companyId,
        departmentId: spec.topology?.department,
        loopId: spec.metadata.id,
        metricDefinitionId: definition.id,
        metricKey: definition.key,
        value: baselineValue,
        unit,
        window: baselineWindow,
        observedAt: baselineWindow.end,
        recordedAt: baselineWindow.end,
        truthStatus: "modeled",
        source: { type: "modeled", sourceRef: `hosted-preview:${definition.id}:baseline` },
        quality: { status: "estimated", reason: "Hosted preview sample data." },
        evidenceRefs: []
      }),
      metricSampleSchema.parse({
        schemaVersion: "metric-sample/v1alpha1",
        id: observedId,
        idempotencyKey: observedId,
        workspaceId: "hosted_preview",
        companyId: session.companyId,
        departmentId: spec.topology?.department,
        loopId: spec.metadata.id,
        metricDefinitionId: definition.id,
        metricKey: definition.key,
        value: observedValue,
        unit,
        window: evaluationWindow,
        observedAt: evaluationWindow.end,
        recordedAt: evaluationWindow.end,
        truthStatus: "modeled",
        source: { type: "modeled", sourceRef: `hosted-preview:${definition.id}:observed` },
        quality: { status: "estimated", reason: "Hosted preview sample data." },
        evidenceRefs: []
      })
    );
    const outcomeId = `preview_outcome_${spec.metadata.id}`;
    observedOutcomes.push(observedOutcomeSchema.parse({
      schemaVersion: "observed-outcome/v1alpha1",
      id: outcomeId,
      workspaceId: "hosted_preview",
      companyId: session.companyId,
      departmentId: spec.topology?.department,
      loopId: spec.metadata.id,
      metricDefinitionId: definition.id,
      metricKey: definition.key,
      unit,
      desiredDirection,
      evaluationWindow,
      baseline: { value: baselineValue, sampleIds: [baselineId] },
      observed: { value: observedValue, sampleIds: [observedId] },
      target: definition.target,
      absoluteDelta,
      relativeDeltaPct,
      status: outcomeStatus,
      truthStatus: "modeled",
      confidence: 0.72,
      evidenceSufficiency: {
        sufficient: true,
        reasons: ["Hosted preview uses modeled evidence; connect a source to observe this outcome."]
      },
      guardrails: [],
      runIds: [],
      problemIds: [],
      evidenceRefs: [],
      evaluatedAt: evaluationWindow.end
    }));
    const grossSavedMinutes = 75 + index * 15;
    const hiddenCostMinutes = {
      review: 8,
      rework: 4,
      botsitting: 3,
      escalation: 0,
      governance: 2
    };
    const observedCostMinutes = Object.values(hiddenCostMinutes)
      .reduce((total, value) => total + value, 0);
    valueLedgerEntries.push(valueLedgerEntrySchema.parse({
      schemaVersion: "value-ledger-entry/v1alpha1",
      id: `preview_value_${spec.metadata.id}`,
      workspaceId: "hosted_preview",
      companyId: session.companyId,
      departmentId: spec.topology?.department,
      loopId: spec.metadata.id,
      window: evaluationWindow,
      grossSavedMinutes,
      hiddenCostMinutes,
      observedCostMinutes,
      netSavedMinutes: grossSavedMinutes - observedCostMinutes,
      truthStatus: "modeled",
      calculationVersion: "loop-value/v1alpha1",
      observedOutcomeIds: [outcomeId],
      runIds: [],
      reviewIds: [],
      evidenceRefs: [],
      recordedAt: evaluationWindow.end
    }));
  });

  return { metricSamples, observedOutcomes, valueLedgerEntries };
}

function defaultMetricUnit(type: MetricDefinition["type"]) {
  const units: Record<MetricDefinition["type"], string> = {
    count: "count",
    rate: "percent",
    duration: "minutes",
    currency: "USD",
    score: "score",
    boolean: "boolean",
    composite: "index"
  };
  return units[type];
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
