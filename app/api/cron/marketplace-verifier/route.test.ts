import { describe, expect, it, vi } from "vitest";

const authorizeCronApiRequest = vi.hoisted(() => vi.fn());
const runHostedMarketplaceVerificationWorker = vi.hoisted(() => vi.fn());
const adminClient = vi.hoisted(() => ({ kind: "admin" }));

vi.mock("@/lib/loopgraph-runtime/worker-api-auth", () => ({ authorizeCronApiRequest }));
vi.mock("@/lib/db/supabase-admin", () => ({
  createSupabaseAdminClient: () => adminClient
}));
vi.mock("@/lib/app-platform/hosted-marketplace-verifier", () => ({
  runHostedMarketplaceVerificationWorker
}));

import { GET } from "./route";

describe("hosted marketplace verifier schedule", () => {
  it("uses a distinct machine capability and the service-role verifier", async () => {
    authorizeCronApiRequest.mockResolvedValue(null);
    runHostedMarketplaceVerificationWorker.mockResolvedValue({
      claimed: 0,
      activated: 0,
      rejected: 0,
      retried: 0,
      reconciled: 0
    });
    const response = await GET(new Request(
      "https://loopgraph.local/api/cron/marketplace-verifier"
    ));

    expect(response.status).toBe(202);
    expect(authorizeCronApiRequest).toHaveBeenCalledWith(
      expect.any(Request),
      "schedule.marketplace_verifier"
    );
    expect(runHostedMarketplaceVerificationWorker).toHaveBeenCalledWith({
      adminClient,
      workerId: "hosted-marketplace-cron",
      limit: 5,
      leaseSeconds: 300
    });
  });
});
