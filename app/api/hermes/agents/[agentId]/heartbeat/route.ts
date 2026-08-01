import { NextResponse } from "next/server";
import { hermesAgentStatusSchema } from "loopgraph/core";
import { getHermesOperationsStore } from "../../../../../../lib/loopgraph-runtime/storage-resolver";
import { verifyHermesMachineRequest } from "../../../../../../lib/loopgraph-runtime/hermes-machine-auth";

export const runtime = "nodejs";

export async function POST(request: Request, context: { params: Promise<{ agentId: string }> }) {
  const verified = await verifyHermesMachineRequest(request, "hermes.agent_heartbeat");
  if (verified.response) return verified.response;
  try {
    const body = recordValue(verified.body);
    const { agentId } = await context.params;
    if (body.id !== agentId) return NextResponse.json({ error: "Agent ID does not match route" }, { status: 400 });
    const store = getHermesOperationsStore();
    const existing = await store.getAgentInstance(agentId);
    if (!existing) return NextResponse.json({ error: "Hermes agent is not registered" }, { status: 404 });
    if (existing.status === "disabled") return NextResponse.json({ error: "Disabled agents cannot restore themselves" }, { status: 409 });
    if (body.workspaceId !== existing.workspaceId) return NextResponse.json({ error: "Agent workspace does not match registration" }, { status: 403 });
    const status = hermesAgentStatusSchema.parse(body.status ?? "online");
    if (status === "disabled") return NextResponse.json({ error: "Agent heartbeat cannot disable an agent" }, { status: 400 });
    const now = new Date().toISOString();
    const agent = {
      ...existing,
      status,
      ...(typeof body.runtimeVersion === "string" && body.runtimeVersion.trim()
        ? { runtimeVersion: body.runtimeVersion.trim().slice(0, 100) }
        : {}),
      lastHeartbeatAt: now,
      updatedAt: now
    };
    await store.saveAgentInstance(agent);
    return NextResponse.json({ agent, heartbeatAccepted: true }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Agent heartbeat failed" }, { status: 400 });
  }
}

function recordValue(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Heartbeat body must be an object");
  return value as Record<string, unknown>;
}
