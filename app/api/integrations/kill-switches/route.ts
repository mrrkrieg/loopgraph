import { NextResponse } from "next/server";
import { z } from "zod";
import { brokerCapabilitySchema, providerIdSchema } from "loopgraph/core";
import { HostedAccessError, requireHostedStepUp } from "@/lib/auth/hosted-access";
import {
  clearConnectorKillSwitch,
  listConnectorKillSwitches,
  setConnectorKillSwitch
} from "@/lib/connector-broker/admin";
import { safeConnectorError } from "@/lib/connector-broker/safe-error";
import { getWorkspaceDatabase } from "@/lib/db/workspace-database";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const scopeTypeSchema = z.enum(["organization", "environment", "provider", "connection", "capability", "loop", "agent"]);
const safeScopeValue = z.string().trim().min(1).max(512).regex(/^[A-Za-z0-9][A-Za-z0-9:._\/-]*$/);
const createSchema = z.object({
  scopeType: scopeTypeSchema,
  scopeValue: safeScopeValue,
  environment: z.enum(["development", "staging", "production"]).optional(),
  reason: z.string().trim().min(3).max(1000),
  expiresAt: z.string().datetime().optional()
}).strict().superRefine((input, context) => {
  if (input.scopeType === "provider" && !providerIdSchema.safeParse(input.scopeValue).success) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["scopeValue"], message: "Unknown provider" });
  }
  if (input.scopeType === "capability" && !brokerCapabilitySchema.safeParse(input.scopeValue).success) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["scopeValue"], message: "Unknown capability" });
  }
  if (input.scopeType === "environment" && input.scopeValue !== input.environment) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["scopeValue"], message: "Environment scope must match environment" });
  }
  if (input.expiresAt && Date.parse(input.expiresAt) <= Date.now()) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["expiresAt"], message: "Expiry must be in the future" });
  }
});

const clearSchema = z.object({
  id: z.string().uuid(),
  reason: z.string().trim().min(3).max(1000)
}).strict();

export async function GET() {
  try {
    const database = await getWorkspaceDatabase("integrations.read");
    return NextResponse.json({
      schemaVersion: "connector-kill-switch-admin/v1",
      killSwitches: await listConnectorKillSwitches(database)
    }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    return connectorError(error);
  }
}

export async function POST(request: Request) {
  try {
    const database = await getWorkspaceDatabase("credentials.revoke");
    await requireHostedStepUp();
    const input = createSchema.parse(await request.json());
    const id = await setConnectorKillSwitch({ database, ...input });
    return NextResponse.json({ accepted: true, id }, { status: 201, headers: { "cache-control": "no-store" } });
  } catch (error) {
    return connectorError(error);
  }
}

export async function DELETE(request: Request) {
  try {
    const database = await getWorkspaceDatabase("credentials.revoke");
    await requireHostedStepUp();
    const input = clearSchema.parse(await request.json());
    await clearConnectorKillSwitch({ database, ...input });
    return NextResponse.json({ accepted: true }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    return connectorError(error);
  }
}

function connectorError(error: unknown) {
  if (error instanceof HostedAccessError) {
    return NextResponse.json({ error: error.message, code: error.code }, { status: error.status, headers: { "cache-control": "no-store" } });
  }
  if (error instanceof z.ZodError) {
    return NextResponse.json({ error: "Kill-switch request is invalid", issues: error.issues }, { status: 400, headers: { "cache-control": "no-store" } });
  }
  return NextResponse.json({ error: safeConnectorError(error, "Kill-switch administration failed") }, { status: 503, headers: { "cache-control": "no-store" } });
}
