import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

describe("App action reconciliation worker migration", () => {
  it("selects oldest nonterminal commit requests through a service-role-only function", async () => {
    const sql = await readFile(path.join(process.cwd(), "supabase/migrations/202608210010_app_action_reconciliation_worker.sql"), "utf8");

    expect(sql).toContain("list_loopgraph_app_action_reconciliation_candidates");
    expect(sql).toContain("loopgraph_app_action_commit_reconciliation_idx");
    expect(sql).toContain("where event_type = 'commit_requested'");
    expect(sql).toContain("requested.event_type = 'commit_requested'");
    expect(sql).toContain("terminal.event_type in ('commit_succeeded', 'commit_failed')");
    expect(sql).toContain("terminal.event_type = 'revoked'");
    expect(sql).toContain("order by requested.occurred_at asc");
    expect(sql).toContain("revoke all on function public.list_loopgraph_app_action_reconciliation_candidates");
    expect(sql).toContain("grant execute on function public.list_loopgraph_app_action_reconciliation_candidates");
    expect(sql).not.toMatch(/canonicalInput|accessToken|refreshToken|clientSecret|credentialRef/);
  });
});
