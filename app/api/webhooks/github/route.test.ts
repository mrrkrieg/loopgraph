import { createHmac } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { POST } from "./route";

describe("GitHub webhook compatibility route", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("rejects direct provider webhooks when Hermes forwarding is not configured", async () => {
    const response = await POST(githubRequest({ body: { action: "opened" } }));

    expect(response.status).toBe(410);
    await expect(response.json()).resolves.toMatchObject({
      ok: false,
      error: expect.stringContaining("Configure this GitHub webhook to point at Hermes")
    });
  });

  it("forwards verified GitHub payloads to Hermes without executing a LoopSpec directly", async () => {
    vi.stubEnv("HERMES_WEBHOOK_URL", "https://hermes.local/webhooks/github");
    vi.stubEnv("GITHUB_WEBHOOK_SECRET", "secret_1");
    const fetchMock = vi.fn(async () => new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetchMock);
    const body = { action: "opened", issue: { number: 1, title: "Bug" } };
    const signature = `sha256=${createHmac("sha256", "secret_1").update(JSON.stringify(body)).digest("hex")}`;

    const response = await POST(githubRequest({ body, deliveryId: "delivery_1", event: "issues", signature }));

    expect(response.status).toBe(202);
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      forwardedToHermes: true,
      deliveryId: "delivery_1",
      hermesStatus: 204
    });
    expect(fetchMock).toHaveBeenCalledWith("https://hermes.local/webhooks/github", expect.objectContaining({
      method: "POST",
      body: JSON.stringify(body),
      headers: expect.objectContaining({
        "x-loopgraph-compat-source": "github",
        "x-loopgraph-source-route": "github.compat",
        "x-github-delivery": "delivery_1",
        "x-github-event": "issues"
      })
    }));
  });

  it("fails closed when forwarding is configured without a GitHub signing secret", async () => {
    vi.stubEnv("HERMES_WEBHOOK_URL", "https://hermes.local/webhooks/github");
    const fetchMock = vi.fn(async () => new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetchMock);

    const response = await POST(githubRequest({ body: { action: "opened" } }));

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({
      ok: false,
      error: expect.stringContaining("GITHUB_WEBHOOK_SECRET is required")
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("keeps GitHub signature validation on the compatibility forwarder", async () => {
    vi.stubEnv("GITHUB_WEBHOOK_SECRET", "secret_1");
    vi.stubEnv("HERMES_WEBHOOK_URL", "https://hermes.local/webhooks/github");
    const body = { action: "opened" };
    const response = await POST(githubRequest({
      body,
      signature: `sha256=${createHmac("sha256", "wrong").update(JSON.stringify(body)).digest("hex")}`
    }));

    expect(response.status).toBe(401);
  });

  it("rejects malformed GitHub signatures without forwarding to Hermes", async () => {
    vi.stubEnv("GITHUB_WEBHOOK_SECRET", "secret_1");
    vi.stubEnv("HERMES_WEBHOOK_URL", "https://hermes.local/webhooks/github");
    const fetchMock = vi.fn(async () => new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetchMock);

    const response = await POST(githubRequest({
      body: { action: "opened" },
      signature: "sha256=too-short"
    }));

    expect(response.status).toBe(401);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("fails closed in hosted mode when the durable provider guard is unavailable", async () => {
    vi.stubEnv("LOOPGRAPH_HERMES_WEBHOOK_URL", "https://hermes.local/webhooks/github");
    vi.stubEnv("GITHUB_WEBHOOK_SECRET", "secret_1");
    vi.stubEnv("LOOPGRAPH_HOSTED_MODE", "1");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://example.supabase.co");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "publishable");
    vi.stubEnv(
      "LOOPGRAPH_HOSTED_ORGANIZATION_ID",
      "123e4567-e89b-12d3-a456-426614174000"
    );
    vi.stubEnv("LOOPGRAPH_HOSTED_PROJECT_KEY", "main");
    vi.stubEnv("LOOPGRAPH_GITHUB_WEBHOOK_CREDENTIAL_ID", "github_forwarder");
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "");
    const fetchMock = vi.fn(async () => new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetchMock);
    const body = { action: "opened" };
    const signature =
      `sha256=${createHmac("sha256", "secret_1").update(JSON.stringify(body)).digest("hex")}`;

    const response = await POST(githubRequest({
      body,
      deliveryId: "delivery_hosted_1",
      signature
    }));

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({
      error: "Supabase service authorization is not configured."
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

function githubRequest(input: {
  body: Record<string, unknown>;
  deliveryId?: string;
  event?: string;
  signature?: string;
}): Request {
  return new Request("https://loopgraph.local/api/webhooks/github", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-github-delivery": input.deliveryId ?? "delivery_test",
      "x-github-event": input.event ?? "issues",
      ...(input.signature ? { "x-hub-signature-256": input.signature } : {})
    },
    body: JSON.stringify(input.body)
  });
}
