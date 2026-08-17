import { describe, expect, it, vi } from "vitest";
import { validateStagingDeployment } from "./validate-staging";

const token = `observability.${"a".repeat(40)}.token`;

describe("staging deployment validation", () => {
  it("uses fresh workload request metadata and emits a body-free receipt", async () => {
    const fetcher = vi.fn(async (input: URL | RequestInfo, init?: RequestInit) => {
      const url = new URL(input instanceof URL ? input : String(input));
      if (url.pathname === "/api/health/ready") {
        expect(new Headers(init?.headers).has("authorization")).toBe(false);
        return json({ status: "ready" });
      }
      const headers = new Headers(init?.headers);
      expect(headers.get("authorization")).toBe(`Bearer ${token}`);
      expect(headers.get("x-loopgraph-organization-id")).toBe(
        "123e4567-e89b-42d3-a456-426614174000"
      );
      expect(headers.get("x-loopgraph-project-key")).toBe("main");
      expect(headers.get("x-loopgraph-request-id")).toMatch(/^staging_/);
      if (url.pathname === "/api/operations/metrics") {
        return new Response([
          "loopgraph_ready 1",
          "loopgraph_security_audit_head_sequence 42"
        ].join("\n"));
      }
      return json({
        integrity: {
          valid: true,
          headSequence: 43,
          headHash: "a".repeat(64)
        },
        events: [{ secret: "not-in-receipt" }]
      });
    });

    const receipt = await validateStagingDeployment({
      baseUrl: "https://staging.loopgraph.test",
      organizationId: "123e4567-e89b-42d3-a456-426614174000",
      projectKey: "main",
      observabilityToken: token
    }, {
      fetcher: fetcher as typeof fetch,
      requestId: () => "123e4567-e89b-42d3-a456-426614174999",
      now: () => new Date("2026-08-17T00:00:00.000Z")
    });

    expect(receipt).toMatchObject({
      schemaVersion: "staging-validation/v3",
      targetOrigin: "https://staging.loopgraph.test",
      organizationId: "123e4567-e89b-42d3-a456-426614174000",
      projectKey: "main",
      auditCheckpoint: { headSequence: 43, headHash: "a".repeat(64) },
      results: [
        { name: "readiness", ok: true },
        { name: "operational_metrics", ok: true },
        { name: "audit_integrity", ok: true }
      ]
    });
    expect(JSON.stringify(receipt)).not.toContain(token);
    expect(JSON.stringify(receipt)).not.toContain("not-in-receipt");
  });

  it("rejects insecure origins before making a request", async () => {
    const fetcher = vi.fn();
    await expect(validateStagingDeployment({
      baseUrl: "http://staging.loopgraph.test",
      organizationId: "123e4567-e89b-42d3-a456-426614174000",
      projectKey: "main",
      observabilityToken: token
    }, { fetcher: fetcher as typeof fetch })).rejects.toThrow(/must use HTTPS/i);
    expect(fetcher).not.toHaveBeenCalled();
  });
});

function json(body: unknown) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" }
  });
}
