import { describe, expect, it, vi } from "vitest";

const authorizeWorkerApiRequest = vi.hoisted(() => vi.fn());
const runHostedMarketplaceVerificationWorker = vi.hoisted(() => vi.fn());
const adminClient = vi.hoisted(() => ({ kind: "admin" }));

vi.mock("@/lib/loopgraph-runtime/worker-api-auth", () => ({ authorizeWorkerApiRequest }));
vi.mock("@/lib/db/supabase-admin", () => ({
  createSupabaseAdminClient: () => adminClient
}));
vi.mock("@/lib/app-platform/hosted-marketplace-verifier", () => ({
  runHostedMarketplaceVerificationWorker
}));

import { POST } from "./route";

describe("hosted marketplace verifier worker API", () => {
  it("uses a dedicated machine capability and bounded lease input", async () => {
    authorizeWorkerApiRequest.mockResolvedValue(null);
    runHostedMarketplaceVerificationWorker.mockResolvedValue({
      claimed: 0,
      activated: 0,
      rejected: 0,
      retried: 0,
      reconciled: 0
    });
    const request = new Request(
      "https://loopgraph.local/api/marketplace/verifier/worker",
      {
        method: "POST",
        body: JSON.stringify({ workerId: "verifier-1", limit: 3, leaseSeconds: 120 })
      }
    );
    const response = await POST(request);

    expect(response.status).toBe(202);
    expect(authorizeWorkerApiRequest).toHaveBeenCalledWith(
      expect.any(Request),
      "marketplace.verify"
    );
    expect(runHostedMarketplaceVerificationWorker).toHaveBeenCalledWith({
      adminClient,
      workerId: "verifier-1",
      limit: 3,
      leaseSeconds: 120
    });
  });
});
