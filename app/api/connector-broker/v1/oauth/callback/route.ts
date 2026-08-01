import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { getConnectorBrokerRuntime } from "@/lib/connector-broker/runtime";

export const runtime = "nodejs";

export async function GET(request: Request) {
  return handleConnectorOAuthCallback(request);
}

export async function handleConnectorOAuthCallback(request: Request, expectedProvider?: string) {
  const url = new URL(request.url);
  const state = url.searchParams.get("state") ?? "";
  const code = url.searchParams.get("code") ?? "";
  const providerError = url.searchParams.get("error");
  if (providerError || state.length < 32 || code.length < 2 || code.length > 16 * 1024) {
    return redirectResult("failed");
  }
  try {
    const runtime = getConnectorBrokerRuntime();
    const transaction = await runtime.store.findTransactionByStateHashGlobal(
      createHash("sha256").update(state).digest("hex")
    );
    if (!transaction || (expectedProvider && transaction.providerId !== expectedProvider)) return redirectResult("failed");
    const installation = await runtime.oauth.completeCallback({
      tenant: transaction.tenant,
      state,
      authorizationCode: code,
      actorId: "system:oauth-callback",
      correlationId: `oauth_callback_${transaction.id}`
    });
    return redirectResult("connected", installation.id);
  } catch {
    return redirectResult("failed");
  }
}

function redirectResult(status: "connected" | "failed", installationId?: string) {
  const base = process.env.LOOPGRAPH_APP_URL;
  if (!base) return NextResponse.json({ status }, { status: status === "connected" ? 200 : 400 });
  const target = new URL("/settings/integrations", base);
  target.searchParams.set("connector", status);
  if (installationId) target.searchParams.set("installation", installationId);
  return NextResponse.redirect(target, 303);
}
