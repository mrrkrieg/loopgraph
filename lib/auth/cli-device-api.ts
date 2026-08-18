import "server-only";

import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { HostedAccessError } from "./hosted-access";
import { CliAuthorizationError } from "./cli-device-authorization";

export function cliAuthorizationResponse(payload: unknown, status = 200) {
  return NextResponse.json(payload, {
    status,
    headers: {
      "cache-control": "no-store",
      pragma: "no-cache"
    }
  });
}

export function cliAuthorizationErrorResponse(error: unknown) {
  if (error instanceof CliAuthorizationError) {
    const response = cliAuthorizationResponse({
      error: error.code,
      error_description: error.message
    }, error.status);
    if (error.retryAfter) response.headers.set("retry-after", String(error.retryAfter));
    return response;
  }
  if (error instanceof HostedAccessError) {
    return cliAuthorizationResponse({
      error: error.code,
      error_description: error.message
    }, error.status);
  }
  if (error instanceof ZodError) {
    return cliAuthorizationResponse({
      error: "invalid_request",
      error_description: "The CLI authorization request is invalid"
    }, 400);
  }
  return cliAuthorizationResponse({
    error: "temporarily_unavailable",
    error_description: "CLI authorization is temporarily unavailable"
  }, 503);
}
