import { beforeEach, describe, expect, it, vi } from "vitest";

const requireHostedPermission = vi.hoisted(() => vi.fn());
const exportSecurityAuditEvents = vi.hoisted(() => vi.fn());
const verifySecurityAuditChain = vi.hoisted(() => vi.fn());

vi.mock("../../../../lib/auth/hosted-access", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../../lib/auth/hosted-access")>();
  return { ...actual, requireHostedPermission };
});
vi.mock("../../../../lib/observability/operational-status", () => ({
  exportSecurityAuditEvents,
  verifySecurityAuditChain
}));

import { GET } from "./route";

describe("security audit export API", () => {
  beforeEach(() => {
    requireHostedPermission.mockReset();
    exportSecurityAuditEvents.mockReset();
    verifySecurityAuditChain.mockReset();
  });

  it("requires audit permission and returns a cursor plus chain verification", async () => {
    requireHostedPermission.mockResolvedValue({
      mode: "hosted",
      userId: "user_1",
      memberships: [],
      membership: {
        organizationId: "123e4567-e89b-12d3-a456-426614174000",
        organizationName: "Example",
        role: "admin"
      }
    });
    exportSecurityAuditEvents.mockResolvedValue([
      { sequence_number: 11, event_type: "machine.request.authorized" }
    ]);
    verifySecurityAuditChain.mockResolvedValue({
      valid: true,
      eventsChecked: 11,
      headHash: "a".repeat(64)
    });

    const response = await GET(new Request(
      "https://loopgraph.local/api/audit/export?after=10&limit=1"
    ));

    expect(requireHostedPermission).toHaveBeenCalledWith("audit.read");
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      schemaVersion: "loopgraph-security-audit-export/v1",
      afterSequence: 10,
      nextCursor: 11,
      hasMore: true,
      integrity: { valid: true },
      events: [{ sequence_number: 11 }]
    });
  });

  it("marks an export conflicted when the database chain verifier detects tampering", async () => {
    requireHostedPermission.mockResolvedValue({
      mode: "hosted",
      userId: "user_1",
      memberships: [],
      membership: {
        organizationId: "123e4567-e89b-12d3-a456-426614174000",
        organizationName: "Example",
        role: "owner"
      }
    });
    exportSecurityAuditEvents.mockResolvedValue([]);
    verifySecurityAuditChain.mockResolvedValue({
      valid: false,
      eventsChecked: 4,
      firstBadSequence: 5,
      headHash: "b".repeat(64)
    });

    const response = await GET(new Request("https://loopgraph.local/api/audit/export"));

    expect(response.status).toBe(409);
  });

  it("rejects invalid cursor input before calling the audit store", async () => {
    requireHostedPermission.mockResolvedValue({
      mode: "hosted",
      userId: "user_1",
      memberships: [],
      membership: {
        organizationId: "123e4567-e89b-12d3-a456-426614174000",
        organizationName: "Example",
        role: "admin"
      }
    });

    const response = await GET(new Request(
      "https://loopgraph.local/api/audit/export?after=-1"
    ));

    expect(response.status).toBe(400);
    expect(exportSecurityAuditEvents).not.toHaveBeenCalled();
  });
});
