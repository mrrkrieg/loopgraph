import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  path.resolve(process.cwd(), "supabase/migrations/202608170003_cli_device_authorization.sql"),
  "utf8"
);

describe("CLI device authorization migration", () => {
  it("keeps device and session tables private and persists only token hashes", () => {
    expect(migration).toContain("alter table public.cli_device_authorizations enable row level security");
    expect(migration).toContain("alter table public.cli_device_issuance_rate_windows enable row level security");
    expect(migration).toContain("alter table public.cli_access_sessions enable row level security");
    expect(migration).toContain("revoke all on public.cli_device_authorizations from public, anon, authenticated");
    expect(migration).toContain("alter table public.cli_device_decision_rate_windows enable row level security");
    expect(migration).toContain("access_token_hash text not null unique");
    expect(migration).toContain("refresh_token_hash text not null unique");
    expect(migration).not.toMatch(/\baccess_token\s+text/i);
    expect(migration).not.toMatch(/\brefresh_token\s+text/i);
  });

  it("binds approval and every refresh/request to active organization membership", () => {
    expect(migration.match(/from public\.organization_memberships/g)?.length).toBeGreaterThanOrEqual(4);
    expect(migration).toContain("membership.status = 'active'");
    expect(migration).toContain("create or replace function public.authorize_cli_session_request");
    expect(migration).toContain("public.authorize_machine_request(");
  });

  it("limits capabilities, access lifetime, refresh lifetime, polling, and issuance", () => {
    expect(migration).toContain("capabilities <@ array['marketplace.consume']::text[]");
    expect(migration).toContain("interval '15 minutes'");
    expect(migration).toContain("interval '30 days'");
    expect(migration).toContain("create table if not exists public.cli_device_issuance_rate_windows");
    expect(migration).toContain("where public.cli_device_issuance_rate_windows.request_count < 5");
    expect(migration).toContain("where public.cli_device_issuance_rate_windows.request_count < 500");
    expect(migration).not.toMatch(/select count\(\*\)[\s\S]+device_authorization_rate_limited/i);
    expect(migration).toContain("attempt_count < 10");
    expect(migration).toContain("'slow_down'::text");
  });
});
