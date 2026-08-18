import {
  cliRefreshTokenRequestSchema,
  rotateCliDeviceSession
} from "@/lib/auth/cli-device-authorization";
import {
  cliAuthorizationErrorResponse,
  cliAuthorizationResponse
} from "@/lib/auth/cli-device-api";
import { readBoundedMarketplaceJson } from "@/lib/app-platform/hosted-marketplace-api";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const input = cliRefreshTokenRequestSchema.parse(await readBoundedMarketplaceJson(request));
    return cliAuthorizationResponse(await rotateCliDeviceSession(input.refresh_token));
  } catch (error) {
    return cliAuthorizationErrorResponse(error);
  }
}
