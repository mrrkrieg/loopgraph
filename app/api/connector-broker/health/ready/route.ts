import { NextResponse } from "next/server";
import { getConnectorBrokerRuntime } from "@/lib/connector-broker/runtime";

export const runtime = "nodejs";

export async function GET() {
  try {
    const runtimeState = getConnectorBrokerRuntime();
    const vault = await runtimeState.vault.healthCheck();
    if (vault.status !== "configured") {
      return NextResponse.json({ status: "not_ready", service: "hermes-connector-broker", vault }, {
        status: 503,
        headers: { "cache-control": "no-store" }
      });
    }
    return NextResponse.json({
      status: "ready",
      service: "hermes-connector-broker",
      vault
    }, { headers: { "cache-control": "no-store" } });
  } catch {
    return NextResponse.json({ status: "not_ready", service: "hermes-connector-broker" }, {
      status: 503,
      headers: { "cache-control": "no-store" }
    });
  }
}
