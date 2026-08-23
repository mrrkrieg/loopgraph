import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("hosted App snapshot bucket migration", () => {
  it("creates one private bounded archive bucket with an unoverrideable client deny", async () => {
    const sql = await readFile(
      "supabase/migrations/20260823003136_hosted_app_snapshots.sql",
      "utf8"
    );

    expect(sql).toContain("'loopgraph-app-snapshots'");
    expect(sql).toContain("public = false");
    expect(sql).toContain("104857600");
    expect(sql).toContain("array['application/json']::text[]");
    expect(sql).toMatch(
      /create\s+policy\s+"Loopgraph App snapshots deny client access"[\s\S]*?as\s+restrictive[\s\S]*?for\s+all[\s\S]*?to\s+public[\s\S]*?using\s*\(bucket_id\s*<>\s*'loopgraph-app-snapshots'\)[\s\S]*?with\s+check\s*\(bucket_id\s*<>\s*'loopgraph-app-snapshots'\)/i
    );
    expect(sql).toMatch(
      /drop\s+policy\s+if\s+exists\s+"Loopgraph App snapshots deny client access"/i
    );
    expect(sql).not.toMatch(/as\s+permissive/i);
  });
});
