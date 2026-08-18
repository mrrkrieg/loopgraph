import { describe, expect, it } from "vitest";
import {
  classifyUserApiQuota,
  parseUserApiQuotaDecision,
  quotaResponseHeaders,
  resolveUserApiQuotaPolicy
} from "./user-api-quota";

describe("hosted user API quotas", () => {
  it("assigns stable buckets that cannot be bypassed with resource IDs", () => {
    expect(classifyUserApiQuota("/api/loops/loop_a/run", "POST")).toBe("compute");
    expect(classifyUserApiQuota("/api/loops/loop_b/run", "POST")).toBe("compute");
    expect(classifyUserApiQuota("/api/discovery/session/session_a/recommend", "POST")).toBe("compute");
    expect(classifyUserApiQuota("/api/opportunities", "POST")).toBe("compute");
    expect(classifyUserApiQuota("/api/opportunities", "GET")).toBe("read");
    expect(classifyUserApiQuota("/api/outcomes/observed", "POST")).toBe("write");
    expect(classifyUserApiQuota("/api/integrations/install_1/rotate", "POST")).toBe("admin");
    expect(classifyUserApiQuota("/api/audit/export", "GET")).toBe("admin");
  });

  it("returns a server-owned bucket and skips preflight requests", () => {
    expect(resolveUserApiQuotaPolicy("/api/opportunities", "POST"))
      .toEqual({ bucket: "compute" });
    expect(resolveUserApiQuotaPolicy("/api/opportunities", "OPTIONS")).toBeUndefined();
    expect(resolveUserApiQuotaPolicy("/settings/integrations", "GET")).toBeUndefined();
  });

  it("accepts only complete database decisions and emits standard headers", () => {
    const decision = parseUserApiQuotaDecision([{
      allowed: false,
      reason: "rate_limited",
      retry_after_seconds: 17,
      remaining: 0,
      quota_limit: 30,
      reset_at: "2026-08-17T12:00:00.000Z"
    }]);
    expect(decision).toEqual({
      allowed: false,
      reason: "rate_limited",
      retryAfterSeconds: 17,
      remaining: 0,
      limit: 30,
      resetAt: "2026-08-17T12:00:00.000Z"
    });
    expect(quotaResponseHeaders(decision!)).toMatchObject({
      "cache-control": "no-store",
      "retry-after": "17",
      "x-ratelimit-limit": "30",
      "x-ratelimit-remaining": "0"
    });
    expect(parseUserApiQuotaDecision([{ allowed: true }])).toBeUndefined();
  });
});
