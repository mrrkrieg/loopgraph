import type { LoopRunTrace } from "@/lib/loopgraph-core/trace";
import type { HumanReviewTrace } from "@/lib/loopgraph-core/review";
import type { EscalationCase } from "@/lib/loopgraph-core/escalation";
import type { StorageAdapter } from "@/lib/loopgraph-sdk/adapters";
import { createSupabaseAdminClient } from "@/lib/db/supabase-admin";

export function isSupabaseStorageEnabled() {
  return Boolean(
    process.env.NEXT_PUBLIC_SUPABASE_URL &&
    process.env.SUPABASE_SERVICE_ROLE_KEY &&
    process.env.LOOPGRAPH_HOSTED_ORGANIZATION_ID
  );
}

export function createSupabaseStorageAdapter(): StorageAdapter {
  const supabase = createSupabaseAdminClient();
  const organizationId = process.env.LOOPGRAPH_HOSTED_ORGANIZATION_ID;
  if (!supabase || !organizationId) {
    throw new Error(
      "Supabase runtime storage requires NEXT_PUBLIC_SUPABASE_URL, " +
      "SUPABASE_SERVICE_ROLE_KEY, and LOOPGRAPH_HOSTED_ORGANIZATION_ID"
    );
  }

  return {
    async saveRun(trace: LoopRunTrace) {
      const { error } = await supabase.from("loop_run_traces").upsert({
        id: trace.id,
        organization_id: organizationId,
        loop_id: trace.loopId,
        status: trace.status,
        idempotency_key: trace.idempotencyKey,
        payload: trace,
        updated_at: new Date().toISOString()
      });
      if (error) throw error;
    },

    async getRun(runId: string) {
      const { data, error } = await supabase
        .from("loop_run_traces")
        .select("payload")
        .eq("organization_id", organizationId)
        .eq("id", runId)
        .maybeSingle();
      if (error) throw error;
      return (data?.payload as LoopRunTrace | undefined) ?? null;
    },

    async saveReview(review: HumanReviewTrace) {
      const { error } = await supabase.from("loop_reviews").upsert({
        id: review.id,
        organization_id: organizationId,
        run_id: review.runId,
        payload: review
      });
      if (error) throw error;
    },

    async saveEscalationCase(caseItem: EscalationCase) {
      const { error } = await supabase.from("loop_escalation_cases").upsert({
        id: caseItem.id,
        organization_id: organizationId,
        source_loop_id: caseItem.sourceLoopId,
        severity: caseItem.severity,
        status: caseItem.status,
        payload: caseItem,
        updated_at: new Date().toISOString()
      });
      if (error) throw error;
    },

    async getEscalationCase(caseId: string) {
      const { data, error } = await supabase
        .from("loop_escalation_cases")
        .select("payload")
        .eq("organization_id", organizationId)
        .eq("id", caseId)
        .maybeSingle();
      if (error) throw error;
      return (data?.payload as EscalationCase | undefined) ?? null;
    },

    async listRuns() {
      const { data, error } = await supabase
        .from("loop_run_traces")
        .select("id, loop_id, status")
        .eq("organization_id", organizationId)
        .order("updated_at", { ascending: false })
        .limit(100);
      if (error) throw error;
      return (data ?? []).map((row) => ({ id: row.id, loopId: row.loop_id, status: row.status }));
    },

    async listCases() {
      const { data, error } = await supabase
        .from("loop_escalation_cases")
        .select("id, source_loop_id, severity, status")
        .eq("organization_id", organizationId)
        .order("updated_at", { ascending: false })
        .limit(100);
      if (error) throw error;
      return (data ?? []).map((row) => ({
        id: row.id,
        sourceLoopId: row.source_loop_id,
        severity: row.severity,
        status: row.status
      }));
    }
  };
}

export async function recordIngestedEvent(input: {
  deliveryId: string;
  source: string;
  eventId: string;
  runId?: string;
  status?: string;
}) {
  if (!isSupabaseStorageEnabled()) return { duplicate: false };
  const supabase = createSupabaseAdminClient();
  const organizationId = process.env.LOOPGRAPH_HOSTED_ORGANIZATION_ID;
  if (!supabase || !organizationId) return { duplicate: false };

  const { data: existing } = await supabase
    .from("ingested_events")
    .select("delivery_id")
    .eq("organization_id", organizationId)
    .eq("source", input.source)
    .eq("event_id", input.eventId)
    .maybeSingle();

  if (existing) return { duplicate: true };

  const { error } = await supabase.from("ingested_events").insert({
    delivery_id: input.deliveryId,
    organization_id: organizationId,
    source: input.source,
    event_id: input.eventId,
    run_id: input.runId ?? null,
    status: input.status ?? "processed"
  });

  if (error?.code === "23505") return { duplicate: true };
  if (error) throw error;
  return { duplicate: false };
}
