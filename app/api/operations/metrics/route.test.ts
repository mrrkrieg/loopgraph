import { describe, expect, it, vi } from "vitest";

const authorizeObservabilityApiRequest = vi.hoisted(() => vi.fn());
const getOperationalReadiness = vi.hoisted(() => vi.fn());
const formatPrometheusMetrics = vi.hoisted(() => vi.fn());

vi.mock("../../../../lib/loopgraph-runtime/worker-api-auth", () => ({
  authorizeObservabilityApiRequest
}));
vi.mock("../../../../lib/observability/operational-status", () => ({
  getOperationalReadiness,
  formatPrometheusMetrics
}));

import { GET } from "./route";

describe("operational metrics API", () => {
  it("requires the observability capability before returning scrape metrics", async () => {
    authorizeObservabilityApiRequest.mockResolvedValue(null);
    getOperationalReadiness.mockResolvedValue({ ready: true });
    formatPrometheusMetrics.mockReturnValue("loopgraph_ready 1\n");
    const request = new Request("https://loopgraph.local/api/operations/metrics");

    const response = await GET(request);

    expect(authorizeObservabilityApiRequest).toHaveBeenCalledWith(request);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/plain");
    await expect(response.text()).resolves.toBe("loopgraph_ready 1\n");
  });
});
