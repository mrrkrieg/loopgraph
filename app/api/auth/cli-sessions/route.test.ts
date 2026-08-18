import { beforeEach, describe, expect, it, vi } from "vitest";

const getWorkspaceDatabase = vi.hoisted(() => vi.fn());
const requireHostedStepUp = vi.hoisted(() => vi.fn());
const listCliAccessSessions = vi.hoisted(() => vi.fn());
const revokeCliAccessSessions = vi.hoisted(() => vi.fn());

vi.mock("@/lib/db/workspace-database", () => ({ getWorkspaceDatabase }));
vi.mock("@/lib/auth/hosted-access", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/auth/hosted-access")>();
  return { ...actual, requireHostedStepUp };
});
vi.mock("@/lib/auth/cli-session-admin", () => ({
  listCliAccessSessions,
  revokeCliAccessSessions
}));

import { DELETE, GET } from "./route";

beforeEach(() => {
  vi.clearAllMocks();
  getWorkspaceDatabase.mockResolvedValue({
    client: null,
    organizationId: "123e4567-e89b-12d3-a456-426614174000",
    userId: "123e4567-e89b-12d3-a456-426614174001",
    role: "admin",
    hosted: true
  });
  requireHostedStepUp.mockResolvedValue(undefined);
});

describe("CLI session administration API", () => {
  it("requires credential revocation permission and returns safe inventory pages", async () => {
    listCliAccessSessions.mockResolvedValue({
      sessions: [{ id: "123e4567-e89b-12d3-a456-426614174010", status: "active" }],
      offset: 50,
      limit: 25,
      total: 76,
      nextOffset: 75
    });
    const response = await GET(new Request("https://loopgraph.local/api/auth/cli-sessions?offset=50&limit=25"));
    expect(getWorkspaceDatabase).toHaveBeenCalledWith("credentials.revoke");
    expect(listCliAccessSessions).toHaveBeenCalledWith(expect.any(Object), { offset: 50, limit: 25 });
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      schemaVersion: "cli-session-admin/v1",
      total: 76,
      nextOffset: 75
    });
  });

  it("requires MFA step-up and returns the atomic revocation receipt", async () => {
    revokeCliAccessSessions.mockResolvedValue({ revokedCount: 1, correlationId: "cli_session_revoke_1" });
    const response = await DELETE(new Request("https://loopgraph.local/api/auth/cli-sessions", {
      method: "DELETE",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        scope: "session",
        sessionId: "123e4567-e89b-12d3-a456-426614174010",
        reason: "Device was replaced"
      })
    }));
    expect(requireHostedStepUp).toHaveBeenCalledOnce();
    expect(revokeCliAccessSessions).toHaveBeenCalledWith(expect.objectContaining({
      scope: "session",
      sessionId: "123e4567-e89b-12d3-a456-426614174010"
    }));
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      accepted: true,
      revokedCount: 1,
      correlationId: "cli_session_revoke_1"
    });
  });

  it("rejects mismatched revocation targets before calling the service", async () => {
    const response = await DELETE(new Request("https://loopgraph.local/api/auth/cli-sessions", {
      method: "DELETE",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        scope: "organization",
        sessionId: "123e4567-e89b-12d3-a456-426614174010",
        reason: "Emergency access shutdown"
      })
    }));
    expect(response.status).toBe(400);
    expect(revokeCliAccessSessions).not.toHaveBeenCalled();
  });
});
