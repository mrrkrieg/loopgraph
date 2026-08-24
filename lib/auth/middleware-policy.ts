const MACHINE_ROUTE_PREFIXES = [
  "/api/controller",
  "/api/connector-broker/",
  "/api/cron/",
  "/api/graph/transactions",
  "/api/measurements",
  "/api/webhooks/"
] as const;

const MACHINE_ROUTE_PATHS = new Set([
  "/api/auth/device/code",
  "/api/auth/device/token",
  "/api/auth/device/refresh",
  "/api/auth/device/revoke",
  "/api/hermes/agents",
  "/api/hermes/design-dispatch/worker",
  "/api/hermes/design-callbacks/worker",
  "/api/hermes/executions/events",
  "/api/marketplace/client/artifacts",
  "/api/marketplace/client/catalog",
  "/api/marketplace/verifier/worker",
  "/api/operations/audit-export",
  "/api/operations/metrics",
  "/api/routing/worker"
]);

export function isMachineAuthenticatedRoute(pathname: string): boolean {
  if (MACHINE_ROUTE_PATHS.has(pathname)) return true;
  if (/^\/api\/hermes\/agents\/[^/]+\/heartbeat$/.test(pathname)) return true;
  if (/^\/api\/hermes\/design-tasks\/[^/]+\/callback$/.test(pathname)) return true;
  if (/^\/api\/routing\/jobs\/[^/]+$/.test(pathname)) return true;
  return MACHINE_ROUTE_PREFIXES.some((prefix) =>
    prefix.endsWith("/") ? pathname.startsWith(prefix) : pathname === prefix
  );
}

export function isUnsafeMethod(method: string): boolean {
  return !["GET", "HEAD", "OPTIONS"].includes(method.toUpperCase());
}

export function canRoleMutateHostedApi(role: unknown): boolean {
  return role === "operator" || role === "admin" || role === "owner";
}

export function isViewerSafeHostedMutation(pathname: string): boolean {
  return pathname === "/api/auth/device/approve";
}

export function selectHostedMembership<T extends { organization_id: string }>(
  memberships: T[] | null | undefined,
  selectedOrganizationId: string | undefined,
  requireExactMatch = false
): T | undefined {
  const exact = memberships?.find(
    (membership) => membership.organization_id === selectedOrganizationId
  );
  return exact ?? (requireExactMatch ? undefined : memberships?.[0]);
}

export function isSameOriginRequest(requestUrl: string, origin: string | null): boolean {
  if (!origin) return false;
  try {
    return new URL(origin).origin === new URL(requestUrl).origin;
  } catch {
    return false;
  }
}
