import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

const migrationPath = path.join(
  process.cwd(),
  "supabase/migrations/202608170002_bounded_audit_retention_export.sql"
);

describe("bounded audit retention export migration", () => {
  it("binds every page to one fully verified immutable checkpoint", async () => {
    const sql = await readFile(migrationPath, "utf8");
    expect(sql).toContain("get_verified_security_audit_checkpoint");
    expect(sql).toContain("verify_security_audit_chain");
    expect(sql).toContain("p_through_sequence");
    expect(sql).toContain("audit.sequence_number <= greatest(p_through_sequence, 0)");
    expect(sql).toContain("audit retention checkpoint does not identify a tenant event");
    expect(sql).toContain("selected_hash <> verification.head_hash");
    expect(sql).toContain("audit retention checkpoint moved during verification");
  });

  it("keeps both retention RPCs service-role-only", async () => {
    const sql = await readFile(migrationPath, "utf8");
    expect(sql).toContain("security invoker");
    expect(sql).toContain("from public, anon, authenticated");
    expect(sql.match(/to service_role/g)).toHaveLength(2);
  });
});
