import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("hosted Hermes route activation migration", () => {
  it("keeps controller receipts tenant scoped, append-only, secret-free, and audited", async () => {
    const sql = await readFile(
      "supabase/migrations/20260823170000_hosted_hermes_route_activation.sql",
      "utf8"
    );

    expect(sql).toContain("primary key (organization_id, project_key, workspace_id, request_digest)");
    expect(sql).toContain("enable row level security");
    expect(sql).toContain("revoke all on public.loopgraph_hermes_route_activation_records from public, anon, authenticated, service_role");
    expect(sql).toContain("before update or delete on public.loopgraph_hermes_route_activation_records");
    expect(sql).toContain("Hermes route activation records are append-only");
    expect(sql).toContain("immutable Hermes route activation conflict");
    expect(sql).toContain("receipt,destructiveChangesApplied");
    expect(sql).toContain("access_token|refresh_token|client_secret|webhook_secret|authorization|password|api_key|private_key");
    expect(sql).toContain("pg_column_size(p_record) > 1048576");
    expect(sql).toContain("private.append_security_audit_event");
    expect(sql).toContain("hermes.route_activation.recorded");
    expect(sql).toContain("hermes.route_activation");
    expect(sql).toContain("'machine'");
    expect(sql).toContain("security definer\nset search_path = ''");
    expect(sql).toContain("grant execute on function public.record_loopgraph_hermes_route_activation");
    expect(sql).not.toMatch(/\b(access_token|refresh_token|client_secret|webhook_secret)\s+(?:text|jsonb)/i);
  });
});
