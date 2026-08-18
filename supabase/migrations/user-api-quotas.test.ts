import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  path.resolve(process.cwd(), "supabase/migrations/202608170005_user_api_quotas.sql"),
  "utf8"
);

describe("hosted user API quota migration", () => {
  it("keeps limits server-owned and supports service-role tenant overrides", () => {
    expect(migration).toContain("create table if not exists public.user_api_quota_policy_overrides");
    expect(migration).toContain("check (bucket in ('read', 'write', 'compute', 'admin'))");
    expect(migration).toContain("revoke all on public.user_api_quota_policy_overrides from public, anon, authenticated");
    expect(migration).toContain("grant all on public.user_api_quota_policy_overrides to service_role");
    expect(migration).not.toContain("p_rate_limit");
    expect(migration).not.toContain("p_project_key");
  });

  it("authorizes the caller against the exact tenant and consumes atomically", () => {
    expect(migration).toContain("v_user_id uuid := auth.uid()");
    expect(migration).toContain("membership.organization_id = p_organization_id");
    expect(migration).toContain("membership.user_id = v_user_id");
    expect(migration).toContain("membership.status = 'active'");
    expect(migration).toContain("on conflict (organization_id, user_id, bucket) do update");
    expect(migration).toContain("quota.request_count < v_rate_limit");
    expect(migration).toContain("'rate_limited'");
  });

  it("keeps quota state private while exposing only the bounded RPC", () => {
    expect(migration).toContain("alter table public.user_api_quota_windows enable row level security");
    expect(migration).toContain("revoke all on public.user_api_quota_windows from public, anon, authenticated");
    expect(migration).toContain("security definer");
    expect(migration).toContain("set search_path = ''");
    expect(migration).toContain("grant execute on function public.consume_user_api_quota(uuid, text)");
    expect(migration).toContain("to authenticated, service_role");
  });
});
