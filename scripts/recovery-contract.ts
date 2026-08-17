export const RECOVERY_TABLES = [
  "organizations",
  "profiles",
  "organization_memberships",
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
  "loop_run_traces",
  "loop_reviews",
  "loop_escalation_cases",
  "ingested_events",
  "security_audit_events",
  "machine_request_receipts",
  "machine_rate_limit_windows",
  "workload_principals",
  "workload_capability_grants",
  "workload_identity_audit_events",
  "workload_identity_replay_claims",
  "connector_installations",
  "credential_namespaces",
  "tenant_key_bindings",
  "provider_credential_versions",
  "credential_access_receipts",
  "connector_oauth_transactions",
  "connector_operation_receipts",
  "connector_idempotency_claims",
  "connector_prepared_actions",
  "connector_action_approvals",
  "connector_kill_switches",
  "connector_revocation_jobs",
  "provider_webhook_deliveries",
  "provider_webhook_inbox",
  "provider_detector_schedules",
  "provider_detector_runs",
  "marketplace_publishers",
  "marketplace_apps",
  "marketplace_app_versions",
  "marketplace_app_artifacts",
  "marketplace_app_dependencies",
  "marketplace_app_connector_requirements",
  "marketplace_app_presets",
  "marketplace_app_eval_results",
  "marketplace_release_signatures",
  "marketplace_verification_jobs",
  "private_catalog_access",
  "discovery_sessions",
  "discovery_evidence_gap_sets",
  "loop_design_artifacts",
  "hermes_design_tasks",
  "hermes_design_callbacks",
  "hermes_design_dispatch_jobs",
  "hermes_design_callback_jobs",
  "hermes_agent_instances",
  "hermes_execution_events",
  "loop_spec_workspaces",
  "loop_spec_versions",
  "loop_spec_registry",
  "loop_spec_commits",
  "loopgraph_evidence_records",
  "canonical_company_entities",
  "canonical_company_entity_aliases",
  "routing_state_records",
  "route_jobs",
  "loop_opportunities",
  "loop_graph_change_sets",
  "loop_controller_runs",
  "loop_controller_state",
  "loop_controller_triggers",
  "loop_controller_leases",
  "graph_editor_transactions",
  "graph_editor_layouts",
  "semantic_graph_snapshots",
  "semantic_graph_approvals",
  "semantic_graph_transactions",
  "semantic_graph_promotions",
  "semantic_graph_rehearsals",
  "semantic_graph_commits"
] as const;

export type RecoveryTable = typeof RECOVERY_TABLES[number];
export type RecoveryFingerprint = {
  table: RecoveryTable;
  rowCount: number;
  sha256: string;
};

export const EVIDENCE_RECORD_TYPES = [
  "metric_binding",
  "measurement_job",
  "reconciliation",
  "metric_sample",
  "observed_outcome",
  "value_ledger"
] as const;

export function recoveryFingerprintSql() {
  return RECOVERY_TABLES.map((table) => `
select '${table}' as table_name,
       count(*)::text as row_count,
       encode(
         sha256(
           coalesce(
             string_agg(row_digest, ''::bytea order by row_digest),
             ''::bytea
           )
         ),
         'hex'
       ) as sha256
  from (
    select sha256(convert_to(row_to_json(t)::text, 'UTF8')) as row_digest
      from public."${table}" t
  ) fingerprint_rows`).join("\nunion all\n") + ";";
}

export function parseRecoveryFingerprints(output: string) {
  const results = new Map<RecoveryTable, RecoveryFingerprint>();
  for (const line of output.trim().split(/\r?\n/).filter(Boolean)) {
    const [table, rowCount, sha256, ...extra] = line.split("\t");
    if (
      extra.length > 0 ||
      !RECOVERY_TABLES.includes(table as RecoveryTable) ||
      !/^\d+$/.test(rowCount ?? "") ||
      !/^[a-f0-9]{64}$/.test(sha256 ?? "") ||
      results.has(table as RecoveryTable)
    ) {
      throw new Error("Recovery fingerprint query returned an invalid row");
    }
    const parsedCount = Number(rowCount);
    if (!Number.isSafeInteger(parsedCount)) {
      throw new Error("Recovery fingerprint row count exceeds the safe integer range");
    }
    results.set(table as RecoveryTable, {
      table: table as RecoveryTable,
      rowCount: parsedCount,
      sha256: sha256!
    });
  }
  if (results.size !== RECOVERY_TABLES.length) {
    throw new Error("Recovery fingerprint query omitted a critical table");
  }
  return results;
}

export function compareRecoveryFingerprints(
  source: Map<RecoveryTable, RecoveryFingerprint>,
  target: Map<RecoveryTable, RecoveryFingerprint>
) {
  return RECOVERY_TABLES.map((table) => {
    const sourceValue = source.get(table);
    const targetValue = target.get(table);
    if (!sourceValue || !targetValue) throw new Error(`Recovery fingerprint missing ${table}`);
    if (
      sourceValue.rowCount !== targetValue.rowCount ||
      sourceValue.sha256 !== targetValue.sha256
    ) {
      throw new Error(`Recovery fingerprint mismatch for ${table}`);
    }
    return {
      table,
      rowCount: targetValue.rowCount,
      sha256: targetValue.sha256,
      matched: true as const
    };
  });
}

export function auditIntegritySql() {
  return `
with scopes as (
  select distinct organization_id, project_key
    from public.security_audit_events
), verified as (
  select scopes.organization_id,
         scopes.project_key,
         result.valid,
         result.events_checked
    from scopes
    cross join lateral public.verify_security_audit_chain(
      scopes.organization_id,
      scopes.project_key
    ) result
)
select coalesce(bool_and(valid), true)::text,
       coalesce(sum(events_checked), 0)::text,
       count(*)::text
  from verified;`;
}

export function recordTypeCountsSql() {
  return `
with expected(record_type) as (
  values ${EVIDENCE_RECORD_TYPES.map((recordType) => `('${recordType}')`).join(", ")}
)
select expected.record_type, count(records.record_id)::text
  from expected
  left join public.loopgraph_evidence_records records
    on records.record_type = expected.record_type
 group by expected.record_type
 order by expected.record_type;`;
}

export function parseNamedCounts(output: string) {
  return Object.fromEntries(output.trim().split(/\r?\n/).filter(Boolean).map((line) => {
    const [name, count, ...extra] = line.split("\t");
    if (extra.length > 0 || !/^[a-z][a-z0-9_]{0,63}$/.test(name ?? "") || !/^\d+$/.test(count ?? "")) {
      throw new Error("Recovery count query returned an invalid row");
    }
    const parsed = Number(count);
    if (!Number.isSafeInteger(parsed)) throw new Error("Recovery count exceeds the safe integer range");
    return [name!, parsed];
  }));
}

export function parseEvidenceRecordCounts(output: string) {
  const counts = parseNamedCounts(output);
  if (
    Object.keys(counts).length !== EVIDENCE_RECORD_TYPES.length ||
    EVIDENCE_RECORD_TYPES.some((recordType) => counts[recordType] === undefined)
  ) {
    throw new Error("Recovery evidence count query omitted a record type");
  }
  return counts as Record<typeof EVIDENCE_RECORD_TYPES[number], number>;
}

export function parseAuditIntegrity(output: string) {
  const rows = output.trim().split(/\r?\n/).filter(Boolean);
  const [valid, eventsChecked, scopesChecked, ...extra] = rows[0]?.split("\t") ?? [];
  if (
    rows.length !== 1 ||
    extra.length > 0 ||
    !new Set(["t", "true", "f", "false"]).has(valid ?? "") ||
    !/^\d+$/.test(eventsChecked ?? "") ||
    !/^\d+$/.test(scopesChecked ?? "")
  ) {
    throw new Error("Recovery audit-integrity query returned an invalid row");
  }
  const parsedEvents = Number(eventsChecked);
  const parsedScopes = Number(scopesChecked);
  if (!Number.isSafeInteger(parsedEvents) || !Number.isSafeInteger(parsedScopes)) {
    throw new Error("Recovery audit-integrity counts exceed the safe integer range");
  }
  return {
    valid: valid === "t" || valid === "true",
    eventsChecked: parsedEvents,
    scopesChecked: parsedScopes
  };
}
