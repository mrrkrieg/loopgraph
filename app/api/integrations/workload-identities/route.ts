import { NextResponse } from "next/server";
import { z } from "zod";
import { workloadCapabilitySchema } from "loopgraph/core";
import { deriveWorkloadCredentialId } from "loopgraph/runtime";
import { HostedAccessError, requireHostedStepUp } from "@/lib/auth/hosted-access";
import {
  listWorkloadIdentities,
  revokeWorkloadIdentity,
  upsertWorkloadIdentityGrant
} from "@/lib/connector-broker/admin";
import { safeConnectorError } from "@/lib/connector-broker/safe-error";
import { getWorkspaceDatabase } from "@/lib/db/workspace-database";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const safeId = z.string().trim().min(3).max(256).regex(/^[A-Za-z0-9][A-Za-z0-9:._\/-]*$/);
const createSchema = z.object({
  issuer: z.string().url().max(512),
  subject: z.string().trim().min(3).max(512),
  audience: z.string().trim().min(3).max(512),
  environment: z.enum(["development", "staging", "production"]),
  workloadType: z.string().trim().min(2).max(96).regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/),
  capability: workloadCapabilitySchema,
  connectionId: safeId.optional(),
  expiresAt: z.string().datetime().optional(),
  confirmationKeyThumbprint: z.string().regex(/^[a-f0-9]{64}$/).optional(),
  reason: z.string().trim().min(3).max(1000)
}).strict().superRefine((input, context) => {
  if (input.environment !== "development" && new URL(input.issuer).protocol !== "https:") {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["issuer"], message: "Production and staging issuers must use HTTPS" });
  }
  if (input.expiresAt && Date.parse(input.expiresAt) <= Date.now()) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["expiresAt"], message: "Expiry must be in the future" });
  }
});

const revokeSchema = z.object({
  credentialId: safeId,
  reason: z.string().trim().min(3).max(1000)
}).strict();

export async function GET() {
  try {
    const database = await getWorkspaceDatabase("integrations.read");
    return NextResponse.json({
      schemaVersion: "workload-identity-admin/v1",
      identities: await listWorkloadIdentities(database)
    }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    return connectorError(error);
  }
}

export async function POST(request: Request) {
  try {
    const database = await getWorkspaceDatabase("workload_identities.manage");
    await requireHostedStepUp();
    const input = createSchema.parse(await request.json());
    const credentialId = deriveWorkloadCredentialId(input.issuer, input.subject);
    await upsertWorkloadIdentityGrant({ database, credentialId, ...input });
    return NextResponse.json({ accepted: true, credentialId }, { status: 201, headers: { "cache-control": "no-store" } });
  } catch (error) {
    return connectorError(error);
  }
}

export async function DELETE(request: Request) {
  try {
    const database = await getWorkspaceDatabase("workload_identities.manage");
    await requireHostedStepUp();
    const input = revokeSchema.parse(await request.json());
    await revokeWorkloadIdentity({ database, ...input });
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
    return NextResponse.json({ error: "Workload identity request is invalid", issues: error.issues }, { status: 400, headers: { "cache-control": "no-store" } });
  }
  return NextResponse.json({ error: safeConnectorError(error, "Workload identity administration failed") }, { status: 503, headers: { "cache-control": "no-store" } });
}
