"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import {
  acceptRecommendation,
  buildDemoDiscoverySession,
  loadDiscoverySession,
  materializeAcceptedLoops,
  rejectRecommendation,
  saveDiscoverySession
} from "@/lib/loopgraph-runtime/discovery-engine";
import {
  getActiveLoopgraphProjectRoot,
  getDiscoveryDesignStore,
  getLoopSpecRegistryStore
} from "../../lib/loopgraph-runtime/storage-resolver";
import {
  editLoopDesignProposal,
  confirmDiscoveryProjectContext,
  generateDeterministicLoopDesign,
  getNextDiscoveryQuestions,
  materializeAcceptedLoopDesignProposals,
  selectDiscoveryDepartments,
  simulateLoopForHermes,
  startHermesDiscoverySession,
  submitDiscoveryAnswers
} from "loopgraph/runtime";
import type { QuestionBundleField } from "loopgraph/core";
import { isHostedPreview } from "@/lib/hosted-preview";
import { demoDiscoverySessionId } from "./view-data";

async function loadOrCreateSession() {
  if (!isHostedPreview()) {
    throw new Error("Legacy demo recommendation actions are unavailable in local mode. Start or resume a Hermes discovery session.");
  }
  const session = (await loadDiscoverySession(demoDiscoverySessionId)) ?? await buildDemoDiscoverySession();
  await saveDiscoverySession(session);
  return session;
}

export async function acceptRecommendationAction(formData: FormData) {
  const recommendationId = String(formData.get("recommendationId") ?? "");
  const session = await loadOrCreateSession();
  await saveDiscoverySession(acceptRecommendation(session, recommendationId));
  revalidatePath("/discovery");
  revalidatePath("/discovery/recommendations");
  revalidatePath("/discovery/create-loops");
}

export async function rejectRecommendationAction(formData: FormData) {
  const recommendationId = String(formData.get("recommendationId") ?? "");
  const session = await loadOrCreateSession();
  await saveDiscoverySession(rejectRecommendation(session, recommendationId));
  revalidatePath("/discovery");
  revalidatePath("/discovery/recommendations");
  revalidatePath("/discovery/create-loops");
}

export async function materializeAcceptedRecommendationsAction() {
  const session = await loadOrCreateSession();
  await materializeAcceptedLoops(session);
  revalidatePath("/discovery/create-loops");
  revalidatePath("/topology");
  revalidatePath("/loops");
}

export async function startBrowserDiscoverySessionAction(formData: FormData) {
  const companyName = cleanOptionalString(formData.get("companyName"));
  const session = await startHermesDiscoverySession({
    projectRoot: getActiveLoopgraphProjectRoot(),
    store: getDiscoveryDesignStore(),
    companyName,
    createdByActor: "browser"
  });

  revalidatePath("/discovery");
  redirect(`/discovery/company?sessionId=${encodeURIComponent(session.id)}`);
}

export async function confirmBrowserDiscoveryProjectContextAction(formData: FormData) {
  const sessionId = requiredFormString(formData, "sessionId");
  const expectedRevision = optionalFormNumber(formData, "expectedRevision");
  const result = await confirmDiscoveryProjectContext({
    projectRoot: getActiveLoopgraphProjectRoot(),
    store: getDiscoveryDesignStore(),
    sessionId,
    expectedRevision,
    displayName: cleanOptionalString(formData.get("displayName")),
    companyDescription: cleanOptionalString(formData.get("companyDescription")),
    customerType: cleanOptionalString(formData.get("customerType")),
    primaryGoal: cleanOptionalString(formData.get("primaryGoal")),
    northStarMetric: cleanOptionalString(formData.get("northStarMetric")),
    sourceOfTruth: cleanOptionalString(formData.get("sourceOfTruth")),
    additionalTools: parseStringArrayFormValue(formData.get("additionalTools")),
    confirmationNotes: cleanOptionalString(formData.get("confirmationNotes")),
    confirmedStack: formData.get("confirmedStack") === "on",
    actor: "browser"
  });

  revalidateDiscoverySessionPaths(result.session.id);
  redirect(`/discovery/departments?sessionId=${encodeURIComponent(result.session.id)}`);
}

export async function selectBrowserDiscoveryDepartmentsAction(formData: FormData) {
  const sessionId = requiredFormString(formData, "sessionId");
  const expectedRevision = optionalFormNumber(formData, "expectedRevision");
  const departments = formData.getAll("departments")
    .filter((value): value is string => typeof value === "string" && value.trim().length > 0);
  const activeDepartmentCandidate = cleanOptionalString(formData.get("activeDepartment"));
  const activeDepartment = activeDepartmentCandidate && departments.includes(activeDepartmentCandidate)
    ? activeDepartmentCandidate
    : departments[0];
  const session = await selectDiscoveryDepartments({
    projectRoot: getActiveLoopgraphProjectRoot(),
    store: getDiscoveryDesignStore(),
    sessionId,
    departments,
    activeDepartment,
    expectedRevision,
    actor: "browser"
  });

  revalidateDiscoverySessionPaths(session.id);
  redirect(`/discovery/questions?sessionId=${encodeURIComponent(session.id)}`);
}

export async function submitBrowserDiscoveryAnswersAction(formData: FormData) {
  const sessionId = requiredFormString(formData, "sessionId");
  const bundleId = requiredFormString(formData, "bundleId");
  const expectedRevision = optionalFormNumber(formData, "expectedRevision");
  const nextQuestions = await getNextDiscoveryQuestions({
    projectRoot: getActiveLoopgraphProjectRoot(),
    store: getDiscoveryDesignStore(),
    sessionId
  });
  if (!nextQuestions.bundle || nextQuestions.bundle.id !== bundleId) {
    throw new Error(`Question bundle is not active: ${bundleId}`);
  }

  const session = await submitDiscoveryAnswers({
    projectRoot: getActiveLoopgraphProjectRoot(),
    store: getDiscoveryDesignStore(),
    sessionId,
    bundleId,
    expectedRevision,
    actor: "browser",
    answers: parseQuestionBundleFormAnswers(formData, nextQuestions.bundle.fields)
  });

  revalidateDiscoverySessionPaths(session.id);
  redirect(`/discovery/questions?sessionId=${encodeURIComponent(session.id)}`);
}

export async function generateBrowserLoopDesignAction(formData: FormData) {
  const sessionId = requiredFormString(formData, "sessionId");
  const maxProposals = optionalFormNumber(formData, "maxProposals") ?? 2;
  const department = cleanOptionalString(formData.get("department"));
  const result = await generateDeterministicLoopDesign({
    projectRoot: getActiveLoopgraphProjectRoot(),
    store: getDiscoveryDesignStore(),
    loopSpecStore: getLoopSpecRegistryStore(),
    sessionId,
    department,
    maxProposals,
    reasoningProfile: "high"
  });

  revalidateDiscoverySessionPaths(sessionId);
  redirect(`/discovery/designing?sessionId=${encodeURIComponent(sessionId)}&designRunId=${encodeURIComponent(result.designRun.id)}`);
}

export async function editBrowserLoopDesignProposalAction(formData: FormData) {
  const sessionId = cleanOptionalString(formData.get("sessionId"));
  const designRunId = requiredFormString(formData, "designRunId");
  const proposalId = requiredFormString(formData, "proposalId");
  const result = await editLoopDesignProposal({
    projectRoot: getActiveLoopgraphProjectRoot(),
    store: getDiscoveryDesignStore(),
    loopSpecStore: getLoopSpecRegistryStore(),
    designRunId,
    proposalId,
    expectedOutputHash: cleanOptionalString(formData.get("expectedOutputHash")),
    editedBy: "browser",
    updates: parseProposalEditForm(formData)
  });

  if (sessionId) revalidateDiscoverySessionPaths(sessionId);
  revalidatePath("/discovery/create-loops");
  const params = new URLSearchParams({
    designRunId: result.designRun.id
  });
  if (sessionId) params.set("sessionId", sessionId);
  redirect(`/discovery/create-loops?${params.toString()}`);
}

export async function materializeBrowserLoopDesignAction(formData: FormData) {
  const sessionId = cleanOptionalString(formData.get("sessionId"));
  const designRunId = requiredFormString(formData, "designRunId");
  const acceptedProposalIds = formData.getAll("acceptedProposalIds")
    .filter((value): value is string => typeof value === "string" && value.trim().length > 0);
  if (acceptedProposalIds.length === 0) {
    throw new Error("Select at least one Hermes loop proposal before materializing.");
  }

  const result = await materializeAcceptedLoopDesignProposals({
    projectRoot: getActiveLoopgraphProjectRoot(),
    store: getDiscoveryDesignStore(),
    loopSpecStore: getLoopSpecRegistryStore(),
    designRunId,
    acceptedProposalIds,
    acceptedBy: "browser"
  });

  revalidatePath("/topology");
  revalidatePath("/loops");
  if (sessionId) revalidateDiscoverySessionPaths(sessionId);
  const params = new URLSearchParams({
    designRunId,
    materializationId: result.materializationId
  });
  if (sessionId) params.set("sessionId", sessionId);
  redirect(`/discovery/create-loops?${params.toString()}`);
}

export async function simulateBrowserMaterializedLoopAction(formData: FormData) {
  const loopId = requiredFormString(formData, "loopId");
  const fixturePath = requiredFormString(formData, "fixturePath");
  const result = await simulateLoopForHermes({
    projectRoot: getActiveLoopgraphProjectRoot(),
    loopId,
    fixturePath
  });

  if (!result.valid) {
    throw new Error(`Loop simulation failed:\n- ${result.errors.join("\n- ")}`);
  }
  if (!result.runId) {
    throw new Error("Loop simulation did not return a run ID.");
  }

  revalidatePath(`/loops/${loopId}`);
  revalidatePath(`/loops/${loopId}/runs`);
  revalidatePath(`/loops/${loopId}/reviews`);
  revalidatePath("/topology");
  if (result.reviewRequired) {
    redirect(`/loops/${encodeURIComponent(loopId)}/reviews?runId=${encodeURIComponent(result.runId)}`);
  }
  redirect(`/loops/${encodeURIComponent(loopId)}/runs/${encodeURIComponent(result.runId)}`);
}

function cleanOptionalString(value: FormDataEntryValue | null): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function requiredFormString(formData: FormData, key: string): string {
  const value = cleanOptionalString(formData.get(key));
  if (!value) throw new Error(`Missing form field: ${key}`);
  return value;
}

function optionalFormNumber(formData: FormData, key: string): number | undefined {
  const value = cleanOptionalString(formData.get(key));
  if (!value) return undefined;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) throw new Error(`Invalid numeric form field: ${key}`);
  return parsed;
}

function parseQuestionBundleFormAnswers(
  formData: FormData,
  fields: QuestionBundleField[]
): Record<string, unknown> {
  const answers: Record<string, unknown> = {};
  for (const field of fields) {
    const value = cleanOptionalString(formData.get(field.id));
    if (value === undefined) continue;
    if (field.valueType === "number") {
      const parsed = Number(value);
      if (!Number.isFinite(parsed)) continue;
      answers[field.id] = parsed;
      continue;
    }
    if (field.valueType === "boolean") {
      if (value === "true") answers[field.id] = true;
      if (value === "false") answers[field.id] = false;
      continue;
    }
    if (field.valueType === "string_array") {
      const items = value
        .split(/\n|,/)
        .map((item) => item.trim())
        .filter(Boolean);
      if (items.length > 0) answers[field.id] = items;
      continue;
    }
    if (field.valueType === "object") {
      answers[field.id] = parseObjectAnswer(value);
      continue;
    }
    answers[field.id] = value;
  }
  return answers;
}

function parseObjectAnswer(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

function parseProposalEditForm(formData: FormData): Record<string, unknown> {
  const edit: Record<string, unknown> = {};
  for (const [formKey, editKey] of [
    ["shortName", "shortName"],
    ["goal", "goal"],
    ["businessOutcome", "businessOutcome"],
    ["reasoningSummary", "reasoningSummary"],
    ["triggerType", "triggerType"],
    ["triggerDescription", "triggerDescription"],
    ["triggerCadence", "triggerCadence"],
    ["workItem", "workItem"],
    ["metricsPrimary", "metricsPrimary"],
    ["metricsLeading", "metricsLeading"],
    ["metricsBaselineState", "metricsBaselineState"],
    ["ownerRole", "ownerRole"],
    ["routingActivationMode", "routingActivationMode"]
  ] as const) {
    const value = cleanOptionalString(formData.get(formKey));
    if (value) edit[editKey] = value;
  }

  for (const [formKey, editKey] of [
    ["observedSignals", "observedSignals"],
    ["contextSources", "contextSources"],
    ["metricsGuardrails", "metricsGuardrails"],
    ["reviewerRoles", "reviewerRoles"],
    ["escalationConditions", "escalationConditions"],
    ["forbiddenActions", "forbiddenActions"],
    ["manualFallbacks", "manualFallbacks"],
    ["routingProblemTypes", "routingProblemTypes"]
  ] as const) {
    const values = parseStringArrayFormValue(formData.get(formKey));
    if (values.length > 0) edit[editKey] = values;
  }

  const routingMinimumConfidence = optionalFormNumber(formData, "routingMinimumConfidence");
  if (routingMinimumConfidence !== undefined) edit.routingMinimumConfidence = routingMinimumConfidence;

  for (const [formKey, editKey] of [
    ["routineStepsJson", "routineSteps"],
    ["proposedActionsJson", "proposedActions"],
    ["verifiersJson", "verifiers"],
    ["connectorRequirementsJson", "connectorRequirements"],
    ["requiredFromUserJson", "requiredFromUser"]
  ] as const) {
    const value = parseOptionalJson(formData.get(formKey), formKey);
    if (value !== undefined) edit[editKey] = value;
  }

  return edit;
}

function parseStringArrayFormValue(value: FormDataEntryValue | null): string[] {
  const text = cleanOptionalString(value);
  if (!text) return [];
  return text
    .split(/\n|,/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function parseOptionalJson(value: FormDataEntryValue | null, label: string): unknown {
  const text = cleanOptionalString(value);
  if (!text) return undefined;
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`Invalid JSON in ${label}`);
  }
}

function revalidateDiscoverySessionPaths(sessionId: string): void {
  revalidatePath("/discovery");
  for (const href of [
    "/discovery/company",
    "/discovery/departments",
    "/discovery/questions",
    "/discovery/designing",
    "/discovery/processes",
    "/discovery/goals",
    "/discovery/access",
    "/discovery/recommendations",
    "/discovery/human-requirements",
    "/discovery/metrics",
    "/discovery/create-loops"
  ]) {
    revalidatePath(`${href}?sessionId=${encodeURIComponent(sessionId)}`);
  }
}
