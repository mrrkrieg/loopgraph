import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

describe("App action reconciliation observability migration", () => {
  it("exports tenant aggregates for nonterminal commit requests without identifiers", async () => {
    const sql = await readFile(path.join(
      process.cwd(),
      "supabase/migrations/202608210011_app_action_reconciliation_observability.sql"
    ), "utf8");

    expect(sql).toContain("get_loopgraph_app_action_reconciliation_snapshot");
    expect(sql).toContain("event_type = 'commit_requested'");
    expect(sql).toContain("terminal.event_type in ('commit_succeeded', 'commit_failed')");
    expect(sql).toContain("terminal.event_type = 'revoked'");
    expect(sql).toContain("app_action_reconciliation_pending");
    expect(sql).toContain("app_action_reconciliation_stale");
    expect(sql).toContain("security invoker");
    expect(sql).toContain("revoke all on function public.get_loopgraph_app_action_reconciliation_snapshot");
    expect(sql).toContain("grant execute on function public.get_loopgraph_app_action_reconciliation_snapshot");
    expect(sql).not.toMatch(/canonicalInput|providerOutput|accessToken|refreshToken|clientSecret|credentialRef/);
  });
});
