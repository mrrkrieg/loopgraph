import { createSupabaseAdminClient } from "../db/supabase-admin";
import { getWorkspaceDatabase } from "../db/workspace-database";
import { createDefaultAnswers, generateQuestions, type AnswerMap } from "./question-engine";
import {
  buildGraphFromRegisteredSpecs,
  buildLoopGraph,
  createCatalogLoopRecords,
  loopRecordFromRegisteredSpec
} from "./graph";
import { getDemoWorkspace } from "./demo-data";
import { questionProgress } from "./demo-helpers";
import {
  createHumanReview,
  startLoopRun as simulateLoopRun
} from "./agent";
import { simulateHeroLoop } from "./runtime-bridge";
import {
  createLoopSpecArtifact,
  generateLoopRequirements,
  generateLoopSpec
} from "./spec-generator";
import { generateImplementationArtifacts } from "./implementation-generator";
import {
  createLocalDesignStudioSpec,
  getRegisteredLoopSpecs,
  getRegisteredLoopSpecsFromStore,
  getStudioAnswers,
  getStudioGeneratedSpec,
  unregisterLoopSpec,
  updateLocalLoopLogic,
  type LoadedRegisteredLoopSpec
} from "./local-workspace";
import { createSpecFromTemplate } from "./template-spec";
import { getDepartmentTemplates, getTemplateById } from "./templates";
import { v1alpha1ToFlat } from "loopgraph/core";
import {
  getActiveLoopgraphProjectRoot,
  getLoopSpecRegistryStore,
  getStorageAdapter
} from "../loopgraph-runtime/storage-resolver";
import { isHostedAuthRequired } from "../auth/hosted-config";
import { loadImprovementsFromStorage, loadLatestManagementRollup } from "loopgraph/runtime";
import {
  buildSemanticTopology,
  type SemanticTopology,
  type TopologyImprovementItem,
  type TopologyMetricInput
} from "loopgraph/core";
import type { LoopSpec as CoreLoopSpec } from "loopgraph/core";
import type { LoopRunTrace } from "loopgraph/core";
import type {
  DepartmentKey,
  GeneratedArtifact,
  HumanReview,
  ImprovementItem,
  LoopGraph,
  LoopRecord,
  LoopRun,
  LoopRunStep,
  WorkspaceData
} from "./types";

type SupabaseClient = NonNullable<ReturnType<typeof createSupabaseAdminClient>>;

type SemanticTopologyWorkspaceOptions = {
  includeCatalogLoops?: boolean;
  brainLabel?: string;
  hierarchyMode?: "management" | "hermes_brain";
};

type LoopRow = {
  id: string;
  organization_id: string;
  template_id?: string | null;
  name: string;
  department: DepartmentKey;
  loop_type: string;
  status: string;
  autonomy_level: string;
  goal: string | null;
  target_metric: string | null;
  business_outcome: string | null;
  cadence: string | null;
  spec?: unknown;
  owner_id?: string | null;
  created_at?: string;
};

export async function getWorkspace(selectedLoopId?: string): Promise<WorkspaceData> {
  const database = await getWorkspaceDatabase("workspace.read");
  const supabase = database.client;

  if (!supabase) {
    return selectLocalWorkspace(selectedLoopId);
  }

  const organization = await getOrFallbackOrganization(supabase, database.organizationId);
  if (!organization) {
    return database.hosted
      ? selectEmptyLocalWorkspace()
      : selectLocalWorkspace(selectedLoopId);
  }

  const { data: loopRows } = await supabase
    .from("loops")
    .select("*")
    .eq("organization_id", organization.id)
    .order("created_at", { ascending: true });

  if (!loopRows || loopRows.length === 0) {
    if (!database.hosted) return selectLocalWorkspace(selectedLoopId);
    const profile = {
      id: database.userId ?? "hosted_user",
      email: database.email ?? "",
      fullName:
        database.email?.split("@")[0] ?? "Loopgraph operator",
      role: database.role ?? "viewer"
    };
    const registeredSpecs = await getRegisteredLoopSpecsFromStore(
      getLoopSpecRegistryStore(),
      getActiveLoopgraphProjectRoot()
    );
    return registeredSpecs.length > 0
      ? selectRegisteredWorkspace({
          selectedLoopId,
          registeredSpecs,
          organization,
          profile,
          sourceLabel: "Hosted LoopSpec registry"
        })
      : selectEmptyLocalWorkspace(organization, profile);
  }

  const loops = await Promise.all(loopRows.map((row) => mapLoopRecord(supabase, row as LoopRow)));
  const selectedLoop = loops.find((loop) => loop.id === selectedLoopId) ?? loops[0];
  const answers = await getAnswers(supabase, selectedLoop.id);
  const answersWithDefaults = {
    ...createDefaultAnswers(selectedLoop.department, selectedLoop.templateId, selectedLoop.goal),
    ...answers
  };
  const questions = generateQuestions(selectedLoop.department, selectedLoop.templateId, selectedLoop.goal);
  const progress = questionProgress(questions, answersWithDefaults);
  const spec = await getLoopSpec(supabase, selectedLoop, answersWithDefaults);
  const artifacts = await getArtifacts(supabase, selectedLoop.id, spec);
  const runBundle = await getLatestRunBundle(supabase, selectedLoop);
  const improvements = mergeImprovements(
    await getImprovements(supabase, selectedLoop.id),
    await loadImprovementsFromStorage(getStorageAdapter(), selectedLoop.id)
  );
  const reviews = runBundle.review ? [runBundle.review] : [];
  const graph = buildLoopGraph({
    organization,
    loops,
    reviews,
    improvements,
    selectedNodeId: `loop:${selectedLoop.id}`,
    sourceLabel: "Supabase"
  });

  return {
    organization,
    profile: {
      id: database.userId ?? "profile_local",
      email: database.email ?? "operator@example.com",
      fullName: database.email?.split("@")[0] ?? "Loop Operator",
      role: database.role ?? "owner"
    },
    templates: getDepartmentTemplates(),
    loops,
    loop: selectedLoop,
    answers: answersWithDefaults,
    questions,
    progress,
    spec,
    artifacts,
    runBundle,
    improvements,
    managementReview: summarizeManagement(loops, graph),
    metrics: summarizeMetrics(graph, selectedLoop.id),
    graph
  };
}

export async function getLoop(loopId: string) {
  const workspace = await getWorkspace(loopId);
  return workspace.loop;
}

export async function createLoop(input: {
  organizationName: string;
  department: DepartmentKey;
  templateId: string;
  name: string;
  goal: string;
}) {
  const database = await getWorkspaceDatabase("loops.write");
  const supabase = database.client;
  const questions = generateQuestions(input.department, input.templateId, input.goal);
  const answers = createDefaultAnswers(input.department, input.templateId, input.goal);

  if (!supabase) {
    const created = await createLocalDesignStudioSpec({
      templateId: input.templateId,
      name: input.name,
      goal: input.goal,
      answers,
      questionGroups: questions
    });
    return created.id;
  }

  const template = getTemplateById(input.templateId);
  const existingOrg = await getOrFallbackOrganization(supabase, database.organizationId);
  if (database.hosted && !existingOrg) {
    throw new Error("The active organization is unavailable.");
  }
  const organization = existingOrg
    ? existingOrg
    : (
        await supabase
          .from("organizations")
          .insert({ name: input.organizationName || "Loopgraph workspace" })
          .select("id, name")
          .single()
      ).data;

  if (!organization) {
    throw new Error("Unable to resolve organization for new loop");
  }

  const { data: loop, error: loopError } = await supabase
    .from("loops")
    .insert({
      organization_id: organization.id,
      name: input.name || template?.name || "New Loop",
      department: input.department,
      loop_type:
        template?.loopType ??
        (input.templateId.split("-").slice(1).join("-") || "custom_company_loop"),
      status: "questions_in_progress",
      autonomy_level: "draft_for_review",
      goal: input.goal,
      target_metric: template?.primaryMetric ?? "Quality-adjusted output per human hour",
      business_outcome:
        template?.businessOutcome ??
        "A measurable business outcome improves while hidden labor remains visible.",
      cadence: "Weekly"
    })
    .select("id")
    .single();

  if (loopError) {
    throw loopError;
  }

  const loopId = loop.id as string;
  await saveLoopAnswers(loopId, answers);

  return loopId;
}

export async function saveLoopAnswers(loopId: string, answers: AnswerMap) {
  const { client: supabase } = await getWorkspaceDatabase("loops.write");

  if (!supabase) {
    const loop = await getLoop(loopId);
    const questions = generateQuestions(loop.department, loop.templateId, loop.goal);
    await updateLocalLoopLogic({ loopId, answers, questionGroups: questions });
    return;
  }

  const loop = await getLoop(loopId);
  const questions = generateQuestions(loop.department, loop.templateId, loop.goal).flatMap(
    (group) => group.questions
  );

  for (const question of questions) {
    const answer = answers[question.questionKey];
    if (!answer || answer.trim().length === 0) {
      continue;
    }

    const questionId = await ensureQuestion(supabase, loopId, question);
    await supabase.from("loop_answers").upsert(
      {
        loop_id: loopId,
        question_id: questionId,
        answer: answer
      },
      {
        onConflict: "loop_id,question_id"
      }
    );
  }
}

export async function generateAndPersistLoopSpec(loopId: string) {
  const { client: supabase } = await getWorkspaceDatabase("loops.write");
  const workspace = await getWorkspace(loopId);
  const spec = generateLoopSpec(workspace.loop, workspace.answers);
  const artifacts = [
    createLoopSpecArtifact(spec),
    ...generateImplementationArtifacts(spec)
  ];

  if (supabase) {
    await supabase
      .from("loops")
      .update({
        spec,
        status: "implementation_generated"
      })
      .eq("id", loopId);

    for (const requirement of generateLoopRequirements(spec)) {
      await supabase.from("loop_requirements").insert({
        loop_id: loopId,
        category: requirement.category,
        title: requirement.title,
        description: requirement.description,
        requirement_type: requirement.requirementType,
        priority: requirement.priority,
        status: requirement.status,
        metadata: {}
      });
    }

    for (const artifact of artifacts) {
      await supabase.from("generated_artifacts").insert({
        loop_id: loopId,
        artifact_type: artifact.artifactType,
        title: artifact.title,
        content: artifact.content,
        json_content: artifact.jsonContent ?? null,
        version: artifact.version
      });
    }
  }

  if (!supabase) {
    await updateLocalLoopLogic({
      loopId,
      answers: workspace.answers,
      questionGroups: workspace.questions,
      generatedSpec: spec
    });
  }

  return {
    spec,
    artifacts
  };
}

export async function deleteLoop(loopId: string) {
  const { client: supabase } = await getWorkspaceDatabase("organization.manage");

  if (!supabase) {
    return unregisterLoopSpec(loopId);
  }

  const { error } = await supabase
    .from("loops")
    .delete()
    .eq("id", loopId);

  if (error) {
    throw error;
  }

  return true;
}

export async function getLoopGraph(loopId?: string): Promise<LoopGraph> {
  const workspace = await getWorkspace(loopId);
  return workspace.graph;
}

export async function getSemanticTopology(
  loopId?: string,
  options: SemanticTopologyWorkspaceOptions = {}
): Promise<SemanticTopology> {
  if (
    !isHostedAuthRequired() &&
    process.env.LOOPGRAPH_DISABLE_LOCAL_REGISTRY !== "true"
  ) {
    const registeredSpecs = await getRegisteredLoopSpecs();
    if (registeredSpecs.length > 0) {
      const registeredLoopSpecs = registeredSpecs.map((item) => withSourcePathLabel(item.spec, item.sourcePath));
      const catalogLoopSpecs = options.includeCatalogLoops
        ? createCatalogLoopRecords("local_workspace").flatMap((loop) => coreSpecFromLoopRecord(loop))
        : [];
      const loopSpecs = mergeCoreLoopSpecs([...registeredLoopSpecs, ...catalogLoopSpecs]);
      const selectedLoopId = selectTopologyLoopId(
        loopSpecs,
        loopId,
        registeredSpecs[0]?.spec.metadata.id
      );
      const traces = await loadPersistedTopologyTraces();

      return buildSemanticTopology({
        loopSpecs,
        traces,
        options: {
          companyName: "Local Loopgraph workspace",
          brainLabel: options.brainLabel,
          hierarchyMode: options.hierarchyMode,
          sourceLabel: options.includeCatalogLoops
            ? "Registered LoopSpecs + demo catalog"
            : "Registered LoopSpecs",
          selectedLoopId,
          generatedAt: new Date(0).toISOString()
        }
      });
    }
  }

  const workspace = await getWorkspace(loopId);
  const liveLoops = workspace.loops.filter((loop) => loop.source !== "demo_catalog");
  const loopsForTopology = options.includeCatalogLoops
    ? mergeLoopRecordsById([
        ...workspace.loops,
        ...createCatalogLoopRecords(workspace.organization.id)
      ])
    : liveLoops;
  const loopSpecs = loopsForTopology.flatMap((loop) => coreSpecFromLoopRecord(loop));
  const selectedLoopId = selectTopologyLoopId(loopSpecs, loopId, liveLoops[0]?.id);

  return buildSemanticTopology({
    loopSpecs,
    traces: selectedLoopId ? [traceFromWorkspaceRun(workspace, selectedLoopId)] : [],
    metrics: selectedLoopId ? metricInputsFromWorkspace(workspace, selectedLoopId) : [],
    improvements: improvementInputsFromWorkspace(workspace.improvements),
    options: {
      companyName: workspace.organization.name,
      brainLabel: options.brainLabel,
      hierarchyMode: options.hierarchyMode,
      sourceLabel: options.includeCatalogLoops
        ? liveLoops.length > 0
          ? `${workspace.graph.sourceLabel ?? "Workspace"} + demo catalog`
          : "Demo catalog"
        : workspace.graph.sourceLabel ?? "Workspace",
      selectedLoopId,
      generatedAt: new Date(0).toISOString()
    }
  });
}

export async function startLoopRun(loopId: string) {
  const { client: supabase } = await getWorkspaceDatabase("runs.write");
  const workspace = await getWorkspace(loopId);
  const heroSimulation = await simulateHeroLoop(loopId);
  const simulated = heroSimulation ?? simulateLoopRun(workspace.loop);

  if (!supabase) {
    return simulated;
  }

  const { data: run, error: runError } = await supabase
    .from("loop_runs")
    .insert({
      loop_id: loopId,
      status: simulated.run.status,
      trigger_type: simulated.run.triggerType,
      started_at: simulated.run.startedAt,
      completed_at: simulated.run.completedAt,
      input_snapshot: simulated.run.inputSnapshot,
      output_snapshot: simulated.run.outputSnapshot,
      verification_result: simulated.run.verificationResult,
      escalation_required: simulated.run.escalationRequired,
      human_review_required: simulated.run.humanReviewRequired,
      error: simulated.run.error ?? null
    })
    .select("*")
    .single();

  if (runError) {
    throw runError;
  }

  const steps = [];
  for (const step of simulated.steps) {
    const { data } = await supabase
      .from("loop_run_steps")
      .insert({
        loop_run_id: run.id,
        step_name: step.stepName,
        step_type: step.stepType,
        status: step.status,
        input: step.input,
        output: step.output,
        tool_calls: step.toolCalls,
        started_at: step.startedAt,
        completed_at: step.completedAt,
        error: step.error ?? null
      })
      .select("*")
      .single();
    steps.push(mapRunStep(data));
  }

  let review: HumanReview | undefined;
  if (simulated.review) {
    const { data } = await supabase
      .from("human_reviews")
      .insert({
        loop_run_id: run.id,
        loop_id: loopId,
        status: "pending",
        reason: simulated.review.reason,
        recommendation: simulated.review.recommendation
      })
      .select("*")
      .single();
    review = mapHumanReview(data);
  }

  return {
    run: mapRun(run),
    steps,
    review
  };
}

export async function submitHumanReview(input: {
  reviewId: string;
  decision: HumanReview["status"];
  reviewerNotes?: string;
  hiddenLabor?: Record<string, number | string>;
}) {
  const { client: supabase } = await getWorkspaceDatabase("reviews.write");

  if (!supabase) {
    return;
  }

  const { data: review, error } = await supabase
    .from("human_reviews")
    .update({
      status: input.decision,
      reviewer_decision: input.decision,
      reviewer_notes: input.reviewerNotes ?? null,
      hidden_labor: input.hiddenLabor ?? {},
      reviewed_at: new Date().toISOString()
    })
    .eq("id", input.reviewId)
    .select("*")
    .single();

  if (error) {
    throw error;
  }

  if (["rejected", "edited", "escalated"].includes(input.decision)) {
    await supabase.from("improvement_items").insert({
      loop_id: review.loop_id,
      source_loop_run_id: review.loop_run_id,
      title: `Review ${input.decision}: improve loop behavior`,
      description:
        input.reviewerNotes ||
        "Human review changed the output. Convert the correction into a loop improvement.",
      failure_mode: input.decision,
      recommendation: "Review the trace, update the verification rubric, and reduce repeated human correction.",
      status: "open"
    });
  }
}

async function getOrFallbackOrganization(
  supabase: SupabaseClient,
  organizationId?: string
) {
  let query = supabase
    .from("organizations")
    .select("id, name");
  if (organizationId) {
    query = query.eq("id", organizationId);
  } else {
    query = query.order("created_at", { ascending: true }).limit(1);
  }
  const { data } = await query.maybeSingle();

  return data as { id: string; name: string } | null;
}

async function mapLoopRecord(supabase: SupabaseClient, row: LoopRow): Promise<LoopRecord> {
  const templateId = row.template_id ?? `${row.department}-${row.loop_type}`;
  const [openReviews, improvementItems, lastRun] = await Promise.all([
    countRows(supabase, "human_reviews", row.id, "pending"),
    countRows(supabase, "improvement_items", row.id, "open"),
    getLastRunAt(supabase, row.id)
  ]);

  return {
    id: row.id,
    organizationId: row.organization_id,
    templateId,
    name: row.name,
    department: row.department,
    loopType: row.loop_type,
    status: row.status,
    autonomyLevel: row.autonomy_level,
    owner: "Department owner",
    goal: row.goal ?? "",
    targetMetric: row.target_metric ?? "Quality-adjusted output",
    businessOutcome: row.business_outcome ?? "Improve a measurable business outcome",
    cadence: row.cadence ?? "Weekly",
    specGenerated: Boolean(row.spec && Object.keys(row.spec as Record<string, unknown>).length > 0),
    implementationGenerated: row.status === "implementation_generated" || row.status === "active",
    lastRunAt: lastRun,
    openReviews,
    improvementItems
  };
}

async function countRows(
  supabase: SupabaseClient,
  table: "human_reviews" | "improvement_items",
  loopId: string,
  status: string
) {
  const { count } = await supabase
    .from(table)
    .select("id", { count: "exact", head: true })
    .eq("loop_id", loopId)
    .eq("status", status);

  return count ?? 0;
}

async function getLastRunAt(supabase: SupabaseClient, loopId: string) {
  const { data } = await supabase
    .from("loop_runs")
    .select("completed_at, started_at")
    .eq("loop_id", loopId)
    .order("started_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  return (data?.completed_at ?? data?.started_at) as string | undefined;
}

async function getAnswers(supabase: SupabaseClient, loopId: string): Promise<AnswerMap> {
  const { data } = await supabase
    .from("loop_answers")
    .select("answer, loop_questions(question_key)")
    .eq("loop_id", loopId);

  return (data ?? []).reduce<AnswerMap>((answers, row) => {
    const question = Array.isArray(row.loop_questions) ? row.loop_questions[0] : row.loop_questions;
    if (question?.question_key) {
      answers[question.question_key] = String(row.answer ?? "");
    }
    return answers;
  }, {});
}

async function getLoopSpec(supabase: SupabaseClient, loop: LoopRecord, answers: AnswerMap) {
  const { data } = await supabase.from("loops").select("spec").eq("id", loop.id).maybeSingle();

  if (data?.spec && Object.keys(data.spec as Record<string, unknown>).length > 0) {
    return data.spec as ReturnType<typeof generateLoopSpec>;
  }

  return generateLoopSpec(loop, answers);
}

async function getArtifacts(supabase: SupabaseClient, loopId: string, spec: ReturnType<typeof generateLoopSpec>) {
  const { data } = await supabase
    .from("generated_artifacts")
    .select("*")
    .eq("loop_id", loopId)
    .order("created_at", { ascending: true });

  if (data && data.length > 0) {
    return data.map((artifact) => ({
      artifactType: artifact.artifact_type,
      title: artifact.title,
      content: artifact.content ?? "",
      jsonContent: artifact.json_content,
      version: artifact.version
    })) as GeneratedArtifact[];
  }

  return generateImplementationArtifacts(spec);
}

async function getLatestRunBundle(supabase: SupabaseClient, loop: LoopRecord) {
  const { data: run } = await supabase
    .from("loop_runs")
    .select("*")
    .eq("loop_id", loop.id)
    .order("started_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!run) {
    return simulateLoopRun(loop);
  }

  const [{ data: steps }, { data: review }] = await Promise.all([
    supabase
      .from("loop_run_steps")
      .select("*")
      .eq("loop_run_id", run.id)
      .order("started_at", { ascending: true }),
    supabase
      .from("human_reviews")
      .select("*")
      .eq("loop_run_id", run.id)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle()
  ]);

  return {
    run: mapRun(run),
    steps: (steps ?? []).map(mapRunStep),
    review: review ? mapHumanReview(review) : undefined
  };
}

async function getImprovements(supabase: SupabaseClient, loopId: string) {
  const { data } = await supabase
    .from("improvement_items")
    .select("*")
    .eq("loop_id", loopId)
    .order("created_at", { ascending: false });

  return (data ?? []).map((item) => ({
    id: item.id,
    loopId: item.loop_id,
    title: item.title,
    description: item.description ?? "",
    failureMode: item.failure_mode ?? "unknown",
    recommendation: item.recommendation ?? "",
    status: item.status,
    owner: "Department owner",
    createdAt: item.created_at
  })) as ImprovementItem[];
}

async function ensureQuestion(
  supabase: SupabaseClient,
  loopId: string,
  question: ReturnType<typeof generateQuestions>[number]["questions"][number]
) {
  const existing = await supabase
    .from("loop_questions")
    .select("id")
    .eq("loop_id", loopId)
    .eq("question_key", question.questionKey)
    .maybeSingle();

  if (existing.data?.id) {
    return existing.data.id as string;
  }

  const { data, error } = await supabase
    .from("loop_questions")
    .insert({
      loop_id: loopId,
      section: question.section,
      question_key: question.questionKey,
      question: question.question,
      help_text: question.helpText ?? null,
      required: question.required,
      answer_type: question.answerType,
      sort_order: question.sortOrder
    })
    .select("id")
    .single();

  if (error) {
    throw error;
  }

  return data.id as string;
}

async function selectLocalWorkspace(selectedLoopId?: string) {
  if (process.env.LOOPGRAPH_DISABLE_LOCAL_REGISTRY === "true") {
    return await selectDemoWorkspace(selectedLoopId);
  }

  const registeredSpecs = await getRegisteredLoopSpecs();
  if (registeredSpecs.length === 0) {
    return selectEmptyLocalWorkspace();
  }

  return selectRegisteredWorkspace({
    selectedLoopId,
    registeredSpecs,
    organization: {
      id: "local_workspace",
      name: "Local Loopgraph workspace"
    },
    profile: {
      id: "profile_local",
      email: "operator@example.com",
      fullName: "Loop Operator",
      role: "owner"
    },
    sourceLabel: "Local LoopSpec"
  });
}

async function selectRegisteredWorkspace(input: {
  selectedLoopId?: string;
  registeredSpecs: LoadedRegisteredLoopSpec[];
  organization: WorkspaceData["organization"];
  profile: WorkspaceData["profile"];
  sourceLabel: string;
}) {
  const { registeredSpecs, organization } = input;
  const loops = registeredSpecs.map((item) => loopRecordFromRegisteredSpec(item, organization.id));
  const selectedLoop =
    loops.find((item) => item.id === input.selectedLoopId) ?? loops[0];
  const selectedSpec = registeredSpecs.find((item) => item.spec.metadata.id === selectedLoop.id) ?? registeredSpecs[0];
  const storedAnswers = getStudioAnswers(selectedSpec.spec);
  const answers = {
    ...createDefaultAnswers(selectedLoop.department, selectedLoop.templateId, selectedLoop.goal),
    ...storedAnswers
  };
  const questions = generateQuestions(selectedLoop.department, selectedLoop.templateId, selectedLoop.goal);
  const progress = questionProgress(questions, answers);
  const spec = getStudioGeneratedSpec(selectedSpec.spec) ??
    (Object.keys(storedAnswers).length > 0 ? generateLoopSpec(selectedLoop, answers) : v1alpha1ToFlat(selectedSpec.spec));
  const graph = buildGraphFromRegisteredSpecs({
    organization,
    specs: registeredSpecs,
    selectedNodeId: `loop:${selectedLoop.id}`,
    sourceLabel: input.sourceLabel
  });
  const storage = getStorageAdapter();
  const improvements = await loadImprovementsFromStorage(storage, selectedLoop.id);
  const managementReview = await managementReviewForWorkspace(loops, graph);

  return {
    organization,
    profile: input.profile,
    templates: getDepartmentTemplates(),
    loops,
    loop: selectedLoop,
    answers,
    questions,
    progress,
    spec,
    artifacts: generateImplementationArtifacts(spec),
    runBundle: simulateLoopRun(selectedLoop),
    improvements,
    managementReview,
    metrics: summarizeMetrics(graph, selectedLoop.id),
    graph
  };
}

function selectEmptyLocalWorkspace(
  organizationInput?: { id: string; name: string },
  profileInput?: WorkspaceData["profile"]
): WorkspaceData {
  const organization = organizationInput ?? {
    id: "local_workspace",
    name: "Local Loopgraph workspace"
  };
  const placeholderLoop = emptyPlaceholderLoop(organization.id);
  const spec = v1alpha1ToFlat(createSpecFromTemplate(placeholderLoop.templateId, {
    id: placeholderLoop.id,
    name: placeholderLoop.name,
    goal: placeholderLoop.goal
  }));
  const graph = buildLoopGraph({
    organization,
    loops: [],
    selectedNodeId: undefined,
    sourceLabel: "Empty local workspace"
  });
  const emptyRun: LoopRun = {
    id: "run_empty_workspace",
    loopId: placeholderLoop.id,
    status: "completed",
    triggerType: "manual",
    startedAt: new Date(0).toISOString(),
    completedAt: new Date(0).toISOString(),
    escalationRequired: false,
    humanReviewRequired: false,
    inputSnapshot: {},
    outputSnapshot: {},
    verificationResult: {}
  };

  return {
    organization,
    profile: profileInput ?? {
      id: "profile_local",
      email: "operator@example.com",
      fullName: "Loop Operator",
      role: "owner"
    },
    templates: getDepartmentTemplates(),
    loops: [],
    loop: placeholderLoop,
    answers: {},
    questions: [],
    progress: {
      totalRequired: 0,
      answered: 0,
      missing: 0,
      percent: 0
    },
    spec,
    artifacts: [],
    runBundle: {
      run: emptyRun,
      steps: []
    },
    improvements: [],
    managementReview: emptyManagementReview(),
    metrics: [],
    graph
  };
}

function emptyPlaceholderLoop(organizationId: string): LoopRecord {
  return {
    id: "new_loop",
    organizationId,
    templateId: "custom-custom_company_loop",
    name: "New Loop",
    department: "custom",
    loopType: "custom_company_loop",
    status: "draft",
    autonomyLevel: "draft_for_review",
    owner: "Loop owner",
    goal: "Design the first local Loopgraph loop.",
    targetMetric: "",
    businessOutcome: "",
    cadence: "Manual",
    specGenerated: false,
    implementationGenerated: false,
    openReviews: 0,
    improvementItems: 0,
    source: "local_spec"
  };
}

async function selectDemoWorkspace(selectedLoopId?: string) {
  const workspace = getDemoWorkspace();
  const loop = workspace.loops.find((item) => item.id === selectedLoopId) ?? workspace.loop;
  const storage = getStorageAdapter();
  const traceImprovements = await loadImprovementsFromStorage(storage, loop.id);
  const improvements = mergeImprovements(workspace.improvements, traceImprovements);
  const managementReview = await managementReviewForWorkspace(workspace.loops, workspace.graph);

  if (loop.id === workspace.loop.id && improvements.length === workspace.improvements.length) {
    return {
      ...workspace,
      improvements,
      managementReview
    };
  }

  return {
    ...workspace,
    loop,
    improvements,
    managementReview,
    graph: buildLoopGraph({
      organization: workspace.organization,
      loops: workspace.loops,
      reviews: workspace.runBundle.review ? [workspace.runBundle.review] : [],
      improvements,
      selectedNodeId: `loop:${loop.id}`,
      sourceLabel: workspace.graph.sourceLabel
    })
  };
}

function mergeImprovements(databaseItems: ImprovementItem[], traceItems: ImprovementItem[]) {
  const byId = new Map<string, ImprovementItem>();
  for (const item of [...traceItems, ...databaseItems]) {
    byId.set(item.id, item);
  }
  return [...byId.values()].sort((left, right) => right.createdAt.localeCompare(left.createdAt));
}

function mergeLoopRecordsById(loops: LoopRecord[]) {
  const byId = new Map<string, LoopRecord>();
  for (const loop of loops) {
    if (!byId.has(loop.id) || byId.get(loop.id)?.source === "demo_catalog") {
      byId.set(loop.id, loop);
    }
  }
  return [...byId.values()];
}

function mergeCoreLoopSpecs(specs: CoreLoopSpec[]) {
  const byId = new Map<string, CoreLoopSpec>();
  for (const spec of specs) {
    if (!byId.has(spec.metadata.id)) {
      byId.set(spec.metadata.id, spec);
    }
  }
  return [...byId.values()];
}

function selectTopologyLoopId(
  specs: CoreLoopSpec[],
  requestedLoopId?: string,
  fallbackLoopId?: string
) {
  const ids = new Set(specs.map((spec) => spec.metadata.id));
  if (requestedLoopId && ids.has(requestedLoopId)) {
    return requestedLoopId;
  }
  if (fallbackLoopId && ids.has(fallbackLoopId)) {
    return fallbackLoopId;
  }
  return specs[0]?.metadata.id;
}

async function managementReviewForWorkspace(loops: LoopRecord[], graph: LoopGraph) {
  const rollup = await loadLatestManagementRollup();
  if (rollup) {
    return {
      period: rollup.weekKey,
      summary: `Persisted management rollup with ${rollup.openCases} open case(s).`,
      risks: rollup.decisionsNeeded,
      decisions: rollup.decisionsNeeded,
      bottlenecks: rollup.plans.map((plan) => plan.summary),
      recommendations: rollup.plans.flatMap((plan) => plan.plan.monitoringPlan.successCriteria)
    };
  }

  return summarizeManagement(loops, graph);
}

async function loadPersistedTopologyTraces(limit = 50): Promise<LoopRunTrace[]> {
  const storage = getStorageAdapter();
  const runSummaries = await storage.listRuns();
  const traces = await Promise.all(runSummaries.slice(0, limit).map((run) => storage.getRun(run.id)));
  return traces.filter((trace): trace is LoopRunTrace => trace !== null);
}

function withSourcePathLabel(spec: CoreLoopSpec, sourcePath: string): CoreLoopSpec {
  return {
    ...spec,
    metadata: {
      ...spec.metadata,
      labels: {
        ...(spec.metadata.labels ?? {}),
        source: "local_spec",
        sourcePath
      }
    }
  };
}

function coreSpecFromLoopRecord(loop: LoopRecord): CoreLoopSpec[] {
  try {
    const spec = createSpecFromTemplate(loop.templateId, {
      id: loop.id,
      name: loop.name,
      goal: loop.goal,
      ownerRole: loop.owner
    });
    return [{
      ...spec,
      metadata: {
        ...spec.metadata,
        labels: {
          ...(spec.metadata.labels ?? {}),
          source: loop.source ?? "workspace",
          runtimeLevel: loop.runtimeLevel ?? spec.metadata.labels?.runtimeLevel ?? "spec_stub"
        }
      }
    }];
  } catch {
    return [];
  }
}

function traceFromWorkspaceRun(workspace: WorkspaceData, loopId: string): LoopRunTrace {
  const run = workspace.runBundle.run;
  const status = run.status === "completed"
    ? "COMPLETED"
    : run.status === "failed"
      ? "FAILED_VALIDATION"
      : "SIMULATING";

  return {
    id: run.id,
    loopId,
    loopSpecVersion: "workspace",
    loopSpecHash: run.id,
    mode: "simulate",
    status,
    trigger: {
      type: run.triggerType,
      source: "workspace",
      event: run.triggerType,
      eventId: run.id,
      receivedAt: run.startedAt
    },
    idempotencyKey: run.id,
    contextSnapshot: {
      id: `${run.id}:context`,
      loopId,
      loopSpecVersion: "workspace",
      createdAt: run.startedAt,
      contentHash: run.id,
      tokenEstimate: 0,
      entries: []
    },
    inputs: [],
    proposedActions: [],
    preparedActions: [],
    toolCalls: workspace.runBundle.steps.flatMap((step) =>
      step.toolCalls.map((toolCall, index) => ({
        id: `${step.id}:tool:${index + 1}`,
        toolKey: String(toolCall.tool ?? step.stepName),
        input: (toolCall.input as Record<string, unknown>) ?? {},
        output: toolCall.output,
        status: step.status === "failed" ? "failed" : "completed",
        startedAt: step.startedAt,
        completedAt: step.completedAt
      }))
    ),
    policyDecisions: [],
    verificationResults: [],
    escalationCases: [],
    humanReviews: [],
    outputs: [],
    metrics: [],
    errors: run.error
      ? [{ code: "workspace_run_error", message: run.error, at: run.completedAt ?? run.startedAt }]
      : [],
    startedAt: run.startedAt,
    completedAt: run.completedAt
  };
}

function metricInputsFromWorkspace(workspace: WorkspaceData, loopId: string): TopologyMetricInput[] {
  return workspace.metrics.map((metric) => ({
    id: metric.name,
    loopId,
    name: metric.name,
    value: metric.value,
    status: "active"
  }));
}

function improvementInputsFromWorkspace(items: ImprovementItem[]): TopologyImprovementItem[] {
  return items.map((item) => ({
    id: item.id,
    loopId: item.loopId,
    title: item.title,
    status: item.status,
    failureMode: item.failureMode
  }));
}

function mapRun(row: Record<string, unknown>): LoopRun {
  return {
    id: String(row.id),
    loopId: String(row.loop_id),
    status: row.status as LoopRun["status"],
    triggerType: row.trigger_type as LoopRun["triggerType"],
    startedAt: String(row.started_at),
    completedAt: row.completed_at ? String(row.completed_at) : undefined,
    escalationRequired: Boolean(row.escalation_required),
    humanReviewRequired: Boolean(row.human_review_required),
    inputSnapshot: (row.input_snapshot as Record<string, unknown>) ?? {},
    outputSnapshot: (row.output_snapshot as Record<string, unknown>) ?? {},
    verificationResult: (row.verification_result as Record<string, unknown>) ?? {},
    error: row.error ? String(row.error) : undefined
  };
}

function mapRunStep(row: Record<string, unknown>): LoopRunStep {
  return {
    id: String(row.id),
    loopRunId: String(row.loop_run_id),
    stepName: String(row.step_name),
    stepType: String(row.step_type),
    status: row.status as LoopRunStep["status"],
    input: (row.input as Record<string, unknown>) ?? {},
    output: (row.output as Record<string, unknown>) ?? {},
    toolCalls: (row.tool_calls as Array<Record<string, unknown>>) ?? [],
    startedAt: String(row.started_at),
    completedAt: row.completed_at ? String(row.completed_at) : undefined,
    error: row.error ? String(row.error) : undefined
  };
}

function mapHumanReview(row: Record<string, unknown>): HumanReview {
  const review = createHumanReview(String(row.loop_run_id), String(row.loop_id));
  return {
    ...review,
    id: String(row.id),
    status: row.status as HumanReview["status"],
    reason: String(row.reason ?? review.reason),
    recommendation: String(row.recommendation ?? review.recommendation),
    reviewerDecision: row.reviewer_decision ? String(row.reviewer_decision) : undefined,
    reviewerNotes: row.reviewer_notes ? String(row.reviewer_notes) : undefined,
    hiddenLabor: (row.hidden_labor as HumanReview["hiddenLabor"]) ?? undefined,
    createdAt: String(row.created_at),
    reviewedAt: row.reviewed_at ? String(row.reviewed_at) : undefined
  };
}

function emptyManagementReview(): WorkspaceData["managementReview"] {
  return {
    period: "This week",
    summary: "No local Loopgraph loops have been created yet. Start in Hermes, pick a department, and materialize only the loops you accept.",
    risks: [],
    decisions: [],
    bottlenecks: [],
    recommendations: [
      "In Hermes, say `start Loopgraph` to begin the guided department discovery.",
      "Open Discovery in the browser if you want to review the same question bundles visually.",
      "After loops are accepted, connect provider webhooks to Hermes and keep Loopgraph in shadow mode until routing tests pass."
    ]
  };
}

function summarizeManagement(loops: LoopRecord[], graph: LoopGraph) {
  if (loops.length === 0) {
    return emptyManagementReview();
  }

  const unhealthy = graph.health.filter((item) => item.healthScore < 75);
  const openReviews = graph.health.reduce((sum, item) => sum + item.openReviews, 0);
  const openImprovements = graph.health.reduce((sum, item) => sum + item.openImprovements, 0);

  return {
    period: "This week",
    summary: `${loops.length} loops are mapped into the management topology. ${openReviews} reviews and ${openImprovements} improvement items need owner attention.`,
    risks: unhealthy.map((item) => `${findLoopName(loops, item.loopId)} health is ${item.healthScore}`),
    decisions: [
      "Approve or reject pending human reviews",
      "Prioritize open improvement items from trace learning",
      "Decide whether any loop should change autonomy level"
    ],
    bottlenecks: unhealthy.length > 0
      ? unhealthy.map((item) => `${findLoopName(loops, item.loopId)} needs a rubric or data-quality pass`)
      : ["No critical loop bottlenecks detected"],
    recommendations: [
      "Keep relationship-time redeployment visible in weekly review",
      "Use the topology view to inspect dependencies before increasing autonomy"
    ]
  };
}

function summarizeMetrics(graph: LoopGraph, loopId: string) {
  const health = graph.health.find((item) => item.loopId === loopId) ?? graph.health[0];
  const minutesToHours = (minutes: number) => `${Math.round((minutes / 60) * 10) / 10}h`;

  return [
    {
      name: "Health",
      value: `${health?.healthScore ?? 72}`,
      note: "Composite of quality, hidden labor, reviews, and improvements."
    },
    {
      name: "Net time saved",
      value: minutesToHours(health?.netTimeSavedMinutes ?? 0),
      note: "Baseline time minus execution, review, rework, escalation, governance, and botsitting."
    },
    {
      name: "Botsitting",
      value: minutesToHours(health?.botsittingMinutes ?? 0),
      note: "Context setup, reruns, cleanup, debugging, and manual transfer."
    },
    {
      name: "Relationship redeployment",
      value: minutesToHours(health?.relationshipRedeploymentMinutes ?? 0),
      note: "Observed saved time moved into customers, coaching, discovery, or strategic relationships."
    }
  ];
}

function findLoopName(loops: LoopRecord[], loopId: string) {
  return loops.find((loop) => loop.id === loopId)?.name ?? "Loop";
}
