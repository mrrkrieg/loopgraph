import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import {
  canRoleMutateHostedApi,
  isMachineAuthenticatedRoute,
  isSameOriginRequest,
  isUnsafeMethod,
  selectHostedMembership
} from "@/lib/auth/middleware-policy";
import {
  HOSTED_ORGANIZATION_COOKIE,
  isHostedAuthRequired
} from "@/lib/auth/hosted-config";

const PUBLIC_PATHS = ["/sign-in", "/auth/callback"] as const;

export async function middleware(request: NextRequest) {
  const machineRoute = isMachineAuthenticatedRoute(request.nextUrl.pathname);
  if (
    isHostedAuthRequired() &&
    request.nextUrl.pathname.startsWith("/api/") &&
    !machineRoute &&
    isUnsafeMethod(request.method) &&
    !isSameOriginRequest(request.url, request.headers.get("origin"))
  ) {
    return secureResponse(NextResponse.json(
      { error: "Cross-origin mutation rejected" },
      { status: 403 }
    ));
  }

  let response = NextResponse.next({ request });
  if (!isHostedAuthRequired() || machineRoute) return secureResponse(response);

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const publishableKey =
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !publishableKey) return secureResponse(response);

  const supabase = createServerClient(url, publishableKey, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll(cookiesToSet: Array<{ name: string; value: string; options: CookieOptions }>) {
        for (const cookie of cookiesToSet) {
          request.cookies.set(cookie.name, cookie.value);
        }
        response = NextResponse.next({ request });
        for (const cookie of cookiesToSet) {
          response.cookies.set(cookie.name, cookie.value, cookie.options);
        }
      }
    }
  });
  const { data, error } = await supabase.auth.getClaims();
  const authenticated = !error && typeof data?.claims?.sub === "string";
  const publicPath = PUBLIC_PATHS.includes(
    request.nextUrl.pathname as (typeof PUBLIC_PATHS)[number]
  );

  if (!authenticated && !publicPath) {
    if (request.nextUrl.pathname.startsWith("/api/")) {
      return secureResponse(NextResponse.json(
        { error: "Authentication required" },
        { status: 401 }
      ));
    }
    const signInUrl = request.nextUrl.clone();
    signInUrl.pathname = "/sign-in";
    signInUrl.search = "";
    signInUrl.searchParams.set("next", `${request.nextUrl.pathname}${request.nextUrl.search}`);
    return secureResponse(NextResponse.redirect(signInUrl));
  }

  if (authenticated && !publicPath && request.nextUrl.pathname !== "/onboarding") {
    const { data: memberships } = await supabase
      .from("organization_memberships")
      .select("organization_id, role")
      .eq("user_id", data.claims.sub)
      .eq("status", "active");
    const selectedOrganizationId = request.cookies.get(HOSTED_ORGANIZATION_COOKIE)?.value;
    const membership = selectHostedMembership(memberships, selectedOrganizationId);
    if (!membership) {
      if (request.nextUrl.pathname.startsWith("/api/")) {
        return secureResponse(NextResponse.json(
          { error: "Organization membership required" },
          { status: 403 }
        ));
      }
      const onboardingUrl = request.nextUrl.clone();
      onboardingUrl.pathname = "/onboarding";
      onboardingUrl.search = "";
      return secureResponse(NextResponse.redirect(onboardingUrl));
    }
    if (
      request.nextUrl.pathname.startsWith("/api/") &&
      isUnsafeMethod(request.method) &&
      !canRoleMutateHostedApi(membership.role)
    ) {
      return secureResponse(NextResponse.json(
        { error: "This organization role is read-only" },
        { status: 403 }
      ));
    }
  }

  if (authenticated && request.nextUrl.pathname === "/sign-in") {
    const destination = request.nextUrl.clone();
    destination.pathname = safeNextPath(request.nextUrl.searchParams.get("next")) ?? "/";
    destination.search = "";
    return secureResponse(NextResponse.redirect(destination));
  }

  return secureResponse(response);
}

function safeNextPath(value: string | null): string | undefined {
  return value?.startsWith("/") && !value.startsWith("//") ? value : undefined;
}

function secureResponse(response: NextResponse) {
  response.headers.set("x-content-type-options", "nosniff");
  response.headers.set("x-frame-options", "DENY");
  response.headers.set("referrer-policy", "strict-origin-when-cross-origin");
  response.headers.set("permissions-policy", "camera=(), microphone=(), geolocation=()");
  if (process.env.VERCEL_ENV === "production") {
    response.headers.set("strict-transport-security", "max-age=31536000; includeSubDomains");
  }
  return response;
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)"
  ]
};
