import { describe, expect, it } from "vitest";
import { validateHostedWorkloadIssuerRotationStaging } from "./validate-hosted-workload-issuer-rotation-staging";

const organizationId = "123e4567-e89b-42d3-a456-426614174000";
const projectKey = "main";
const issuer = "https://identity.test";
const audience = "https://staging.loopgraph.test/marketplace";
const previousKid = "issuer-key-a";
const nextKid = "issuer-key-b";
const now = new Date("2026-08-23T12:00:00.000Z");

describe("hosted workload issuer rotation staging validation", () => {
  it("proves overlap, cross-replica adoption, retirement, denial, and audit evidence", async () => {
    const previousToken = token(previousKid, "previous-token-id");
    const nextToken = token(nextKid, "next-token-id");
    const controllerToken = token("controller-key", "controller-token-id");
    const observabilityToken = token("observability-key", "observability-token-id");
    const harness = rotationHarness({ previousToken, nextToken });
    let request = 0;

    const receipt = await validateHostedWorkloadIssuerRotationStaging({
      primaryUrl: "https://staging.loopgraph.test",
      replicaUrl: "https://replica.loopgraph.test",
      audience,
      organizationId,
      projectKey,
      issuer,
      jwksUri: `${issuer}/.well-known/jwks.json`,
      controllerUrl: "https://rotation-controller.test/v1/issuer-rotation",
      rotationId: "staging-rotation-2026-08-23",
      previousKid,
      nextKid,
      maximumPropagationSeconds: 2,
      retirementCacheGraceSeconds: 301
    }, {
      previousToken,
      nextToken,
      controllerToken,
      observabilityToken
    }, {
      fetcher: harness.fetcher,
      now: () => now,
      requestId: () => `request-${++request}`,
      wait: async () => undefined
    });

    expect(receipt).toMatchObject({
      schemaVersion: "hosted-workload-issuer-rotation-staging-validation/v1",
      primaryOrigin: "https://staging.loopgraph.test",
      replicaOrigin: "https://replica.loopgraph.test",
      organizationId,
      projectKey,
      issuer,
      jwksUri: `${issuer}/.well-known/jwks.json`,
      rotation: {
        rotationId: "staging-rotation-2026-08-23",
        previousKid,
        nextKid,
        overlapReceiptDigest: expect.stringMatching(/^sha256:[a-f0-9]{64}$/),
        retirementReceiptDigest: expect.stringMatching(/^sha256:[a-f0-9]{64}$/)
      },
      auditEvidence: {
        afterSequence: 10,
        throughSequence: 11,
        headHash: "a".repeat(64),
        requestId: expect.stringMatching(/^issuer_final_primary_/)
      },
      checks: [
        { name: "pre_rotation_jwks", status: 200, ok: true },
        { name: "previous_key_cross_replica_acceptance", status: 200, ok: true },
        { name: "overlap_published", status: 200, ok: true },
        { name: "next_key_cross_replica_acceptance", status: 200, ok: true },
        { name: "previous_key_retired", status: 200, ok: true },
        { name: "previous_key_cross_replica_denial", status: 401, ok: true },
        { name: "next_key_post_retirement_acceptance", status: 200, ok: true },
        { name: "independent_audit_evidence", status: 200, ok: true }
      ]
    });
    const serialized = JSON.stringify(receipt);
    expect(serialized).not.toContain(previousToken);
    expect(serialized).not.toContain(nextToken);
    expect(serialized).not.toContain(controllerToken);
    expect(serialized).not.toContain(observabilityToken);
    expect(harness.controllerOperations).toEqual(["publish_overlap", "retire_previous"]);
  });

  it("fails if either deployed origin keeps accepting the retired key", async () => {
    const previousToken = token(previousKid, "previous-token-id");
    const nextToken = token(nextKid, "next-token-id");
    const harness = rotationHarness({
      previousToken,
      nextToken,
      acceptRetiredAtReplica: true
    });

    await expect(validateHostedWorkloadIssuerRotationStaging({
      primaryUrl: "https://staging.loopgraph.test",
      replicaUrl: "https://replica.loopgraph.test",
      audience,
      organizationId,
      projectKey,
      issuer,
      jwksUri: `${issuer}/.well-known/jwks.json`,
      controllerUrl: "https://rotation-controller.test/v1/issuer-rotation",
      rotationId: "staging-rotation-2026-08-23",
      previousKid,
      nextKid,
      maximumPropagationSeconds: 2,
      retirementCacheGraceSeconds: 301
    }, {
      previousToken,
      nextToken,
      controllerToken: token("controller-key", "controller-token-id"),
      observabilityToken: token("observability-key", "observability-token-id")
    }, {
      fetcher: harness.fetcher,
      now: () => now,
      requestId: (() => {
        let request = 0;
        return () => `request-${++request}`;
      })(),
      wait: async () => undefined
    })).rejects.toThrow(/Retired key at replica returned 200; expected 401/i);
  });
});

function rotationHarness(input: {
  previousToken: string;
  nextToken: string;
  acceptRetiredAtReplica?: boolean;
}) {
  let state: "initial" | "overlap" | "retired" = "initial";
  let acceptedAuditRequestId = "";
  const controllerOperations: string[] = [];
  const fetcher = async (resource: string | URL | Request, init?: RequestInit) => {
    const url = new URL(typeof resource === "string" || resource instanceof URL
      ? resource.toString()
      : resource.url);
    if (url.origin === issuer) {
      const kids = state === "initial"
        ? [previousKid]
        : state === "overlap" ? [previousKid, nextKid] : [nextKid];
      return json({
        keys: kids.map((kid) => ({ kid, alg: "RS256", use: "sig", kty: "RSA" }))
      });
    }
    if (url.origin === "https://rotation-controller.test") {
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      const operation = String(body.operation);
      controllerOperations.push(operation);
      state = operation === "publish_overlap" ? "overlap" : "retired";
      return json({
        schemaVersion: "loopgraph-issuer-rotation-controller-receipt/v1",
        receiptId: `receipt-${operation}`,
        rotationId: body.rotationId,
        issuer: body.issuer,
        operation,
        previousKid: body.previousKid,
        nextKid: body.nextKid,
        changed: true,
        completedAt: now.toISOString()
      });
    }
    if (url.pathname === "/api/operations/metrics") {
      return new Response("loopgraph_security_audit_head_sequence 10\n", { status: 200 });
    }
    if (url.pathname === "/api/operations/audit-export") {
      return json({
        schemaVersion: "loopgraph-security-audit-export/v2",
        organizationId,
        projectKey,
        afterSequence: 10,
        throughSequence: 11,
        nextCursor: 11,
        hasMore: false,
        integrity: {
          valid: true,
          eventsChecked: 1,
          headSequence: 11,
          currentHeadSequence: 11,
          headHash: "a".repeat(64)
        },
        events: [{
          event_type: "machine.request.authorized",
          capability: "marketplace.consume",
          request_id: acceptedAuditRequestId
        }]
      });
    }
    if (url.pathname === "/api/marketplace/client/catalog") {
      const headers = new Headers(init?.headers);
      const supplied = headers.get("authorization")?.replace(/^Bearer /, "");
      const isPrevious = supplied === input.previousToken;
      const isNext = supplied === input.nextToken;
      const acceptsRetiredAtReplica = input.acceptRetiredAtReplica === true &&
        url.origin === "https://replica.loopgraph.test";
      if (isPrevious && state === "retired" && !acceptsRetiredAtReplica) {
        return json({ error: "unauthorized" }, 401);
      }
      if (!isPrevious && !isNext) return json({ error: "unauthorized" }, 401);
      if (isNext && state === "initial") return json({ error: "unauthorized" }, 401);
      if (isNext && state === "retired" && url.origin === "https://staging.loopgraph.test") {
        acceptedAuditRequestId = headers.get("x-loopgraph-request-id") ?? "";
      }
      return json({
        schemaVersion: "hosted-marketplace-machine-search/v1",
        query: { limit: 1 },
        results: []
      });
    }
    throw new Error(`Unexpected staging request: ${url}`);
  };
  return { fetcher: fetcher as typeof fetch, controllerOperations };
}

function token(kid: string, tokenId: string) {
  const header = encode({ alg: "RS256", kid, typ: "JWT" });
  const claims = encode({
    iss: issuer,
    sub: "hermes:staging",
    aud: audience,
    exp: Math.floor(now.getTime() / 1_000) + 1_200,
    iat: Math.floor(now.getTime() / 1_000),
    jti: tokenId,
    capabilities: ["marketplace.consume"],
    organization_id: organizationId,
    project_key: projectKey
  });
  return `${header}.${claims}.${encode(`signature-${kid}-${tokenId}`)}`;
}

function encode(value: unknown) {
  return Buffer.from(typeof value === "string" ? value : JSON.stringify(value)).toString("base64url");
}

function json(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json" }
  });
}
