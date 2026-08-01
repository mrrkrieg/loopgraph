-- Tenant-scoped routing state and an atomic, lease-based route-job queue.
-- Local CLI workspaces continue to use .loopgraph/routing; hosted runtimes use
-- these service-role-only records so any replica can ingest, inspect, or work.

create table if not exists public.routing_state_records (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  project_key text not null,
  record_type text not null,
  record_id text not null,
  event_id text,
  event_primary boolean not null default false,
  problem_id text,
  route_commit_id text,
  payload jsonb not null,
  revision bigint not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (organization_id, project_key, record_type, record_id),
  constraint routing_state_project_key_check
    check (project_key ~ '^[a-z0-9][a-z0-9_-]{0,63}$'),
  constraint routing_state_record_type_check
    check (record_type in (
      'event_receipt',
      'business_problem',
      'routing_attempt',
      'route_commit',
      'routing_correction',
      'router_evaluation'
    )),
  constraint routing_state_payload_object_check
    check (jsonb_typeof(payload) = 'object'),
  constraint routing_state_payload_size_check
    check (pg_column_size(payload) <= 1048576),
  constraint routing_state_event_primary_check
    check (
      not event_primary
      or (record_type = 'event_receipt' and event_id is not null)
    ),
  constraint routing_state_revision_check
    check (revision >= 1)
);

create index if not exists routing_state_event_idx
  on public.routing_state_records(
    organization_id,
    project_key,
    event_id,
    record_type,
    updated_at desc
  )
  where event_id is not null;
create unique index if not exists routing_state_primary_event_idx
  on public.routing_state_records(organization_id, project_key, event_id)
  where record_type = 'event_receipt' and event_primary;
create index if not exists routing_state_problem_idx
  on public.routing_state_records(
    organization_id,
    project_key,
    problem_id,
    record_type,
    updated_at desc
  )
  where problem_id is not null;
create index if not exists routing_state_commit_idx
  on public.routing_state_records(
    organization_id,
    project_key,
    route_commit_id,
    record_type
  )
  where route_commit_id is not null;

create table if not exists public.route_jobs (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  project_key text not null,
  job_id text not null,
  idempotency_key text not null,
  event_id text not null,
  problem_id text not null,
  route_commit_id text not null,
  loop_id text not null,
  status text not null,
  attempt_count integer not null,
  max_attempts integer not null,
  next_run_at timestamptz not null,
  lease_owner text,
  lease_token text,
  lease_expires_at timestamptz,
  payload jsonb not null,
  revision bigint not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (organization_id, project_key, job_id),
  unique (organization_id, project_key, idempotency_key),
  constraint route_jobs_project_key_check
    check (project_key ~ '^[a-z0-9][a-z0-9_-]{0,63}$'),
  constraint route_jobs_status_check
    check (status in (
      'queued',
      'claimed',
      'running',
      'waiting_review',
      'completed',
      'failed',
      'dead_letter',
      'cancelled'
    )),
  constraint route_jobs_attempt_count_check
    check (attempt_count >= 0 and max_attempts >= 1 and attempt_count <= max_attempts),
  constraint route_jobs_lease_shape_check
    check (
      (lease_owner is null and lease_token is null and lease_expires_at is null)
      or
      (lease_owner is not null and lease_token is not null and lease_expires_at is not null)
    ),
  constraint route_jobs_payload_object_check
    check (jsonb_typeof(payload) = 'object'),
  constraint route_jobs_payload_size_check
    check (pg_column_size(payload) <= 1048576),
  constraint route_jobs_revision_check
    check (revision >= 1)
);

create index if not exists route_jobs_due_claim_idx
  on public.route_jobs(
    organization_id,
    project_key,
    next_run_at,
    created_at
  )
  where status in ('queued', 'failed', 'claimed', 'running');
create index if not exists route_jobs_review_claim_idx
  on public.route_jobs(
    organization_id,
    project_key,
    updated_at
  )
  where status = 'waiting_review';
create index if not exists route_jobs_event_idx
  on public.route_jobs(organization_id, project_key, event_id);
create index if not exists route_jobs_problem_idx
  on public.route_jobs(organization_id, project_key, problem_id);
create index if not exists route_jobs_commit_idx
  on public.route_jobs(organization_id, project_key, route_commit_id);
create index if not exists route_jobs_loop_idx
  on public.route_jobs(organization_id, project_key, loop_id, status);

alter table public.routing_state_records enable row level security;
alter table public.route_jobs enable row level security;
revoke all on public.routing_state_records from public, anon, authenticated, service_role;
revoke all on public.route_jobs from public, anon, authenticated, service_role;
grant select on public.routing_state_records to service_role;
grant select on public.route_jobs to service_role;

create or replace function public.upsert_routing_state_record(
  p_organization_id uuid,
  p_project_key text,
  p_record_type text,
  p_record_id text,
  p_event_id text,
  p_event_primary boolean,
  p_problem_id text,
  p_route_commit_id text,
  p_payload jsonb
)
returns table (
  record jsonb,
  revision bigint
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_project_key !~ '^[a-z0-9][a-z0-9_-]{0,63}$' then
    raise exception 'invalid routing-state project key';
  end if;
  if p_record_type not in (
    'event_receipt',
    'business_problem',
    'routing_attempt',
    'route_commit',
    'routing_correction',
    'router_evaluation'
  ) then
    raise exception 'invalid routing-state record type';
  end if;
  if nullif(btrim(p_record_id), '') is null then
    raise exception 'routing-state record id is required';
  end if;
  if jsonb_typeof(p_payload) <> 'object' or pg_column_size(p_payload) > 1048576 then
    raise exception 'routing-state payload must be an object no larger than 1 MiB';
  end if;

  insert into public.routing_state_records (
    organization_id,
    project_key,
    record_type,
    record_id,
    event_id,
    event_primary,
    problem_id,
    route_commit_id,
    payload
  ) values (
    p_organization_id,
    p_project_key,
    p_record_type,
    p_record_id,
    p_event_id,
    p_event_primary,
    p_problem_id,
    p_route_commit_id,
    p_payload
  )
  on conflict (organization_id, project_key, record_type, record_id)
  do update
    set event_id = excluded.event_id,
        event_primary = excluded.event_primary,
        problem_id = excluded.problem_id,
        route_commit_id = excluded.route_commit_id,
        payload = excluded.payload,
        revision = public.routing_state_records.revision + 1,
        updated_at = now()
  returning payload, public.routing_state_records.revision
    into record, revision;
  return next;
end;
$$;

create or replace function public.create_routing_event_receipt(
  p_organization_id uuid,
  p_project_key text,
  p_record_id text,
  p_event_id text,
  p_payload jsonb
)
returns table (
  receipt jsonb,
  created boolean
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  inserted_receipt public.routing_state_records%rowtype;
  existing_receipt public.routing_state_records%rowtype;
begin
  if p_project_key !~ '^[a-z0-9][a-z0-9_-]{0,63}$'
    or nullif(btrim(p_record_id), '') is null
    or nullif(btrim(p_event_id), '') is null then
    raise exception 'invalid routing event receipt identity';
  end if;
  if jsonb_typeof(p_payload) <> 'object' or pg_column_size(p_payload) > 1048576 then
    raise exception 'routing event receipt must be an object no larger than 1 MiB';
  end if;

  insert into public.routing_state_records (
    organization_id,
    project_key,
    record_type,
    record_id,
    event_id,
    event_primary,
    payload
  ) values (
    p_organization_id,
    p_project_key,
    'event_receipt',
    p_record_id,
    p_event_id,
    true,
    p_payload
  )
  on conflict do nothing
  returning * into inserted_receipt;
  if found then
    return query select inserted_receipt.payload, true;
    return;
  end if;

  select existing.*
    into strict existing_receipt
    from public.routing_state_records existing
    where existing.organization_id = p_organization_id
      and existing.project_key = p_project_key
      and existing.record_type = 'event_receipt'
      and existing.event_id = p_event_id
      and existing.event_primary;
  return query select existing_receipt.payload, false;
end;
$$;

create or replace function public.enqueue_route_job(
  p_organization_id uuid,
  p_project_key text,
  p_job jsonb
)
returns table (
  job jsonb,
  revision bigint,
  created boolean
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_job_id text := p_job ->> 'id';
  v_inserted public.route_jobs%rowtype;
  v_existing public.route_jobs%rowtype;
begin
  if p_project_key !~ '^[a-z0-9][a-z0-9_-]{0,63}$' then
    raise exception 'invalid route-job project key';
  end if;
  if nullif(btrim(v_job_id), '') is null
    or nullif(btrim(p_job ->> 'idempotencyKey'), '') is null then
    raise exception 'route-job id and idempotency key are required';
  end if;
  if jsonb_typeof(p_job) <> 'object' or pg_column_size(p_job) > 1048576 then
    raise exception 'route-job payload must be an object no larger than 1 MiB';
  end if;

  insert into public.route_jobs (
    organization_id,
    project_key,
    job_id,
    idempotency_key,
    event_id,
    problem_id,
    route_commit_id,
    loop_id,
    status,
    attempt_count,
    max_attempts,
    next_run_at,
    lease_owner,
    lease_token,
    lease_expires_at,
    payload
  ) values (
    p_organization_id,
    p_project_key,
    v_job_id,
    p_job ->> 'idempotencyKey',
    p_job ->> 'eventId',
    p_job ->> 'problemId',
    p_job ->> 'routeCommitId',
    p_job ->> 'loopId',
    p_job ->> 'status',
    (p_job ->> 'attemptCount')::integer,
    (p_job ->> 'maxAttempts')::integer,
    (p_job ->> 'nextRunAt')::timestamptz,
    p_job #>> '{lease,claimedBy}',
    p_job #>> '{lease,leaseToken}',
    nullif(p_job #>> '{lease,expiresAt}', '')::timestamptz,
    p_job
  )
  on conflict (organization_id, project_key, job_id) do nothing
  returning * into v_inserted;

  if found then
    return query select v_inserted.payload, v_inserted.revision, true;
    return;
  end if;

  select existing.*
    into strict v_existing
    from public.route_jobs existing
    where existing.organization_id = p_organization_id
      and existing.project_key = p_project_key
      and existing.job_id = v_job_id;
  if v_existing.idempotency_key <> (p_job ->> 'idempotencyKey') then
    raise exception 'route-job idempotency conflict';
  end if;
  return query select v_existing.payload, v_existing.revision, false;
end;
$$;

create or replace function public.claim_due_route_jobs(
  p_organization_id uuid,
  p_project_key text,
  p_claimed_by text,
  p_now timestamptz,
  p_lease_seconds integer,
  p_limit integer
)
returns table (
  job jsonb,
  revision bigint
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  candidate public.route_jobs%rowtype;
  v_job jsonb;
  v_lease_token text;
  v_now_iso text := to_char(
    p_now at time zone 'UTC',
    'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
  );
  v_expires_at timestamptz;
  v_expires_iso text;
begin
  if nullif(btrim(p_claimed_by), '') is null then
    raise exception 'route-job claimant is required';
  end if;
  if p_lease_seconds < 1 or p_lease_seconds > 86400
    or p_limit < 1 or p_limit > 100 then
    raise exception 'invalid route-job claim bounds';
  end if;
  v_expires_at := p_now + make_interval(secs => p_lease_seconds);
  v_expires_iso := to_char(
    v_expires_at at time zone 'UTC',
    'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
  );

  for candidate in
    select queued.*
      from public.route_jobs queued
      where queued.organization_id = p_organization_id
        and queued.project_key = p_project_key
        and queued.status in ('queued', 'failed', 'claimed', 'running')
        and queued.next_run_at <= p_now
        and (
          queued.lease_expires_at is null
          or queued.lease_expires_at <= p_now
        )
        and queued.attempt_count < queued.max_attempts
      order by queued.next_run_at, queued.created_at, queued.job_id
      for update skip locked
      limit p_limit
  loop
    v_lease_token := gen_random_uuid()::text;
    v_job := candidate.payload || jsonb_build_object(
      'status', 'claimed',
      'attemptCount', candidate.attempt_count + 1,
      'lease', jsonb_build_object(
        'claimedBy', p_claimed_by,
        'leaseToken', v_lease_token,
        'claimedAt', v_now_iso,
        'heartbeatAt', v_now_iso,
        'expiresAt', v_expires_iso
      ),
      'updatedAt', v_now_iso
    );

    update public.route_jobs queued
      set status = 'claimed',
          attempt_count = candidate.attempt_count + 1,
          lease_owner = p_claimed_by,
          lease_token = v_lease_token,
          lease_expires_at = v_expires_at,
          payload = v_job,
          revision = queued.revision + 1,
          updated_at = p_now
      where queued.organization_id = candidate.organization_id
        and queued.project_key = candidate.project_key
        and queued.job_id = candidate.job_id
      returning queued.revision into revision;
    job := v_job;
    return next;
  end loop;
end;
$$;

create or replace function public.claim_waiting_review_route_jobs(
  p_organization_id uuid,
  p_project_key text,
  p_claimed_by text,
  p_now timestamptz,
  p_lease_seconds integer,
  p_limit integer
)
returns table (
  job jsonb,
  revision bigint
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  candidate public.route_jobs%rowtype;
  v_job jsonb;
  v_lease_token text;
  v_now_iso text := to_char(
    p_now at time zone 'UTC',
    'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
  );
  v_expires_at timestamptz;
  v_expires_iso text;
begin
  if nullif(btrim(p_claimed_by), '') is null then
    raise exception 'route-job claimant is required';
  end if;
  if p_lease_seconds < 1 or p_lease_seconds > 86400
    or p_limit < 1 or p_limit > 100 then
    raise exception 'invalid route-job review-claim bounds';
  end if;
  v_expires_at := p_now + make_interval(secs => p_lease_seconds);
  v_expires_iso := to_char(
    v_expires_at at time zone 'UTC',
    'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
  );

  for candidate in
    select waiting.*
      from public.route_jobs waiting
      where waiting.organization_id = p_organization_id
        and waiting.project_key = p_project_key
        and waiting.status = 'waiting_review'
        and (
          waiting.lease_expires_at is null
          or waiting.lease_expires_at <= p_now
        )
      order by waiting.updated_at, waiting.job_id
      for update skip locked
      limit p_limit
  loop
    v_lease_token := gen_random_uuid()::text;
    v_job := candidate.payload || jsonb_build_object(
      'lease', jsonb_build_object(
        'claimedBy', p_claimed_by,
        'leaseToken', v_lease_token,
        'claimedAt', v_now_iso,
        'heartbeatAt', v_now_iso,
        'expiresAt', v_expires_iso
      ),
      'updatedAt', v_now_iso
    );

    update public.route_jobs waiting
      set lease_owner = p_claimed_by,
          lease_token = v_lease_token,
          lease_expires_at = v_expires_at,
          payload = v_job,
          revision = waiting.revision + 1,
          updated_at = p_now
      where waiting.organization_id = candidate.organization_id
        and waiting.project_key = candidate.project_key
        and waiting.job_id = candidate.job_id
      returning waiting.revision into revision;
    job := v_job;
    return next;
  end loop;
end;
$$;

create or replace function public.compare_and_swap_route_job(
  p_organization_id uuid,
  p_project_key text,
  p_job_id text,
  p_expected_revision bigint,
  p_expected_lease_token text,
  p_job jsonb
)
returns table (
  updated boolean,
  job jsonb,
  revision bigint,
  conflict_reason text
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_job public.route_jobs%rowtype;
begin
  if p_job_id <> (p_job ->> 'id') then
    raise exception 'route-job identity cannot change';
  end if;
  if jsonb_typeof(p_job) <> 'object' or pg_column_size(p_job) > 1048576 then
    raise exception 'route-job payload must be an object no larger than 1 MiB';
  end if;

  select stored.*
    into current_job
    from public.route_jobs stored
    where stored.organization_id = p_organization_id
      and stored.project_key = p_project_key
      and stored.job_id = p_job_id
    for update;
  if not found then
    return query select false, null::jsonb, null::bigint, 'not_found'::text;
    return;
  end if;
  if current_job.revision <> p_expected_revision then
    return query select
      false,
      current_job.payload,
      current_job.revision,
      'revision_conflict'::text;
    return;
  end if;
  if p_expected_lease_token is not null
    and current_job.lease_token is distinct from p_expected_lease_token then
    return query select
      false,
      current_job.payload,
      current_job.revision,
      'lease_lost'::text;
    return;
  end if;

  update public.route_jobs stored
    set idempotency_key = p_job ->> 'idempotencyKey',
        event_id = p_job ->> 'eventId',
        problem_id = p_job ->> 'problemId',
        route_commit_id = p_job ->> 'routeCommitId',
        loop_id = p_job ->> 'loopId',
        status = p_job ->> 'status',
        attempt_count = (p_job ->> 'attemptCount')::integer,
        max_attempts = (p_job ->> 'maxAttempts')::integer,
        next_run_at = (p_job ->> 'nextRunAt')::timestamptz,
        lease_owner = p_job #>> '{lease,claimedBy}',
        lease_token = p_job #>> '{lease,leaseToken}',
        lease_expires_at = nullif(p_job #>> '{lease,expiresAt}', '')::timestamptz,
        payload = p_job,
        revision = stored.revision + 1,
        updated_at = (p_job ->> 'updatedAt')::timestamptz
    where stored.organization_id = p_organization_id
      and stored.project_key = p_project_key
      and stored.job_id = p_job_id
      and stored.revision = p_expected_revision
    returning stored.payload, stored.revision
      into job, revision;
  return query select true, job, revision, null::text;
end;
$$;

revoke all on function public.enqueue_route_job(uuid, text, jsonb)
  from public, anon, authenticated;
revoke all on function public.upsert_routing_state_record(
  uuid,
  text,
  text,
  text,
  text,
  boolean,
  text,
  text,
  jsonb
) from public, anon, authenticated;
revoke all on function public.create_routing_event_receipt(
  uuid,
  text,
  text,
  text,
  jsonb
) from public, anon, authenticated;
revoke all on function public.claim_due_route_jobs(
  uuid,
  text,
  text,
  timestamptz,
  integer,
  integer
) from public, anon, authenticated;
revoke all on function public.claim_waiting_review_route_jobs(
  uuid,
  text,
  text,
  timestamptz,
  integer,
  integer
) from public, anon, authenticated;
revoke all on function public.compare_and_swap_route_job(
  uuid,
  text,
  text,
  bigint,
  text,
  jsonb
) from public, anon, authenticated;
grant execute on function public.enqueue_route_job(uuid, text, jsonb)
  to service_role;
grant execute on function public.upsert_routing_state_record(
  uuid,
  text,
  text,
  text,
  text,
  boolean,
  text,
  text,
  jsonb
) to service_role;
grant execute on function public.create_routing_event_receipt(
  uuid,
  text,
  text,
  text,
  jsonb
) to service_role;
grant execute on function public.claim_due_route_jobs(
  uuid,
  text,
  text,
  timestamptz,
  integer,
  integer
) to service_role;
grant execute on function public.claim_waiting_review_route_jobs(
  uuid,
  text,
  text,
  timestamptz,
  integer,
  integer
) to service_role;
grant execute on function public.compare_and_swap_route_job(
  uuid,
  text,
  text,
  bigint,
  text,
  jsonb
) to service_role;

-- Extend the existing protected operational snapshot now that queue state is
-- queryable across replicas.
create or replace function public.get_loopgraph_operational_snapshot(
  p_organization_id uuid,
  p_project_key text
)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select jsonb_build_object(
    'database_ready', true,
    'captured_at', now(),
    'machine_requests_5m', (
      select count(*)
      from public.machine_request_receipts receipt
      where receipt.organization_id = p_organization_id
        and receipt.project_key = p_project_key
        and receipt.received_at >= now() - interval '5 minutes'
    ),
    'machine_rate_limited_5m', (
      select count(*)
      from public.machine_request_receipts receipt
      where receipt.organization_id = p_organization_id
        and receipt.project_key = p_project_key
        and receipt.decision = 'rate_limited'
        and receipt.received_at >= now() - interval '5 minutes'
    ),
    'machine_denied_5m', (
      select count(*)
      from public.security_audit_events audit
      where audit.organization_id = p_organization_id
        and audit.project_key = p_project_key
        and audit.event_type = 'machine.request.denied'
        and audit.occurred_at >= now() - interval '5 minutes'
    ),
    'audit_events_total', (
      select count(*)
      from public.security_audit_events audit
      where audit.organization_id = p_organization_id
        and audit.project_key = p_project_key
    ),
    'audit_head_sequence', coalesce((
      select max(audit.sequence_number)
      from public.security_audit_events audit
      where audit.organization_id = p_organization_id
        and audit.project_key = p_project_key
    ), 0),
    'last_machine_request_at', (
      select max(receipt.received_at)
      from public.machine_request_receipts receipt
      where receipt.organization_id = p_organization_id
        and receipt.project_key = p_project_key
    ),
    'route_jobs_queued', (
      select count(*)
      from public.route_jobs queued
      where queued.organization_id = p_organization_id
        and queued.project_key = p_project_key
        and queued.status in ('queued', 'failed')
    ),
    'route_jobs_running', (
      select count(*)
      from public.route_jobs running
      where running.organization_id = p_organization_id
        and running.project_key = p_project_key
        and running.status in ('claimed', 'running')
    ),
    'route_jobs_waiting_review', (
      select count(*)
      from public.route_jobs waiting
      where waiting.organization_id = p_organization_id
        and waiting.project_key = p_project_key
        and waiting.status = 'waiting_review'
    ),
    'route_jobs_dead_letter', (
      select count(*)
      from public.route_jobs dead
      where dead.organization_id = p_organization_id
        and dead.project_key = p_project_key
        and dead.status = 'dead_letter'
    ),
    'route_jobs_due', (
      select count(*)
      from public.route_jobs due
      where due.organization_id = p_organization_id
        and due.project_key = p_project_key
        and due.status in ('queued', 'failed', 'claimed', 'running')
        and due.next_run_at <= now()
        and (due.lease_expires_at is null or due.lease_expires_at <= now())
        and due.attempt_count < due.max_attempts
    ),
    'route_job_expired_leases', (
      select count(*)
      from public.route_jobs leased
      where leased.organization_id = p_organization_id
        and leased.project_key = p_project_key
        and leased.status in ('claimed', 'running', 'waiting_review')
        and leased.lease_expires_at <= now()
    ),
    'route_job_oldest_due_seconds', coalesce((
      select greatest(
        0,
        floor(extract(epoch from (now() - min(due.next_run_at))))
      )::bigint
      from public.route_jobs due
      where due.organization_id = p_organization_id
        and due.project_key = p_project_key
        and due.status in ('queued', 'failed', 'claimed', 'running')
        and due.next_run_at <= now()
        and (due.lease_expires_at is null or due.lease_expires_at <= now())
        and due.attempt_count < due.max_attempts
    ), 0)
  );
$$;
