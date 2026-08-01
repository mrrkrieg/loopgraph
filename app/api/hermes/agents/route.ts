import { NextResponse } from "next/server";
import { hermesAgentInstanceSchema } from "loopgraph/core";
import { getHermesOperationsStore } from "../../../../lib/loopgraph-runtime/storage-resolver";
import { verifyHermesMachineRequest } from "../../../../lib/loopgraph-runtime/hermes-machine-auth";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const verified = await verifyHermesMachineRequest(request, "hermes.agent_register");
  if (verified.response) return verified.response;
  try {
    const agent = hermesAgentInstanceSchema.parse(verified.body);
    const organizationId = process.env.LOOPGRAPH_HOSTED_ORGANIZATION_ID?.trim();
    if (organizationId && agent.organizationId !== organizationId) {
      return NextResponse.json({ error: "Agent organization does not match the hosted runtime" }, { status: 403 });
    }
    await getHermesOperationsStore().saveAgentInstance(agent);
    return NextResponse.json({ agent, registered: true }, { status: 201, headers: { "cache-control": "no-store" } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Agent registration failed" }, { status: 400 });
  }
}
