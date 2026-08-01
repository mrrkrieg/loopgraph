import { NextResponse } from "next/server";
import { authorizeCronApiRequest } from "@/lib/loopgraph-runtime/worker-api-auth";
import { getConnectorBrokerRuntime } from "@/lib/connector-broker/runtime";

async function run(request: Request) {
  const unauthorized = await authorizeCronApiRequest(request, "schedule.connector_oauth");
  if (unauthorized) return unauthorized;
  try {
    return NextResponse.json(await getConnectorBrokerRuntime().oauth.refreshDue(50), {
      headers: { "cache-control": "no-store" }
    });
  } catch {
    return NextResponse.json({ error: "OAuth refresh worker failed" }, { status: 503 });
  }
}

export const GET = run;
export const POST = run;
