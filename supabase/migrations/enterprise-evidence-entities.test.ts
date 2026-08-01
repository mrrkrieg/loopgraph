import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("enterprise evidence and entity migrations", () => {
  it("fences distributed evidence claims, finalization, revisions, and immutability", async () => {
    const sql = await readFile("supabase/migrations/202607310001_enterprise_evidence_and_entities.sql", "utf8");
    expect(sql).toContain("enable row level security");
    expect(sql).toContain("revoke all on public.loopgraph_evidence_records from public, anon, authenticated, service_role");
    expect(sql).toContain("for update skip locked");
    expect(sql).toContain("measurement lease conflict");
    expect(sql).toContain("metric binding revision conflict");
    expect(sql).toContain("immutable Loopgraph evidence conflict");
    expect(sql).toContain("p_payload->>'status' = 'pending'");
    expect(sql).toContain("on conflict do nothing");
    expect(sql).toContain("security definer\nset search_path = ''");
  });

  it("keeps canonical entities tenant scoped with one exact external alias owner", async () => {
    const sql = await readFile("supabase/migrations/202607310002_canonical_company_entities.sql", "utf8");
    expect(sql).toContain("primary key (organization_id, project_key, provider, external_type, external_id, account_scope)");
    expect(sql).toContain("enable row level security");
    expect(sql).toContain("revoke all on public.canonical_company_entities from public, anon, authenticated, service_role");
    expect(sql).toContain("canonical entity revision conflict");
    expect(sql).toContain("security definer set search_path = ''");
  });
});
