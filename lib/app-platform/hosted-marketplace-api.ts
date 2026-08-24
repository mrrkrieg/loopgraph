import "server-only";

import { NextResponse } from "next/server";
import { z } from "zod";
import { HostedAccessError, type HostedPermission, requireHostedPermission } from "@/lib/auth/hosted-access";
import { createSupabaseAdminClient } from "@/lib/db/supabase-admin";
import { createSupabaseServerClient } from "@/lib/db/supabase-server";
import { HostedMarketplaceArtifactError } from "./hosted-marketplace-artifacts";

const MAX_MARKETPLACE_REQUEST_BYTES = 5 * 1024 * 1024;

export async function requireHostedMarketplaceContext(permission: HostedPermission) {
  const identity = await requireHostedPermission(permission);
  if (!identity?.membership) {
    throw new HostedMarketplaceApiError(
      "hosted_marketplace_required",
      "The hosted marketplace requires an authenticated organization.",
      409
    );
  }
  const userClient = await createSupabaseServerClient();
  const adminClient = createSupabaseAdminClient();
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!userClient || !adminClient || !supabaseUrl) {
    throw new HostedMarketplaceApiError(
      "marketplace_unavailable",
      "Hosted marketplace storage is not configured.",
      503
    );
  }
  return {
    identity,
    organizationId: identity.membership.organizationId,
    userClient,
    adminClient,
    supabaseUrl
  };
}

export async function readBoundedMarketplaceJson(request: Request) {
  const declaredLength = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(declaredLength) && declaredLength > MAX_MARKETPLACE_REQUEST_BYTES) {
    throw new HostedMarketplaceApiError(
      "request_too_large",
      "Marketplace requests may not exceed 5 MiB.",
      413
    );
  }
  const text = await request.text();
  if (Buffer.byteLength(text, "utf8") > MAX_MARKETPLACE_REQUEST_BYTES) {
    throw new HostedMarketplaceApiError(
      "request_too_large",
      "Marketplace requests may not exceed 5 MiB.",
      413
    );
  }
  return JSON.parse(text) as unknown;
}

export function hostedMarketplaceError(error: unknown) {
  if (error instanceof HostedAccessError) {
    return NextResponse.json(
      { error: error.message, code: error.code },
      { status: error.status, headers: { "cache-control": "no-store" } }
    );
  }
  if (error instanceof HostedMarketplaceApiError) {
    return NextResponse.json(
      { error: error.message, code: error.code },
      { status: error.status, headers: { "cache-control": "no-store" } }
    );
  }
  if (error instanceof HostedMarketplaceArtifactError) {
    const status = error.code === "release_not_visible"
      ? 404
      : error.code.startsWith("invalid_")
        ? 400
        : error.code === "artifact_upload_incomplete" ||
            error.code === "release_identity_mismatch"
          ? 409
          : 503;
    return NextResponse.json(
      { error: error.message, code: error.code },
      { status, headers: { "cache-control": "no-store" } }
    );
  }
  if (error instanceof z.ZodError || error instanceof SyntaxError) {
    return NextResponse.json(
      { error: "Marketplace request is invalid", code: "invalid_request" },
      { status: 400, headers: { "cache-control": "no-store" } }
    );
  }
  return NextResponse.json(
    { error: "Hosted marketplace operation is unavailable", code: "marketplace_unavailable" },
    { status: 503, headers: { "cache-control": "no-store" } }
  );
}

export class HostedMarketplaceApiError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status: 409 | 413 | 503
  ) {
    super(message);
    this.name = "HostedMarketplaceApiError";
  }
}
