import { NextResponse } from "next/server";
import {
  listHermesDiscoverySessions,
  startHermesDiscoverySession
} from "loopgraph/runtime";
import { getActiveLoopgraphProjectRoot } from "../../../../lib/loopgraph-runtime/storage-resolver";
import type { DiscoveryActor } from "loopgraph/runtime";

export async function GET() {
  return NextResponse.json(await listHermesDiscoverySessions(getActiveLoopgraphProjectRoot()));
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const session = await startHermesDiscoverySession({
    projectRoot: getActiveLoopgraphProjectRoot(),
    sessionId: stringValue(body, "sessionId") ?? stringValue(body, "id"),
    companyId: stringValue(body, "companyId"),
    companyName: stringValue(body, "companyName") ?? nestedStringValue(body, "companyProfile", "name"),
    createdByActor: discoveryActorValue(body, "createdByActor") ?? "api"
  });
  return NextResponse.json(session, { status: 201 });
}

function stringValue(value: unknown, key: string): string | undefined {
  if (!isRecord(value)) return undefined;
  const item = value[key];
  return typeof item === "string" && item.trim().length > 0 ? item : undefined;
}

function nestedStringValue(value: unknown, objectKey: string, key: string): string | undefined {
  if (!isRecord(value) || !isRecord(value[objectKey])) return undefined;
  return stringValue(value[objectKey], key);
}

function discoveryActorValue(value: unknown, key: string): DiscoveryActor | undefined {
  const item = stringValue(value, key);
  return item === "browser" || item === "hermes" || item === "cli" || item === "api" ? item : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}
