import { afterEach, describe, expect, it, vi } from "vitest";

const authorizeObservabilityApiRequest = vi.hoisted(() => vi.fn());
const exportSecurityAuditEvents = vi.hoisted(() => vi.fn());
const getVerifiedSecurityAuditCheckpoint = vi.hoisted(() => vi.fn());

vi.mock("../../../../lib/loopgraph-runtime/worker-api-auth", () => ({ authorizeObservabilityApiRequest }));
vi.mock("../../../../lib/observability/operational-status", () => ({
  exportSecurityAuditEvents,
  getVerifiedSecurityAuditCheckpoint
}));

import { GET } from "./route";

describe("machine audit export API", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("requires observability authorization and returns only a verified tenant export", async () => {
    vi.stubEnv("LOOPGRAPH_HOSTED_ORGANIZATION_ID", "123e4567-e89b-12d3-a456-426614174000");
    vi.stubEnv("LOOPGRAPH_HOSTED_PROJECT_KEY", "main");
    authorizeObservabilityApiRequest.mockResolvedValue(null);
    exportSecurityAuditEvents.mockResolvedValue([{ sequence_number: 8, event_type: "machine.request.authorized" }]);
    getVerifiedSecurityAuditCheckpoint.mockResolvedValue({
      valid: true,
      eventsChecked: 8,
      headSequence: 8,
      currentHeadSequence: 8,
      headHash: "a".repeat(64)
    });
    const request = new Request("https://loopgraph.local/api/operations/audit-export?after=7&limit=1");

    const response = await GET(request);

    expect(authorizeObservabilityApiRequest).toHaveBeenCalledWith(request);
    expect(exportSecurityAuditEvents).toHaveBeenCalledWith({
      organizationId: "123e4567-e89b-12d3-a456-426614174000",
      afterSequence: 7,
      throughSequence: 8,
      limit: 1
    });
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ projectKey: "main", nextCursor: 8, integrity: { valid: true } });
  });

  it("returns conflict instead of exporting a broken audit chain", async () => {
    vi.stubEnv("LOOPGRAPH_HOSTED_ORGANIZATION_ID", "123e4567-e89b-12d3-a456-426614174000");
    authorizeObservabilityApiRequest.mockResolvedValue(null);
    exportSecurityAuditEvents.mockResolvedValue([]);
    getVerifiedSecurityAuditCheckpoint.mockResolvedValue({
      valid: false,
      eventsChecked: 4,
      headSequence: 4,
      currentHeadSequence: 4,
      firstBadSequence: 3,
      headHash: "b".repeat(64)
    });
    expect((await GET(new Request("https://loopgraph.local/api/operations/audit-export"))).status).toBe(409);
  });

  it("keeps later pages bound to the requested verified head", async () => {
    vi.stubEnv("LOOPGRAPH_HOSTED_ORGANIZATION_ID", "123e4567-e89b-12d3-a456-426614174000");
    authorizeObservabilityApiRequest.mockResolvedValue(null);
    exportSecurityAuditEvents.mockResolvedValue([{ sequence_number: 10 }]);
    getVerifiedSecurityAuditCheckpoint.mockResolvedValue({
      valid: true,
      eventsChecked: 10,
      headSequence: 10,
      currentHeadSequence: 14,
      headHash: "c".repeat(64)
    });

    const response = await GET(new Request(
      "https://loopgraph.local/api/operations/audit-export?after=8&through=10&limit=1"
    ));

    expect(getVerifiedSecurityAuditCheckpoint).toHaveBeenCalledWith({
      organizationId: "123e4567-e89b-12d3-a456-426614174000",
      throughSequence: 10
    });
    await expect(response.json()).resolves.toMatchObject({
      throughSequence: 10,
      nextCursor: 10,
      hasMore: false,
      integrity: { currentHeadSequence: 14 }
    });
  });
});
