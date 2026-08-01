import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { verifyHermesExecutionPayload } from "loopgraph/runtime";
import {
  authorizeVerifiedHostedMachineRequest,
  type MachineCapability
} from "./worker-api-auth";

const MAX_BODY_BYTES = 1024 * 1024;

export async function verifyHermesMachineRequest(
  request: Request,
  capability: MachineCapability
): Promise<
  | { rawBody: string; body: unknown; response?: never }
  | { response: NextResponse; rawBody?: never; body?: never }
> {
  const secret = process.env.LOOPGRAPH_HERMES_EXECUTION_CALLBACK_SECRET ?? process.env.LOOPGRAPH_HERMES_EXECUTION_SECRET;
  if (!secret) {
    return { response: NextResponse.json({ error: "Hermes execution callback verification is not configured" }, { status: 503 }) };
  }
  const rawBody = await request.text();
  if (Buffer.byteLength(rawBody, "utf8") > MAX_BODY_BYTES) {
    return { response: NextResponse.json({ error: "Hermes request body exceeds 1 MiB" }, { status: 413 }) };
  }
  const timestamp = request.headers.get("x-hermes-timestamp") ?? "";
  const signature = request.headers.get("x-hermes-signature") ?? "";
  if (!verifyHermesExecutionPayload({ body: rawBody, timestamp, signature, secret })) {
    return { response: NextResponse.json({ error: "Invalid Hermes signature" }, { status: 401 }) };
  }
  let body: unknown;
  try {
    body = JSON.parse(rawBody);
  } catch {
    return { response: NextResponse.json({ error: "Hermes request body must be valid JSON" }, { status: 400 }) };
  }
  const requestId = request.headers.get("x-request-id") ?? readId(body);
  if (!requestId) {
    return { response: NextResponse.json({ error: "x-request-id is required" }, { status: 400 }) };
  }
  const authorization = await authorizeVerifiedHostedMachineRequest({
    capability,
    credentialEnvironmentVariable: "LOOPGRAPH_HERMES_EXECUTION_CREDENTIAL_ID",
    requestId,
    requestHash: createHash("sha256").update(rawBody).digest("hex"),
    requestedAt: new Date(Number(timestamp) * 1_000).toISOString(),
    rateLimit: positiveInteger(process.env.LOOPGRAPH_HERMES_EXECUTION_RATE_LIMIT_PER_MINUTE, 600)
  });
  if (authorization) return { response: authorization };
  return { rawBody, body };
}

function readId(body: unknown): string | undefined {
  if (!body || typeof body !== "object") return undefined;
  const record = body as Record<string, unknown>;
  const value = record.id ?? record.idempotencyKey;
  return typeof value === "string" && value.length >= 8 ? value : undefined;
}

function positiveInteger(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}
