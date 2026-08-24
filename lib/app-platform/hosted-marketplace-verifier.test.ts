import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";
import { runHostedMarketplaceVerificationWorker } from "./hosted-marketplace-verifier";

const job = {
  jobId: "123e4567-e89b-42d3-a456-426614174100",
  appId: "acme.product.feedback",
  version: "1.0.0",
  attempts: 1,
  leaseToken: "123e4567-e89b-42d3-a456-426614174101",
  leaseExpiresAt: "2026-08-16T12:05:00.000Z",
  releaseStatus: "pending_verification",
  artifactDigest: `sha256:${"a".repeat(64)}`,
  manifestDigest: `sha256:${"b".repeat(64)}`,
  fileIndexDigest: `sha256:${"c".repeat(64)}`,
  snapshotDigest: `sha256:${"d".repeat(64)}`,
  artifactObjectKey: "tenant/marketplace/acme.product.feedback/1.0.0/archive.json",
  manifestPayload: {},
  fileIndexPayload: [],
  signature: {
    publisherId: "acme",
    algorithm: "ed25519",
    keyId: "acme.primary",
    publicKey: "public-key-material-that-is-long-enough",
    value: "signature-material-that-is-long-enough"
  }
} as const;

describe("hosted marketplace verification worker", () => {
  it("reconciles a previously activated release without downloading bytes", async () => {
    const rpc = verifierRpc([{ ...job, releaseStatus: "active" }]);
    const download = vi.fn();
    const result = await runHostedMarketplaceVerificationWorker({
      adminClient: {
        rpc,
        storage: { from: vi.fn(() => ({ download })) }
      } as unknown as SupabaseClient,
      workerId: "marketplace-worker"
    });

    expect(result).toEqual({ claimed: 1, activated: 0, rejected: 0, retried: 0, reconciled: 1 });
    expect(download).not.toHaveBeenCalled();
    expect(rpc).toHaveBeenCalledWith("finish_hosted_marketplace_verification_job", {
      p_job_id: job.jobId,
      p_lease_token: job.leaseToken,
      p_outcome: "completed",
      p_error_code: null
    });
  });

  it("retries storage failures without rejecting the signed release", async () => {
    const rpc = verifierRpc([job]);
    const result = await runHostedMarketplaceVerificationWorker({
      adminClient: {
        rpc,
        storage: {
          from: vi.fn(() => ({
            download: vi.fn().mockResolvedValue({ data: null, error: { message: "offline" } })
          }))
        }
      } as unknown as SupabaseClient,
      workerId: "marketplace-worker"
    });

    expect(result.retried).toBe(1);
    expect(rpc).not.toHaveBeenCalledWith(
      "reject_hosted_marketplace_release",
      expect.anything()
    );
    expect(rpc).toHaveBeenCalledWith("finish_hosted_marketplace_verification_job", {
      p_job_id: job.jobId,
      p_lease_token: job.leaseToken,
      p_outcome: "retry",
      p_error_code: "artifact_storage_unavailable"
    });
  });

  it("rejects malformed archives with a bounded code and no raw parser error", async () => {
    const rpc = verifierRpc([job]);
    const result = await runHostedMarketplaceVerificationWorker({
      adminClient: {
        rpc,
        storage: {
          from: vi.fn(() => ({
            download: vi.fn().mockResolvedValue({
              data: new Blob(["{}"], { type: "application/json" }),
              error: null
            })
          }))
        }
      } as unknown as SupabaseClient,
      workerId: "marketplace-worker"
    });

    expect(result.rejected).toBe(1);
    expect(rpc).toHaveBeenCalledWith("reject_hosted_marketplace_release", expect.objectContaining({
      p_app_id: job.appId,
      p_version: job.version,
      p_reason_code: "archive_verification_failed"
    }));
    expect(JSON.stringify(rpc.mock.calls)).not.toContain("Invalid LoopPack archive envelope");
  });
});

function verifierRpc(claimed: unknown[]) {
  return vi.fn(async (name: string, parameters: Record<string, unknown>) => {
    if (name === "claim_hosted_marketplace_verification_jobs") {
      return { data: claimed, error: null };
    }
    if (name === "finish_hosted_marketplace_verification_job") {
      return {
        data: {
          jobId: parameters.p_job_id,
          status: parameters.p_outcome === "retry" ? "pending" : "completed",
          attempts: 1,
          errorCode: parameters.p_error_code
        },
        error: null
      };
    }
    if (name === "reject_hosted_marketplace_release") {
      return {
        data: {
          appId: job.appId,
          version: job.version,
          artifactDigest: job.artifactDigest,
          releaseStatus: "rejected",
          created: true
        },
        error: null
      };
    }
    throw new Error(`Unexpected RPC ${name}`);
  });
}
