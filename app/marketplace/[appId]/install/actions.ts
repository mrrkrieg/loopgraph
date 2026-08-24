"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import type { AppInstallPlan, AppOnboardingJourney } from "loopgraph/core";
import { requireHostedPermission } from "@/lib/auth/hosted-access";
import { getActiveLoopgraphProjectRoot } from "@/lib/loopgraph-runtime/storage-resolver";
import { callLoopgraphAppTool } from "@/lib/app-platform/tool-bridge";
import {
  configurationFromInstallForm,
  appOnboardingProgressForView,
  buildAppInstallImpactView,
  type InstallWizardState
} from "@/lib/app-platform/install-wizard";
import type { MarketplaceAppDetail } from "@/lib/app-platform/read-model";

export async function planMarketplaceAppInstallAction(
  previousState: InstallWizardState,
  formData: FormData
): Promise<InstallWizardState> {
  const actor = await authorizedInstallActor();
  const projectRoot = getActiveLoopgraphProjectRoot();
  try {
    const appId = requiredFormString(formData, "appId");
    const presetId = requiredFormString(formData, "presetId");
    const detail = await callLoopgraphAppTool("loopgraph_app_get", {
      projectRoot,
      appId
    }) as MarketplaceAppDetail;
    const selectedModules = formData.getAll("selectedModule").filter((value): value is string => typeof value === "string");
    const configuration = configurationFromInstallForm(formData, detail.setupQuestions);
    const journey = await callLoopgraphAppTool("loopgraph_app_onboarding_save", {
      projectRoot,
      appId,
      versionRange: detail.selectedVersion.version,
      presetId,
      selectedModules,
      configuration,
      fieldMappingIds: previousState.plan.fieldMappingIds.length > 0 ? previousState.plan.fieldMappingIds : undefined,
      expectedDraftRevision: previousState.journey.draft?.revision ?? 0,
      confirmPresetChange: formData.get("confirmPresetChange") === "on",
      actor
    }) as AppOnboardingJourney;
    if (!journey.plan) throw new Error("Loopgraph did not return an exact install plan for this journey");
    const plan = journey.plan;
    return {
      stage: "review",
      plan,
      impact: buildAppInstallImpactView(plan, detail),
      mappingPlan: journey.mappingPlan ?? previousState.mappingPlan,
      journey: appOnboardingProgressForView(journey),
      unresolvedQuestionKeys: journey.questions.map((question) => question.key),
      notice: plan.missingConfigurationKeys.length === 0
        ? "Your onboarding progress was saved. Review the exact graph and permission transaction below."
        : "Your onboarding progress was saved. Complete only the remaining items before installation."
    };
  } catch (error) {
    return {
      ...previousState,
      stage: "configure",
      error: error instanceof Error ? error.message : "Unable to prepare the installation plan"
    };
  }
}

export async function applyReviewedAppInstallAction(formData: FormData): Promise<void> {
  const actor = await authorizedInstallActor();
  if (formData.get("confirmPlan") !== "on") throw new Error("Confirm the reviewed installation plan before applying it");
  const projectRoot = getActiveLoopgraphProjectRoot();
  const rawPlan = requiredFormString(formData, "plan", 2_000_000);
  let plan: AppInstallPlan;
  try {
    plan = JSON.parse(rawPlan) as AppInstallPlan;
  } catch {
    throw new Error("The reviewed installation plan is not valid JSON");
  }
  if (plan.planDigest !== requiredFormString(formData, "expectedPlanDigest")) {
    throw new Error("The reviewed installation plan changed; create a fresh plan before installing")
  }
  const result = await callLoopgraphAppTool("loopgraph_app_install_apply", {
    projectRoot,
    plan,
    actor
  }) as { installation: { id: string } };
  revalidatePath("/marketplace");
  revalidatePath("/apps");
  revalidatePath("/brain");
  redirect(`/apps/${encodeURIComponent(result.installation.id)}`);
}

export async function resetMarketplaceAppOnboardingAction(formData: FormData): Promise<void> {
  const actor = await authorizedInstallActor();
  if (formData.get("confirmReset") !== "on") throw new Error("Confirm that you want to clear this onboarding draft");
  const appId = requiredFormString(formData, "appId");
  const presetId = requiredFormString(formData, "presetId");
  const expectedDraftId = requiredFormString(formData, "expectedDraftId");
  const expectedDraftRevision = Number(requiredFormString(formData, "expectedDraftRevision"));
  if (!Number.isInteger(expectedDraftRevision) || expectedDraftRevision <= 0) {
    throw new Error("The onboarding draft revision is invalid; reload before starting over");
  }
  const projectRoot = getActiveLoopgraphProjectRoot();
  await callLoopgraphAppTool("loopgraph_app_onboarding_reset", {
    projectRoot,
    appId,
    expectedDraftId,
    expectedDraftRevision,
    confirmReset: true,
    actor
  });
  const target = `/marketplace/${encodeURIComponent(appId)}/install?preset=${encodeURIComponent(presetId)}`;
  revalidatePath(target);
  redirect(target);
}

export async function confirmAppFieldMappingsAction(formData: FormData): Promise<void> {
  const actor = await authorizedInstallActor();
  if (formData.get("confirmMappings") !== "on") throw new Error("Confirm the reviewed field mappings before saving them");
  const projectRoot = getActiveLoopgraphProjectRoot();
  const appId = requiredFormString(formData, "appId");
  const presetId = requiredFormString(formData, "presetId");
  const connectionId = requiredFormString(formData, "connectionId");
  const objectType = requiredFormString(formData, "objectType");
  const logicalFields = formData.getAll("logicalField").filter((value): value is string => typeof value === "string" && value.length > 0);
  const mappings = logicalFields.flatMap((logicalField) => {
    const providerField = formData.get(`providerField:${logicalField}`);
    if (typeof providerField !== "string" || providerField.trim() === "") return [];
    const rawConfidence = formData.get(`confidence:${logicalField}`);
    const confidence = typeof rawConfidence === "string" && Number.isFinite(Number(rawConfidence)) ? Number(rawConfidence) : 0;
    return [{ logicalField, providerField: providerField.trim(), direction: "read" as const, confidence }];
  });
  if (mappings.length === 0) throw new Error("Select at least one reviewed provider field mapping");
  await callLoopgraphAppTool("loopgraph_app_field_mapping_confirm", {
    projectRoot,
    connectionId,
    objectType,
    mappings,
    actor
  });
  revalidatePath(`/marketplace/${encodeURIComponent(appId)}/install`);
  redirect(`/marketplace/${encodeURIComponent(appId)}/install?preset=${encodeURIComponent(presetId)}`);
}

function requiredFormString(formData: FormData, key: string, maxLength = 240): string {
  const value = formData.get(key);
  if (typeof value !== "string" || value.trim().length === 0 || value.length > maxLength) {
    throw new Error(`Missing or invalid form field: ${key}`);
  }
  return value.trim();
}

async function authorizedInstallActor(): Promise<string> {
  const identity = await requireHostedPermission("organization.manage");
  return identity?.email?.trim() || identity?.userId || "local-browser";
}
