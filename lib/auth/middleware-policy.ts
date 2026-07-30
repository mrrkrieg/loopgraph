const MACHINE_ROUTE_PREFIXES = [
  "/api/controller",
  "/api/cron/",
  "/api/graph/transactions",
  "/api/measurements",
  "/api/operations/metrics",
  "/api/webhooks/"
] as const;

export function isMachineAuthenticatedRoute(pathname: string): boolean {
  if (/^\/api\/hermes\/design-tasks\/[^/]+\/callback$/.test(pathname)) {
    return true;
  }
  if (pathname === "/api/routing/worker" || /^\/api\/routing\/jobs\/[^/]+$/.test(pathname)) {
    return true;
  }
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
