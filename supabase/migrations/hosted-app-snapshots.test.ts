import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("hosted App snapshot bucket migration", () => {
  it("creates one private bounded service-role-only archive bucket", async () => {
    const sql = await readFile(
      "supabase/migrations/20260823003136_hosted_app_snapshots.sql",
      "utf8"
    );

    expect(sql).toContain("'loopgraph-app-snapshots'");
    expect(sql).toContain("public = false");
    expect(sql).toContain("104857600");
    expect(sql).toContain("array['application/json']::text[]");
    expect(sql).toContain("must remain service-role-only and policy-free");
    expect(sql).not.toMatch(/create\s+policy/i);
    expect(sql).not.toMatch(/to\s+(anon|authenticated)/i);
  });
});
