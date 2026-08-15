import { beforeEach, describe, expect, it, vi } from "vitest";

const getWorkspaceDatabase = vi.hoisted(() => vi.fn());
const requireHostedStepUp = vi.hoisted(() => vi.fn());
const controlProviderDetectorSchedule = vi.hoisted(() => vi.fn());

vi.mock("@/lib/db/workspace-database", () => ({ getWorkspaceDatabase }));
vi.mock("@/lib/auth/hosted-access", () => ({
  HostedAccessError: class HostedAccessError extends Error {},
  requireHostedStepUp
}));
vi.mock("@/lib/connector-broker/admin", () => ({
  ProviderDetectorControlError: class ProviderDetectorControlError extends Error {},
  controlProviderDetectorSchedule
}));
vi.mock("@/lib/connector-broker/safe-error", () => ({
  safeConnectorError: (_error: unknown, fallback: string) => fallback
}));

import { POST } from "./route";

const scheduleId = "provider_detector_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

describe("provider detector control route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getWorkspaceDatabase.mockResolvedValue({ organizationId: "org-1", userId: "user-1", hosted: true });
    requireHostedStepUp.mockResolvedValue(undefined);
    controlProviderDetectorSchedule.mockResolvedValue({
      result: "run_scheduled",
      schedule: { id: scheduleId, status: "active", runState: "idle" }
    });
  });

  it("requires admin permission and step-up before an audited detector transition", async () => {
    const response = await POST(request({ action: "run_now", reason: "Validate current evidence" }), {
      params: Promise.resolve({ scheduleId })
    });
    expect(getWorkspaceDatabase).toHaveBeenCalledWith("integrations.manage");
    expect(requireHostedStepUp).toHaveBeenCalledTimes(1);
    expect(controlProviderDetectorSchedule).toHaveBeenCalledWith({
      database: expect.objectContaining({ organizationId: "org-1", userId: "user-1" }),
      scheduleId,
      action: "run_now",
      reason: "Validate current evidence"
    });
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
  });

  it("rejects an attacker-controlled schedule identifier before database access", async () => {
    const response = await POST(request({ action: "pause", reason: "Review detector evidence" }), {
      params: Promise.resolve({ scheduleId: "../../another-tenant" })
    });
    expect(response.status).toBe(400);
    expect(getWorkspaceDatabase).not.toHaveBeenCalled();
    expect(controlProviderDetectorSchedule).not.toHaveBeenCalled();
  });
});

function request(body: Record<string, unknown>) {
  return new Request(`https://loopgraph.example/api/integrations/detectors/${scheduleId}/control`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body)
  });
}
