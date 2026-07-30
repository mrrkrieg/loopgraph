import { createHash, timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { isHostedAuthRequired, getHostedOrganizationId } from "@/lib/auth/hosted-config";
import { createSupabaseAdminClient } from "@/lib/db/supabase-admin";
import { emitOperationalLog } from "@/lib/observability/operational-log";

const WORKER_API_TOKEN_ENV = "LOOPGRAPH_WORKER_API_TOKEN";
const REQUEST_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/;
const CREDENTIAL_ID_PATTERN = /^[a-z0-9][a-z0-9_-]{2,63}$/;
const PROJECT_KEY_PATTERN = /^[a-z0-9][a-z0-9_-]{0,63}$/;
const MAX_CLOCK_SKEW_MS = 5 * 60 * 1000;
const MAX_AUTHENTICATED_BODY_BYTES = 1024 * 1024;

export type MachineCapability =
  | "controller.operate"
  | "graph.transact"
  | "hermes.design_callback"
  | "hermes.design_callback_process"
  | "hermes.design_dispatch"
  | "measurements.collect"
  | "observability.read"
  | "provider.github_forward"
  | "routing.jobs"
  | "routing.worker"
  | "schedule.controller"
  | "schedule.hermes_design"
  | "schedule.hermes_callbacks"
  | "schedule.management"
  | "schedule.measurements";

export type GuardOptions = {
  environmentVariable: string;
  credentialEnvironmentVariable: string;
  capability: MachineCapability;
  rateLimit: number;
};

export type VerifiedHostedMachineRequest = {
  capability: MachineCapability;
  credentialEnvironmentVariable: string;
  requestId: string;
  requestHash: string;
  requestedAt: string;
  rateLimit: number;
};

export type HostedMachineRequestContext = {
  organizationId: string;
  projectKey: string;
  credentialId: string;
  capability: MachineCapability;
  requestId: string;
  requestHash: string;
  requestedAt: string;
  rateLimit: number;
};

export type PreparedVerifiedHostedMachineRequest = {
  context?: HostedMachineRequestContext;
  response?: NextResponse;
};

export function authorizeWorkerApiRequest(
  request: Request,
  capability: MachineCapability = "routing.worker"
): Promise<NextResponse | null> {
  return authorizeBearerApiRequest(request, {
    environmentVariable: WORKER_API_TOKEN_ENV,
    credentialEnvironmentVariable: "LOOPGRAPH_WORKER_CREDENTIAL_ID",
    capability,
    rateLimit: positiveInteger(process.env.LOOPGRAPH_WORKER_RATE_LIMIT_PER_MINUTE, 120)
  });
}

export function authorizeCronApiRequest(
  request: Request,
  capability: MachineCapability = "schedule.controller"
): Promise<NextResponse | null> {
  return authorizeBearerApiRequest(request, {
    environmentVariable: "CRON_SECRET",
    credentialEnvironmentVariable: "LOOPGRAPH_CRON_CREDENTIAL_ID",
    capability,
    rateLimit: positiveInteger(process.env.LOOPGRAPH_CRON_RATE_LIMIT_PER_MINUTE, 20)
  });
}

export function authorizeObservabilityApiRequest(
  request: Request
): Promise<NextResponse | null> {
  return authorizeBearerApiRequest(request, {
    environmentVariable: "LOOPGRAPH_OBSERVABILITY_API_TOKEN",
    credentialEnvironmentVariable: "LOOPGRAPH_OBSERVABILITY_CREDENTIAL_ID",
    capability: "observability.read",
    rateLimit: positiveInteger(
      process.env.LOOPGRAPH_OBSERVABILITY_RATE_LIMIT_PER_MINUTE,
      60
    )
  });
}

export async function authorizeBearerApiRequest(
  request: Request,
  optionsOrEnvironmentVariable: GuardOptions | string,
  legacyCapability?: string
): Promise<NextResponse | null> {
  const options = typeof optionsOrEnvironmentVariable === "string"
    ? {
        environmentVariable: optionsOrEnvironmentVariable,
        credentialEnvironmentVariable: "LOOPGRAPH_WORKER_CREDENTIAL_ID",
        capability: legacyMachineCapability(legacyCapability),
        rateLimit: positiveInteger(process.env.LOOPGRAPH_WORKER_RATE_LIMIT_PER_MINUTE, 120)
      }
    : optionsOrEnvironmentVariable;
  const configuredToken = process.env[options.environmentVariable];
  if (!configuredToken) {
    return unavailable(
      `${options.environmentVariable} must be configured before the ` +
      `${options.capability} machine API can be used.`
    );
  }

  const authorization = request.headers.get("authorization");
  const suppliedToken = authorization?.startsWith("Bearer ")
    ? authorization.slice("Bearer ".length)
    : "";
  if (!constantTimeTokenEqual(suppliedToken, configuredToken)) {
    emitOperationalLog({
      level: "warn",
      event: "machine.request.denied",
      outcome: "denied",
      capability: options.capability,
      reason: "invalid_bearer"
    });
    return NextResponse.json({ error: "Unauthorized" }, {
      status: 401,
      headers: {
        "cache-control": "no-store",
        "www-authenticate": "Bearer"
      }
    });
  }

  if (!isHostedAuthRequired()) return null;
  return authorizeHostedMachineRequest(request, options);
}

async function authorizeHostedMachineRequest(
  request: Request,
  options: GuardOptions
): Promise<NextResponse | null> {
  const organizationId = getHostedOrganizationId();
  const projectKey = process.env.LOOPGRAPH_HOSTED_PROJECT_KEY?.trim() || "default";
  const configuredCredentialId =
    process.env[options.credentialEnvironmentVariable]?.trim();
  if (!organizationId || !configuredCredentialId) {
    return unavailable(
      `Hosted ${options.capability} authorization requires ` +
      `LOOPGRAPH_HOSTED_ORGANIZATION_ID and ${options.credentialEnvironmentVariable}.`
    );
  }
  if (!CREDENTIAL_ID_PATTERN.test(configuredCredentialId)) {
    return unavailable(`${options.credentialEnvironmentVariable} has an invalid credential ID.`);
  }
  if (!PROJECT_KEY_PATTERN.test(projectKey)) {
    return unavailable("LOOPGRAPH_HOSTED_PROJECT_KEY has an invalid project key.");
  }

  const platformCron = options.capability.startsWith("schedule.") &&
    Boolean(request.headers.get("x-vercel-id"));
  const suppliedCredentialId = request.headers.get("x-loopgraph-credential-id") ??
    (platformCron ? configuredCredentialId : null);
  if (
    !suppliedCredentialId ||
    !constantTimeTokenEqual(suppliedCredentialId, configuredCredentialId)
  ) {
    emitOperationalLog({
      level: "warn",
      event: "machine.request.denied",
      outcome: "denied",
      capability: options.capability,
      organizationId,
      projectKey,
      reason: "invalid_machine_identity"
    });
    return NextResponse.json({ error: "Invalid machine credential identity" }, {
      status: 401,
      headers: { "cache-control": "no-store" }
    });
  }
  const requestedOrganization = request.headers.get("x-loopgraph-organization-id");
  const requestedProject = request.headers.get("x-loopgraph-project-key");
  if (
    (requestedOrganization && requestedOrganization !== organizationId) ||
    (requestedProject && requestedProject !== projectKey)
  ) {
    emitOperationalLog({
      level: "warn",
      event: "machine.request.denied",
      outcome: "denied",
      capability: options.capability,
      credentialId: configuredCredentialId,
      organizationId,
      projectKey,
      reason: "scope_mismatch"
    });
    return NextResponse.json({ error: "Machine credential scope mismatch" }, {
      status: 403,
      headers: { "cache-control": "no-store" }
    });
  }

  const platformRequestId = platformCron
    ? `vercel_${createHash("sha256")
        .update(request.headers.get("x-vercel-id") ?? "")
        .digest("hex")
        .slice(0, 32)}`
    : "";
  const requestId = request.headers.get("x-loopgraph-request-id") ?? platformRequestId;
  const timestampText = request.headers.get("x-loopgraph-timestamp") ??
    (platformCron ? new Date().toISOString() : "");
  const timestamp = Date.parse(timestampText);
  if (
    !REQUEST_ID_PATTERN.test(requestId) ||
    !Number.isFinite(timestamp) ||
    Math.abs(Date.now() - timestamp) > MAX_CLOCK_SKEW_MS
  ) {
    emitOperationalLog({
      level: "warn",
      event: "machine.request.denied",
      outcome: "denied",
      capability: options.capability,
      credentialId: configuredCredentialId,
      organizationId,
      projectKey,
      requestId,
      reason: "invalid_or_stale_request_metadata"
    });
    return NextResponse.json({
      error:
        "Hosted machine requests require a valid x-loopgraph-request-id and " +
        "an x-loopgraph-timestamp within five minutes."
    }, {
      status: 400,
      headers: { "cache-control": "no-store" }
    });
  }

  const contentLength = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(contentLength) && contentLength > MAX_AUTHENTICATED_BODY_BYTES) {
    emitOperationalLog({
      level: "warn",
      event: "machine.request.denied",
      outcome: "denied",
      capability: options.capability,
      credentialId: configuredCredentialId,
      organizationId,
      projectKey,
      requestId,
      reason: "body_too_large"
    });
    return NextResponse.json({ error: "Machine request body exceeds 1 MiB." }, {
      status: 413,
      headers: { "cache-control": "no-store" }
    });
  }
  let requestHash: string;
  try {
    requestHash = await hashRequest(request);
  } catch (error) {
    if (error instanceof MachineBodyTooLargeError) {
      emitOperationalLog({
        level: "warn",
        event: "machine.request.denied",
        outcome: "denied",
        capability: options.capability,
        credentialId: configuredCredentialId,
        organizationId,
        projectKey,
        requestId,
        reason: "body_too_large"
      });
      return NextResponse.json({ error: "Machine request body exceeds 1 MiB." }, {
        status: 413,
        headers: { "cache-control": "no-store" }
      });
    }
    throw error;
  }
  return recordHostedMachineRequest({
    organizationId,
    projectKey,
    credentialId: configuredCredentialId,
    capability: options.capability,
    requestId,
    requestHash,
    requestedAt: new Date(timestamp).toISOString(),
    rateLimit: options.rateLimit
  });
}

export async function authorizeVerifiedHostedMachineRequest(
  input: VerifiedHostedMachineRequest
): Promise<NextResponse | null> {
  const prepared = prepareVerifiedHostedMachineRequest(input);
  if (prepared.response) return prepared.response;
  if (!prepared.context) return null;
  return recordHostedMachineRequest(prepared.context);
}

export function prepareVerifiedHostedMachineRequest(
  input: VerifiedHostedMachineRequest
): PreparedVerifiedHostedMachineRequest {
  if (!isHostedAuthRequired()) return {};
  const organizationId = getHostedOrganizationId();
  const projectKey = process.env.LOOPGRAPH_HOSTED_PROJECT_KEY?.trim() || "default";
  const credentialId =
    process.env[input.credentialEnvironmentVariable]?.trim();
  const requestedAt = Date.parse(input.requestedAt);
  if (!organizationId || !credentialId) {
    return {
      response: unavailable(
        `Hosted ${input.capability} authorization requires ` +
        `LOOPGRAPH_HOSTED_ORGANIZATION_ID and ${input.credentialEnvironmentVariable}.`
      )
    };
  }
  if (!CREDENTIAL_ID_PATTERN.test(credentialId)) {
    return {
      response: unavailable(
        `${input.credentialEnvironmentVariable} has an invalid credential ID.`
      )
    };
  }
  if (!PROJECT_KEY_PATTERN.test(projectKey)) {
    return {
      response: unavailable(
        "LOOPGRAPH_HOSTED_PROJECT_KEY has an invalid project key."
      )
    };
  }
  if (
    !REQUEST_ID_PATTERN.test(input.requestId) ||
    !/^[a-f0-9]{64}$/.test(input.requestHash) ||
    !Number.isFinite(requestedAt) ||
    Math.abs(Date.now() - requestedAt) > MAX_CLOCK_SKEW_MS
  ) {
    return {
      response: NextResponse.json({
        error: "Verified machine request metadata is invalid or stale."
      }, {
        status: 400,
        headers: { "cache-control": "no-store" }
      })
    };
  }

  return {
    context: {
      organizationId,
      projectKey,
      credentialId,
      capability: input.capability,
      requestId: input.requestId,
      requestHash: input.requestHash,
      requestedAt: new Date(requestedAt).toISOString(),
      rateLimit: positiveInteger(String(input.rateLimit), 60)
    }
  };
}

async function recordHostedMachineRequest(input: {
  organizationId: string;
  projectKey: string;
  credentialId: string;
  capability: MachineCapability;
  requestId: string;
  requestHash: string;
  requestedAt: string;
  rateLimit: number;
}): Promise<NextResponse | null> {
  const supabase = createSupabaseAdminClient();
  if (!supabase) {
    emitOperationalLog({
      level: "error",
      event: "machine.guard.unavailable",
      outcome: "error",
      capability: input.capability,
      credentialId: input.credentialId,
      organizationId: input.organizationId,
      projectKey: input.projectKey,
      requestId: input.requestId,
      correlationId: input.requestId,
      reason: "service_database_unavailable"
    });
    return unavailable("Supabase service authorization is not configured.");
  }
  const { data, error } = await supabase.rpc("authorize_machine_request", {
    p_organization_id: input.organizationId,
    p_project_key: input.projectKey,
    p_credential_id: input.credentialId,
    p_capability: input.capability,
    p_request_id: input.requestId,
    p_request_hash: input.requestHash,
    p_requested_at: input.requestedAt,
    p_rate_limit: input.rateLimit
  });
  if (error) {
    emitOperationalLog({
      level: "error",
      event: "machine.guard.unavailable",
      outcome: "error",
      capability: input.capability,
      credentialId: input.credentialId,
      organizationId: input.organizationId,
      projectKey: input.projectKey,
      requestId: input.requestId,
      correlationId: input.requestId,
      reason: "authorization_rpc_failed"
    });
    return unavailable(`Machine request guard is unavailable: ${error.message}`);
  }
  const result = Array.isArray(data) ? data[0] : data;
  if (!result || result.authorized !== true) {
    const reason = typeof result?.reason === "string" ? result.reason : "guard_rejected";
    const rateLimited = reason === "rate_limited";
    emitOperationalLog({
      level: "warn",
      event: "machine.request.denied",
      outcome: "denied",
      capability: input.capability,
      credentialId: input.credentialId,
      organizationId: input.organizationId,
      projectKey: input.projectKey,
      requestId: input.requestId,
      correlationId: input.requestId,
      reason
    });
    return NextResponse.json({ error: reason }, {
      status: rateLimited ? 429 : 409,
      headers: {
        "cache-control": "no-store",
        ...(rateLimited && result?.retry_after_seconds
          ? { "retry-after": String(result.retry_after_seconds) }
          : {})
      }
    });
  }
  emitOperationalLog({
    level: "info",
    event: "machine.request.authorized",
    outcome: "accepted",
    capability: input.capability,
    credentialId: input.credentialId,
    organizationId: input.organizationId,
    projectKey: input.projectKey,
    requestId: input.requestId,
    correlationId: input.requestId
  });
  return null;
}

async function hashRequest(request: Request): Promise<string> {
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
        throw new MachineBodyTooLargeError();
      }
      hash.update(value);
    }
  }
  return hash.digest("hex");
}

function legacyMachineCapability(value?: string): MachineCapability {
  if (value?.includes("graph")) return "graph.transact";
  return "routing.worker";
}

function unavailable(message: string) {
  return NextResponse.json({ error: message }, {
    status: 503,
    headers: { "cache-control": "no-store" }
  });
}

function positiveInteger(value: string | undefined, fallback: number) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function constantTimeTokenEqual(supplied: string, configured: string): boolean {
  const suppliedDigest = createHash("sha256").update(supplied, "utf8").digest();
  const configuredDigest = createHash("sha256").update(configured, "utf8").digest();
  return timingSafeEqual(suppliedDigest, configuredDigest);
}

class MachineBodyTooLargeError extends Error {}
