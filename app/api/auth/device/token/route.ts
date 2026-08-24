import {
  cliDeviceTokenRequestSchema,
  exchangeCliDeviceAuthorization
} from "@/lib/auth/cli-device-authorization";
import {
  cliAuthorizationErrorResponse,
  cliAuthorizationResponse
} from "@/lib/auth/cli-device-api";
import { readBoundedMarketplaceJson } from "@/lib/app-platform/hosted-marketplace-api";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const input = cliDeviceTokenRequestSchema.parse(await readBoundedMarketplaceJson(request));
    return cliAuthorizationResponse(await exchangeCliDeviceAuthorization(input.device_code));
  } catch (error) {
    return cliAuthorizationErrorResponse(error);
  }
}
