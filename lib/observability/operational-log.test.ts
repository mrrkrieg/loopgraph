import { afterEach, describe, expect, it, vi } from "vitest";
import { emitOperationalLog, sanitizeMetadata } from "./operational-log";

describe("structured operational logs", () => {
  afterEach(() => vi.restoreAllMocks());

  it("emits one structured line with correlation context", () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => undefined);
    emitOperationalLog({
      level: "info",
      event: "machine.request.authorized",
      outcome: "accepted",
      capability: "routing.worker",
      requestId: "request_12345678",
      correlationId: "request_12345678",
      durationMs: 12.4
    });

    expect(info).toHaveBeenCalledTimes(1);
    expect(JSON.parse(String(info.mock.calls[0]?.[0]))).toMatchObject({
      service: "loopgraph",
      level: "info",
      event: "machine.request.authorized",
      outcome: "accepted",
      capability: "routing.worker",
      requestId: "request_12345678",
      correlationId: "request_12345678",
      durationMs: 12
    });
  });

  it("drops sensitive and nested metadata instead of serializing arbitrary payloads", () => {
    expect(sanitizeMetadata({
      status: "ready",
      count: 4,
      authorization: "Bearer secret",
      accessToken: "secret",
      nested: { raw: "payload" }
    })).toEqual({
      status: "ready",
      count: 4
    });
  });
});
