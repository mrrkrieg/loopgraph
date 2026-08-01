import { NextResponse } from "next/server";
import { authorizeObservabilityApiRequest } from "../../../../lib/loopgraph-runtime/worker-api-auth";
import { exportSecurityAuditEvents, verifySecurityAuditChain } from "../../../../lib/observability/operational-status";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  const unauthorized = await authorizeObservabilityApiRequest(request);
  if (unauthorized) return unauthorized;
  const organizationId = process.env.LOOPGRAPH_HOSTED_ORGANIZATION_ID?.trim();
  if (!organizationId) return NextResponse.json({ error: "Hosted audit scope is unavailable." }, { status: 503 });
  try {
    const url = new URL(request.url);
    const afterSequence = boundedInteger(url.searchParams.get("after"), 0, 0, Number.MAX_SAFE_INTEGER);
    const limit = boundedInteger(url.searchParams.get("limit"), 100, 1, 500);
    const [events, integrity] = await Promise.all([
      exportSecurityAuditEvents({ organizationId, afterSequence, limit }),
      verifySecurityAuditChain(organizationId)
    ]);
    return NextResponse.json({
      schemaVersion: "loopgraph-security-audit-export/v1",
      organizationId,
      projectKey: process.env.LOOPGRAPH_HOSTED_PROJECT_KEY?.trim() || "default",
      exportedAt: new Date().toISOString(),
      afterSequence,
      nextCursor: events.at(-1)?.sequence_number ?? afterSequence,
      hasMore: events.length === limit,
      integrity,
      events
    }, {
      status: integrity.valid ? 200 : 409,
      headers: { "cache-control": "no-store" }
    });
  } catch (error) {
    if (error instanceof InvalidAuditQueryError) {
      return NextResponse.json({ error: error.message }, { status: 400, headers: { "cache-control": "no-store" } });
    }
    return NextResponse.json({ error: "Security audit export is unavailable." }, { status: 503, headers: { "cache-control": "no-store" } });
  }
}

function boundedInteger(value: string | null, fallback: number, minimum: number, maximum: number) {
  if (value === null || value === "") return fallback;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) throw new InvalidAuditQueryError(`Expected an integer from ${minimum} to ${maximum}.`);
  return parsed;
}

class InvalidAuditQueryError extends Error {}
