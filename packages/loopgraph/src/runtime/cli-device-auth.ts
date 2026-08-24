import { createHash, randomUUID } from "node:crypto";
import {
  chmod,
  lstat,
  mkdir,
  readFile,
  rename,
  rm,
  writeFile
} from "node:fs/promises";
import { lstatSync, readFileSync, type Stats } from "node:fs";
import os from "node:os";
import path from "node:path";
import { z } from "zod";
import type { WorkloadTokenProvider, WorkloadTokenRequest } from "./workload-token-provider";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const PROJECT_KEY_PATTERN = /^[a-z0-9][a-z0-9_-]{0,63}$/;
const MAX_CREDENTIAL_FILE_BYTES = 1024 * 1024;

const deviceCodeSchema = z.object({
  device_code: z.string().regex(/^lgdc_[A-Za-z0-9_-]{43}$/),
  user_code: z.string().regex(/^[A-Z2-9]{4}-[A-Z2-9]{4}$/),
  verification_uri: z.string().url(),
  verification_uri_complete: z.string().url(),
  expires_in: z.number().int().min(1).max(900),
  interval: z.number().int().min(5).max(30)
}).strict();

const tokenResponseSchema = z.object({
  access_token: z.string().regex(/^lgcli_access_[A-Za-z0-9_-]{43}$/),
  token_type: z.literal("Bearer"),
  expires_in: z.number().int().min(1).max(1_200),
  refresh_token: z.string().regex(/^lgcli_refresh_[A-Za-z0-9_-]{43}$/),
  refresh_expires_at: z.string().datetime(),
  scope: z.string().min(1).max(512),
  organization_id: z.string().regex(UUID_PATTERN),
  project_key: z.string().regex(PROJECT_KEY_PATTERN)
}).strict();

const cliSessionProfileSchema = z.object({
  id: z.string().regex(/^cli_[a-f0-9]{32}$/),
  baseUrl: z.string().url(),
  audience: z.string().min(1).max(512),
  organizationId: z.string().regex(UUID_PATTERN),
  projectKey: z.string().regex(PROJECT_KEY_PATTERN),
  scope: z.array(z.string().min(1).max(128)).min(1).max(8),
  accessToken: z.string().regex(/^lgcli_access_[A-Za-z0-9_-]{43}$/),
  accessExpiresAt: z.string().datetime(),
  refreshToken: z.string().regex(/^lgcli_refresh_[A-Za-z0-9_-]{43}$/),
  refreshExpiresAt: z.string().datetime(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime()
}).strict();

const credentialFileSchema = z.object({
  schemaVersion: z.literal("loopgraph-cli-credentials/v1"),
  activeProfileId: z.string().regex(/^cli_[a-f0-9]{32}$/).nullable(),
  profiles: z.array(cliSessionProfileSchema).max(32)
}).strict();

export type CliDeviceCode = z.infer<typeof deviceCodeSchema>;
export type CliTokenResponse = z.infer<typeof tokenResponseSchema>;
export type CliSessionProfile = z.infer<typeof cliSessionProfileSchema>;
type CredentialFile = z.infer<typeof credentialFileSchema>;

export class CliDeviceAuthorizationError extends Error {
  constructor(readonly code: string, readonly status: number, message = code) {
    super(message);
    this.name = "CliDeviceAuthorizationError";
  }
}

export class CliDeviceAuthorizationClient {
  private readonly baseUrl: URL;

  constructor(
    baseUrl: string,
    private readonly dependencies: { fetcher?: typeof fetch; now?: () => number; sleep?: (milliseconds: number) => Promise<void> } = {}
  ) {
    this.baseUrl = trustedCliAuthorizationBaseUrl(baseUrl);
  }

  async requestDeviceCode(): Promise<CliDeviceCode> {
    return deviceCodeSchema.parse(await this.request("api/auth/device/code", {
      client_id: "loopgraph-cli",
      scope: "marketplace.consume"
    }));
  }

  async exchangeDeviceCode(deviceCode: string): Promise<CliTokenResponse> {
    return tokenResponseSchema.parse(await this.request("api/auth/device/token", {
      grant_type: "urn:ietf:params:oauth:grant-type:device_code",
      client_id: "loopgraph-cli",
      device_code: deviceCode
    }));
  }

  async waitForAuthorization(device: CliDeviceCode): Promise<CliTokenResponse> {
    const expiresAt = this.now() + device.expires_in * 1_000;
    let intervalSeconds = device.interval;
    while (this.now() < expiresAt) {
      await this.sleep(intervalSeconds * 1_000);
      try {
        return await this.exchangeDeviceCode(device.device_code);
      } catch (error) {
        if (!(error instanceof CliDeviceAuthorizationError)) throw error;
        if (error.code === "authorization_pending") continue;
        if (error.code === "slow_down") {
          intervalSeconds = Math.min(30, intervalSeconds + 5);
          continue;
        }
        throw error;
      }
    }
    throw new CliDeviceAuthorizationError("expired_token", 400, "The device authorization code expired");
  }

  async refresh(refreshToken: string): Promise<CliTokenResponse> {
    return tokenResponseSchema.parse(await this.request("api/auth/device/refresh", {
      grant_type: "refresh_token",
      client_id: "loopgraph-cli",
      refresh_token: refreshToken
    }));
  }

  async revoke(token: string): Promise<void> {
    await this.request("api/auth/device/revoke", {
      client_id: "loopgraph-cli",
      token
    }, true);
  }

  private async request(relativePath: string, body: unknown, allowEmpty = false) {
    const response = await (this.dependencies.fetcher ?? fetch)(
      new URL(relativePath, ensureTrailingSlash(this.baseUrl)),
      {
        method: "POST",
        headers: { accept: "application/json", "content-type": "application/json" },
        body: JSON.stringify(body),
        redirect: "error",
        signal: AbortSignal.timeout(15_000)
      }
    );
    if (allowEmpty && response.ok && response.status === 204) return {};
    const payload = await readBoundedJson(response);
    if (!response.ok) {
      const error = payload && typeof payload === "object" ? payload as Record<string, unknown> : {};
      throw new CliDeviceAuthorizationError(
        typeof error.error === "string" ? error.error : "authorization_failed",
        response.status,
        typeof error.error_description === "string" ? error.error_description : `CLI authorization failed (${response.status})`
      );
    }
    return payload;
  }

  private now() {
    return (this.dependencies.now ?? Date.now)();
  }

  private sleep(milliseconds: number) {
    return this.dependencies.sleep?.(milliseconds) ?? new Promise<void>((resolve) => setTimeout(resolve, milliseconds));
  }
}

export class LocalCliCredentialStore {
  constructor(readonly filePath = defaultCliCredentialFile()) {
    if (!path.isAbsolute(filePath)) throw new Error("CLI credential file must be an absolute path");
  }

  async getActiveProfile(selector: Partial<Pick<CliSessionProfile, "baseUrl" | "audience" | "organizationId" | "projectKey">> = {}) {
    const file = await this.read();
    const matches = file.profiles.filter((profile) => profileMatches(profile, selector));
    return matches.find((profile) => profile.id === file.activeProfileId) ?? matches[0];
  }

  async saveProfile(profile: CliSessionProfile) {
    const parsed = cliSessionProfileSchema.parse(profile);
    const file = await this.read();
    file.profiles = [...file.profiles.filter((candidate) => candidate.id !== parsed.id), parsed];
    file.activeProfileId = parsed.id;
    await this.write(file);
  }

  async removeProfile(profileId: string) {
    const file = await this.read();
    file.profiles = file.profiles.filter((profile) => profile.id !== profileId);
    file.activeProfileId = file.activeProfileId === profileId ? file.profiles[0]?.id ?? null : file.activeProfileId;
    await this.write(file);
  }

  async listProfiles() {
    return (await this.read()).profiles;
  }

  private async read(): Promise<CredentialFile> {
    try {
      const stats = await lstat(this.filePath);
      validateCredentialFileStats(stats, this.filePath);
      if (stats.size > MAX_CREDENTIAL_FILE_BYTES) throw new Error("CLI credential file exceeds 1 MiB");
      return credentialFileSchema.parse(JSON.parse(await readFile(this.filePath, "utf8")));
    } catch (error) {
      if (isMissing(error)) return emptyCredentialFile();
      throw error;
    }
  }

  private async write(value: CredentialFile) {
    const parsed = credentialFileSchema.parse(value);
    const directory = path.dirname(this.filePath);
    const createdDirectory = await mkdir(directory, { recursive: true, mode: 0o700 });
    if (createdDirectory && process.platform !== "win32") await chmod(directory, 0o700);
    try {
      const existing = await lstat(this.filePath);
      validateCredentialFileStats(existing, this.filePath);
    } catch (error) {
      if (!isMissing(error)) throw error;
    }
    const temporary = path.join(directory, `.${path.basename(this.filePath)}.${randomUUID()}.tmp`);
    try {
      await writeFile(temporary, `${JSON.stringify(parsed, null, 2)}\n`, { flag: "wx", mode: 0o600 });
      if (process.platform !== "win32") await chmod(temporary, 0o600);
      await rename(temporary, this.filePath);
    } finally {
      await rm(temporary, { force: true });
    }
  }
}

export class CliSessionTokenProvider implements WorkloadTokenProvider {
  private refreshPromise?: Promise<string>;

  constructor(private readonly options: {
    profile: Pick<CliSessionProfile, "baseUrl" | "audience" | "organizationId" | "projectKey">;
    store?: LocalCliCredentialStore;
    client?: CliDeviceAuthorizationClient;
    now?: () => number;
  }) {}

  async getToken(input: WorkloadTokenRequest) {
    if (input.audience !== this.options.profile.audience) throw new Error("CLI session audience mismatch");
    const store = this.options.store ?? new LocalCliCredentialStore();
    const profile = await store.getActiveProfile(this.options.profile);
    if (!profile) throw new Error("No Loopgraph CLI session matches this marketplace; run `loopgraph auth login`");
    const now = (this.options.now ?? Date.now)();
    if (Date.parse(profile.refreshExpiresAt) <= now) throw new Error("Loopgraph CLI session expired; run `loopgraph auth login`");
    if (Date.parse(profile.accessExpiresAt) > now + 30_000) return profile.accessToken;
    if (!this.refreshPromise) {
      this.refreshPromise = this.refresh(profile, store).finally(() => {
        this.refreshPromise = undefined;
      });
    }
    return this.refreshPromise;
  }

  private async refresh(profile: CliSessionProfile, store: LocalCliCredentialStore) {
    const client = this.options.client ?? new CliDeviceAuthorizationClient(profile.baseUrl);
    let tokens: CliTokenResponse;
    try {
      tokens = await client.refresh(profile.refreshToken);
    } catch (error) {
      if (
        error instanceof CliDeviceAuthorizationError &&
        ["refresh_token_reused", "invalid_grant", "membership_required"].includes(error.code)
      ) {
        await store.removeProfile(profile.id);
      }
      throw error;
    }
    const updated = profileFromTokens({
      baseUrl: profile.baseUrl,
      audience: profile.audience,
      tokens,
      createdAt: profile.createdAt
    });
    await store.saveProfile(updated);
    return updated.accessToken;
  }
}

export function profileFromTokens(input: {
  baseUrl: string;
  audience: string;
  tokens: CliTokenResponse;
  createdAt?: string;
  now?: number;
}): CliSessionProfile {
  const now = input.now ?? Date.now();
  const baseUrl = canonicalCliBaseUrl(input.baseUrl);
  const id = cliProfileId(baseUrl, input.audience, input.tokens.organization_id, input.tokens.project_key);
  return cliSessionProfileSchema.parse({
    id,
    baseUrl,
    audience: input.audience,
    organizationId: input.tokens.organization_id,
    projectKey: input.tokens.project_key,
    scope: input.tokens.scope.split(/\s+/).filter(Boolean),
    accessToken: input.tokens.access_token,
    accessExpiresAt: new Date(now + input.tokens.expires_in * 1_000).toISOString(),
    refreshToken: input.tokens.refresh_token,
    refreshExpiresAt: input.tokens.refresh_expires_at,
    createdAt: input.createdAt ?? new Date(now).toISOString(),
    updatedAt: new Date(now).toISOString()
  });
}

export function readConfiguredCliProfile(
  env: NodeJS.ProcessEnv = process.env,
  filePath = cliCredentialFileFromEnvironment(env)
): CliSessionProfile | undefined {
  try {
    const stats = lstatSync(filePath);
    validateCredentialFileStats(stats, filePath);
    if (stats.size > MAX_CREDENTIAL_FILE_BYTES) throw new Error("CLI credential file exceeds 1 MiB");
    const file = credentialFileSchema.parse(JSON.parse(readFileSync(filePath, "utf8")));
    const selector = {
      baseUrl: env.LOOPGRAPH_MARKETPLACE_URL?.trim()
        ? canonicalCliBaseUrl(env.LOOPGRAPH_MARKETPLACE_URL)
        : undefined,
      audience: env.LOOPGRAPH_MARKETPLACE_AUDIENCE?.trim(),
      organizationId: env.LOOPGRAPH_MARKETPLACE_ORGANIZATION_ID?.trim(),
      projectKey: env.LOOPGRAPH_MARKETPLACE_PROJECT_KEY?.trim()
    };
    const matches = file.profiles.filter((profile) => profileMatches(profile, selector));
    return matches.find((profile) => profile.id === file.activeProfileId) ?? matches[0];
  } catch (error) {
    if (isMissing(error)) return undefined;
    throw error;
  }
}

export function cliCredentialFileFromEnvironment(env: NodeJS.ProcessEnv = process.env) {
  const configured = env.LOOPGRAPH_CLI_CREDENTIALS_FILE?.trim();
  if (configured) {
    if (!path.isAbsolute(configured)) throw new Error("LOOPGRAPH_CLI_CREDENTIALS_FILE must be absolute");
    return configured;
  }
  return defaultCliCredentialFile(env);
}

export function cliProfileId(baseUrl: string, audience: string, organizationId: string, projectKey: string) {
  return `cli_${createHash("sha256")
    .update([baseUrl, audience, organizationId, projectKey].join("\n"))
    .digest("hex")
    .slice(0, 32)}`;
}

function defaultCliCredentialFile(env: NodeJS.ProcessEnv = process.env) {
  const root = env.XDG_CONFIG_HOME?.trim() || (process.platform === "win32" ? env.APPDATA?.trim() : undefined);
  return path.resolve(root || path.join(os.homedir(), ".config"), "loopgraph", "credentials.json");
}

function trustedCliAuthorizationBaseUrl(value: string) {
  const url = new URL(value);
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
    throw new Error("Loopgraph authorization URL must be an HTTP(S) origin without credentials or query state");
  }
  const loopback = ["localhost", "127.0.0.1", "::1"].includes(url.hostname);
  if (url.protocol !== "https:" && !loopback) {
    throw new Error("Loopgraph authorization requires HTTPS except on loopback");
  }
  return url;
}

function canonicalCliBaseUrl(value: string) {
  const url = trustedCliAuthorizationBaseUrl(value);
  url.pathname = url.pathname === "/" ? "" : url.pathname.replace(/\/+$/, "");
  return url.toString().replace(/\/$/, "");
}

function ensureTrailingSlash(url: URL) {
  const result = new URL(url);
  if (!result.pathname.endsWith("/")) result.pathname += "/";
  return result;
}

function emptyCredentialFile(): CredentialFile {
  return { schemaVersion: "loopgraph-cli-credentials/v1", activeProfileId: null, profiles: [] };
}

function profileMatches(profile: CliSessionProfile, selector: Partial<Pick<CliSessionProfile, "baseUrl" | "audience" | "organizationId" | "projectKey">>) {
  return (!selector.baseUrl || canonicalCliBaseUrl(profile.baseUrl) === canonicalCliBaseUrl(selector.baseUrl)) &&
    (!selector.audience || profile.audience === selector.audience) &&
    (!selector.organizationId || profile.organizationId === selector.organizationId) &&
    (!selector.projectKey || profile.projectKey === selector.projectKey);
}

function validateCredentialFileStats(stats: Stats, filePath: string) {
  if (!stats.isFile() || stats.isSymbolicLink()) throw new Error(`CLI credential path must be a regular file: ${filePath}`);
  if (process.platform !== "win32") {
    if ((stats.mode & 0o077) !== 0) throw new Error("CLI credential file permissions must be 0600");
    if (typeof process.getuid === "function" && stats.uid !== process.getuid()) {
      throw new Error("CLI credential file must be owned by the current user");
    }
  }
}

function isMissing(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}

async function readBoundedJson(response: Response) {
  const declared = Number(response.headers.get("content-length") ?? "0");
  if (Number.isFinite(declared) && declared > 64 * 1024) throw new Error("CLI authorization response exceeded 64 KiB");
  const text = await response.text();
  if (Buffer.byteLength(text) > 64 * 1024) throw new Error("CLI authorization response exceeded 64 KiB");
  try {
    return text ? JSON.parse(text) as unknown : {};
  } catch {
    throw new Error("Loopgraph returned invalid CLI authorization JSON");
  }
}
