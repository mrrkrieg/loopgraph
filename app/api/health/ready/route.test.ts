import { describe, expect, it, vi } from "vitest";

const getOperationalReadiness = vi.hoisted(() => vi.fn());
vi.mock("../../../../lib/observability/operational-status", () => ({
  getOperationalReadiness
}));

import { GET } from "./route";

describe("readiness API", () => {
  it("returns 503 without exposing internal failures when a hosted dependency is not ready", async () => {
    getOperationalReadiness.mockResolvedValue({
      ready: false,
      mode: "hosted",
      checkedAt: "2026-07-30T16:00:00.000Z",
      checks: {
        configuration: true,
        database: false,
        audit: false,
        runtimeNamespace: true
      },
      metrics: {}
    });

    const response = await GET();

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({
      status: "not_ready",
      service: "loopgraph",
      checkedAt: "2026-07-30T16:00:00.000Z"
    });
  });
});
