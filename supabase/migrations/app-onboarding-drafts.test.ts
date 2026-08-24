import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("hosted App onboarding draft migration", () => {
  it("backfills and bounds drafts in the tenant-scoped leased registry", async () => {
    const sql = await readFile("supabase/migrations/202608210012_app_onboarding_drafts.sql", "utf8");
    expect(sql).toContain("loopgraph_app_installation_registries");
    expect(sql).toContain("'onboardingDrafts'");
    expect(sql).toContain("loopgraph_app_onboarding_drafts_shape");
    expect(sql).toContain("jsonb_array_length(registry_payload->'onboardingDrafts') <= 50");
    expect(sql).toContain("pg_column_size(registry_payload->'onboardingDrafts') <= 1048576");
    expect(sql).not.toMatch(/grant\s+(?:insert|update|delete|all).*authenticated/i);
    expect(sql).not.toMatch(/access[_-]?token|refresh[_-]?token|client[_-]?secret/i);
  });
});
