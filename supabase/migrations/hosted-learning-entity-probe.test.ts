import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("hosted learning/entity active probe migration", () => {
  it("limits cleanup to one random reserved tenant scope and service-role execution", async () => {
    const sql = await readFile(
      "supabase/migrations/20260823045212_hosted_learning_entity_probe.sql",
      "utf8"
    );
    expect(sql).toContain("^learning_probe_[a-f0-9]{24}$");
    expect(sql).toContain("security definer\nset search_path = ''");
    expect(sql).toContain("where organization_id = p_organization_id\n    and project_key = p_project_key");
    expect(sql).toContain("from public.canonical_company_entity_aliases");
    expect(sql).toContain("revoke all on function public.loopgraph_learning_entity_probe_cleanup(uuid, text)");
    expect(sql).toContain("from public, anon, authenticated, service_role");
    expect(sql).toContain("grant execute on function public.loopgraph_learning_entity_probe_cleanup(uuid, text)\n  to service_role");
    expect(sql).not.toMatch(/delete from public\.[a-z_]+\s*;/);
  });
});
