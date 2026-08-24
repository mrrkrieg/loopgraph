import { generateKeyPairSync } from "node:crypto";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { canonicalAppDigest } from "../core";
import { createAppIndependentVerificationReceipt } from "./app-operational-maturity";
import { FileAppVerificationStore } from "./app-verification-store";

const temporaryDirectories: string[] = [];
const now = "2026-08-21T12:00:00.000Z";

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe("App independent verification registry", () => {
  it("stores only approved public trust material and verifies receipts before import", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "loopgraph-app-verification-"));
    temporaryDirectories.push(root);
    const store = new FileAppVerificationStore(root, "acme");
    const keys = generateKeyPairSync("ed25519", {
      publicKeyEncoding: { type: "spki", format: "pem" },
      privateKeyEncoding: { type: "pkcs8", format: "pem" }
    });
    await expect(store.trustVerifierKey({
      verifierId: "unsafe-verifier",
      keyId: "unsafe-verifier.primary",
      algorithm: "ed25519",
      publicKey: keys.privateKey,
      approvedBy: "security-admin",
      approvalRef: "change:rejected",
      approvedAt: now
    })).rejects.toThrow(/public keys only/);
    const trusted = await store.trustVerifierKey({
      verifierId: "independent-auditor",
      keyId: "independent-auditor.primary",
      algorithm: "ed25519",
      publicKey: keys.publicKey,
      approvedBy: "security-admin",
      approvalRef: "change:SEC-42",
      approvedAt: now
    });
    expect(trusted.trustedVerifierKeys).toHaveLength(1);

    const receipt = createAppIndependentVerificationReceipt({
      installationId: "install.customer-health",
      appId: "acme.customer-health",
      artifactDigest: canonicalAppDigest("customer-health-v1"),
      verifierId: "independent-auditor",
      verifierType: "accredited_third_party",
      status: "passed",
      evidenceRefs: ["audit:report-2026-08"],
      verifiedAt: now,
      keyId: "independent-auditor.primary",
      privateKeyPem: keys.privateKey
    });
    const importContext = { importedBy: "security-admin", importRef: "change:SEC-45", importedAt: now };
    const imported = await store.importReceipt(receipt, importContext);
    expect(imported.receipts).toEqual([receipt]);
    expect((await store.importReceipt(receipt, importContext)).receipts).toHaveLength(1);
    expect((await store.read()).revision).toBe(2);

    const registryPath = path.join(root, "operational-verification.json");
    expect((await stat(registryPath)).mode & 0o777).toBe(0o600);
    expect(await readFile(registryPath, "utf8")).not.toContain(keys.privateKey);
  });

  it("rejects forged receipts and blocks a verifier immediately after revocation", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "loopgraph-app-verification-"));
    temporaryDirectories.push(root);
    const store = new FileAppVerificationStore(root, "acme");
    const trustedKeys = generateKeyPairSync("ed25519", {
      publicKeyEncoding: { type: "spki", format: "pem" },
      privateKeyEncoding: { type: "pkcs8", format: "pem" }
    });
    const attackerKeys = generateKeyPairSync("ed25519", {
      publicKeyEncoding: { type: "spki", format: "pem" },
      privateKeyEncoding: { type: "pkcs8", format: "pem" }
    });
    await store.trustVerifierKey({
      verifierId: "loopgraph-verifier",
      keyId: "loopgraph-verifier.primary",
      algorithm: "ed25519",
      publicKey: trustedKeys.publicKey,
      approvedBy: "security-admin",
      approvalRef: "change:SEC-43",
      approvedAt: now
    });
    const receiptInput = {
      installationId: "install.ads",
      appId: "acme.ads",
      artifactDigest: canonicalAppDigest("ads-v1"),
      verifierId: "loopgraph-verifier",
      verifierType: "loopgraph" as const,
      status: "passed" as const,
      evidenceRefs: ["audit:ads"],
      verifiedAt: now,
      keyId: "loopgraph-verifier.primary"
    };
    const forged = createAppIndependentVerificationReceipt({ ...receiptInput, privateKeyPem: attackerKeys.privateKey });
    const importContext = { importedBy: "security-admin", importRef: "change:SEC-46", importedAt: now };
    await expect(store.importReceipt(forged, importContext)).rejects.toThrow(/active trusted verifier key/);

    const valid = createAppIndependentVerificationReceipt({ ...receiptInput, privateKeyPem: trustedKeys.privateKey });
    await store.revokeVerifierKey({
      verifierId: "loopgraph-verifier",
      keyId: "loopgraph-verifier.primary",
      revokedBy: "incident-commander",
      revocationRef: "incident:IR-9",
      revokedAt: "2026-08-21T12:05:00.000Z"
    });
    await expect(store.importReceipt(valid, importContext)).rejects.toThrow(/active trusted verifier key/);
  });
});
