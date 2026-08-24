import "server-only";

import {
  appEvidenceRenewalPlanSchema,
  deriveAppEvidenceFleetHealth,
  type AppEvidenceRenewalPlan
} from "loopgraph/core";
import { callLoopgraphAppTool } from "@/lib/app-platform/tool-bridge";
import { getActiveLoopgraphProjectRoot } from "@/lib/loopgraph-runtime/storage-resolver";

export const HOSTED_APP_EVIDENCE_HEALTH_SCHEMA_VERSION =
  "loopgraph-hosted-app-evidence-health/v1alpha1" as const;

const MAX_PLAN_CLOCK_SKEW_MS = 5 * 60 * 1000;

export type HostedAppEvidenceHealth = {
  schemaVersion: typeof HOSTED_APP_EVIDENCE_HEALTH_SCHEMA_VERSION;
  workspaceId: string;
  generatedAt: string;
  health: "healthy" | "degraded" | "blocked";
  totalInstallations: number;
  totalMatched: number;
  itemsReturned: number;
  truncated: boolean;
  counts: AppEvidenceRenewalPlan["counts"];
};

/**
 * Derive one secret-free hosted fleet-health projection from the same App
 * renewal contract consumed by Hermes, the CLI, browser, and local supervisor.
 * Reading this projection cannot execute any returned renewal action.
 */
export async function getHostedAppEvidenceHealth(input: {
  projectRoot?: string;
  now?: Date;
} = {}): Promise<HostedAppEvidenceHealth> {
  const projectRoot = input.projectRoot ?? getActiveLoopgraphProjectRoot();
  const workspaceId = hostedWorkspaceId();
  const now = input.now ?? new Date();
  const raw = await callLoopgraphAppTool(
    "loopgraph_apps_renewal_plan",
    { projectRoot, limit: 100 },
    { projectRoot, now }
  );
  const plan = appEvidenceRenewalPlanSchema.parse(raw);
  if (plan.workspaceId !== workspaceId || plan.companyId !== workspaceId) {
    throw new Error("App evidence health returned a cross-workspace projection");
  }
  if (Math.abs(now.getTime() - Date.parse(plan.generatedAt)) > MAX_PLAN_CLOCK_SKEW_MS) {
    throw new Error("App evidence health returned a stale or future-dated projection");
  }
  const health = deriveAppEvidenceFleetHealth(plan.counts);
  return {
    schemaVersion: HOSTED_APP_EVIDENCE_HEALTH_SCHEMA_VERSION,
    workspaceId,
    generatedAt: plan.generatedAt,
    health,
    totalInstallations: plan.totalInstallations,
    totalMatched: plan.totalMatched,
    itemsReturned: plan.items.length,
    truncated: plan.items.length < plan.totalMatched,
    counts: plan.counts
  };
}

function hostedWorkspaceId(): string {
  const projectKey = process.env.LOOPGRAPH_HOSTED_PROJECT_KEY?.trim() || "default";
  if (!/^[a-z0-9][a-z0-9_-]{0,63}$/.test(projectKey)) {
    throw new Error("LOOPGRAPH_HOSTED_PROJECT_KEY is not a valid hosted workspace identity");
  }
  return projectKey;
}
