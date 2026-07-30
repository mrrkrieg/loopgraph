import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

const migrationPath = path.join(
  process.cwd(),
  "supabase/migrations/202607300001_hosted_tenant_security.sql"
);

describe("hosted tenant security migration", () => {
  it("enables RLS across every exposed workspace and runtime table", async () => {
    const sql = await readFile(migrationPath, "utf8");
    for (const table of [
      "organizations",
      "profiles",
      "loop_templates",
      "loops",
      "loop_questions",
      "loop_answers",
      "data_sources",
      "loop_data_sources",
      "loop_requirements",
      "generated_artifacts",
      "loop_runs",
      "loop_run_steps",
      "human_reviews",
      "loop_metrics",
      "improvement_items",
      "loop_relationships",
      "loop_graph_views",
      "management_reviews",
      "agent_threads",
      "agent_messages",
      "organization_memberships",
      "loop_run_traces",
      "loop_reviews",
      "loop_escalation_cases",
      "ingested_events"
    ]) {
      expect(sql).toContain(`'${table}'`);
    }
    expect(sql).toContain("enable row level security");
    expect(sql).toContain("revoke all on all tables in schema public from anon");
  });

  it("keeps authorization helpers private and bases membership on auth.uid()", async () => {
    const sql = await readFile(migrationPath, "utf8");
    expect(sql).toContain("create schema if not exists private");
    expect(sql).toContain("security definer");
    expect(sql).toContain("set search_path = ''");
    expect(sql).toContain("membership.user_id = auth.uid()");
    expect(sql).not.toContain("user_metadata");
  });
});
