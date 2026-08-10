"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import type { AppInstallPlan } from "loopgraph/core";
import { requireHostedPermission } from "@/lib/auth/hosted-access";
import { getActiveLoopgraphProjectRoot } from "@/lib/loopgraph-runtime/storage-resolver";
import { callLoopgraphAppTool } from "@/lib/loopgraph-runtime/app-tools";
import {
  configurationFromInstallForm,
  type InstallWizardState
} from "@/lib/app-platform/install-wizard";
import type { MarketplaceAppDetail } from "@/lib/app-platform/read-model";

export async function planMarketplaceAppInstallAction(
  previousState: InstallWizardState,
  formData: FormData
): Promise<InstallWizardState> {
  await requireHostedPermission("organization.manage");
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
    const plan = await callLoopgraphAppTool("loopgraph_app_install_plan", {
      projectRoot,
      appId,
      versionRange: detail.selectedVersion.version,
      presetId,
      selectedModules,
      configuration,
      fieldMappingIds: previousState.plan.fieldMappingIds.length > 0 ? previousState.plan.fieldMappingIds : undefined,
      actor: "loopgraph-browser"
    }) as AppInstallPlan;
    return {
      stage: "review",
      plan,
      notice: plan.missingConfigurationKeys.length === 0
        ? "Configuration was validated. Review the exact graph and permission transaction below."
        : "Your answers were saved into a new read-only plan. Complete the remaining items before installation."
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
  await requireHostedPermission("organization.manage");
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
    actor: "loopgraph-browser"
  }) as { installation: { id: string } };
  revalidatePath("/marketplace");
  revalidatePath("/apps");
  revalidatePath("/brain");
  redirect(`/apps/${encodeURIComponent(result.installation.id)}`);
}

function requiredFormString(formData: FormData, key: string, maxLength = 240): string {
  const value = formData.get(key);
  if (typeof value !== "string" || value.trim().length === 0 || value.length > maxLength) {
    throw new Error(`Missing or invalid form field: ${key}`);
  }
  return value.trim();
}
