import { mkdir, open, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import {
  appIndependentVerificationReceiptSchema,
  appVerifierTrustKeySchema,
  type AppIndependentVerificationReceipt,
  type AppVerifierTrustKey
} from "../core";
import { verifyAppIndependentVerificationReceipt } from "./app-operational-maturity";

export const APP_VERIFICATION_REGISTRY_SCHEMA_VERSION = "loopgraph-app-verification-registry/v1alpha1" as const;

const appVerificationRegistrySchema = z.object({
  schemaVersion: z.literal(APP_VERIFICATION_REGISTRY_SCHEMA_VERSION),
  workspaceId: z.string().min(1),
  revision: z.number().int().nonnegative(),
  trustedVerifierKeys: z.array(appVerifierTrustKeySchema).default([]),
  receipts: z.array(appIndependentVerificationReceiptSchema).default([]),
  updatedAt: z.string().datetime()
}).strict();

export type AppVerificationRegistry = z.infer<typeof appVerificationRegistrySchema>;

export class FileAppVerificationStore {
  private readonly filePath: string;
  private readonly lockPath: string;

  constructor(appsRoot: string, private readonly workspaceId: string) {
    this.filePath = path.join(appsRoot, "operational-verification.json");
    this.lockPath = path.join(appsRoot, ".operational-verification.lock");
  }

  async read(): Promise<AppVerificationRegistry> {
    try {
      const registry = appVerificationRegistrySchema.parse(JSON.parse(await readFile(this.filePath, "utf8")));
      if (registry.workspaceId !== this.workspaceId) throw new Error("App verification registry belongs to another workspace");
      return registry;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      return {
        schemaVersion: APP_VERIFICATION_REGISTRY_SCHEMA_VERSION,
        workspaceId: this.workspaceId,
        revision: 0,
        trustedVerifierKeys: [],
        receipts: [],
        updatedAt: new Date(0).toISOString()
      };
    }
  }

  async trustVerifierKey(keyInput: AppVerifierTrustKey): Promise<AppVerificationRegistry> {
    const key = appVerifierTrustKeySchema.parse(keyInput);
    return this.update((registry) => {
      const existing = registry.trustedVerifierKeys.find((candidate) => candidate.verifierId === key.verifierId && candidate.keyId === key.keyId);
      if (existing && (existing.publicKey.trim() !== key.publicKey.trim() || existing.algorithm !== key.algorithm)) {
        throw new Error(`Verifier key identity conflict: ${key.verifierId}/${key.keyId}`);
      }
      const trustedVerifierKeys = existing
        ? registry.trustedVerifierKeys
        : [...registry.trustedVerifierKeys, key].sort(compareVerifierKeys);
      return { ...registry, trustedVerifierKeys, updatedAt: key.approvedAt };
    });
  }

  async revokeVerifierKey(input: {
    verifierId: string;
    keyId: string;
    revokedBy: string;
    revocationRef: string;
    revokedAt: string;
  }): Promise<AppVerificationRegistry> {
    return this.update((registry) => {
      const existing = registry.trustedVerifierKeys.find((candidate) => candidate.verifierId === input.verifierId && candidate.keyId === input.keyId);
      if (!existing) throw new Error(`Trusted verifier key not found: ${input.verifierId}/${input.keyId}`);
      const revoked = appVerifierTrustKeySchema.parse({ ...existing, ...input });
      return {
        ...registry,
        trustedVerifierKeys: registry.trustedVerifierKeys.map((candidate) =>
          candidate.verifierId === input.verifierId && candidate.keyId === input.keyId ? revoked : candidate),
        updatedAt: input.revokedAt
      };
    });
  }

  async importReceipt(receiptInput: AppIndependentVerificationReceipt): Promise<AppVerificationRegistry> {
    const receipt = appIndependentVerificationReceiptSchema.parse(receiptInput);
    return this.update((registry) => {
      const key = registry.trustedVerifierKeys.find((candidate) =>
        candidate.verifierId === receipt.verifierId && candidate.keyId === receipt.signature.keyId);
      if (!key || !verifyAppIndependentVerificationReceipt(receipt, key)) {
        throw new Error("Independent App verification receipt is not signed by an active trusted verifier key");
      }
      const existing = registry.receipts.find((candidate) => candidate.id === receipt.id);
      if (existing && existing.verificationDigest !== receipt.verificationDigest) {
        throw new Error(`Verification receipt identity conflict: ${receipt.id}`);
      }
      const receipts = existing ? registry.receipts : [...registry.receipts, receipt].sort((left, right) => left.verifiedAt.localeCompare(right.verifiedAt));
      return { ...registry, receipts, updatedAt: receipt.verifiedAt };
    });
  }

  private async update(operation: (registry: AppVerificationRegistry) => AppVerificationRegistry): Promise<AppVerificationRegistry> {
    await mkdir(path.dirname(this.filePath), { recursive: true, mode: 0o700 });
    const lock = await acquireLock(this.lockPath);
    try {
      const current = await this.read();
      const changed = operation(current);
      const next = appVerificationRegistrySchema.parse({ ...changed, revision: current.revision + 1 });
      await atomicWriteJson(this.filePath, next);
      return next;
    } finally {
      await lock.close();
      await rm(this.lockPath, { force: true });
    }
  }
}

function compareVerifierKeys(left: AppVerifierTrustKey, right: AppVerifierTrustKey): number {
  return `${left.verifierId}/${left.keyId}`.localeCompare(`${right.verifierId}/${right.keyId}`);
}

async function acquireLock(lockPath: string) {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    try {
      return await open(lockPath, "wx", 0o600);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      await new Promise((resolve) => setTimeout(resolve, Math.min(100, 5 + attempt * 2)));
    }
  }
  throw new Error("Timed out waiting for the App verification registry lock");
}

async function atomicWriteJson(filePath: string, value: unknown): Promise<void> {
  const temporaryPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  await rename(temporaryPath, filePath);
}
