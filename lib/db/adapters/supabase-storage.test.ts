import { afterEach, describe, expect, it, vi } from "vitest";
import { isSupabaseStorageEnabled } from "./supabase-storage";

describe("Supabase runtime storage boundary", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("requires an explicit tenant binding before enabling service-role persistence", () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://example.supabase.co");
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "service-role");
    vi.stubEnv("LOOPGRAPH_HOSTED_ORGANIZATION_ID", "");
    expect(isSupabaseStorageEnabled()).toBe(false);
    vi.stubEnv("LOOPGRAPH_HOSTED_ORGANIZATION_ID", "123e4567-e89b-12d3-a456-426614174000");
    expect(isSupabaseStorageEnabled()).toBe(true);
  });
});
