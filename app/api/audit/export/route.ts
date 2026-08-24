import { NextResponse } from "next/server";
import {
  HostedAccessError,
  requireHostedPermission
} from "../../../../lib/auth/hosted-access";
import {
  exportSecurityAuditEvents,
  getVerifiedSecurityAuditCheckpoint
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
    const requestedThrough = optionalBoundedInteger(
      url.searchParams.get("through"),
      0,
      Number.MAX_SAFE_INTEGER
    );
    const integrity = await getVerifiedSecurityAuditCheckpoint({
      organizationId: identity.membership.organizationId,
      ...(requestedThrough === undefined ? {} : { throughSequence: requestedThrough })
    });
    if (!integrity.valid) {
      return NextResponse.json({
        error: "Security audit chain verification failed.",
        integrity
      }, { status: 409, headers: { "cache-control": "no-store" } });
    }
    if (afterSequence > integrity.headSequence) {
      throw new InvalidAuditQueryError("after must not be greater than the verified audit checkpoint");
    }
    const events = await exportSecurityAuditEvents({
      organizationId: identity.membership.organizationId,
      afterSequence,
      throughSequence: integrity.headSequence,
      limit
    });
    const nextCursor = events.at(-1)?.sequence_number ?? afterSequence;
    return NextResponse.json({
      schemaVersion: "loopgraph-security-audit-export/v2",
      organizationId: identity.membership.organizationId,
      projectKey: process.env.LOOPGRAPH_HOSTED_PROJECT_KEY?.trim() || "default",
      exportedAt: new Date().toISOString(),
      afterSequence,
      throughSequence: integrity.headSequence,
      nextCursor,
      hasMore: nextCursor < integrity.headSequence,
      integrity,
      events
    }, {
      status: 200,
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

function optionalBoundedInteger(
  value: string | null,
  minimum: number,
  maximum: number
) {
  if (value === null || value === "") return undefined;
  return boundedInteger(value, minimum, minimum, maximum);
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
