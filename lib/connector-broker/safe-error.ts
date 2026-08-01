import "server-only";

import { redactSensitiveString } from "loopgraph/runtime";

export function safeConnectorError(error: unknown, fallback: string) {
  return redactSensitiveString(error instanceof Error ? error.message : fallback).slice(0, 512) || fallback;
}
