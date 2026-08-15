import { NextResponse } from "next/server";
import { z } from "zod";
import { HostedAccessError, requireHostedStepUp } from "@/lib/auth/hosted-access";
import {
  controlProviderDetectorSchedule,
  ProviderDetectorControlError
} from "@/lib/connector-broker/admin";
import { safeConnectorError } from "@/lib/connector-broker/safe-error";
import { getWorkspaceDatabase } from "@/lib/db/workspace-database";

export const runtime = "nodejs";

const scheduleIdSchema = z.string().regex(/^provider_detector_[a-f0-9]{32}$/);
const inputSchema = z.object({
  action: z.enum(["pause", "resume", "run_now", "retry_now"]),
  reason: z.string().trim().min(3).max(1000)
}).strict();

export async function POST(
  request: Request,
  context: { params: Promise<{ scheduleId: string }> }
) {
  try {
    const scheduleId = scheduleIdSchema.parse((await context.params).scheduleId);
    const database = await getWorkspaceDatabase("integrations.manage");
    await requireHostedStepUp();
    const input = inputSchema.parse(await request.json());
    const result = await controlProviderDetectorSchedule({ database, scheduleId, ...input });
    return NextResponse.json({
      schemaVersion: "provider-detector-control/v1",
      ...result
    }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    if (error instanceof HostedAccessError) {
      return NextResponse.json({ error: error.message, code: error.code }, {
        status: error.status,
        headers: { "cache-control": "no-store" }
      });
    }
    if (error instanceof ProviderDetectorControlError) {
      return NextResponse.json({ error: error.message, code: error.code }, {
        status: error.status,
        headers: { "cache-control": "no-store" }
      });
    }
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: "Detector control request is invalid", issues: error.issues }, {
        status: 400,
        headers: { "cache-control": "no-store" }
      });
    }
    return NextResponse.json({ error: safeConnectorError(error, "Detector control failed") }, {
      status: 503,
      headers: { "cache-control": "no-store" }
    });
  }
}
