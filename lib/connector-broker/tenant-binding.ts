import "server-only";

import { NextResponse } from "next/server";
import type { ConnectorTenant } from "loopgraph/core";
import { getHostedOrganizationId } from "@/lib/auth/hosted-config";

export function connectorTenantBoundaryResponse(tenant: ConnectorTenant) {
  const organizationId = getHostedOrganizationId();
  if (process.env.NODE_ENV === "production" && !organizationId) {
    return NextResponse.json({ error: "Connector broker tenant binding is not configured" }, {
      status: 503,
      headers: { "cache-control": "no-store" }
    });
  }
  const projectKey = process.env.LOOPGRAPH_HOSTED_PROJECT_KEY?.trim() || (organizationId ? "default" : undefined);
  if (
    (organizationId && tenant.organizationId !== organizationId) ||
    (projectKey && tenant.projectKey !== projectKey)
  ) {
    return NextResponse.json({ error: "Connector tenant scope mismatch" }, {
      status: 403,
      headers: { "cache-control": "no-store" }
    });
  }
  return null;
}

export function connectorWorkloadGrantHeaderResponse(request: Request, input: {
  installationId: string;
  capability: string;
}) {
  const connectionId = request.headers.get("x-loopgraph-connection-id");
  const capability = request.headers.get("x-loopgraph-provider-capability");
  if (connectionId === input.installationId && capability === input.capability) return null;
  return NextResponse.json({ error: "Connector workload grant headers do not match the invocation" }, {
    status: 403,
    headers: { "cache-control": "no-store" }
  });
}
