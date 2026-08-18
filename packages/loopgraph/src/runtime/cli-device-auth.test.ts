import { chmod, lstat, mkdtemp, readFile, rm, symlink } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  CliDeviceAuthorizationClient,
  CliSessionTokenProvider,
  LocalCliCredentialStore,
  profileFromTokens,
  readConfiguredCliProfile,
  type CliTokenResponse
} from "./cli-device-auth";

const directories: string[] = [];
const organizationId = "123e4567-e89b-12d3-a456-426614174000";

afterEach(async () => {
  vi.unstubAllEnvs();
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe("interactive CLI device authorization", () => {
  it("handles pending and slow-down responses without exposing a session before approval", async () => {
    let now = Date.parse("2026-08-17T00:00:00.000Z");
    const responses = [
      errorResponse("authorization_pending", 400),
      errorResponse("slow_down", 429),
      jsonResponse(tokenResponse())
    ];
    const fetcher = vi.fn<typeof fetch>(async () => responses.shift()!);
    const client = new CliDeviceAuthorizationClient("https://loopgraph.example", {
      fetcher,
      now: () => now,
      sleep: async (milliseconds) => { now += milliseconds; }
    });
    const result = await client.waitForAuthorization({
      device_code: `lgdc_${"d".repeat(43)}`,
      user_code: "ABCD-EFGH",
      verification_uri: "https://loopgraph.example/device",
      verification_uri_complete: "https://loopgraph.example/device?user_code=ABCD-EFGH",
      expires_in: 600,
      interval: 5
    });
    expect(result.access_token).toMatch(/^lgcli_access_/);
    expect(fetcher).toHaveBeenCalledTimes(3);
    expect(fetcher.mock.calls.every((call) => String(call[0]).startsWith("https://loopgraph.example/api/auth/device/token"))).toBe(true);
  });

  it("writes an atomic current-user-only credential file and rejects unsafe files", async () => {
    const directory = await temporaryDirectory();
    const filePath = path.join(directory, "config", "credentials.json");
    const store = new LocalCliCredentialStore(filePath);
    const profile = profileFromTokens({
      baseUrl: "https://loopgraph.example",
      audience: "https://loopgraph.example/marketplace",
      tokens: tokenResponse(),
      now: Date.parse("2026-08-17T00:00:00.000Z")
    });
    await store.saveProfile(profile);
    expect((await store.getActiveProfile())?.id).toBe(profile.id);
    expect((await lstat(filePath)).mode & 0o777).toBe(process.platform === "win32" ? (await lstat(filePath)).mode & 0o777 : 0o600);
    expect(await readFile(filePath, "utf8")).toContain("loopgraph-cli-credentials/v1");

    if (process.platform !== "win32") {
      await chmod(filePath, 0o644);
      await expect(store.listProfiles()).rejects.toThrow(/0600/);
      await chmod(filePath, 0o600);
      const linkPath = path.join(directory, "credentials-link.json");
      await symlink(filePath, linkPath);
      await expect(new LocalCliCredentialStore(linkPath).listProfiles()).rejects.toThrow(/regular file/);
    }
  });

  it("rotates an expired access credential once across concurrent requests", async () => {
    const directory = await temporaryDirectory();
    const filePath = path.join(directory, "credentials.json");
    const store = new LocalCliCredentialStore(filePath);
    const original = profileFromTokens({
      baseUrl: "https://loopgraph.example",
      audience: "https://loopgraph.example/marketplace",
      tokens: tokenResponse({ expires_in: 1 }),
      now: Date.parse("2026-08-17T00:00:00.000Z")
    });
    await store.saveProfile(original);
    const refreshed = tokenResponse({
      access_token: `lgcli_access_${"n".repeat(43)}`,
      refresh_token: `lgcli_refresh_${"m".repeat(43)}`
    });
    const fetcher = vi.fn(async () => jsonResponse(refreshed));
    const provider = new CliSessionTokenProvider({
      profile: original,
      store,
      client: new CliDeviceAuthorizationClient(original.baseUrl, { fetcher }),
      now: () => Date.parse("2026-08-17T00:01:00.000Z")
    });
    await expect(Promise.all([
      provider.getToken({ audience: original.audience }),
      provider.getToken({ audience: original.audience })
    ])).resolves.toEqual([refreshed.access_token, refreshed.access_token]);
    expect(fetcher).toHaveBeenCalledTimes(1);
    const persisted = await store.getActiveProfile();
    expect(persisted?.refreshToken).toBe(refreshed.refresh_token);
    expect(JSON.stringify(persisted)).not.toContain(original.refreshToken);
  });

  it("discovers the active hosted profile without requiring marketplace environment variables", async () => {
    const directory = await temporaryDirectory();
    const filePath = path.join(directory, "credentials.json");
    const profile = profileFromTokens({
      baseUrl: "https://loopgraph.example",
      audience: "https://loopgraph.example/marketplace",
      tokens: tokenResponse()
    });
    await new LocalCliCredentialStore(filePath).saveProfile(profile);
    const loaded = readConfiguredCliProfile({
      NODE_ENV: "test",
      LOOPGRAPH_CLI_CREDENTIALS_FILE: filePath
    } as NodeJS.ProcessEnv);
    expect(loaded).toMatchObject({
      baseUrl: "https://loopgraph.example",
      organizationId,
      projectKey: "main"
    });
  });
});

function tokenResponse(overrides: Partial<CliTokenResponse> = {}): CliTokenResponse {
  return {
    access_token: `lgcli_access_${"a".repeat(43)}`,
    token_type: "Bearer",
    expires_in: 900,
    refresh_token: `lgcli_refresh_${"r".repeat(43)}`,
    refresh_expires_at: "2026-09-16T00:00:00.000Z",
    scope: "marketplace.consume",
    organization_id: organizationId,
    project_key: "main",
    ...overrides
  };
}

function jsonResponse(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json" }
  });
}

function errorResponse(error: string, status: number) {
  return jsonResponse({ error, error_description: error }, status);
}

async function temporaryDirectory() {
  const directory = await mkdtemp(path.join(os.tmpdir(), "loopgraph-cli-auth-"));
  directories.push(directory);
  return directory;
}
