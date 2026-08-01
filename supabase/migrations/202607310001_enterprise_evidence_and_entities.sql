-- Distributed evidence ledger for measurement bindings/jobs, observed outcomes,
-- value proof, and future entity-resolution receipts. Raw provider secrets and
-- payloads are intentionally excluded; only bounded normalized records belong here.

create table if not exists public.loopgraph_evidence_records (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  project_key text not null,
  record_type text not null,
  record_id text not null,
  payload jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (organization_id, project_key, record_type, record_id),
  constraint loopgraph_evidence_project_key_check check (project_key ~ '^[a-z0-9][a-z0-9_-]{0,63}$'),
  constraint loopgraph_evidence_type_check check (record_type in ('metric_binding', 'measurement_job', 'reconciliation', 'metric_sample', 'observed_outcome', 'value_ledger')),
  constraint loopgraph_evidence_id_check check (length(record_id) between 1 and 240),
  constraint loopgraph_evidence_payload_check check (jsonb_typeof(payload) = 'object' and pg_column_size(payload) <= 1048576)
);

create index if not exists loopgraph_evidence_activity_idx
  on public.loopgraph_evidence_records (organization_id, project_key, record_type, updated_at desc);

alter table public.loopgraph_evidence_records enable row level security;
revoke all on public.loopgraph_evidence_records from public, anon, authenticated, service_role;
grant select on public.loopgraph_evidence_records to service_role;

create or replace function public.upsert_loopgraph_evidence_record(
  p_organization_id uuid,
  p_project_key text,
  p_record_type text,
  p_record_id text,
  p_payload jsonb,
  p_expected_revision integer default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_existing jsonb;
begin
  if p_project_key !~ '^[a-z0-9][a-z0-9_-]{0,63}$'
    or p_record_type not in ('metric_binding', 'measurement_job', 'reconciliation', 'metric_sample', 'observed_outcome', 'value_ledger')
    or length(p_record_id) not between 1 and 240
    or jsonb_typeof(p_payload) <> 'object'
    or pg_column_size(p_payload) > 1048576
    or coalesce(p_payload->>'id', '') <> p_record_id
  then
    raise exception 'invalid Loopgraph evidence record';
  end if;

  if p_record_type in ('metric_sample', 'observed_outcome', 'value_ledger') then
    insert into public.loopgraph_evidence_records (
      organization_id, project_key, record_type, record_id, payload, created_at, updated_at
    ) values (
      p_organization_id, p_project_key, p_record_type, p_record_id, p_payload, now(), now()
    ) on conflict do nothing;
    select er.payload into strict v_existing
      from public.loopgraph_evidence_records er
      where er.organization_id = p_organization_id
        and er.project_key = p_project_key
        and er.record_type = p_record_type
        and er.record_id = p_record_id;
    if v_existing <> p_payload then
      raise exception 'immutable Loopgraph evidence conflict';
    end if;
    return v_existing;
  end if;

  select er.payload into v_existing
    from public.loopgraph_evidence_records er
    where er.organization_id = p_organization_id
      and er.project_key = p_project_key
      and er.record_type = p_record_type
      and er.record_id = p_record_id
    for update;

  if p_record_type = 'metric_binding'
    and p_expected_revision is not null
    and coalesce((v_existing->>'revision')::integer, 0) <> p_expected_revision
  then
    raise exception 'metric binding revision conflict';
  end if;

  -- Scheduling is create-only. A racing scheduler must never reset a claimed,
  -- completed, failed, or dead-letter job back to pending.
  if p_record_type = 'measurement_job'
    and p_payload->>'status' = 'pending'
  then
    if v_existing is not null then
      return v_existing;
    end if;
    insert into public.loopgraph_evidence_records (
      organization_id, project_key, record_type, record_id, payload, created_at, updated_at
    ) values (
      p_organization_id, p_project_key, p_record_type, p_record_id, p_payload, now(), now()
    ) on conflict do nothing;
    select er.payload into strict v_existing
      from public.loopgraph_evidence_records er
      where er.organization_id = p_organization_id
        and er.project_key = p_project_key
        and er.record_type = p_record_type
        and er.record_id = p_record_id;
    return v_existing;
  end if;

  insert into public.loopgraph_evidence_records (
    organization_id, project_key, record_type, record_id, payload, created_at, updated_at
  ) values (
    p_organization_id, p_project_key, p_record_type, p_record_id, p_payload, now(), now()
  )
  on conflict (organization_id, project_key, record_type, record_id) do update set
    payload = excluded.payload,
    updated_at = now();
  return p_payload;
end;
$$;

revoke all on function public.upsert_loopgraph_evidence_record(uuid, text, text, text, jsonb, integer)
  from public, anon, authenticated;
grant execute on function public.upsert_loopgraph_evidence_record(uuid, text, text, text, jsonb, integer)
  to service_role;

create or replace function public.finalize_loopgraph_measurement_job(
  p_organization_id uuid,
  p_project_key text,
  p_record_id text,
  p_expected_lease_hash text,
  p_payload jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_existing jsonb;
begin
  if p_project_key !~ '^[a-z0-9][a-z0-9_-]{0,63}$'
    or length(p_record_id) not between 1 and 240
    or length(p_expected_lease_hash) <> 16
    or jsonb_typeof(p_payload) <> 'object'
    or pg_column_size(p_payload) > 1048576
    or p_payload->>'id' <> p_record_id
    or p_payload->>'status' not in ('completed', 'failed', 'dead_letter')
  then
    raise exception 'invalid measurement finalization';
  end if;

  select er.payload into strict v_existing
    from public.loopgraph_evidence_records er
    where er.organization_id = p_organization_id
      and er.project_key = p_project_key
      and er.record_type = 'measurement_job'
      and er.record_id = p_record_id
    for update;

  if v_existing->>'status' <> 'claimed'
    or coalesce(v_existing#>>'{lease,tokenHash}', '') <> p_expected_lease_hash
  then
    raise exception 'measurement lease conflict';
  end if;

  update public.loopgraph_evidence_records
    set payload = p_payload, updated_at = now()
    where organization_id = p_organization_id
      and project_key = p_project_key
      and record_type = 'measurement_job'
      and record_id = p_record_id;
  return p_payload;
end;
$$;

revoke all on function public.finalize_loopgraph_measurement_job(uuid, text, text, text, jsonb)
  from public, anon, authenticated;
grant execute on function public.finalize_loopgraph_measurement_job(uuid, text, text, text, jsonb)
  to service_role;

-- Atomically leases due jobs across hosted workers. SKIP LOCKED ensures two
-- collectors can never receive the same active lease.
create or replace function public.claim_loopgraph_measurement_jobs(
  p_organization_id uuid,
  p_project_key text,
  p_claimed_by text,
  p_limit integer,
  p_lease_seconds integer,
  p_connection_instance_id text default null,
  p_now timestamptz default now()
)
returns table (payload jsonb, lease_token text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  candidate record;
  v_lease_token text;
  v_payload jsonb;
begin
  if p_project_key !~ '^[a-z0-9][a-z0-9_-]{0,63}$'
    or length(trim(p_claimed_by)) = 0
    or p_limit not between 1 and 100
    or p_lease_seconds not between 30 and 3600
  then
    raise exception 'invalid measurement claim';
  end if;

  for candidate in
    select record_id, er.payload
    from public.loopgraph_evidence_records er
    where organization_id = p_organization_id
      and project_key = p_project_key
      and record_type = 'measurement_job'
      and (p_connection_instance_id is null or er.payload->>'connectorInstanceId' = p_connection_instance_id)
      and (er.payload->>'dueAt')::timestamptz <= p_now
      and (
        (
          er.payload->>'status' in ('pending', 'failed')
          and (er.payload->>'attemptCount')::integer < (er.payload->>'maxAttempts')::integer
        )
        or (
          er.payload->>'status' = 'claimed'
          and (er.payload#>>'{lease,expiresAt}')::timestamptz <= p_now
        )
      )
    order by (er.payload->>'dueAt')::timestamptz, record_id
    for update skip locked
    limit p_limit
  loop
    v_lease_token := gen_random_uuid()::text;
    v_payload := (candidate.payload - 'error') || jsonb_build_object(
      'status', 'claimed',
      'attemptCount', (candidate.payload->>'attemptCount')::integer + 1,
      'lease', jsonb_build_object(
        'claimedBy', p_claimed_by,
        'tokenHash', left(encode(digest(v_lease_token, 'sha256'), 'hex'), 16),
        'claimedAt', to_char(p_now at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
        'expiresAt', to_char((p_now + make_interval(secs => p_lease_seconds)) at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
      ),
      'updatedAt', to_char(p_now at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
    );

    update public.loopgraph_evidence_records
      set payload = v_payload, updated_at = p_now
      where organization_id = p_organization_id
        and project_key = p_project_key
        and record_type = 'measurement_job'
        and record_id = candidate.record_id;

    payload := v_payload;
    lease_token := v_lease_token;
    return next;
  end loop;
end;
$$;

revoke all on function public.claim_loopgraph_measurement_jobs(uuid, text, text, integer, integer, text, timestamptz)
  from public, anon, authenticated;
grant execute on function public.claim_loopgraph_measurement_jobs(uuid, text, text, integer, integer, text, timestamptz)
  to service_role;
