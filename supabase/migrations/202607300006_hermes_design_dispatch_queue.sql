-- Durable outbound Hermes delivery. Hosted replicas commit design tasks and
-- dispatch jobs together, then workers claim jobs with expiring leases.

create table if not exists public.hermes_design_dispatch_jobs (
  organization_id uuid not null,
  project_key text not null,
  job_id text not null,
  idempotency_key text not null,
  task_id text not null,
  status text not null,
  attempt_count integer not null default 0,
  max_attempts integer not null default 5,
  next_run_at timestamptz not null,
  lease_token text,
  claimed_by text,
  claimed_at timestamptz,
  lease_expires_at timestamptz,
  payload jsonb not null,
  revision bigint not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (organization_id, project_key, job_id),
  foreign key (organization_id, project_key, task_id)
    references public.hermes_design_tasks(organization_id, project_key, task_id)
    on delete cascade,
  constraint hermes_design_dispatch_jobs_project_key_check
    check (project_key ~ '^[a-z0-9][a-z0-9_-]{0,63}$'),
  constraint hermes_design_dispatch_jobs_status_check
    check (status in (
      'queued',
      'claimed',
      'completed',
      'failed',
      'dead_letter',
      'cancelled'
    )),
  constraint hermes_design_dispatch_jobs_attempts_check
    check (attempt_count >= 0 and max_attempts between 1 and 100),
  constraint hermes_design_dispatch_jobs_payload_object_check
    check (jsonb_typeof(payload) = 'object'),
  constraint hermes_design_dispatch_jobs_payload_size_check
    check (pg_column_size(payload) <= 1048576),
  constraint hermes_design_dispatch_jobs_revision_check
    check (revision >= 1),
  constraint hermes_design_dispatch_jobs_lease_check
    check (
      (status = 'claimed'
        and lease_token is not null
        and claimed_by is not null
        and claimed_at is not null
        and lease_expires_at is not null)
      or
      (status <> 'claimed'
        and lease_token is null
        and claimed_by is null
        and claimed_at is null
        and lease_expires_at is null)
    )
);

create unique index if not exists hermes_design_dispatch_jobs_idempotency_idx
  on public.hermes_design_dispatch_jobs(
    organization_id,
    project_key,
    idempotency_key
  );
create index if not exists hermes_design_dispatch_jobs_due_idx
  on public.hermes_design_dispatch_jobs(
    organization_id,
    project_key,
    next_run_at,
    created_at
  )
  where status in ('queued', 'failed', 'claimed');
create index if not exists hermes_design_dispatch_jobs_task_idx
  on public.hermes_design_dispatch_jobs(
    organization_id,
    project_key,
    task_id,
    created_at desc
  );

alter table public.hermes_design_dispatch_jobs enable row level security;
revoke all on public.hermes_design_dispatch_jobs
  from public, anon, authenticated, service_role;
grant select on public.hermes_design_dispatch_jobs to service_role;

create or replace function public.enqueue_hermes_design_dispatch_job(
  p_organization_id uuid,
  p_project_key text,
  p_job jsonb
)
returns table (
  job jsonb,
  created boolean,
  revision bigint
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  inserted_job public.hermes_design_dispatch_jobs%rowtype;
  existing_job public.hermes_design_dispatch_jobs%rowtype;
begin
  if p_project_key !~ '^[a-z0-9][a-z0-9_-]{0,63}$' then
    raise exception 'invalid Hermes design project key';
  end if;
  if jsonb_typeof(p_job) <> 'object' or pg_column_size(p_job) > 1048576 then
    raise exception 'Hermes design dispatch job must be an object no larger than 1 MiB';
  end if;
  if nullif(btrim(p_job->>'id'), '') is null
    or nullif(btrim(p_job->>'idempotencyKey'), '') is null
    or nullif(btrim(p_job->>'taskId'), '') is null then
    raise exception 'Hermes design dispatch identity is incomplete';
  end if;
  if not exists (
    select 1
    from public.hermes_design_tasks task
    where task.organization_id = p_organization_id
      and task.project_key = p_project_key
      and task.task_id = p_job->>'taskId'
  ) then
    raise exception 'Hermes design task does not exist for dispatch';
  end if;

  insert into public.hermes_design_dispatch_jobs (
    organization_id,
    project_key,
    job_id,
    idempotency_key,
    task_id,
    status,
    attempt_count,
    max_attempts,
    next_run_at,
    lease_token,
    claimed_by,
    claimed_at,
    lease_expires_at,
    payload,
    created_at,
    updated_at
  ) values (
    p_organization_id,
    p_project_key,
    p_job->>'id',
    p_job->>'idempotencyKey',
    p_job->>'taskId',
    p_job->>'status',
    coalesce((p_job->>'attemptCount')::integer, 0),
    coalesce((p_job->>'maxAttempts')::integer, 5),
    (p_job->>'nextRunAt')::timestamptz,
    nullif(p_job#>>'{lease,leaseToken}', ''),
    nullif(p_job#>>'{lease,claimedBy}', ''),
    nullif(p_job#>>'{lease,claimedAt}', '')::timestamptz,
    nullif(p_job#>>'{lease,expiresAt}', '')::timestamptz,
    p_job,
    coalesce((p_job->>'createdAt')::timestamptz, now()),
    coalesce((p_job->>'updatedAt')::timestamptz, now())
  )
  on conflict do nothing
  returning * into inserted_job;

  if found then
    return query select inserted_job.payload, true, inserted_job.revision;
    return;
  end if;

  select queued.*
    into existing_job
    from public.hermes_design_dispatch_jobs queued
   where queued.organization_id = p_organization_id
     and queued.project_key = p_project_key
     and (
       queued.job_id = p_job->>'id'
       or queued.idempotency_key = p_job->>'idempotencyKey'
     )
   order by (queued.job_id = p_job->>'id') desc, queued.created_at desc
   limit 1;
  if not found then
    raise exception 'Hermes design dispatch conflict could not be resolved';
  end if;
  if existing_job.task_id <> p_job->>'taskId' then
    raise exception 'Hermes design dispatch identity is bound to another task';
  end if;
  return query select existing_job.payload, false, existing_job.revision;
end;
$$;

create or replace function public.create_hermes_design_task_with_dispatch(
  p_organization_id uuid,
  p_project_key text,
  p_task jsonb,
  p_dispatch_job jsonb
)
returns table (
  task jsonb,
  created boolean,
  revision bigint,
  dispatch_job jsonb,
  dispatch_created boolean,
  dispatch_revision bigint
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  task_result record;
  dispatch_result record;
begin
  select *
    into task_result
    from public.create_hermes_design_task(
      p_organization_id,
      p_project_key,
      p_task
    );
  if p_dispatch_job->>'taskId' <> task_result.task->>'id' then
    raise exception 'Hermes design dispatch does not belong to the created task';
  end if;
  select *
    into dispatch_result
    from public.enqueue_hermes_design_dispatch_job(
      p_organization_id,
      p_project_key,
      p_dispatch_job
    );
  return query select
    task_result.task,
    task_result.created,
    task_result.revision,
    dispatch_result.job,
    dispatch_result.created,
    dispatch_result.revision;
end;
$$;

create or replace function public.claim_hermes_design_dispatch_jobs(
  p_organization_id uuid,
  p_project_key text,
  p_claimed_by text,
  p_now timestamptz,
  p_lease_seconds integer,
  p_limit integer
)
returns table (job jsonb)
language plpgsql
security definer
set search_path = ''
as $$
declare
  candidate public.hermes_design_dispatch_jobs%rowtype;
  claimed_payload jsonb;
  claimed_token text;
  claimed_expires_at timestamptz;
begin
  if p_project_key !~ '^[a-z0-9][a-z0-9_-]{0,63}$'
    or nullif(btrim(p_claimed_by), '') is null
    or p_lease_seconds not between 30 and 3600
    or p_limit not between 1 and 100 then
    raise exception 'invalid Hermes design dispatch claim';
  end if;

  update public.hermes_design_dispatch_jobs exhausted
     set status = 'dead_letter',
         lease_token = null,
         claimed_by = null,
         claimed_at = null,
         lease_expires_at = null,
         payload = (
           exhausted.payload - 'lease'
         ) || jsonb_build_object(
           'status', 'dead_letter',
           'deadLetterReason',
             'Dispatch worker lease expired after the maximum attempt count.',
           'updatedAt', p_now
         ),
         revision = exhausted.revision + 1,
         updated_at = p_now
   where exhausted.organization_id = p_organization_id
     and exhausted.project_key = p_project_key
     and exhausted.status = 'claimed'
     and exhausted.lease_expires_at <= p_now
     and exhausted.attempt_count >= exhausted.max_attempts;

  for candidate in
    select queued.*
      from public.hermes_design_dispatch_jobs queued
     where queued.organization_id = p_organization_id
       and queued.project_key = p_project_key
       and queued.attempt_count < queued.max_attempts
       and (
         (
           queued.status in ('queued', 'failed')
           and queued.next_run_at <= p_now
         )
         or
         (
           queued.status = 'claimed'
           and queued.lease_expires_at <= p_now
         )
       )
     order by queued.next_run_at, queued.created_at, queued.job_id
     for update skip locked
     limit p_limit
  loop
    claimed_token := gen_random_uuid()::text;
    claimed_expires_at := p_now + make_interval(secs => p_lease_seconds);
    claimed_payload := (
      candidate.payload - 'lease'
    ) || jsonb_build_object(
      'status', 'claimed',
      'attemptCount', candidate.attempt_count + 1,
      'lease', jsonb_build_object(
        'claimedBy', p_claimed_by,
        'leaseToken', claimed_token,
        'claimedAt', p_now,
        'expiresAt', claimed_expires_at
      ),
      'updatedAt', p_now
    );
    update public.hermes_design_dispatch_jobs saved
       set status = 'claimed',
           attempt_count = candidate.attempt_count + 1,
           lease_token = claimed_token,
           claimed_by = p_claimed_by,
           claimed_at = p_now,
           lease_expires_at = claimed_expires_at,
           payload = claimed_payload,
           revision = saved.revision + 1,
           updated_at = p_now
     where saved.organization_id = p_organization_id
       and saved.project_key = p_project_key
       and saved.job_id = candidate.job_id;
    return query select claimed_payload;
  end loop;
end;
$$;

create or replace function public.compare_and_swap_hermes_design_task_with_dispatch(
  p_organization_id uuid,
  p_project_key text,
  p_task_id text,
  p_expected_revision bigint,
  p_task jsonb,
  p_dispatch_job jsonb
)
returns table (
  updated boolean,
  task jsonb,
  revision bigint,
  conflict_reason text,
  dispatch_job jsonb,
  dispatch_created boolean
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  task_result record;
  dispatch_result record;
begin
  select *
    into task_result
    from public.compare_and_swap_hermes_design_task(
      p_organization_id,
      p_project_key,
      p_task_id,
      p_expected_revision,
      p_task
    );
  if not task_result.updated then
    return query select
      false,
      task_result.task,
      task_result.revision,
      task_result.conflict_reason,
      null::jsonb,
      null::boolean;
    return;
  end if;
  if p_dispatch_job->>'taskId' <> task_result.task->>'id' then
    raise exception 'Hermes design dispatch does not belong to the updated task';
  end if;
  select *
    into dispatch_result
    from public.enqueue_hermes_design_dispatch_job(
      p_organization_id,
      p_project_key,
      p_dispatch_job
    );
  return query select
    true,
    task_result.task,
    task_result.revision,
    null::text,
    dispatch_result.job,
    dispatch_result.created;
end;
$$;

create or replace function public.compare_and_swap_hermes_design_dispatch_job(
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
  current_job public.hermes_design_dispatch_jobs%rowtype;
  saved_job public.hermes_design_dispatch_jobs%rowtype;
begin
  if p_project_key !~ '^[a-z0-9][a-z0-9_-]{0,63}$'
    or nullif(btrim(p_job_id), '') is null then
    raise exception 'invalid Hermes design dispatch identity';
  end if;
  if jsonb_typeof(p_job) <> 'object' or pg_column_size(p_job) > 1048576 then
    raise exception 'Hermes design dispatch job must be an object no larger than 1 MiB';
  end if;

  select queued.*
    into current_job
    from public.hermes_design_dispatch_jobs queued
   where queued.organization_id = p_organization_id
     and queued.project_key = p_project_key
     and queued.job_id = p_job_id
   for update;
  if not found then
    return query select false, null::jsonb, null::bigint, 'not_found'::text;
    return;
  end if;
  if current_job.revision <> p_expected_revision then
    return query
      select false, current_job.payload, current_job.revision,
        'revision_conflict'::text;
    return;
  end if;
  if p_expected_lease_token is not null
    and current_job.lease_token is distinct from p_expected_lease_token then
    return query
      select false, current_job.payload, current_job.revision, 'lease_lost'::text;
    return;
  end if;
  if p_job->>'id' <> current_job.job_id
    or p_job->>'idempotencyKey' <> current_job.idempotency_key
    or p_job->>'taskId' <> current_job.task_id then
    raise exception 'Hermes design dispatch identity cannot change';
  end if;

  update public.hermes_design_dispatch_jobs saved
     set status = p_job->>'status',
         attempt_count = (p_job->>'attemptCount')::integer,
         max_attempts = (p_job->>'maxAttempts')::integer,
         next_run_at = (p_job->>'nextRunAt')::timestamptz,
         lease_token = nullif(p_job#>>'{lease,leaseToken}', ''),
         claimed_by = nullif(p_job#>>'{lease,claimedBy}', ''),
         claimed_at = nullif(p_job#>>'{lease,claimedAt}', '')::timestamptz,
         lease_expires_at = nullif(p_job#>>'{lease,expiresAt}', '')::timestamptz,
         payload = p_job,
         revision = saved.revision + 1,
         updated_at = coalesce((p_job->>'updatedAt')::timestamptz, now())
   where saved.organization_id = p_organization_id
     and saved.project_key = p_project_key
     and saved.job_id = p_job_id
  returning saved.* into saved_job;
  return query select true, saved_job.payload, saved_job.revision, null::text;
end;
$$;

revoke all on function public.enqueue_hermes_design_dispatch_job(
  uuid, text, jsonb
) from public, anon, authenticated;
revoke all on function public.create_hermes_design_task_with_dispatch(
  uuid, text, jsonb, jsonb
) from public, anon, authenticated;
revoke all on function public.claim_hermes_design_dispatch_jobs(
  uuid, text, text, timestamptz, integer, integer
) from public, anon, authenticated;
revoke all on function public.compare_and_swap_hermes_design_task_with_dispatch(
  uuid, text, text, bigint, jsonb, jsonb
) from public, anon, authenticated;
revoke all on function public.compare_and_swap_hermes_design_dispatch_job(
  uuid, text, text, bigint, text, jsonb
) from public, anon, authenticated;
grant execute on function public.enqueue_hermes_design_dispatch_job(
  uuid, text, jsonb
) to service_role;
grant execute on function public.create_hermes_design_task_with_dispatch(
  uuid, text, jsonb, jsonb
) to service_role;
grant execute on function public.claim_hermes_design_dispatch_jobs(
  uuid, text, text, timestamptz, integer, integer
) to service_role;
grant execute on function public.compare_and_swap_hermes_design_task_with_dispatch(
  uuid, text, text, bigint, jsonb, jsonb
) to service_role;
grant execute on function public.compare_and_swap_hermes_design_dispatch_job(
  uuid, text, text, bigint, text, jsonb
) to service_role;

-- Extend the protected operational snapshot with outbound Hermes queue health.
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
      select count(*) from public.machine_request_receipts receipt
      where receipt.organization_id = p_organization_id
        and receipt.project_key = p_project_key
        and receipt.received_at >= now() - interval '5 minutes'
    ),
    'machine_rate_limited_5m', (
      select count(*) from public.machine_request_receipts receipt
      where receipt.organization_id = p_organization_id
        and receipt.project_key = p_project_key
        and receipt.decision = 'rate_limited'
        and receipt.received_at >= now() - interval '5 minutes'
    ),
    'machine_denied_5m', (
      select count(*) from public.security_audit_events audit
      where audit.organization_id = p_organization_id
        and audit.project_key = p_project_key
        and audit.event_type = 'machine.request.denied'
        and audit.occurred_at >= now() - interval '5 minutes'
    ),
    'audit_events_total', (
      select count(*) from public.security_audit_events audit
      where audit.organization_id = p_organization_id
        and audit.project_key = p_project_key
    ),
    'audit_head_sequence', coalesce((
      select max(audit.sequence_number) from public.security_audit_events audit
      where audit.organization_id = p_organization_id
        and audit.project_key = p_project_key
    ), 0),
    'last_machine_request_at', (
      select max(receipt.received_at) from public.machine_request_receipts receipt
      where receipt.organization_id = p_organization_id
        and receipt.project_key = p_project_key
    ),
    'route_jobs_queued', (
      select count(*) from public.route_jobs queued
      where queued.organization_id = p_organization_id
        and queued.project_key = p_project_key
        and queued.status in ('queued', 'failed')
    ),
    'route_jobs_running', (
      select count(*) from public.route_jobs running
      where running.organization_id = p_organization_id
        and running.project_key = p_project_key
        and running.status in ('claimed', 'running')
    ),
    'route_jobs_waiting_review', (
      select count(*) from public.route_jobs waiting
      where waiting.organization_id = p_organization_id
        and waiting.project_key = p_project_key
        and waiting.status = 'waiting_review'
    ),
    'route_jobs_dead_letter', (
      select count(*) from public.route_jobs dead
      where dead.organization_id = p_organization_id
        and dead.project_key = p_project_key
        and dead.status = 'dead_letter'
    ),
    'route_jobs_due', (
      select count(*) from public.route_jobs due
      where due.organization_id = p_organization_id
        and due.project_key = p_project_key
        and due.status in ('queued', 'failed', 'claimed', 'running')
        and due.next_run_at <= now()
        and (due.lease_expires_at is null or due.lease_expires_at <= now())
        and due.attempt_count < due.max_attempts
    ),
    'route_job_expired_leases', (
      select count(*) from public.route_jobs leased
      where leased.organization_id = p_organization_id
        and leased.project_key = p_project_key
        and leased.status in ('claimed', 'running', 'waiting_review')
        and leased.lease_expires_at <= now()
    ),
    'route_job_oldest_due_seconds', coalesce((
      select greatest(0, floor(extract(epoch from (now() - min(due.next_run_at)))))::bigint
      from public.route_jobs due
      where due.organization_id = p_organization_id
        and due.project_key = p_project_key
        and due.status in ('queued', 'failed', 'claimed', 'running')
        and due.next_run_at <= now()
        and (due.lease_expires_at is null or due.lease_expires_at <= now())
        and due.attempt_count < due.max_attempts
    ), 0),
    'hermes_dispatch_queued', (
      select count(*) from public.hermes_design_dispatch_jobs queued
      where queued.organization_id = p_organization_id
        and queued.project_key = p_project_key
        and queued.status in ('queued', 'failed')
    ),
    'hermes_dispatch_running', (
      select count(*) from public.hermes_design_dispatch_jobs running
      where running.organization_id = p_organization_id
        and running.project_key = p_project_key
        and running.status = 'claimed'
    ),
    'hermes_dispatch_dead_letter', (
      select count(*) from public.hermes_design_dispatch_jobs dead
      where dead.organization_id = p_organization_id
        and dead.project_key = p_project_key
        and dead.status = 'dead_letter'
    ),
    'hermes_dispatch_due', (
      select count(*) from public.hermes_design_dispatch_jobs due
      where due.organization_id = p_organization_id
        and due.project_key = p_project_key
        and due.status in ('queued', 'failed', 'claimed')
        and due.next_run_at <= now()
        and (due.lease_expires_at is null or due.lease_expires_at <= now())
        and due.attempt_count < due.max_attempts
    ),
    'hermes_dispatch_expired_leases', (
      select count(*) from public.hermes_design_dispatch_jobs leased
      where leased.organization_id = p_organization_id
        and leased.project_key = p_project_key
        and leased.status = 'claimed'
        and leased.lease_expires_at <= now()
    ),
    'hermes_dispatch_oldest_due_seconds', coalesce((
      select greatest(0, floor(extract(epoch from (now() - min(due.next_run_at)))))::bigint
      from public.hermes_design_dispatch_jobs due
      where due.organization_id = p_organization_id
        and due.project_key = p_project_key
        and due.status in ('queued', 'failed', 'claimed')
        and due.next_run_at <= now()
        and (due.lease_expires_at is null or due.lease_expires_at <= now())
        and due.attempt_count < due.max_attempts
    ), 0)
  );
$$;
