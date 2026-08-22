"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireHostedPermission, requireHostedStepUp } from "@/lib/auth/hosted-access";
import { approveConnectorPreparedAction, revokeConnectorPreparedAction } from "@/lib/connector-broker/admin";
import { getWorkspaceDatabase } from "@/lib/db/workspace-database";
import { approveAppOperationAction } from "@/lib/app-platform/app-operation-action-approval";
import { revokeAppOperationAction } from "@/lib/app-platform/app-operation-action-revocation";
import {
  getActiveLoopgraphProjectRoot,
  getAppInstallationStore,
  getAppOperationActionStore
} from "@/lib/loopgraph-runtime/storage-resolver";
import { callLoopgraphAppTool, type LoopgraphAppToolName } from "@/lib/app-platform/tool-bridge";

const actionTools = {
  test: "loopgraph_app_test",
  pause: "loopgraph_app_pause",
  resume: "loopgraph_app_resume",
  repair: "loopgraph_app_repair"
} as const satisfies Record<string, LoopgraphAppToolName>;

export async function operateInstalledAppAction(formData: FormData) {
  const actor = await authorizedAppActor();
  const installationId = requiredFormString(formData, "installationId");
  const action = requiredFormString(formData, "action");
  if (!(action in actionTools)) throw new Error(`Unsupported app operation: ${action}`);
  await callLoopgraphAppTool(actionTools[action as keyof typeof actionTools], {
    projectRoot: getActiveLoopgraphProjectRoot(),
    installationId,
    actor
  });
  revalidateInstalledApp(installationId);
}

export async function approveInstalledAppOperationAction(formData: FormData) {
  const identity = await requireHostedPermission("integrations.manage");
  await requireHostedStepUp();
  const database = await getWorkspaceDatabase("integrations.manage");
  if (!database.organizationId || !database.userId || !identity) {
    throw new Error("Hosted App action approval requires an authenticated organization administrator");
  }
  const installationId = requiredFormString(formData, "installationId");
  const actionId = requiredFormString(formData, "actionId");
  const projectRoot = getActiveLoopgraphProjectRoot();
  const workspaceId = process.env.LOOPGRAPH_HOSTED_PROJECT_KEY?.trim() || "default";
  await approveAppOperationAction({
    workspaceId,
    installationId,
    actionId,
    reason: requiredFormString(formData, "reason", 1_000),
    actorSubject: database.userId,
    actionStore: getAppOperationActionStore({ projectRoot, workspaceId }),
    installationStore: getAppInstallationStore({ projectRoot, workspaceId }),
    approveConnectorAction: (approval) => approveConnectorPreparedAction({ database, ...approval })
  });
  revalidateInstalledApp(installationId);
}

export async function revokeInstalledAppOperationAction(formData: FormData) {
  const identity = await requireHostedPermission("integrations.manage");
  await requireHostedStepUp();
  const database = await getWorkspaceDatabase("integrations.manage");
  if (!database.organizationId || !database.userId || !identity) {
    throw new Error("Hosted App action revocation requires an authenticated organization administrator");
  }
  const installationId = requiredFormString(formData, "installationId");
  const actionId = requiredFormString(formData, "actionId");
  const projectRoot = getActiveLoopgraphProjectRoot();
  const workspaceId = process.env.LOOPGRAPH_HOSTED_PROJECT_KEY?.trim() || "default";
  await revokeAppOperationAction({
    workspaceId,
    installationId,
    actionId,
    reason: requiredFormString(formData, "reason", 1_000),
    actorSubject: database.userId,
    actionStore: getAppOperationActionStore({ projectRoot, workspaceId }),
    revokeConnectorAction: (revocation) => revokeConnectorPreparedAction({ database, ...revocation })
  });
  revalidateInstalledApp(installationId);
}

export async function activateInstalledAppAction(formData: FormData) {
  const actor = await authorizedAppActor();
  const installationId = requiredFormString(formData, "installationId");
  const mode = requiredFormString(formData, "mode");
  if (mode !== "shadow" && mode !== "recommend" && mode !== "execute_with_approval") {
    throw new Error("Browser activation is limited to shadow, recommend, or execute with approval");
  }
  await callLoopgraphAppTool("loopgraph_app_activate", {
    projectRoot: getActiveLoopgraphProjectRoot(),
    installationId,
    mode,
    actor
  });
  revalidateInstalledApp(installationId);
}

export async function replayInstalledAppAction(formData: FormData) {
  const actor = await authorizedAppActor();
  const installationId = requiredFormString(formData, "installationId");
  const rawDataset = requiredFormString(formData, "dataset", 1_000_000);
  let dataset: unknown;
  try {
    dataset = JSON.parse(rawDataset);
  } catch {
    throw new Error("Historical replay dataset must be valid JSON");
  }
  if (!dataset || typeof dataset !== "object" || Array.isArray(dataset)) {
    throw new Error("Historical replay dataset must be a JSON object with from, to, and events");
  }
  await callLoopgraphAppTool("loopgraph_app_historical_replay", {
    ...(dataset as Record<string, unknown>),
    projectRoot: getActiveLoopgraphProjectRoot(),
    installationId,
    actor
  });
  revalidateInstalledApp(installationId);
}

export async function labelAppEvaluationAction(formData: FormData) {
  const actor = await authorizedAppActor();
  const installationId = requiredFormString(formData, "installationId");
  const label = requiredFormString(formData, "label");
  if (label !== "correct" && label !== "incomplete" && label !== "false_positive") {
    throw new Error("Unsupported evaluation label");
  }
  const reviewMinutes = Number(requiredFormString(formData, "reviewMinutes"));
  await callLoopgraphAppTool("loopgraph_app_evaluation_label", {
    projectRoot: getActiveLoopgraphProjectRoot(),
    runId: requiredFormString(formData, "runId"),
    scenarioId: requiredFormString(formData, "scenarioId"),
    label,
    reviewMinutes,
    actor
  });
  revalidateInstalledApp(installationId);
}

export async function configureInstalledAppAction(formData: FormData) {
  const actor = await authorizedAppActor();
  const installationId = requiredFormString(formData, "installationId");
  await callLoopgraphAppTool("loopgraph_app_configure", {
    projectRoot: getActiveLoopgraphProjectRoot(),
    installationId,
    values: parseJsonObject(requiredFormString(formData, "values", 100_000), "Configuration values"),
    expectedConfigurationDigest: requiredFormString(formData, "expectedConfigurationDigest"),
    actor
  });
  revalidateInstalledApp(installationId);
}

export async function overlayInstalledAppAction(formData: FormData) {
  const actor = await authorizedAppActor();
  const installationId = requiredFormString(formData, "installationId");
  const overlay = parseJsonObject(requiredFormString(formData, "overlay", 100_000), "Overlay");
  await callLoopgraphAppTool("loopgraph_app_overlay_apply", {
    projectRoot: getActiveLoopgraphProjectRoot(),
    installationId,
    operations: overlay.operations,
    expectedArtifactDigest: requiredFormString(formData, "expectedArtifactDigest"),
    expectedOverlayRevision: Number(requiredFormString(formData, "expectedOverlayRevision")),
    actor
  });
  revalidateInstalledApp(installationId);
}

export async function duplicateInstalledAppAction(formData: FormData) {
  const actor = await authorizedAppActor();
  const installationId = requiredFormString(formData, "installationId");
  const rawOverlay = optionalFormString(formData, "overlay", 100_000);
  const overlay = rawOverlay ? parseJsonObject(rawOverlay, "Duplicate overlay") : {};
  const result = await callLoopgraphAppTool("loopgraph_app_duplicate", {
    projectRoot: getActiveLoopgraphProjectRoot(),
    installationId,
    derivedAppId: requiredFormString(formData, "derivedAppId"),
    overlayOperations: overlay.operations ?? [],
    actor
  }) as { installation?: { id?: unknown } };
  const derivedInstallationId = result.installation?.id;
  if (typeof derivedInstallationId !== "string" || derivedInstallationId.length < 1 || derivedInstallationId.length > 240) {
    throw new Error("Loopgraph did not return the new private App installation identity");
  }
  revalidateInstalledApp(derivedInstallationId);
  redirect(`/apps/${encodeURIComponent(derivedInstallationId)}?created=duplicate`);
}

export async function applyInstalledAppUpdateAction(formData: FormData) {
  const actor = await authorizedAppActor();
  const installationId = requiredFormString(formData, "installationId");
  await callLoopgraphAppTool("loopgraph_app_update_apply", {
    projectRoot: getActiveLoopgraphProjectRoot(),
    plan: parseJsonObject(requiredFormString(formData, "plan", 1_000_000), "Update plan"),
    approvedPermissionCapabilities: formData.getAll("approvedPermissionCapabilities").filter((value): value is string => typeof value === "string"),
    actor
  });
  revalidateInstalledApp(installationId);
}

export async function rollbackInstalledAppAction(formData: FormData) {
  const actor = await authorizedAppActor();
  const installationId = requiredFormString(formData, "installationId");
  await callLoopgraphAppTool("loopgraph_app_rollback", {
    projectRoot: getActiveLoopgraphProjectRoot(),
    installationId,
    expectedArtifactDigest: requiredFormString(formData, "expectedArtifactDigest"),
    actor
  });
  revalidateInstalledApp(installationId);
}

export async function detachInstalledAppAction(formData: FormData) {
  const actor = await authorizedAppActor();
  const installationId = requiredFormString(formData, "installationId");
  await callLoopgraphAppTool("loopgraph_app_detach", {
    projectRoot: getActiveLoopgraphProjectRoot(),
    installationId,
    expectedArtifactDigest: requiredFormString(formData, "expectedArtifactDigest"),
    actor
  });
  revalidateInstalledApp(installationId);
}

export async function uninstallInstalledAppAction(formData: FormData) {
  const actor = await authorizedAppActor();
  const installationId = requiredFormString(formData, "installationId");
  if (requiredFormString(formData, "confirmation") !== "UNINSTALL") throw new Error("Type UNINSTALL to confirm removal");
  await callLoopgraphAppTool("loopgraph_app_uninstall", {
    projectRoot: getActiveLoopgraphProjectRoot(),
    installationId,
    expectedArtifactDigest: requiredFormString(formData, "expectedArtifactDigest"),
    reason: requiredFormString(formData, "reason", 2000),
    confirmed: true,
    actor
  });
  revalidateInstalledApp(installationId);
}

function revalidateInstalledApp(installationId: string) {
  revalidatePath("/apps");
  revalidatePath(`/apps/${installationId}`);
  revalidatePath("/brain");
  revalidatePath("/marketplace");
}

async function authorizedAppActor(): Promise<string> {
  const identity = await requireHostedPermission("organization.manage");
  return identity?.email?.trim() || identity?.userId || "local-browser";
}

function requiredFormString(formData: FormData, key: string, maxLength = 240): string {
  const value = formData.get(key);
  if (typeof value !== "string" || value.trim().length === 0 || value.length > maxLength) {
    throw new Error(`Missing or invalid form field: ${key}`);
  }
  return value.trim();
}

function optionalFormString(formData: FormData, key: string, maxLength = 240): string | undefined {
  const value = formData.get(key);
  if (value === null || value === "") return undefined;
  if (typeof value !== "string" || value.length > maxLength) throw new Error(`Invalid form field: ${key}`);
  return value.trim();
}

function parseJsonObject(value: string, label: string): Record<string, unknown> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new Error(`${label} must be valid JSON`);
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error(`${label} must be a JSON object`);
  return parsed as Record<string, unknown>;
}
