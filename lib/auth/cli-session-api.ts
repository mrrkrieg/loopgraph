import "server-only";

import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { getHostedOrganizationId } from "./hosted-config";
import { createSupabaseAdminClient } from "@/lib/db/supabase-admin";
import { emitOperationalLog } from "@/lib/observability/operational-log";

const ACCESS_TOKEN_PATTERN = /^lgcli_access_[A-Za-z0-9_-]{43}$/;
const REQUEST_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/;
const PROJECT_KEY_PATTERN = /^[a-z0-9][a-z0-9_-]{0,63}$/;
const MAX_CLOCK_SKEW_MS = 5 * 60 * 1000;
const MAX_AUTHENTICATED_BODY_BYTES = 1024 * 1024;

export type CliSessionAuthorization =
  | { handled: false }
  | { handled: true; response: NextResponse }
  | {
      handled: true;
      organizationId: string;
      projectKey: string;
      adminClient: NonNullable<ReturnType<typeof createSupabaseAdminClient>>;
    };

export async function authorizeCliSessionRequest(
  request: Request,
  capability: "marketplace.consume",
  rateLimit: number
): Promise<CliSessionAuthorization> {
  const token = bearerToken(request);
  if (!token.startsWith("lgcli_")) return { handled: false };
  if (!ACCESS_TOKEN_PATTERN.test(token)) return denied("invalid_cli_session", 401);

  const organizationId = getHostedOrganizationId();
  const projectKey = process.env.LOOPGRAPH_HOSTED_PROJECT_KEY?.trim() || "default";
  const adminClient = createSupabaseAdminClient();
  if (!organizationId || !PROJECT_KEY_PATTERN.test(projectKey) || !adminClient) {
    return denied("cli_session_authorization_unavailable", 503);
  }
  const requestedOrganization = request.headers.get("x-loopgraph-organization-id");
  const requestedProject = request.headers.get("x-loopgraph-project-key");
  if (
    (requestedOrganization && requestedOrganization !== organizationId) ||
    (requestedProject && requestedProject !== projectKey)
  ) {
    return denied("scope_mismatch", 403);
  }
  const requestId = request.headers.get("x-loopgraph-request-id") ?? "";
  const timestampText = request.headers.get("x-loopgraph-timestamp") ?? "";
  const timestamp = Date.parse(timestampText);
  if (
    !REQUEST_ID_PATTERN.test(requestId) ||
    !Number.isFinite(timestamp) ||
    Math.abs(Date.now() - timestamp) > MAX_CLOCK_SKEW_MS
  ) {
    return denied("invalid_or_stale_request_metadata", 400);
  }
  let requestHash: string;
  try {
    requestHash = await hashBoundedRequest(request);
  } catch {
    return denied("body_too_large", 413);
  }
  const { data, error } = await adminClient.rpc("authorize_cli_session_request", {
    p_access_token_hash: createHash("sha256").update(token, "utf8").digest("hex"),
    p_organization_id: organizationId,
    p_project_key: projectKey,
    p_capability: capability,
    p_request_id: requestId,
    p_request_hash: requestHash,
    p_requested_at: new Date(timestamp).toISOString(),
    p_rate_limit: rateLimit,
    p_now: new Date().toISOString()
  });
  if (error) return denied("cli_session_authorization_unavailable", 503);
  const row = firstRow(data);
  if (row.authorized !== true) {
    const reason = typeof row.reason === "string" ? row.reason : "cli_session_denied";
    const status = reason === "rate_limited" ? 429
      : reason === "replayed_request" ? 409
        : reason === "invalid_or_expired_session" ? 401
          : 403;
    return denied(reason, status, numberValue(row.retry_after_seconds));
  }
  emitOperationalLog({
    level: "info",
    event: "cli.session.request.authorized",
    outcome: "accepted",
    capability,
    credentialId: typeof row.credential_id === "string" ? row.credential_id : undefined,
    organizationId,
    projectKey,
    requestId,
    correlationId: requestId
  });
  return { handled: true, organizationId, projectKey, adminClient };
}

function bearerToken(request: Request) {
  const authorization = request.headers.get("authorization") ?? "";
  return authorization.startsWith("Bearer ") ? authorization.slice(7) : "";
}

function denied(reason: string, status: number, retryAfter?: number): CliSessionAuthorization {
  emitOperationalLog({
    level: status >= 500 ? "error" : "warn",
    event: "cli.session.request.denied",
    outcome: status >= 500 ? "error" : "denied",
    reason
  });
  return {
    handled: true,
    response: NextResponse.json({ error: reason }, {
      status,
      headers: {
        "cache-control": "no-store",
        ...(status === 401 ? { "www-authenticate": "Bearer" } : {}),
        ...(status === 429 && retryAfter ? { "retry-after": String(retryAfter) } : {})
      }
    })
  };
}

async function hashBoundedRequest(request: Request) {
  const url = new URL(request.url);
  const hash = createHash("sha256")
    .update(request.method)
    .update("\n")
    .update(url.pathname)
    .update(url.search)
    .update("\n");
  const reader = request.clone().body?.getReader();
  let total = 0;
  if (reader) {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_AUTHENTICATED_BODY_BYTES) {
        await reader.cancel();
        throw new Error("body_too_large");
      }
      hash.update(value);
    }
  }
  return hash.digest("hex");
}

function firstRow(data: unknown): Record<string, unknown> {
  const row = Array.isArray(data) ? data[0] : data;
  return row && typeof row === "object" ? row as Record<string, unknown> : {};
}

function numberValue(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}
