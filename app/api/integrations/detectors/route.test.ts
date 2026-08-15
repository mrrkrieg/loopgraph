import { beforeEach, describe, expect, it, vi } from "vitest";

const getWorkspaceDatabase = vi.hoisted(() => vi.fn());
const listProviderDetectorOperations = vi.hoisted(() => vi.fn());

vi.mock("@/lib/db/workspace-database", () => ({ getWorkspaceDatabase }));
vi.mock("@/lib/connector-broker/admin", () => ({ listProviderDetectorOperations }));
vi.mock("@/lib/connector-broker/safe-error", () => ({
  safeConnectorError: (_error: unknown, fallback: string) => fallback
}));

import { GET } from "./route";

describe("provider detector operations route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getWorkspaceDatabase.mockResolvedValue({ organizationId: "org-1", hosted: true });
    listProviderDetectorOperations.mockResolvedValue([{ id: "provider_detector_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" }]);
  });

  it("uses tenant read permission and returns only the bounded operations view", async () => {
    const response = await GET();
    expect(getWorkspaceDatabase).toHaveBeenCalledWith("integrations.read");
    expect(listProviderDetectorOperations).toHaveBeenCalledWith(expect.objectContaining({ organizationId: "org-1" }));
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    await expect(response.json()).resolves.toEqual({
      schemaVersion: "provider-detector-operations/v1",
      detectors: [{ id: "provider_detector_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" }]
    });
  });
});
