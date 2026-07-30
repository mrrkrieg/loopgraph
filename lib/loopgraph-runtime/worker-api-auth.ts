import { createHash, timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";

const WORKER_API_TOKEN_ENV = "LOOPGRAPH_WORKER_API_TOKEN";

export function authorizeWorkerApiRequest(request: Request): NextResponse | null {
  return authorizeBearerApiRequest(request, WORKER_API_TOKEN_ENV, "route-job HTTP API");
}

export function authorizeCronApiRequest(request: Request): NextResponse | null {
  return authorizeBearerApiRequest(request, "CRON_SECRET", "scheduled controller API");
}

export function authorizeBearerApiRequest(
  request: Request,
  environmentVariable: string,
  capability: string
): NextResponse | null {
  const configuredToken = process.env[environmentVariable];
  if (!configuredToken) {
    return NextResponse.json({
      error: `${environmentVariable} must be configured before the ${capability} can be used.`
    }, {
      status: 503,
      headers: {
        "cache-control": "no-store"
      }
    });
  }

  const authorization = request.headers.get("authorization");
  const suppliedToken = authorization?.startsWith("Bearer ")
    ? authorization.slice("Bearer ".length)
    : "";
  if (!constantTimeTokenEqual(suppliedToken, configuredToken)) {
    return NextResponse.json({ error: "Unauthorized" }, {
      status: 401,
      headers: {
        "cache-control": "no-store",
        "www-authenticate": "Bearer"
      }
    });
  }

  return null;
}

function constantTimeTokenEqual(supplied: string, configured: string): boolean {
  const suppliedDigest = createHash("sha256").update(supplied, "utf8").digest();
  const configuredDigest = createHash("sha256").update(configured, "utf8").digest();
  return timingSafeEqual(suppliedDigest, configuredDigest);
}
