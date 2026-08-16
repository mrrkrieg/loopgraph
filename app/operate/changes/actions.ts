"use server";

import { revalidatePath } from "next/cache";
import { isPublicHostedPreviewEnvironment } from "@/lib/auth/hosted-config";
import { getWorkspaceDatabase } from "@/lib/db/workspace-database";
import {
  getActiveLoopgraphProjectRoot,
  getDiscoveryDesignStore,
  getHermesDesignStore,
  getLoopOpportunityStore,
  getLoopSpecRegistryStore,
  getSemanticGraphStore
} from "@/lib/loopgraph-runtime/storage-resolver";
import { reviewHermesGraphChangeSet } from "loopgraph/runtime";

export type GraphChangeDecisionState = {
  status: "idle" | "success" | "error";
  message?: string;
};

export const initialGraphChangeDecisionState: GraphChangeDecisionState = {
  status: "idle"
};

export async function decideGraphChangeAction(
  _previous: GraphChangeDecisionState,
  formData: FormData
): Promise<GraphChangeDecisionState> {
  try {
    if (isPublicHostedPreviewEnvironment()) {
      throw new Error("The public Loopgraph preview is read-only");
    }
    const changeSetId = requiredFormString(formData, "changeSetId", 512);
    const decision = requiredFormString(formData, "decision", 32);
    const reason = requiredFormString(formData, "reason", 2000);
    if (decision !== "approved" && decision !== "rejected") {
      throw new Error("decision must be approved or rejected");
    }
    const database = await getWorkspaceDatabase("reviews.write");
    if (database.hosted && (!database.userId || !database.role)) {
      throw new Error("The authenticated graph reviewer is unavailable");
    }
    const projectRoot = getActiveLoopgraphProjectRoot();
    const result = await reviewHermesGraphChangeSet({
      projectRoot,
      changeSetId,
      decision,
      actorId: database.userId ?? "loopgraph-ui",
      actorRole: database.role ?? "local-operator",
      policyVersion: "loopgraph-ui/graph-review/v1",
      reason
    }, {
      store: getSemanticGraphStore({ projectRoot }),
      opportunityStore: getLoopOpportunityStore({ projectRoot }),
      designStore: getDiscoveryDesignStore(),
      hermesDesignStore: getHermesDesignStore(),
      loopSpecStore: getLoopSpecRegistryStore({ projectRoot })
    });
    revalidatePath("/brain");
    revalidatePath("/operate/changes");
    revalidatePath("/operate/opportunities");
    return {
      status: "success",
      message: decision === "approved"
        ? `Approved with content-bound receipt ${result.receipt.id}. The graph is still unchanged until governed application.`
        : `Rejected with accountable receipt ${result.receipt.id}. No graph mutation occurred.`
    };
  } catch (error) {
    return {
      status: "error",
      message: error instanceof Error ? error.message : "Graph decision failed"
    };
  }
}

function requiredFormString(
  formData: FormData,
  key: string,
  maxLength: number
): string {
  const value = formData.get(key);
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`${key} is required`);
  }
  const normalized = value.trim();
  if (normalized.length > maxLength) {
    throw new Error(`${key} exceeds ${maxLength} characters`);
  }
  return normalized;
}
