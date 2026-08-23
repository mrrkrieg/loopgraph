import {
  generateKeyPairSync,
  sign,
  type JsonWebKey,
  type KeyObject
} from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import {
  WorkloadIdentityError,
  WorkloadIdentityVerifier,
  type WorkloadIdentityIssuer
} from "./workload-identity";

const NOW = new Date("2026-08-23T12:00:00.000Z").getTime();
const ISSUER = "https://identity.example";
const AUDIENCE = "https://loopgraph.example/marketplace";
const CAPABILITY = "marketplace.consume";

describe("workload identity JWKS rotation", () => {
  it("refreshes a still-fresh JWKS once when a rotated key ID appears", async () => {
    const first = rsaKey("key-a");
    const second = rsaKey("key-b");
    const fetcher = sequenceJwks([
      [first.jwk],
      [first.jwk, second.jwk]
    ]);
    const verifier = createVerifier(fetcher);

    await expect(verifier.verifyBearer(jwt(first), required())).resolves.toMatchObject({
      subject: "hermes:staging"
    });
    await expect(verifier.verifyBearer(jwt(second), required())).resolves.toMatchObject({
      subject: "hermes:staging"
    });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("recovers when an issuer rotates key material without changing the key ID", async () => {
    const first = rsaKey("shared-key");
    const second = rsaKey("shared-key");
    const fetcher = sequenceJwks([[first.jwk], [second.jwk]]);
    const verifier = createVerifier(fetcher);

    await verifier.verifyBearer(jwt(first), required());
    await expect(verifier.verifyBearer(jwt(second), required())).resolves.toMatchObject({
      credentialId: expect.stringMatching(/^wi_[a-f0-9]{32}$/)
    });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("deduplicates concurrent refreshes during a key rotation", async () => {
    const first = rsaKey("key-a");
    const second = rsaKey("key-b");
    let releaseRotation!: () => void;
    const rotationReady = new Promise<void>((resolve) => {
      releaseRotation = resolve;
    });
    let calls = 0;
    const fetcher = vi.fn(async () => {
      calls += 1;
      if (calls === 2) await rotationReady;
      return jwksResponse(calls === 1 ? [first.jwk] : [first.jwk, second.jwk]);
    });
    const verifier = createVerifier(fetcher);
    await verifier.verifyBearer(jwt(first), required());

    const attempts = [
      verifier.verifyBearer(jwt(second), required()),
      verifier.verifyBearer(jwt(second), required())
    ];
    await vi.waitFor(() => expect(fetcher).toHaveBeenCalledTimes(2));
    releaseRotation();

    await expect(Promise.all(attempts)).resolves.toHaveLength(2);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("rate-limits unknown key refreshes instead of amplifying attacker-controlled key IDs", async () => {
    const trusted = rsaKey("trusted-key");
    const unknownA = rsaKey("unknown-a");
    const unknownB = rsaKey("unknown-b");
    const fetcher = sequenceJwks([[trusted.jwk], [trusted.jwk]]);
    const verifier = createVerifier(fetcher);
    await verifier.verifyBearer(jwt(trusted), required());

    await expect(verifier.verifyBearer(jwt(unknownA), required())).rejects.toMatchObject({
      code: "signing_key_not_found"
    });
    await expect(verifier.verifyBearer(jwt(unknownB), required())).rejects.toMatchObject({
      code: "signing_key_not_found"
    });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("fails closed for malformed, oversized, or unavailable JWKS responses", async () => {
    const key = rsaKey("key-a");
    const malformed = createVerifier(vi.fn(async () => new Response("not-json", { status: 200 })));
    const oversized = createVerifier(vi.fn(async () => jwksResponse(
      Array.from({ length: 101 }, (_, index) => ({ ...key.jwk, kid: `key-${index}` }))
    )));
    const unavailable = createVerifier(vi.fn(async () => {
      throw new Error("network unavailable");
    }));

    await expect(malformed.verifyBearer(jwt(key), required())).rejects.toEqual(
      new WorkloadIdentityError("invalid_jwks")
    );
    await expect(oversized.verifyBearer(jwt(key), required())).rejects.toEqual(
      new WorkloadIdentityError("invalid_jwks")
    );
    await expect(unavailable.verifyBearer(jwt(key), required())).rejects.toEqual(
      new WorkloadIdentityError("jwks_unavailable")
    );
  });
});

function createVerifier(fetcher: typeof fetch) {
  return new WorkloadIdentityVerifier([issuerConfig()], fetcher, () => NOW);
}

function issuerConfig(): WorkloadIdentityIssuer {
  return {
    issuer: ISSUER,
    jwksUri: `${ISSUER}/.well-known/jwks.json`,
    audiences: [AUDIENCE],
    allowedSubjectPatterns: ["hermes:*"],
    requireTokenId: true
  };
}

function required() {
  return {
    capability: CAPABILITY,
    organizationId: "org-staging",
    projectKey: "main"
  };
}

function rsaKey(kid: string) {
  const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  return {
    kid,
    privateKey,
    jwk: {
      ...publicKey.export({ format: "jwk" }),
      kid,
      alg: "RS256",
      use: "sig"
    } as JsonWebKey & { kid: string; alg: string; use: string }
  };
}

function jwt(key: { kid: string; privateKey: KeyObject }) {
  const header = encode({ alg: "RS256", kid: key.kid, typ: "JWT" });
  const claims = encode({
    iss: ISSUER,
    sub: "hermes:staging",
    aud: AUDIENCE,
    exp: Math.floor(NOW / 1_000) + 300,
    iat: Math.floor(NOW / 1_000),
    jti: `request-${key.kid}`,
    capabilities: [CAPABILITY],
    organization_id: "org-staging",
    project_key: "main"
  });
  const content = `${header}.${claims}`;
  return `${content}.${sign("sha256", Buffer.from(content), key.privateKey).toString("base64url")}`;
}

function encode(value: unknown) {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}

function sequenceJwks(documents: JsonWebKey[][]) {
  let index = 0;
  return vi.fn(async () => {
    const keys = documents[Math.min(index, documents.length - 1)] ?? [];
    index += 1;
    return jwksResponse(keys);
  }) as unknown as typeof fetch;
}

function jwksResponse(keys: JsonWebKey[]) {
  return new Response(JSON.stringify({ keys }), {
    status: 200,
    headers: {
      "cache-control": "public, max-age=3600",
      "content-type": "application/json"
    }
  });
}
