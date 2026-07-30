import { NextResponse } from "next/server";
import { authorizeObservabilityApiRequest } from "../../../../lib/loopgraph-runtime/worker-api-auth";
import {
  formatPrometheusMetrics,
  getOperationalReadiness
} from "../../../../lib/observability/operational-status";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  const unauthorized = await authorizeObservabilityApiRequest(request);
  if (unauthorized) return unauthorized;
  const readiness = await getOperationalReadiness();
  return new NextResponse(formatPrometheusMetrics(readiness), {
    status: readiness.ready ? 200 : 503,
    headers: {
      "cache-control": "no-store",
      "content-type": "text/plain; version=0.0.4; charset=utf-8"
    }
  });
}
