import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  RECOVERY_TABLES,
  EVIDENCE_RECORD_TYPES,
  auditIntegritySql,
  compareRecoveryFingerprints,
  parseAuditIntegrity,
  parseEvidenceRecordCounts,
  parseNamedCounts,
  parseRecoveryFingerprints,
  recoveryFingerprintSql
} from "./recovery-contract";

describe("recovery evidence contract", () => {
  it("fails when a migration adds an application table without recovery coverage", () => {
    const migrations = path.resolve(process.cwd(), "supabase/migrations");
    const discovered = readdirSync(migrations)
      .filter((file) => file.endsWith(".sql"))
      .flatMap((file) => [
        ...readFileSync(path.join(migrations, file), "utf8")
          .matchAll(/create table(?: if not exists)? (?:public\.)?([a-z0-9_]+)/gi)
      ].map((match) => match[1]!))
      .sort();
    expect([...RECOVERY_TABLES].sort()).toEqual(discovered);
  });

  it("covers every critical persistence family with allowlisted SQL identifiers", () => {
    const sql = recoveryFingerprintSql();
    for (const table of [
      "marketplace_app_versions",
      "workload_capability_grants",
      "cli_access_sessions",
      "cli_device_issuance_rate_windows",
      "connector_action_approvals",
      "provider_webhook_inbox",
      "security_audit_events",
      "user_api_quota_windows",
      "hermes_execution_events",
      "loop_controller_state",
      "graph_editor_transactions",
      "human_reviews",
      "agent_messages",
      "loopgraph_evidence_records",
      "loopgraph_app_installation_registries",
      "loopgraph_provider_schema_snapshots",
      "loopgraph_connector_field_mappings",
      "loopgraph_company_contexts",
      "loopgraph_app_verification_registries",
      "loopgraph_app_verifier_keys",
      "loopgraph_app_verification_receipts",
      "canonical_company_entity_aliases",
      "loop_spec_versions",
      "route_jobs",
      "semantic_graph_commits"
    ]) expect(sql).toContain(`public.\"${table}\"`);
    expect(sql).not.toContain("${");
    expect(sql).toContain("sha256(convert_to(row_to_json(t)::text, 'UTF8'))");
    expect(sql).toContain("string_agg(row_digest");
    expect(auditIntegritySql()).toContain("verify_security_audit_chain");
  });

  it("requires an exact multiset fingerprint match", () => {
    const output = RECOVERY_TABLES.map((table, index) =>
      `${table}\t${index}\t${index.toString(16).padStart(64, "0")}`
    ).join("\n");
    const source = parseRecoveryFingerprints(output);
    const target = parseRecoveryFingerprints(output);

    expect(compareRecoveryFingerprints(source, target)).toHaveLength(RECOVERY_TABLES.length);
    expect(compareRecoveryFingerprints(source, target)[1]).toEqual({
      table: RECOVERY_TABLES[1],
      rowCount: 1,
      sha256: "1".padStart(64, "0"),
      matched: true
    });

    const changed = new Map(target);
    changed.set("marketplace_app_versions", {
      ...changed.get("marketplace_app_versions")!,
      sha256: "f".repeat(64)
    });
    expect(() => compareRecoveryFingerprints(source, changed))
      .toThrow(/marketplace_app_versions/i);
  });

  it("parses bounded evidence-family counts", () => {
    expect(parseNamedCounts("metric_sample\t10\nobserved_outcome\t4\nvalue_ledger\t2\n"))
      .toEqual({ metric_sample: 10, observed_outcome: 4, value_ledger: 2 });
    expect(() => parseNamedCounts("bad name\t1\n")).toThrow(/invalid row/i);

    const complete = EVIDENCE_RECORD_TYPES.map((recordType, index) =>
      `${recordType}\t${index}`
    ).join("\n");
    expect(parseEvidenceRecordCounts(complete).value_ledger).toBe(5);
    expect(() => parseEvidenceRecordCounts("metric_sample\t1\n")).toThrow(/omitted/i);
  });

  it("requires a valid restored audit chain", () => {
    expect(parseAuditIntegrity("t\t24\t3\n")).toEqual({
      valid: true,
      eventsChecked: 24,
      scopesChecked: 3
    });
    expect(parseAuditIntegrity("false\t4\t1\n").valid).toBe(false);
    expect(() => parseAuditIntegrity("true\t1\n")).toThrow(/invalid row/i);
  });
});
