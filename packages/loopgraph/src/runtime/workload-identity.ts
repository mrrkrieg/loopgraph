import { createHash, createPublicKey, verify as verifySignature, type JsonWebKey } from "node:crypto";
import { z } from "zod";

const workloadIdentityIssuerSchema = z.object({
  issuer: z.string().url(),
  jwksUri: z.string().url(),
  audiences: z.array(z.string().min(1)).min(1),
  allowedSubjectPatterns: z.array(z.string().min(1)).min(1),
  capabilityClaim: z.string().min(1).default("capabilities"),
  organizationClaim: z.string().min(1).default("organization_id"),
  projectClaim: z.string().min(1).default("project_key"),
  environmentClaim: z.string().min(1).default("environment"),
  workloadTypeClaim: z.string().min(1).default("workload_type"),
  defaultEnvironment: z.enum(["development", "staging", "production"]).optional(),
  requireTokenId: z.boolean().default(false)
});

const jwtHeaderSchema = z.object({
  alg: z.enum(["RS256", "ES256"]),
  kid: z.string().min(1),
  typ: z.string().optional()
});

const jwtClaimsSchema = z.object({
  iss: z.string().min(1),
  sub: z.string().min(1).max(512),
  aud: z.union([z.string(), z.array(z.string())]),
  exp: z.number().int(),
  nbf: z.number().int().optional(),
  iat: z.number().int().optional(),
  jti: z.string().min(1).max(256).optional()
}).passthrough();

export type WorkloadIdentityIssuer = z.input<typeof workloadIdentityIssuerSchema>;
type ParsedWorkloadIdentityIssuer = z.output<typeof workloadIdentityIssuerSchema>;
export type VerifiedWorkloadIdentity = {
  issuer: string;
  subject: string;
  audience: string[];
  credentialId: string;
  capabilities: string[];
  organizationId?: string;
  projectKey?: string;
  expiresAt: string;
  tokenId?: string;
  environment?: "development" | "staging" | "production";
  workloadType?: string;
  issuedAt: string;
  confirmationKey?: string;
};

type JwksDocument = { keys: Array<JsonWebKey & { kid?: string; alg?: string; use?: string }> };
type CachedJwks = { value: JwksDocument; expiresAt: number };
type ResolvedJwks = { cached: CachedJwks; fromCache: boolean };

const JWKS_ROTATION_REFRESH_COOLDOWN_MS = 30_000;
const MAX_JWKS_KEYS = 100;

export class WorkloadIdentityVerifier {
  private readonly jwks = new Map<string, CachedJwks>();
  private readonly jwksLoads = new Map<string, Promise<CachedJwks>>();
  private readonly lastRotationRefreshAt = new Map<string, number>();
  private readonly issuers: ParsedWorkloadIdentityIssuer[];

  constructor(
    issuers: WorkloadIdentityIssuer[],
    private readonly fetcher: typeof fetch = fetch,
    private readonly now: () => number = Date.now
  ) {
    this.issuers = z.array(workloadIdentityIssuerSchema).parse(issuers);
  }

  static fromEnvironment(value = process.env.LOOPGRAPH_WORKLOAD_IDENTITY_ISSUERS) {
    if (!value) return undefined;
    const parsed = z.array(workloadIdentityIssuerSchema).parse(JSON.parse(value));
    return new WorkloadIdentityVerifier(parsed);
  }

  async verifyBearer(token: string, required: {
    capability: string;
    organizationId?: string;
    projectKey?: string;
  }): Promise<VerifiedWorkloadIdentity> {
    const segments = token.split(".");
    if (segments.length !== 3) throw new WorkloadIdentityError("malformed_token");
    const header = jwtHeaderSchema.parse(parseSegment(segments[0]));
    const claims = jwtClaimsSchema.parse(parseSegment(segments[1]));
    const issuer = this.issuers.find((candidate) => candidate.issuer === claims.iss);
    if (!issuer) throw new WorkloadIdentityError("untrusted_issuer");
    const nowSeconds = Math.floor(this.now() / 1_000);
    if (
      claims.exp <= nowSeconds - 30 ||
      (claims.nbf !== undefined && claims.nbf > nowSeconds + 30) ||
      (claims.iat !== undefined && claims.iat > nowSeconds + 30)
    ) {
      throw new WorkloadIdentityError("expired_or_inactive_token");
    }
    if (issuer.requireTokenId && !claims.jti) throw new WorkloadIdentityError("token_id_required");
    const audiences = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
    if (!audiences.some((audience) => issuer.audiences.includes(audience))) {
      throw new WorkloadIdentityError("invalid_audience");
    }
    if (issuer.allowedSubjectPatterns.length > 0 && !issuer.allowedSubjectPatterns.some((pattern) => wildcardMatch(claims.sub, pattern))) {
      throw new WorkloadIdentityError("subject_not_allowed");
    }
    const signature = Buffer.from(segments[2], "base64url");
    const signedContent = Buffer.from(`${segments[0]}.${segments[1]}`);
    let key = await this.findKey(issuer, header.kid, header.alg);
    if (!verifyJwtSignature(header.alg, key, signedContent, signature)) {
      key = await this.findKey(issuer, header.kid, header.alg, { refreshForRotation: true });
      if (!verifyJwtSignature(header.alg, key, signedContent, signature)) {
        throw new WorkloadIdentityError("invalid_signature");
      }
    }

    const capabilities = stringList(claims[issuer.capabilityClaim] ?? claims.scope);
    if (!capabilities.includes(required.capability)) {
      throw new WorkloadIdentityError("capability_not_granted");
    }
    const organizationId = stringClaim(claims[issuer.organizationClaim]);
    const projectKey = stringClaim(claims[issuer.projectClaim]);
    const environmentValue = stringClaim(claims[issuer.environmentClaim]) ?? issuer.defaultEnvironment;
    const environment = environmentValue && ["development", "staging", "production"].includes(environmentValue)
      ? environmentValue as "development" | "staging" | "production"
      : undefined;
    const workloadType = stringClaim(claims[issuer.workloadTypeClaim]);
    const confirmation = claims.cnf && typeof claims.cnf === "object"
      ? claims.cnf as Record<string, unknown>
      : undefined;
    const confirmationClaim = stringClaim(confirmation?.["x5t#S256"]) ?? stringClaim(confirmation?.jkt);
    const confirmationKey = confirmationClaim ? normalizeConfirmationThumbprint(confirmationClaim) : undefined;
    if (required.organizationId && organizationId !== required.organizationId) {
      throw new WorkloadIdentityError("organization_scope_mismatch");
    }
    if (required.projectKey && projectKey !== required.projectKey) {
      throw new WorkloadIdentityError("project_scope_mismatch");
    }
    return {
      issuer: claims.iss,
      subject: claims.sub,
      audience: audiences,
      credentialId: deriveWorkloadCredentialId(claims.iss, claims.sub),
      capabilities,
      organizationId,
      projectKey,
      expiresAt: new Date(claims.exp * 1_000).toISOString(),
      tokenId: claims.jti,
      environment,
      workloadType,
      issuedAt: new Date((claims.iat ?? nowSeconds) * 1_000).toISOString(),
      confirmationKey
    };
  }

  private async findKey(
    issuer: ParsedWorkloadIdentityIssuer,
    kid: string,
    alg: string,
    options: { refreshForRotation?: boolean } = {}
  ): Promise<JsonWebKey> {
    let resolved = await this.resolveJwks(issuer);
    let keys = matchingKeys(resolved.cached.value, kid, alg);
    const shouldRefreshForRotation = options.refreshForRotation || (resolved.fromCache && keys.length === 0);
    const inFlightRefresh = shouldRefreshForRotation
      ? this.jwksLoads.get(issuer.jwksUri)
      : undefined;
    if (shouldRefreshForRotation && (inFlightRefresh || this.reserveRotationRefresh(issuer.jwksUri))) {
      resolved = {
        cached: await (inFlightRefresh ?? this.loadJwks(issuer, true)),
        fromCache: false
      };
      keys = matchingKeys(resolved.cached.value, kid, alg);
    }
    if (keys.length !== 1) throw new WorkloadIdentityError("signing_key_not_found");
    return keys[0];
  }

  private async resolveJwks(issuer: ParsedWorkloadIdentityIssuer): Promise<ResolvedJwks> {
    const cached = this.jwks.get(issuer.jwksUri);
    if (cached && cached.expiresAt > this.now()) return { cached, fromCache: true };
    return { cached: await this.loadJwks(issuer, false), fromCache: false };
  }

  private async loadJwks(issuer: ParsedWorkloadIdentityIssuer, force: boolean): Promise<CachedJwks> {
    if (!force) {
      const cached = this.jwks.get(issuer.jwksUri);
      if (cached && cached.expiresAt > this.now()) return cached;
    }
    const existing = this.jwksLoads.get(issuer.jwksUri);
    if (existing) return existing;
    const load = this.fetchJwks(issuer).finally(() => {
      this.jwksLoads.delete(issuer.jwksUri);
    });
    this.jwksLoads.set(issuer.jwksUri, load);
    return load;
  }

  private async fetchJwks(issuer: ParsedWorkloadIdentityIssuer): Promise<CachedJwks> {
    let response: Response;
    try {
      response = await this.fetcher(issuer.jwksUri, {
        headers: { accept: "application/json" },
        redirect: "error",
        signal: AbortSignal.timeout(10_000)
      });
    } catch {
      throw new WorkloadIdentityError("jwks_unavailable");
    }
    if (!response.ok) throw new WorkloadIdentityError("jwks_unavailable");
    let value: unknown;
    try {
      value = await response.json();
    } catch {
      throw new WorkloadIdentityError("invalid_jwks");
    }
    if (!isJwksDocument(value)) throw new WorkloadIdentityError("invalid_jwks");
    const cached = {
      value,
      expiresAt: this.now() + cacheMaxAge(response.headers.get("cache-control"))
    };
    this.jwks.set(issuer.jwksUri, cached);
    return cached;
  }

  private reserveRotationRefresh(jwksUri: string) {
    const now = this.now();
    const lastRefresh = this.lastRotationRefreshAt.get(jwksUri);
    if (lastRefresh !== undefined && now - lastRefresh < JWKS_ROTATION_REFRESH_COOLDOWN_MS) {
      return false;
    }
    this.lastRotationRefreshAt.set(jwksUri, now);
    return true;
  }
}

function matchingKeys(value: JwksDocument, kid: string, alg: string) {
  return value.keys.filter((candidate) =>
    candidate.kid === kid &&
    (!candidate.alg || candidate.alg === alg) &&
    (!candidate.use || candidate.use === "sig")
  );
}

function isJwksDocument(value: unknown): value is JwksDocument {
  if (!value || typeof value !== "object") return false;
  const keys = (value as { keys?: unknown }).keys;
  return Array.isArray(keys) && keys.length <= MAX_JWKS_KEYS && keys.every((key) =>
    Boolean(key) && typeof key === "object" && !Array.isArray(key)
  );
}

function verifyJwtSignature(
  alg: "RS256" | "ES256",
  key: JsonWebKey,
  signedContent: Buffer,
  signature: Buffer
) {
  try {
    return verifySignature(
      "sha256",
      signedContent,
      alg === "ES256"
        ? { key: createPublicKey({ key, format: "jwk" }), dsaEncoding: "ieee-p1363" }
        : createPublicKey({ key, format: "jwk" }),
      signature
    );
  } catch {
    throw new WorkloadIdentityError("invalid_jwks");
  }
}

export function deriveWorkloadCredentialId(issuer: string, subject: string) {
  return `wi_${createHash("sha256").update(`${issuer}|${subject}`).digest("hex").slice(0, 32)}`;
}

export class WorkloadIdentityError extends Error {
  constructor(readonly code: string) {
    super(`Workload identity denied: ${code}`);
    this.name = "WorkloadIdentityError";
  }
}

function parseSegment(segment: string) {
  try {
    return JSON.parse(Buffer.from(segment, "base64url").toString("utf8")) as unknown;
  } catch {
    throw new WorkloadIdentityError("malformed_token");
  }
}

function stringList(value: unknown): string[] {
  if (Array.isArray(value)) return value.filter((item): item is string => typeof item === "string");
  return typeof value === "string" ? value.split(/[ ,]+/).filter(Boolean) : [];
}

function stringClaim(value: unknown) {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function normalizeConfirmationThumbprint(value: string) {
  if (/^[a-f0-9]{64}$/i.test(value)) return value.toLowerCase();
  if (!/^[A-Za-z0-9_-]{43}$/.test(value)) throw new WorkloadIdentityError("invalid_confirmation_key");
  const bytes = Buffer.from(value, "base64url");
  if (bytes.byteLength !== 32) throw new WorkloadIdentityError("invalid_confirmation_key");
  return bytes.toString("hex");
}

function wildcardMatch(value: string, pattern: string) {
  const expression = pattern.split("*").map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join(".*");
  return new RegExp(`^${expression}$`).test(value);
}

function cacheMaxAge(header: string | null) {
  const match = /(?:^|,)\s*max-age=(\d+)/i.exec(header ?? "");
  const seconds = match ? Number(match[1]) : 300;
  // A provider may advertise a long cache lifetime, but a retired signing key must stop being
  // accepted within one bounded operational window. New-key misses still refresh immediately.
  return Math.min(Math.max(seconds, 30), 300) * 1_000;
}
