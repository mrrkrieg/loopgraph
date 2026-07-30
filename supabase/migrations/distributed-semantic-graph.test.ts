import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

const migrationPath = path.resolve(
  process.cwd(),
  "supabase/migrations/202607300011_distributed_semantic_graph.sql"
);

describe("distributed semantic graph migration", () => {
  it("defines tenant-scoped durable graph authority", async () => {
    const sql = await readFile(migrationPath, "utf8");

    for (const table of [
      "semantic_graph_snapshots",
      "semantic_graph_approvals",
      "semantic_graph_transactions",
      "semantic_graph_promotions",
      "semantic_graph_rehearsals",
      "semantic_graph_commits"
    ]) {
      expect(sql).toContain(`create table if not exists public.${table}`);
      expect(sql).toContain(`alter table public.${table} enable row level security`);
    }
    expect(sql).toContain("create or replace function public.save_semantic_graph_record");
    expect(sql).toContain("create or replace function public.commit_semantic_graph_transaction");
    expect(sql).toContain("create or replace function public.get_semantic_graph_snapshot");
    expect(sql).toContain("semantic graph transaction approval is missing or stale");
    expect(sql).toContain("semantic graph active artifact conflict");
    expect(sql).toContain("semantic graph workspace revision conflict");
    expect(sql).toContain("perform public.upsert_loop_graph_change_set");
  });

  it("keeps browser roles read/write denied and grants only service reads", async () => {
    const sql = await readFile(migrationPath, "utf8");

    expect(sql).toContain(
      "revoke all on public.semantic_graph_commits\n  from public, anon, authenticated, service_role"
    );
    expect(sql).toContain(
      "grant select on public.semantic_graph_transactions to service_role"
    );
    expect(sql).toContain(
      "revoke all on function public.commit_semantic_graph_transaction"
    );
    expect(sql).toContain(
      "grant execute on function public.commit_semantic_graph_transaction"
    );
  });
});
