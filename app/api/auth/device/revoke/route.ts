import {
  cliRevokeTokenRequestSchema,
  revokeCliDeviceSession
} from "@/lib/auth/cli-device-authorization";
import {
  cliAuthorizationErrorResponse
} from "@/lib/auth/cli-device-api";
import { readBoundedMarketplaceJson } from "@/lib/app-platform/hosted-marketplace-api";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const input = cliRevokeTokenRequestSchema.parse(await readBoundedMarketplaceJson(request));
    await revokeCliDeviceSession(input.token);
    return new Response(null, {
      status: 204,
      headers: { "cache-control": "no-store", pragma: "no-cache" }
    });
  } catch (error) {
    return cliAuthorizationErrorResponse(error);
  }
}
