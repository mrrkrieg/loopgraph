import "server-only";

import { createHash, createHmac, randomBytes } from "node:crypto";
import { z } from "zod";
import { getHostedOrganizationId } from "./hosted-config";
import { createSupabaseAdminClient } from "@/lib/db/supabase-admin";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const PROJECT_KEY_PATTERN = /^[a-z0-9][a-z0-9_-]{0,63}$/;
const DEVICE_CODE_PATTERN = /^lgdc_[A-Za-z0-9_-]{43}$/;
const REFRESH_TOKEN_PATTERN = /^lgcli_refresh_[A-Za-z0-9_-]{43}$/;
const USER_CODE_ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";
const DEVICE_AUTH_CAPABILITIES = ["marketplace.consume"] as const;

export const cliDeviceCodeRequestSchema = z.object({
  client_id: z.literal("loopgraph-cli").default("loopgraph-cli"),
  scope: z.literal("marketplace.consume").default("marketplace.consume")
}).strict();

export const cliDeviceTokenRequestSchema = z.object({
  grant_type: z.literal("urn:ietf:params:oauth:grant-type:device_code"),
  client_id: z.literal("loopgraph-cli"),
  device_code: z.string().regex(DEVICE_CODE_PATTERN)
}).strict();

export const cliRefreshTokenRequestSchema = z.object({
  grant_type: z.literal("refresh_token"),
  client_id: z.literal("loopgraph-cli"),
  refresh_token: z.string().regex(REFRESH_TOKEN_PATTERN)
}).strict();

export const cliRevokeTokenRequestSchema = z.object({
  client_id: z.literal("loopgraph-cli"),
  token: z.string().min(32).max(1024)
}).strict();

type DeviceRpcRow = {
  authorization_id?: string;
  authorized?: boolean;
  rotated?: boolean;
  reason?: string;
  organization_id?: string;
  project_key?: string;
  capabilities?: string[];
  expires_at?: string;
  access_expires_at?: string;
  refresh_expires_at?: string;
  interval_seconds?: number;
};

export class CliAuthorizationError extends Error {
  constructor(
    readonly code: string,
    readonly status: number,
    message = code,
    readonly retryAfter?: number
  ) {
    super(message);
    this.name = "CliAuthorizationError";
  }
}

export async function createCliDeviceAuthorization(request: Request) {
  const context = hostedCliAuthorizationContext();
  const deviceCode = randomSecret("lgdc_");
  const userCode = generateUserCode();
  const fingerprint = requestFingerprint(request);
  const { data, error } = await context.admin.rpc("create_cli_device_authorization", {
    p_device_code_hash: tokenHash(deviceCode),
    p_user_code_hash: userCodeHash(normalizeUserCode(userCode)),
    p_organization_id: context.organizationId,
    p_project_key: context.projectKey,
    p_capabilities: [...DEVICE_AUTH_CAPABILITIES],
    p_request_fingerprint_hash: fingerprint,
    p_now: new Date().toISOString()
  });
  if (error) {
    if (String(error.message).includes("device_authorization_rate_limited")) {
      throw new CliAuthorizationError("slow_down", 429, "Too many device authorization requests", 60);
    }
    throw new CliAuthorizationError("temporarily_unavailable", 503, "CLI authorization storage is unavailable");
  }
  const row = firstRow(data);
  const expiresAt = requiredDate(row.expires_at, "device authorization expiry");
  const interval = boundedInterval(row.interval_seconds);
  const verificationUri = new URL("device", `${context.publicOrigin}/`).toString();
  const verificationUriComplete = new URL(verificationUri);
  verificationUriComplete.searchParams.set("user_code", userCode);
  return {
    device_code: deviceCode,
    user_code: userCode,
    verification_uri: verificationUri,
    verification_uri_complete: verificationUriComplete.toString(),
    expires_in: Math.max(1, Math.floor((expiresAt.getTime() - Date.now()) / 1_000)),
    interval
  };
}

export async function exchangeCliDeviceAuthorization(deviceCode: string) {
  const context = hostedCliAuthorizationContext();
  const accessToken = randomSecret("lgcli_access_");
  const refreshToken = randomSecret("lgcli_refresh_");
  const { data, error } = await context.admin.rpc("exchange_cli_device_authorization", {
    p_device_code_hash: tokenHash(deviceCode),
    p_access_token_hash: tokenHash(accessToken),
    p_refresh_token_hash: tokenHash(refreshToken),
    p_now: new Date().toISOString()
  });
  if (error) throw new CliAuthorizationError("temporarily_unavailable", 503, "CLI authorization exchange is unavailable");
  const row = firstRow(data);
  if (row.authorized !== true) throw oauthDecision(row);
  return tokenResponse(row, accessToken, refreshToken);
}

export async function rotateCliDeviceSession(refreshToken: string) {
  const context = hostedCliAuthorizationContext();
  const accessToken = randomSecret("lgcli_access_");
  const nextRefreshToken = randomSecret("lgcli_refresh_");
  const { data, error } = await context.admin.rpc("rotate_cli_access_session", {
    p_refresh_token_hash: tokenHash(refreshToken),
    p_new_access_token_hash: tokenHash(accessToken),
    p_new_refresh_token_hash: tokenHash(nextRefreshToken),
    p_now: new Date().toISOString()
  });
  if (error) throw new CliAuthorizationError("temporarily_unavailable", 503, "CLI session refresh is unavailable");
  const row = firstRow(data);
  if (row.rotated !== true) throw oauthDecision(row);
  return tokenResponse(row, accessToken, nextRefreshToken);
}

export async function revokeCliDeviceSession(token: string) {
  const context = hostedCliAuthorizationContext();
  const { error } = await context.admin.rpc("revoke_cli_access_session", {
    p_token_hash: tokenHash(token),
    p_now: new Date().toISOString()
  });
  if (error) throw new CliAuthorizationError("temporarily_unavailable", 503, "CLI session revocation is unavailable");
}

export async function decideCliDeviceAuthorization(input: {
  userCode: string;
  userId: string;
  organizationId: string;
  approve: boolean;
}) {
  const context = hostedCliAuthorizationContext();
  if (input.organizationId !== context.organizationId) {
    throw new CliAuthorizationError("invalid_user_code", 404, "The code does not belong to this organization");
  }
  const { data, error } = await context.admin.rpc("decide_cli_device_authorization", {
    p_user_code_hash: userCodeHash(normalizeUserCode(input.userCode)),
    p_organization_id: input.organizationId,
    p_user_id: input.userId,
    p_approve: input.approve,
    p_now: new Date().toISOString()
  });
  if (error) throw new CliAuthorizationError("temporarily_unavailable", 503, "CLI authorization decision is unavailable");
  const row = firstRow(data) as DeviceRpcRow & { decided?: boolean };
  if (row.decided !== true) throw oauthDecision(row);
  return { decision: row.reason === "approved" ? "approved" : "denied" } as const;
}

export function normalizeUserCode(value: string) {
  const normalized = value.trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (normalized.length !== 8 || [...normalized].some((character) => !USER_CODE_ALPHABET.includes(character))) {
    throw new CliAuthorizationError("invalid_user_code", 400, "Enter the eight-character code shown by the CLI");
  }
  return `${normalized.slice(0, 4)}-${normalized.slice(4)}`;
}

export function tokenHash(value: string) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function userCodeHash(value: string) {
  const secret = fingerprintSecret();
  return createHmac("sha256", secret).update(value, "utf8").digest("hex");
}

function hostedCliAuthorizationContext() {
  const organizationId = getHostedOrganizationId();
  const projectKey = process.env.LOOPGRAPH_HOSTED_PROJECT_KEY?.trim() || "default";
  const admin = createSupabaseAdminClient();
  if (!organizationId || !UUID_PATTERN.test(organizationId) || !PROJECT_KEY_PATTERN.test(projectKey) || !admin) {
    throw new CliAuthorizationError("temporarily_unavailable", 503, "Hosted CLI authorization is unavailable");
  }
  return {
    organizationId,
    projectKey,
    admin,
    publicOrigin: trustedPublicOrigin()
  };
}

function trustedPublicOrigin() {
  const configured = process.env.LOOPGRAPH_PUBLIC_URL?.trim();
  if (!configured) {
    if (process.env.NODE_ENV === "production") {
      throw new CliAuthorizationError("temporarily_unavailable", 503, "LOOPGRAPH_PUBLIC_URL is required for device authorization");
    }
    return "http://localhost:3000";
  }
  const url = new URL(configured);
  if (!(["http:", "https:"].includes(url.protocol)) || url.username || url.password || url.search || url.hash) {
    throw new CliAuthorizationError("temporarily_unavailable", 503, "LOOPGRAPH_PUBLIC_URL is invalid");
  }
  if (process.env.NODE_ENV === "production" && url.protocol !== "https:") {
    throw new CliAuthorizationError("temporarily_unavailable", 503, "Production device authorization requires HTTPS");
  }
  return url.origin;
}

function requestFingerprint(request: Request) {
  const secret = fingerprintSecret();
  const forwarded = process.env.VERCEL === "1"
    ? request.headers.get("x-vercel-forwarded-for")
    : process.env.LOOPGRAPH_TRUSTED_PROXY_HEADERS === "true"
      ? request.headers.get("x-forwarded-for")
      : undefined;
  const clientClass = forwarded ?? "unverified-client";
  const address = clientClass.split(",", 1)[0]?.trim().slice(0, 128) || "unverified-client";
  const agent = request.headers.get("user-agent")?.slice(0, 256) ?? "unknown";
  return createHmac("sha256", secret)
    .update(address)
    .update("\n")
    .update(agent)
    .digest("hex");
}

function fingerprintSecret() {
  const secret = process.env.LOOPGRAPH_DEVICE_AUTH_FINGERPRINT_SECRET?.trim();
  if (process.env.NODE_ENV === "production" && (!secret || secret.length < 32)) {
    throw new CliAuthorizationError("temporarily_unavailable", 503, "Device authorization rate-limit key is not configured");
  }
  return secret || "loopgraph-device-auth-development-only";
}

function randomSecret(prefix: string) {
  return `${prefix}${randomBytes(32).toString("base64url")}`;
}

function generateUserCode() {
  const bytes = randomBytes(8);
  const code = [...bytes].map((byte) => USER_CODE_ALPHABET[byte % USER_CODE_ALPHABET.length]).join("");
  return `${code.slice(0, 4)}-${code.slice(4)}`;
}

function firstRow(data: unknown): DeviceRpcRow {
  const row = Array.isArray(data) ? data[0] : data;
  return row && typeof row === "object" ? row as DeviceRpcRow : {};
}

function requiredDate(value: unknown, label: string) {
  const date = new Date(typeof value === "string" ? value : "");
  if (!Number.isFinite(date.getTime())) {
    throw new CliAuthorizationError("temporarily_unavailable", 503, `Invalid ${label}`);
  }
  return date;
}

function boundedInterval(value: unknown) {
  return typeof value === "number" && Number.isInteger(value) && value >= 5 && value <= 30 ? value : 5;
}

function oauthDecision(row: DeviceRpcRow) {
  const code = row.reason ?? "invalid_grant";
  const status = code === "slow_down" || code === "rate_limited" ? 429
    : code === "authorization_pending" ? 400
      : code === "access_denied" || code === "membership_required" ? 403
        : 400;
  return new CliAuthorizationError(
    code,
    status,
    code === "refresh_token_reused"
      ? "Refresh token reuse detected; this CLI session was revoked. Sign in again."
      : code,
    code === "slow_down" ? boundedInterval(row.interval_seconds) : code === "rate_limited" ? 60 : undefined
  );
}

function tokenResponse(row: DeviceRpcRow, accessToken: string, refreshToken: string) {
  const accessExpiry = requiredDate(row.access_expires_at, "access-token expiry");
  const refreshExpiry = requiredDate(row.refresh_expires_at, "refresh-token expiry");
  return {
    access_token: accessToken,
    token_type: "Bearer" as const,
    expires_in: Math.max(1, Math.floor((accessExpiry.getTime() - Date.now()) / 1_000)),
    refresh_token: refreshToken,
    refresh_expires_at: refreshExpiry.toISOString(),
    scope: Array.isArray(row.capabilities) ? row.capabilities.join(" ") : "marketplace.consume",
    organization_id: row.organization_id,
    project_key: row.project_key
  };
}
