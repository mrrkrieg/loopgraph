import { generateKeyPairSync } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";
import { canonicalAppDigest } from "loopgraph/core";
import { createAppIndependentVerificationReceipt } from "loopgraph/runtime";
import { SupabaseAppVerificationStore } from "./supabase-app-verification-store";

const scope = {
  organizationId: "123e4567-e89b-12d3-a456-426614174000",
  projectKey: "main",
  workspaceId: "acme"
};
const now = "2026-08-21T12:00:00.000Z";

describe("Supabase App verification store", () => {
  it("rejects unsafe tenant and workspace scopes", () => {
    const client = { rpc: vi.fn(), from: vi.fn() } as unknown as SupabaseClient;
    expect(() => new SupabaseAppVerificationStore(client, { ...scope, organizationId: "../other" })).toThrow(/organization ID/);
    expect(() => new SupabaseAppVerificationStore(client, { ...scope, projectKey: "../../escape" })).toThrow(/project key/);
    expect(() => new SupabaseAppVerificationStore(client, { ...scope, workspaceId: "" })).toThrow(/workspace ID/);
  });

  it("persists only public trust material through bounded RPCs and invalidates revoked trust", async () => {
    const fake = new VerificationSupabase();
    const store = new SupabaseAppVerificationStore(fake.client, scope);
    const keys = generateKeyPairSync("ed25519", {
      publicKeyEncoding: { type: "spki", format: "pem" },
      privateKeyEncoding: { type: "pkcs8", format: "pem" }
    });
    const trust = {
      verifierId: "independent-auditor",
      keyId: "independent-auditor.primary",
      algorithm: "ed25519" as const,
      publicKey: keys.publicKey,
      approvedBy: "security-admin",
      approvalRef: "change:SEC-48",
      approvedAt: now
    };
    expect((await store.trustVerifierKey(trust)).trustedVerifierKeys).toEqual([trust]);

    const receipt = createAppIndependentVerificationReceipt({
      installationId: "install.product-learning",
      appId: "acme.product-learning",
      artifactDigest: canonicalAppDigest("product-learning-v1"),
      verifierId: trust.verifierId,
      verifierType: "accredited_third_party",
      status: "passed",
      evidenceRefs: ["audit:product-learning"],
      verifiedAt: now,
      keyId: trust.keyId,
      privateKeyPem: keys.privateKey
    });
    const imported = await store.importReceipt(receipt, {
      importedBy: "security-admin",
      importRef: "change:SEC-49",
      importedAt: now
    });
    expect(imported).toMatchObject({ revision: 2, receipts: [receipt] });
    expect(JSON.stringify(fake.rpc.mock.calls)).not.toContain(keys.privateKey);
    expect(fake.rpc).toHaveBeenCalledWith("import_loopgraph_app_verification_receipt", expect.objectContaining({
      p_imported_by: "security-admin",
      p_import_ref: "change:SEC-49"
    }));

    const revoked = await store.revokeVerifierKey({
      verifierId: trust.verifierId,
      keyId: trust.keyId,
      revokedBy: "incident-commander",
      revocationRef: "incident:IR-11",
      revokedAt: "2026-08-21T12:05:00.000Z"
    });
    expect(revoked.revision).toBe(3);
    expect(revoked.trustedVerifierKeys[0]).toMatchObject({ revokedBy: "incident-commander" });
    await expect(store.importReceipt(receipt, {
      importedBy: "security-admin",
      importRef: "change:SEC-50",
      importedAt: "2026-08-21T12:06:00.000Z"
    })).rejects.toThrow(/active trusted verifier key/);
  });
});

class VerificationSupabase {
  state: { revision: number; updated_at: string } | undefined;
  keys: unknown[] = [];
  receipts: unknown[] = [];
  rpc = vi.fn(async (name: string, args: Record<string, unknown>) => {
    if (name === "trust_loopgraph_app_verifier_key") this.keys.push(args.p_key);
    if (name === "import_loopgraph_app_verification_receipt") this.receipts.push(args.p_receipt);
    if (name === "revoke_loopgraph_app_verifier_key") {
      this.keys = this.keys.map((value) => {
        const key = value as Record<string, unknown>;
        return key.verifierId === args.p_verifier_id && key.keyId === args.p_key_id
          ? { ...key, revokedAt: args.p_revoked_at, revokedBy: args.p_revoked_by, revocationRef: args.p_revocation_ref }
          : key;
      });
    }
    this.state = { revision: (this.state?.revision ?? 0) + 1, updated_at: String(args.p_revoked_at ?? args.p_imported_at ?? now) };
    return { data: null, error: null };
  });

  client = {
    rpc: this.rpc,
    from: (table: string) => {
      const query = {
        select: () => query,
        eq: () => query,
        order: () => query,
        maybeSingle: async () => ({ data: table === "loopgraph_app_verification_registries" ? this.state : null, error: null }),
        range: async () => ({
          data: (table === "loopgraph_app_verifier_keys" ? this.keys : this.receipts).map((payload) => ({ payload })),
          error: null
        })
      };
      return query;
    }
  } as unknown as SupabaseClient;
}
