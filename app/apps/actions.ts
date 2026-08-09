"use server";

import { revalidatePath } from "next/cache";
import { requireHostedPermission } from "@/lib/auth/hosted-access";
import { getActiveLoopgraphProjectRoot } from "@/lib/loopgraph-runtime/storage-resolver";
import { callLoopgraphAppTool, type LoopgraphAppToolName } from "@/lib/loopgraph-runtime/app-tools";

const actionTools = {
  test: "loopgraph_app_test",
  pause: "loopgraph_app_pause",
  resume: "loopgraph_app_resume"
} as const satisfies Record<string, LoopgraphAppToolName>;

export async function operateInstalledAppAction(formData: FormData) {
  await requireHostedPermission("organization.manage");
  const installationId = requiredFormString(formData, "installationId");
  const action = requiredFormString(formData, "action");
  if (!(action in actionTools)) throw new Error(`Unsupported app operation: ${action}`);
  await callLoopgraphAppTool(actionTools[action as keyof typeof actionTools], {
    projectRoot: getActiveLoopgraphProjectRoot(),
    installationId,
    actor: "loopgraph-browser"
  });
  revalidateInstalledApp(installationId);
}

export async function activateInstalledAppAction(formData: FormData) {
  await requireHostedPermission("organization.manage");
  const installationId = requiredFormString(formData, "installationId");
  const mode = requiredFormString(formData, "mode");
  if (mode !== "shadow" && mode !== "recommend" && mode !== "execute_with_approval") {
    throw new Error("Browser activation is limited to shadow, recommend, or execute with approval");
  }
  await callLoopgraphAppTool("loopgraph_app_activate", {
    projectRoot: getActiveLoopgraphProjectRoot(),
    installationId,
    mode,
    actor: "loopgraph-browser"
  });
  revalidateInstalledApp(installationId);
}

function revalidateInstalledApp(installationId: string) {
  revalidatePath("/apps");
  revalidatePath(`/apps/${installationId}`);
  revalidatePath("/brain");
  revalidatePath("/marketplace");
}

function requiredFormString(formData: FormData, key: string): string {
  const value = formData.get(key);
  if (typeof value !== "string" || value.trim().length === 0 || value.length > 240) {
    throw new Error(`Missing or invalid form field: ${key}`);
  }
  return value.trim();
}
