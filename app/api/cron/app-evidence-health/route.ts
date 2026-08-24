import { NextResponse } from "next/server";
import { getHostedOrganizationId } from "@/lib/auth/hosted-config";
import { getHostedAppEvidenceHealth } from "@/lib/observability/app-evidence-health";
import { emitOperationalLog } from "@/lib/observability/operational-log";
import { authorizeCronApiRequest } from "@/lib/loopgraph-runtime/worker-api-auth";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const unauthorized = await authorizeCronApiRequest(request, "schedule.app_evidence_health");
  if (unauthorized) return unauthorized;
  const organizationId = getHostedOrganizationId();
  const projectKey = process.env.LOOPGRAPH_HOSTED_PROJECT_KEY?.trim() || "default";
  try {
    const health = await getHostedAppEvidenceHealth();
    emitOperationalLog({
      level: health.health === "blocked" ? "error" : health.health === "degraded" ? "warn" : "info",
      event: "app.evidence_health.observed",
      outcome: "observed",
      capability: "schedule.app_evidence_health",
      organizationId,
      projectKey,
      metadata: {
        health: health.health,
        totalInstallations: health.totalInstallations,
        invalid: health.counts.invalid,
        expired: health.counts.expired,
        renewSoon: health.counts.renewSoon,
        incomplete: health.counts.incomplete,
        current: health.counts.current,
        truncated: health.truncated
      }
    });
    return NextResponse.json(health, {
      status: 202,
      headers: { "cache-control": "no-store" }
    });
  } catch {
    emitOperationalLog({
      level: "error",
      event: "app.evidence_health.failed",
      outcome: "error",
      capability: "schedule.app_evidence_health",
      organizationId,
      projectKey,
      reason: "app_evidence_health_unavailable"
    });
    return NextResponse.json({ error: "App evidence health is temporarily unavailable" }, {
      status: 503,
      headers: { "cache-control": "no-store" }
    });
  }
}

export async function POST(request: Request) {
  return GET(request);
}
