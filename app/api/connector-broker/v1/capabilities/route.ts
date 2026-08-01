import { NextResponse } from "next/server";
import { providerIdSchema } from "loopgraph/core";
import { buildSignedCapabilityManifest, PROVIDER_ONBOARDING_CATALOG } from "loopgraph/runtime";
import { authorizeWorkerApiRequest } from "@/lib/loopgraph-runtime/worker-api-auth";
import { getConnectorCapabilityManifestSigningKey } from "@/lib/connector-broker/runtime";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const unauthorized = await authorizeWorkerApiRequest(request, "provider.connector_broker");
  if (unauthorized) return unauthorized;
  try {
    const provider = new URL(request.url).searchParams.get("provider");
    const selected = provider ? [providerIdSchema.parse(provider)] : PROVIDER_ONBOARDING_CATALOG.map((item) => item.providerId);
    const keyId = process.env.LOOPGRAPH_CONNECTOR_MANIFEST_SIGNING_KEY_ID?.trim();
    if (!keyId) throw new Error("Manifest signing key ID is not configured");
    const signingKey = await getConnectorCapabilityManifestSigningKey();
    let manifests;
    try {
      manifests = selected.map((providerId) => buildSignedCapabilityManifest({
        providerId,
        signingKey: signingKey.reveal(),
        keyId
      }));
    } finally {
      signingKey.dispose();
    }
    return NextResponse.json({ manifests }, { headers: { "cache-control": "private, max-age=60" } });
  } catch {
    return NextResponse.json({ error: "Connector capability manifest is unavailable" }, {
      status: 503,
      headers: { "cache-control": "no-store" }
    });
  }
}
