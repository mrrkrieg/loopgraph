import "server-only";

import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { SupabaseClient } from "@supabase/supabase-js";
import { canonicalAppDigest, type LoopPackArtifact } from "loopgraph/core";
import { readLoopPackArchive } from "loopgraph/runtime";
import {
  hostedMarketplaceArtifactAttestation,
  SupabaseMarketplaceReleaseVerifier,
  SupabaseMarketplaceVerificationJobStore,
  type HostedMarketplaceVerificationJob
} from "@/lib/db/adapters/supabase-marketplace-registry-store";
import {
  HOSTED_MARKETPLACE_ARTIFACT_BUCKET,
  MAX_HOSTED_MARKETPLACE_ARCHIVE_BYTES
} from "./hosted-marketplace-artifacts";

export type HostedMarketplaceVerifierRun = {
  claimed: number;
  activated: number;
  rejected: number;
  retried: number;
  reconciled: number;
};

export async function runHostedMarketplaceVerificationWorker(input: {
  adminClient: SupabaseClient;
  workerId: string;
  limit?: number;
  leaseSeconds?: number;
}): Promise<HostedMarketplaceVerifierRun> {
  const jobs = new SupabaseMarketplaceVerificationJobStore(input.adminClient);
  const verifier = new SupabaseMarketplaceReleaseVerifier(input.adminClient);
  const claimed = await jobs.claim({
    workerId: input.workerId,
    limit: input.limit,
    leaseSeconds: input.leaseSeconds
  });
  const result: HostedMarketplaceVerifierRun = {
    claimed: claimed.length,
    activated: 0,
    rejected: 0,
    retried: 0,
    reconciled: 0
  };
  for (const job of claimed) {
    if (job.releaseStatus === "active" || job.releaseStatus === "rejected") {
      await jobs.finish({
        jobId: job.jobId,
        leaseToken: job.leaseToken,
        outcome: "completed",
        errorCode: job.releaseStatus === "rejected" ? "release_rejected" : undefined
      });
      result.reconciled += 1;
      continue;
    }
    let artifact: LoopPackArtifact;
    try {
      artifact = await downloadAndVerifyArchive(input.adminClient, job);
    } catch (error) {
      const failure = classifyVerificationFailure(error);
      if (failure.retry) {
        await jobs.finish({
          jobId: job.jobId,
          leaseToken: job.leaseToken,
          outcome: "retry",
          errorCode: failure.code
        });
        result.retried += 1;
      } else {
        await verifier.reject({
          appId: job.appId,
          version: job.version,
          verificationReceiptDigest: verificationReceiptDigest(job, failure.code),
          reasonCode: failure.code
        });
        await jobs.finish({
          jobId: job.jobId,
          leaseToken: job.leaseToken,
          outcome: "completed",
          errorCode: failure.code
        });
        result.rejected += 1;
      }
      continue;
    }
    try {
      await verifier.attest({
        appId: job.appId,
        version: job.version,
        artifact,
        verificationReceiptDigest: verificationReceiptDigest(job, "accepted"),
        accepted: true
      });
    } catch {
      await jobs.finish({
        jobId: job.jobId,
        leaseToken: job.leaseToken,
        outcome: "retry",
        errorCode: "verifier_dependency_unavailable"
      });
      result.retried += 1;
      continue;
    }
    // Completion is deliberately outside the verification catch. If it fails
    // after activation, the expired lease is reclaimed and reconciled against
    // the now-active release instead of being reset to pending.
    await jobs.finish({
      jobId: job.jobId,
      leaseToken: job.leaseToken,
      outcome: "completed"
    });
    result.activated += 1;
  }
  return result;
}

async function downloadAndVerifyArchive(
  adminClient: SupabaseClient,
  job: HostedMarketplaceVerificationJob
) {
  const { data, error } = await adminClient.storage
    .from(HOSTED_MARKETPLACE_ARTIFACT_BUCKET)
    .download(job.artifactObjectKey);
  if (error || !data) {
    throw new MarketplaceVerificationFailure("artifact_storage_unavailable", true);
  }
  if (data.size < 1 || data.size > MAX_HOSTED_MARKETPLACE_ARCHIVE_BYTES) {
    throw new MarketplaceVerificationFailure("archive_size_invalid", false);
  }
  const temporaryRoot = await mkdtemp(path.join(tmpdir(), "loopgraph-marketplace-"));
  const archivePath = path.join(temporaryRoot, "release.loopgraph-pack.json");
  try {
    await writeFile(archivePath, Buffer.from(await data.arrayBuffer()), { flag: "wx" });
    const archive = await readLoopPackArchive(archivePath);
    const artifact = archive.artifact;
    const attestation = hostedMarketplaceArtifactAttestation(artifact);
    const signature = artifact.provenance.signature;
    if (
      artifact.manifest.metadata.id !== job.appId ||
      artifact.manifest.metadata.version !== job.version ||
      attestation.artifactDigest !== job.artifactDigest ||
      attestation.manifestDigest !== job.manifestDigest ||
      attestation.fileIndexDigest !== job.fileIndexDigest
    ) {
      throw new MarketplaceVerificationFailure("artifact_identity_mismatch", false);
    }
    if (
      !signature ||
      signature.publisherId !== job.signature.publisherId ||
      signature.algorithm !== job.signature.algorithm ||
      signature.keyId !== job.signature.keyId ||
      normalizeKey(signature.publicKey) !== normalizeKey(job.signature.publicKey) ||
      signature.value !== job.signature.value
    ) {
      throw new MarketplaceVerificationFailure("signature_identity_mismatch", false);
    }
    if (
      canonicalAppDigest(artifact.manifest) !== canonicalAppDigest(job.manifestPayload) ||
      canonicalAppDigest(canonicalFileIndex(artifact)) !==
        canonicalAppDigest(job.fileIndexPayload)
    ) {
      throw new MarketplaceVerificationFailure("registry_payload_mismatch", false);
    }
    return artifact;
  } catch (error) {
    if (error instanceof MarketplaceVerificationFailure) throw error;
    throw new MarketplaceVerificationFailure("archive_verification_failed", false);
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
}

function canonicalFileIndex(artifact: {
  files: Array<{ path: string; digest: string; sizeBytes: number; mediaType: string }>;
}) {
  return [...artifact.files]
    .sort((left, right) => left.path.localeCompare(right.path))
    .map(({ path: filePath, digest, sizeBytes, mediaType }) => ({
      path: filePath,
      digest,
      sizeBytes,
      mediaType
    }));
}

function verificationReceiptDigest(
  job: HostedMarketplaceVerificationJob,
  outcome: string
) {
  return canonicalAppDigest({
    schemaVersion: "hosted-marketplace-verification-receipt/v1",
    jobId: job.jobId,
    appId: job.appId,
    version: job.version,
    artifactDigest: job.artifactDigest,
    manifestDigest: job.manifestDigest,
    fileIndexDigest: job.fileIndexDigest,
    signatureKeyId: job.signature.keyId,
    outcome
  });
}

class MarketplaceVerificationFailure extends Error {
  constructor(readonly code: string, readonly retry: boolean) {
    super(code);
    this.name = "MarketplaceVerificationFailure";
  }
}

function classifyVerificationFailure(error: unknown) {
  if (error instanceof MarketplaceVerificationFailure) {
    return { code: error.code, retry: error.retry };
  }
  return { code: "verifier_dependency_unavailable", retry: true };
}

function normalizeKey(value: string) {
  return value.replace(/\r\n/g, "\n").trim();
}
