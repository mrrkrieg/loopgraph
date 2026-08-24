import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const authorizeCronApiRequest = vi.hoisted(() => vi.fn());
const runScheduler = vi.hoisted(() => vi.fn());
const dispose = vi.hoisted(() => vi.fn());
const reveal = vi.hoisted(() => vi.fn(() => "a-secure-detector-signing-key-with-32-chars"));
const getWebhookReceiptSigningKey = vi.hoisted(() => vi.fn(async () => ({ reveal, dispose })));
const connectorRuntime = vi.hoisted(() => ({ store: { kind: "store" }, broker: { kind: "broker" } }));

vi.mock("loopgraph/runtime", () => ({
  AmbientWorkloadTokenProvider: class AmbientWorkloadTokenProvider {},
  HttpHermesProviderDetectorForwarder: class HttpHermesProviderDetectorForwarder {},
  ProviderDetectorScheduler: class ProviderDetectorScheduler {
    run = runScheduler;
  }
}));
vi.mock("@/lib/connector-broker/runtime", () => ({
  getConnectorBrokerRuntime: () => connectorRuntime,
  getWebhookReceiptSigningKey
}));
vi.mock("@/lib/loopgraph-runtime/worker-api-auth", () => ({ authorizeCronApiRequest }));

import { GET } from "./route";

describe("provider detector worker route", () => {
  const previousUrl = process.env.HERMES_WEBHOOK_URL;
  const previousAudience = process.env.LOOPGRAPH_HERMES_WEBHOOK_AUDIENCE;

  beforeEach(() => {
    vi.clearAllMocks();
    authorizeCronApiRequest.mockResolvedValue(null);
    runScheduler.mockResolvedValue({ claimed: 1, forwardedRuns: 1, emittedEvents: 2 });
    process.env.HERMES_WEBHOOK_URL = "https://hermes.example/events";
    process.env.LOOPGRAPH_HERMES_WEBHOOK_AUDIENCE = "https://hermes.example";
  });

  afterEach(() => {
    if (previousUrl === undefined) delete process.env.HERMES_WEBHOOK_URL;
    else process.env.HERMES_WEBHOOK_URL = previousUrl;
    if (previousAudience === undefined) delete process.env.LOOPGRAPH_HERMES_WEBHOOK_AUDIENCE;
    else process.env.LOOPGRAPH_HERMES_WEBHOOK_AUDIENCE = previousAudience;
  });

  it("uses a distinct scheduler capability, a five-minute-safe lease, and disposes the signing key", async () => {
    const response = await GET(new Request("https://loopgraph.example/api/connector-broker/v1/workers/provider-detectors"));
    expect(response.status).toBe(200);
    expect(authorizeCronApiRequest).toHaveBeenCalledWith(expect.any(Request), "schedule.connector_detectors");
    expect(runScheduler).toHaveBeenCalledWith({ limit: 5, leaseSeconds: 300 });
    expect(await response.json()).toMatchObject({ claimed: 1, emittedEvents: 2 });
    expect(dispose).toHaveBeenCalledTimes(1);
  });

  it("fails closed before resolving secrets when Hermes forwarding is unconfigured", async () => {
    delete process.env.HERMES_WEBHOOK_URL;
    const response = await GET(new Request("https://loopgraph.example/api/connector-broker/v1/workers/provider-detectors"));
    expect(response.status).toBe(503);
    expect(getWebhookReceiptSigningKey).not.toHaveBeenCalled();
  });
});
