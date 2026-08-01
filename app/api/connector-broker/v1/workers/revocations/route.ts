import { NextResponse } from "next/server";
import { authorizeCronApiRequest } from "@/lib/loopgraph-runtime/worker-api-auth";
import { createSupabaseAdminClient } from "@/lib/db/supabase-admin";
import { getConnectorBrokerRuntime } from "@/lib/connector-broker/runtime";

async function run(request: Request) {
  const unauthorized = await authorizeCronApiRequest(request, "schedule.connector_revocations");
  if (unauthorized) return unauthorized;
  const database = createSupabaseAdminClient();
  if (!database) return NextResponse.json({ error: "Revocation storage is unavailable" }, { status: 503 });
  const { data, error } = await database.rpc("claim_connector_revocation_jobs", { p_limit: 20, p_lease_seconds: 90 });
  if (error) return NextResponse.json({ error: "Revocation queue is unavailable" }, { status: 503 });
  const runtime = getConnectorBrokerRuntime();
  let completed = 0;
  let retried = 0;
  for (const row of data ?? []) {
    try {
      await runtime.oauth.revoke({
        organizationId: String(row.organization_id),
        projectKey: String(row.project_key),
        installationId: String(row.installation_id),
        actorId: "system:credential-revocation-worker",
        correlationId: `connector_revocation_job_${row.id}`,
        emergency: Boolean(row.emergency)
      });
      await database.from("connector_revocation_jobs").update({
        status: "completed",
        leased_until: null,
        completed_at: new Date().toISOString(),
        last_error_code: null
      }).eq("id", row.id);
      completed += 1;
    } catch {
      const attempts = Number(row.attempt_count ?? 1);
      const terminal = attempts >= 10;
      await database.from("connector_revocation_jobs").update({
        status: terminal ? "failed" : "queued",
        leased_until: null,
        available_at: new Date(Date.now() + Math.min(2 ** attempts * 30_000, 60 * 60 * 1_000)).toISOString(),
        last_error_code: "revocation_failed"
      }).eq("id", row.id);
      retried += 1;
    }
  }
  return NextResponse.json({ claimed: data?.length ?? 0, completed, retried }, { headers: { "cache-control": "no-store" } });
}

export const GET = run;
export const POST = run;
