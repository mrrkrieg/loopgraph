import { afterEach, describe, expect, it, vi } from "vitest";
import { emitOperationalLog, sanitizeMetadata } from "./operational-log";
import { assertSecretFree, redactSensitive, redactSensitiveString } from "loopgraph/runtime";

const CANARIES = [
  "Bearer canary-access-token-abcdefghijklmnopqrstuvwxyz",
  "ghp_CanaryGitHubToken12345678901234567890",
  ["sk", "live", "CanaryStripeKey1234567890"].join("_"),
  "xoxb-1234567890-canary-slack-token",
  "eyJhbGciOiJSUzI1NiJ9.eyJjYW5hcnkiOnRydWV9.c2lnbmF0dXJlY2FuYXJ5",
  "refresh_token=canary-refresh-token-value"
] as const;

describe("connector secret canary boundary", () => {
  afterEach(() => vi.restoreAllMocks());

  it("keeps credential-shaped canaries out of logs, metadata, public errors, and JSON", () => {
    const captured: string[] = [];
    vi.spyOn(console, "info").mockImplementation((value) => captured.push(String(value)));
    vi.spyOn(console, "warn").mockImplementation((value) => captured.push(String(value)));
    vi.spyOn(console, "error").mockImplementation((value) => captured.push(String(value)));

    for (const [index, canary] of CANARIES.entries()) {
      const value = { note: canary, nested: { value: `provider failed: ${canary}` } };
      const redacted = redactSensitive(value);
      expect(JSON.stringify(redacted)).not.toContain(canary);
      expect(redactSensitiveString(canary)).not.toContain(canary);
      expect(JSON.stringify(sanitizeMetadata(value))).not.toContain(canary);
      expect(() => assertSecretFree(value, `connector_canary_${index}`)).toThrowError(/Secret-like material was blocked/);
      try {
        assertSecretFree(value, `connector_canary_${index}`);
      } catch (error) {
        expect(String(error)).not.toContain(canary);
      }
      emitOperationalLog({
        level: "warn",
        event: "connector.canary.blocked",
        outcome: "denied",
        reason: canary,
        metadata: value
      });
    }

    const exported = captured.join("\n");
    for (const canary of CANARIES) expect(exported).not.toContain(canary);
  });
});
