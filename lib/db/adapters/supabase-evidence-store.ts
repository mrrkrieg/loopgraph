import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  connectionReconciliationReportSchema,
  measurementJobSchema,
  metricBindingSchema,
  metricSampleSchema,
  observedOutcomeSchema,
  valueLedgerEntrySchema,
  type ConnectionReconciliationReport,
  type MeasurementJob,
  type MetricBinding,
  type MetricSample,
  type ObservedOutcome,
  type ValueLedgerEntry
} from "loopgraph/core";
import type {
  MeasurementJobFilters,
  MeasurementJobClaimInput,
  MeasurementStore,
  MetricSampleFilters,
  ObservedOutcomeFilters,
  OutcomeStore,
  OutcomeStoreSaveResult,
  ValueLedgerFilters
} from "loopgraph/runtime";
import { createSupabaseAdminClient } from "@/lib/db/supabase-admin";

type RecordType = "metric_binding" | "measurement_job" | "reconciliation" | "metric_sample" | "observed_outcome" | "value_ledger";
type Scope = { organizationId: string; projectKey: string };
const PROJECT_KEY_PATTERN = /^[a-z0-9][a-z0-9_-]{0,63}$/;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export class SupabaseEvidenceStore implements MeasurementStore, OutcomeStore {
  readonly persistence = "distributed" as const;
  constructor(private readonly supabase: SupabaseClient, private readonly scope: Scope) {
    if (!UUID_PATTERN.test(scope.organizationId)) throw new Error("Evidence store organization ID must be a UUID");
    if (!PROJECT_KEY_PATTERN.test(scope.projectKey)) throw new Error("Evidence store project key is invalid");
  }

  async listMetricBindings(loopId?: string) { return (await this.list("metric_binding", metricBindingSchema)).filter((item) => !loopId || item.loopId === loopId); }
  async getMetricBinding(id: string) { return this.get("metric_binding", id, metricBindingSchema); }
  async saveMetricBinding(value: MetricBinding, expectedRevision?: number) {
    const parsed = metricBindingSchema.parse(value);
    return metricBindingSchema.parse(await this.upsert("metric_binding", parsed.id, parsed, expectedRevision));
  }
  async saveMeasurementJob(value: MeasurementJob) { const parsed = measurementJobSchema.parse(value); return measurementJobSchema.parse(await this.upsert("measurement_job", parsed.id, parsed)); }
  async saveClaimedMeasurementJob(value: MeasurementJob, expectedLeaseTokenHash: string) {
    const parsed = measurementJobSchema.parse(value);
    const { data, error } = await this.supabase.rpc("finalize_loopgraph_measurement_job", {
      p_organization_id: this.scope.organizationId,
      p_project_key: this.scope.projectKey,
      p_record_id: parsed.id,
      p_expected_lease_hash: expectedLeaseTokenHash,
      p_payload: parsed
    });
    if (error) throw new Error(`Failed to finalize measurement job: ${error.message}`);
    return measurementJobSchema.parse(data);
  }
  async getMeasurementJob(id: string) { return this.get("measurement_job", id, measurementJobSchema); }
  async listMeasurementJobs(filters: MeasurementJobFilters = {}) {
    return (await this.list("measurement_job", measurementJobSchema))
      .filter((job) => !filters.bindingId || job.bindingId === filters.bindingId)
      .filter((job) => !filters.loopId || job.loopId === filters.loopId)
      .filter((job) => !filters.connectionInstanceId || job.connectorInstanceId === filters.connectionInstanceId)
      .filter((job) => !filters.status || job.status === filters.status)
      .filter((job) => !filters.dueBefore || job.dueAt <= filters.dueBefore)
      .sort((a, b) => a.dueAt.localeCompare(b.dueAt));
  }
  async claimDueJobs(input: MeasurementJobClaimInput) {
    const { data, error } = await this.supabase.rpc("claim_loopgraph_measurement_jobs", {
      p_organization_id: this.scope.organizationId,
      p_project_key: this.scope.projectKey,
      p_claimed_by: input.claimedBy,
      p_limit: input.limit,
      p_lease_seconds: input.leaseSeconds,
      p_connection_instance_id: input.connectionInstanceId ?? null,
      p_now: input.now.toISOString()
    });
    if (error) throw new Error(`Failed to claim measurement jobs: ${error.message}`);
    return ((data ?? []) as Array<{ payload: unknown; lease_token: string }>).map((row) => ({
      job: measurementJobSchema.parse(row.payload),
      leaseToken: row.lease_token
    }));
  }
  async saveReconciliationReport(value: ConnectionReconciliationReport) { const parsed = connectionReconciliationReportSchema.parse(value); await this.upsert("reconciliation", parsed.id, parsed); return parsed; }
  async getReconciliationReport(id: string) { return this.get("reconciliation", id, connectionReconciliationReportSchema); }
  async listReconciliationReports() { return (await this.list("reconciliation", connectionReconciliationReportSchema)).sort((a, b) => b.checkedAt.localeCompare(a.checkedAt)); }
  async withJobLock<T>(operation: () => Promise<T>) { return operation(); }

  async saveMetricSample(value: MetricSample): Promise<OutcomeStoreSaveResult<MetricSample>> { const parsed = metricSampleSchema.parse(value); return this.saveImmutable("metric_sample", parsed.id, parsed, metricSampleSchema); }
  async getMetricSample(id: string) { return this.get("metric_sample", id, metricSampleSchema); }
  async listMetricSamples(filters: MetricSampleFilters = {}) {
    return (await this.list("metric_sample", metricSampleSchema))
      .filter((item) => !filters.workspaceId || item.workspaceId === filters.workspaceId)
      .filter((item) => !filters.companyId || item.companyId === filters.companyId)
      .filter((item) => !filters.departmentId || item.departmentId === filters.departmentId)
      .filter((item) => !filters.loopId || item.loopId === filters.loopId)
      .filter((item) => !filters.metricDefinitionId || item.metricDefinitionId === filters.metricDefinitionId)
      .filter((item) => !filters.metricKey || item.metricKey === filters.metricKey)
      .filter((item) => !filters.windowStart || item.window.end > filters.windowStart)
      .filter((item) => !filters.windowEnd || item.window.start < filters.windowEnd);
  }
  async saveObservedOutcome(value: ObservedOutcome) { const parsed = observedOutcomeSchema.parse(value); return this.saveImmutable("observed_outcome", parsed.id, parsed, observedOutcomeSchema); }
  async getObservedOutcome(id: string) { return this.get("observed_outcome", id, observedOutcomeSchema); }
  async listObservedOutcomes(filters: ObservedOutcomeFilters = {}) {
    return (await this.list("observed_outcome", observedOutcomeSchema))
      .filter((item) => !filters.workspaceId || item.workspaceId === filters.workspaceId)
      .filter((item) => !filters.companyId || item.companyId === filters.companyId)
      .filter((item) => !filters.departmentId || item.departmentId === filters.departmentId)
      .filter((item) => !filters.loopId || item.loopId === filters.loopId)
      .filter((item) => !filters.metricDefinitionId || item.metricDefinitionId === filters.metricDefinitionId)
      .filter((item) => !filters.status || item.status === filters.status);
  }
  async saveValueLedgerEntry(value: ValueLedgerEntry) { const parsed = valueLedgerEntrySchema.parse(value); return this.saveImmutable("value_ledger", parsed.id, parsed, valueLedgerEntrySchema); }
  async getValueLedgerEntry(id: string) { return this.get("value_ledger", id, valueLedgerEntrySchema); }
  async listValueLedgerEntries(filters: ValueLedgerFilters = {}) {
    return (await this.list("value_ledger", valueLedgerEntrySchema))
      .filter((item) => !filters.workspaceId || item.workspaceId === filters.workspaceId)
      .filter((item) => !filters.companyId || item.companyId === filters.companyId)
      .filter((item) => !filters.departmentId || item.departmentId === filters.departmentId)
      .filter((item) => !filters.loopId || item.loopId === filters.loopId)
      .filter((item) => !filters.windowStart || item.window.end >= filters.windowStart)
      .filter((item) => !filters.windowEnd || item.window.start <= filters.windowEnd);
  }

  private async saveImmutable<T>(type: RecordType, id: string, value: T, schema: { parse(value: unknown): T }) {
    const existing = await this.get(type, id, schema);
    if (existing) {
      if (JSON.stringify(existing) !== JSON.stringify(value)) throw new Error(`${type} idempotency conflict for ${id}`);
      return { record: existing, duplicate: true };
    }
    const stored = schema.parse(await this.upsert(type, id, value));
    return { record: stored, duplicate: JSON.stringify(stored) === JSON.stringify(existing) };
  }
  private async upsert(type: RecordType, id: string, payload: unknown, expectedRevision?: number) {
    const { data, error } = await this.supabase.rpc("upsert_loopgraph_evidence_record", { p_organization_id: this.scope.organizationId, p_project_key: this.scope.projectKey, p_record_type: type, p_record_id: id, p_payload: payload, p_expected_revision: expectedRevision ?? null });
    if (error) throw new Error(`Failed to save ${type}: ${error.message}`);
    return data;
  }
  private async get<T>(type: RecordType, id: string, schema: { parse(value: unknown): T }): Promise<T | undefined> {
    const { data, error } = await this.supabase.from("loopgraph_evidence_records").select("payload").eq("organization_id", this.scope.organizationId).eq("project_key", this.scope.projectKey).eq("record_type", type).eq("record_id", id).maybeSingle();
    if (error) throw new Error(`Failed to read ${type}: ${error.message}`);
    return data ? schema.parse((data as { payload: unknown }).payload) : undefined;
  }
  private async list<T>(type: RecordType, schema: { parse(value: unknown): T }): Promise<T[]> {
    const values: T[] = [];
    for (let offset = 0; ; offset += 500) {
      const { data, error } = await this.supabase.from("loopgraph_evidence_records").select("payload").eq("organization_id", this.scope.organizationId).eq("project_key", this.scope.projectKey).eq("record_type", type).order("updated_at", { ascending: false }).range(offset, offset + 499);
      if (error) throw new Error(`Failed to list ${type}: ${error.message}`);
      const page = (data ?? []) as Array<{ payload: unknown }>;
      values.push(...page.map((row) => schema.parse(row.payload)));
      if (page.length < 500) return values;
    }
  }
}

export function isSupabaseEvidenceStoreEnabled(env: NodeJS.ProcessEnv = process.env) { return Boolean(env.NEXT_PUBLIC_SUPABASE_URL && env.SUPABASE_SERVICE_ROLE_KEY && env.LOOPGRAPH_HOSTED_ORGANIZATION_ID); }
export function createSupabaseEvidenceStore() {
  const supabase = createSupabaseAdminClient();
  const organizationId = process.env.LOOPGRAPH_HOSTED_ORGANIZATION_ID?.trim();
  const projectKey = process.env.LOOPGRAPH_HOSTED_PROJECT_KEY?.trim() || "default";
  if (!supabase || !organizationId) throw new Error("Supabase evidence storage requires a hosted organization");
  return new SupabaseEvidenceStore(supabase, { organizationId, projectKey });
}
