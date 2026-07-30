import { NextResponse } from "next/server";
import {
  HostedAccessError,
  requireHostedPermission
} from "../../../../lib/auth/hosted-access";
import {
  exportSecurityAuditEvents,
  verifySecurityAuditChain
} from "../../../../lib/observability/operational-status";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const identity = await requireHostedPermission("audit.read");
    if (!identity?.membership) {
      return NextResponse.json({
        error: "Security audit export is available only in authenticated hosted mode."
      }, {
        status: 404,
        headers: { "cache-control": "no-store" }
      });
    }
    const url = new URL(request.url);
    const afterSequence = boundedInteger(url.searchParams.get("after"), 0, 0, Number.MAX_SAFE_INTEGER);
    const limit = boundedInteger(url.searchParams.get("limit"), 100, 1, 500);
    const [events, integrity] = await Promise.all([
      exportSecurityAuditEvents({
        organizationId: identity.membership.organizationId,
        afterSequence,
        limit
      }),
      verifySecurityAuditChain(identity.membership.organizationId)
    ]);
    const nextCursor = events.at(-1)?.sequence_number ?? afterSequence;
    return NextResponse.json({
      schemaVersion: "loopgraph-security-audit-export/v1",
      organizationId: identity.membership.organizationId,
      projectKey: process.env.LOOPGRAPH_HOSTED_PROJECT_KEY?.trim() || "default",
      exportedAt: new Date().toISOString(),
      afterSequence,
      nextCursor,
      hasMore: events.length === limit,
      integrity,
      events
    }, {
      status: integrity.valid ? 200 : 409,
      headers: { "cache-control": "no-store" }
    });
  } catch (error) {
    if (error instanceof HostedAccessError) {
      return NextResponse.json({ error: error.message, code: error.code }, {
        status: error.status,
        headers: { "cache-control": "no-store" }
      });
    }
    if (error instanceof InvalidAuditQueryError) {
      return NextResponse.json({ error: error.message }, {
        status: 400,
        headers: { "cache-control": "no-store" }
      });
    }
    return NextResponse.json({
      error: "Security audit export is unavailable."
    }, {
      status: 503,
      headers: { "cache-control": "no-store" }
    });
  }
}

function boundedInteger(
  value: string | null,
  fallback: number,
  minimum: number,
  maximum: number
) {
  if (value === null || value === "") return fallback;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new InvalidAuditQueryError(`Expected an integer from ${minimum} to ${maximum}.`);
  }
  return parsed;
}

class InvalidAuditQueryError extends Error {}
