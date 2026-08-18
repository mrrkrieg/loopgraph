import { NextResponse } from "next/server";
import { z } from "zod";
import { readBoundedMarketplaceJson } from "@/lib/app-platform/hosted-marketplace-api";
import { HostedAccessError, requireHostedStepUp } from "@/lib/auth/hosted-access";
import {
  listCliAccessSessions,
  revokeCliAccessSessions
} from "@/lib/auth/cli-session-admin";
import { safeConnectorError } from "@/lib/connector-broker/safe-error";
import { getWorkspaceDatabase } from "@/lib/db/workspace-database";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const pageSchema = z.object({
  offset: z.coerce.number().int().min(0).max(10_000).default(0),
  limit: z.coerce.number().int().min(1).max(100).default(50)
}).strict();

const revokeSchema = z.object({
  scope: z.enum(["session", "user", "organization"]),
  sessionId: z.string().uuid().optional(),
  targetUserId: z.string().uuid().optional(),
  reason: z.string().trim().min(3).max(1000)
}).strict().superRefine((input, context) => {
  const valid = input.scope === "session"
    ? Boolean(input.sessionId) && !input.targetUserId
    : input.scope === "user"
      ? Boolean(input.targetUserId) && !input.sessionId
      : !input.sessionId && !input.targetUserId;
  if (!valid) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["scope"],
      message: "Revocation scope and target do not match"
    });
  }
});

export async function GET(request: Request) {
  try {
    const database = await getWorkspaceDatabase("credentials.revoke");
    const url = new URL(request.url);
    const page = pageSchema.parse({
      offset: url.searchParams.get("offset") ?? undefined,
      limit: url.searchParams.get("limit") ?? undefined
    });
    return NextResponse.json({
      schemaVersion: "cli-session-admin/v1",
      ...await listCliAccessSessions(database, page)
    }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    return adminError(error);
  }
}

export async function DELETE(request: Request) {
  try {
    const database = await getWorkspaceDatabase("credentials.revoke");
    await requireHostedStepUp();
    const input = revokeSchema.parse(await readBoundedMarketplaceJson(request));
    const receipt = await revokeCliAccessSessions({ database, ...input });
    return NextResponse.json({
      schemaVersion: "cli-session-revocation/v1",
      accepted: true,
      ...receipt
    }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    return adminError(error);
  }
}

function adminError(error: unknown) {
  if (error instanceof HostedAccessError) {
    return NextResponse.json(
      { error: error.message, code: error.code },
      { status: error.status, headers: { "cache-control": "no-store" } }
    );
  }
  if (error instanceof z.ZodError) {
    return NextResponse.json(
      { error: "CLI session administration request is invalid", issues: error.issues },
      { status: 400, headers: { "cache-control": "no-store" } }
    );
  }
  return NextResponse.json(
    { error: safeConnectorError(error, "CLI session administration failed") },
    { status: 503, headers: { "cache-control": "no-store" } }
  );
}
