import { z } from "zod";
import { requireHostedPermission } from "@/lib/auth/hosted-access";
import { decideCliDeviceAuthorization } from "@/lib/auth/cli-device-authorization";
import {
  cliAuthorizationErrorResponse,
  cliAuthorizationResponse
} from "@/lib/auth/cli-device-api";
import { readBoundedMarketplaceJson } from "@/lib/app-platform/hosted-marketplace-api";

export const runtime = "nodejs";

const decisionSchema = z.object({
  user_code: z.string().min(8).max(16),
  decision: z.enum(["approve", "deny"])
}).strict();

export async function POST(request: Request) {
  try {
    const identity = await requireHostedPermission("workspace.read");
    if (!identity?.membership) throw new Error("Hosted identity is required");
    const input = decisionSchema.parse(await readBoundedMarketplaceJson(request));
    return cliAuthorizationResponse(await decideCliDeviceAuthorization({
      userCode: input.user_code,
      userId: identity.userId,
      organizationId: identity.membership.organizationId,
      approve: input.decision === "approve"
    }));
  } catch (error) {
    return cliAuthorizationErrorResponse(error);
  }
}
