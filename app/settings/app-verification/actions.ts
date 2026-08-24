"use server";

import { revalidatePath } from "next/cache";
import { requireHostedStepUp } from "@/lib/auth/hosted-access";
import { getWorkspaceDatabase, type WorkspaceDatabase } from "@/lib/db/workspace-database";
import { callLoopgraphAppTool } from "@/lib/app-platform/tool-bridge";
import { getActiveLoopgraphProjectRoot } from "@/lib/loopgraph-runtime/storage-resolver";

const MAX_PUBLIC_KEY_BYTES = 16 * 1024;
const MAX_RECEIPT_BYTES = 256 * 1024;

export async function trustAppVerifierAction(formData: FormData) {
  const database = await authorizeMutation();
  const approvedBy = mutationActor(database, formData);
  await callLoopgraphAppTool("loopgraph_app_verifier_trust_add", {
    projectRoot: getActiveLoopgraphProjectRoot(),
    key: {
      verifierId: requiredText(formData, "verifier_id", 300),
      keyId: requiredText(formData, "key_id", 160),
      algorithm: "ed25519",
      publicKey: requiredText(formData, "public_key", MAX_PUBLIC_KEY_BYTES),
      approvedBy,
      approvalRef: requiredText(formData, "approval_ref", 1000),
      approvedAt: new Date().toISOString()
    }
  });
  revalidatePath("/settings/app-verification");
}

export async function revokeAppVerifierAction(formData: FormData) {
  const database = await authorizeMutation();
  await callLoopgraphAppTool("loopgraph_app_verifier_trust_revoke", {
    projectRoot: getActiveLoopgraphProjectRoot(),
    verifierId: requiredText(formData, "verifier_id", 300),
    keyId: requiredText(formData, "key_id", 160),
    revokedBy: mutationActor(database, formData),
    revocationRef: requiredText(formData, "revocation_ref", 1000)
  });
  revalidatePath("/settings/app-verification");
}

export async function importAppVerificationReceiptAction(formData: FormData) {
  const database = await authorizeMutation();
  const serialized = requiredText(formData, "receipt", MAX_RECEIPT_BYTES);
  let receipt: unknown;
  try {
    receipt = JSON.parse(serialized);
  } catch {
    throw new Error("Verification receipt must be valid JSON.");
  }
  await callLoopgraphAppTool("loopgraph_app_verification_import", {
    projectRoot: getActiveLoopgraphProjectRoot(),
    receipt,
    importedBy: mutationActor(database, formData),
    importRef: requiredText(formData, "import_ref", 1000)
  });
  revalidatePath("/settings/app-verification");
}

async function authorizeMutation(): Promise<WorkspaceDatabase> {
  const database = await getWorkspaceDatabase("integrations.manage");
  await requireHostedStepUp();
  return database;
}

function mutationActor(database: WorkspaceDatabase, formData: FormData): string {
  if (database.hosted) {
    const actor = database.email?.trim() || database.userId?.trim();
    if (!actor) throw new Error("Hosted administrator identity is unavailable.");
    return actor;
  }
  return requiredText(formData, "local_actor", 300);
}

function requiredText(formData: FormData, field: string, maxLength: number): string {
  const value = String(formData.get(field) ?? "").trim();
  if (!value) throw new Error(`${field.replaceAll("_", " ")} is required.`);
  if (Buffer.byteLength(value, "utf8") > maxLength) throw new Error(`${field.replaceAll("_", " ")} is too large.`);
  return value;
}
