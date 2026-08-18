import "server-only";

import { NextResponse } from "next/server";
import { getHostedOrganizationId } from "@/lib/auth/hosted-config";
import { createSupabaseAdminClient } from "@/lib/db/supabase-admin";
import { authorizeBearerApiRequest } from "@/lib/loopgraph-runtime/worker-api-auth";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const PROJECT_KEY_PATTERN = /^[a-z0-9][a-z0-9_-]{0,63}$/;

export async function requireHostedMarketplaceMachineContext(request: Request) {
  const denied = await authorizeBearerApiRequest(request, {
    environmentVariable: "LOOPGRAPH_MARKETPLACE_API_TOKEN",
    credentialEnvironmentVariable: "LOOPGRAPH_MARKETPLACE_CREDENTIAL_ID",
    capability: "marketplace.consume",
    rateLimit: positiveInteger(
      process.env.LOOPGRAPH_MARKETPLACE_RATE_LIMIT_PER_MINUTE,
      120
    )
  });
  if (denied) return { response: denied } as const;

  const organizationId = getHostedOrganizationId();
  const projectKey = process.env.LOOPGRAPH_HOSTED_PROJECT_KEY?.trim() || "default";
  const adminClient = createSupabaseAdminClient();
  if (
    !organizationId ||
    !UUID_PATTERN.test(organizationId) ||
    !PROJECT_KEY_PATTERN.test(projectKey) ||
    !adminClient
  ) {
    return {
      response: NextResponse.json(
        { error: "Hosted marketplace machine delivery is unavailable" },
        { status: 503, headers: { "cache-control": "no-store" } }
      )
    } as const;
  }
  return { organizationId, projectKey, adminClient } as const;
}

function positiveInteger(value: string | undefined, fallback: number) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}
