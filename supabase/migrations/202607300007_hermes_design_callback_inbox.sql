-- Durable inbound Hermes callback inbox. Signed callback authorization and
-- callback persistence share one transaction so replay acceptance can never
-- outlive the work needed to process the callback.

create table if not exists public.hermes_design_callback_jobs (
  organization_id uuid not null,
  project_key text not null,
  job_id text not null,
  idempotency_key text not null,
  task_id text not null,
  callback_id text not null,
  request_hash text not null,
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
  constraint hermes_design_callback_jobs_project_key_check
    check (project_key ~ '^[a-z0-9][a-z0-9_-]{0,63}$'),
  constraint hermes_design_callback_jobs_request_hash_check
    check (request_hash ~ '^[a-f0-9]{64}$'),
  constraint hermes_design_callback_jobs_status_check
    check (status in (
      'queued',
      'claimed',
      'completed',
      'failed',
      'dead_letter',
      'cancelled'
    )),
  constraint hermes_design_callback_jobs_attempts_check
    check (attempt_count >= 0 and max_attempts between 1 and 100),
  constraint hermes_design_callback_jobs_payload_object_check
    check (jsonb_typeof(payload) = 'object'),
  constraint hermes_design_callback_jobs_payload_size_check
    check (pg_column_size(payload) <= 1048576),
  constraint hermes_design_callback_jobs_revision_check
    check (revision >= 1),
  constraint hermes_design_callback_jobs_lease_check
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

create unique index if not exists hermes_design_callback_jobs_idempotency_idx
  on public.hermes_design_callback_jobs(
    organization_id,
    project_key,
    idempotency_key
  );
create unique index if not exists hermes_design_callback_jobs_callback_idx
  on public.hermes_design_callback_jobs(
    organization_id,
    project_key,
    callback_id
  );
create index if not exists hermes_design_callback_jobs_due_idx
  on public.hermes_design_callback_jobs(
    organization_id,
    project_key,
    next_run_at,
    created_at
  )
  where status in ('queued', 'failed', 'claimed');
create index if not exists hermes_design_callback_jobs_task_idx
  on public.hermes_design_callback_jobs(
    organization_id,
    project_key,
    task_id,
    created_at desc
  );

alter table public.hermes_design_callback_jobs enable row level security;
revoke all on public.hermes_design_callback_jobs
  from public, anon, authenticated, service_role;
grant select on public.hermes_design_callback_jobs to service_role;

create or replace function public.enqueue_hermes_design_callback_job(
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
  inserted_job public.hermes_design_callback_jobs%rowtype;
  existing_job public.hermes_design_callback_jobs%rowtype;
begin
  if p_project_key !~ '^[a-z0-9][a-z0-9_-]{0,63}$' then
    raise exception 'invalid Hermes callback project key';
  end if;
  if jsonb_typeof(p_job) <> 'object' or pg_column_size(p_job) > 1048576 then
    raise exception 'Hermes callback job must be an object no larger than 1 MiB';
  end if;
  if nullif(btrim(p_job->>'id'), '') is null
    or nullif(btrim(p_job->>'idempotencyKey'), '') is null
    or nullif(btrim(p_job->>'taskId'), '') is null
    or nullif(btrim(p_job->>'callbackId'), '') is null
    or (p_job->>'requestHash') !~ '^[a-f0-9]{64}$' then
    raise exception 'Hermes callback job identity is incomplete';
  end if;
  if p_job#>>'{callback,taskId}' <> p_job->>'taskId'
    or p_job#>>'{callback,callbackId}' <> p_job->>'callbackId' then
    raise exception 'Hermes callback payload identity does not match its job';
  end if;
  if not exists (
    select 1
    from public.hermes_design_tasks task
    where task.organization_id = p_organization_id
      and task.project_key = p_project_key
      and task.task_id = p_job->>'taskId'
  ) then
    raise exception 'Hermes design task does not exist for callback';
  end if;

  insert into public.hermes_design_callback_jobs (
    organization_id,
    project_key,
    job_id,
    idempotency_key,
    task_id,
    callback_id,
    request_hash,
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
    p_job->>'callbackId',
    p_job->>'requestHash',
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
    from public.hermes_design_callback_jobs queued
   where queued.organization_id = p_organization_id
     and queued.project_key = p_project_key
     and (
       queued.job_id = p_job->>'id'
       or queued.idempotency_key = p_job->>'idempotencyKey'
       or queued.callback_id = p_job->>'callbackId'
     )
   order by
     (queued.callback_id = p_job->>'callbackId') desc,
     (queued.job_id = p_job->>'id') desc,
     queued.created_at desc
   limit 1;
  if not found then
    raise exception 'Hermes callback conflict could not be resolved';
  end if;
  if existing_job.task_id <> p_job->>'taskId'
    or existing_job.callback_id <> p_job->>'callbackId'
    or existing_job.request_hash <> p_job->>'requestHash' then
    raise exception 'Hermes callback identity was used with another signed payload';
  end if;
  return query select existing_job.payload, false, existing_job.revision;
end;
$$;

create or replace function public.authorize_and_enqueue_hermes_design_callback(
  p_organization_id uuid,
  p_project_key text,
  p_credential_id text,
  p_capability text,
  p_request_id text,
  p_request_hash text,
  p_requested_at timestamptz,
  p_rate_limit integer,
  p_job jsonb
)
returns table (
  authorized boolean,
  reason text,
  retry_after_seconds integer,
  job jsonb,
  created boolean,
  revision bigint
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  existing_job public.hermes_design_callback_jobs%rowtype;
  guard_result record;
  enqueue_result record;
begin
  if p_capability <> 'hermes.design_callback' then
    raise exception 'invalid Hermes callback capability';
  end if;
  if jsonb_typeof(p_job) <> 'object'
    or p_job->>'requestHash' <> p_request_hash then
    raise exception 'Hermes callback request hash does not match the queued job';
  end if;

  -- Exact signed retries are idempotent and do not consume another rate slot.
  select queued.*
    into existing_job
    from public.hermes_design_callback_jobs queued
   where queued.organization_id = p_organization_id
     and queued.project_key = p_project_key
     and queued.callback_id = p_job->>'callbackId'
   limit 1;
  if found then
    if existing_job.task_id = p_job->>'taskId'
      and existing_job.idempotency_key = p_job->>'idempotencyKey'
      and existing_job.request_hash = p_request_hash then
      return query select
        true,
        'duplicate'::text,
        null::integer,
        existing_job.payload,
        false,
        existing_job.revision;
      return;
    end if;
  end if;

  select *
    into guard_result
    from public.authorize_machine_request(
      p_organization_id,
      p_project_key,
      p_credential_id,
      p_capability,
      p_request_id,
      p_request_hash,
      p_requested_at,
      p_rate_limit
    );
  if not guard_result.authorized then
    return query select
      false,
      guard_result.reason,
      guard_result.retry_after_seconds,
      null::jsonb,
      false,
      null::bigint;
    return;
  end if;

  -- An enqueue exception rolls back the request receipt, rate counter, and
  -- audit append made above, eliminating the accepted-but-unrecoverable gap.
  select *
    into enqueue_result
    from public.enqueue_hermes_design_callback_job(
      p_organization_id,
      p_project_key,
      p_job
    );
  return query select
    true,
    case when enqueue_result.created then 'accepted' else 'duplicate' end,
    null::integer,
    enqueue_result.job,
    enqueue_result.created,
    enqueue_result.revision;
end;
$$;

create or replace function public.claim_hermes_design_callback_jobs(
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
  candidate public.hermes_design_callback_jobs%rowtype;
  claimed_payload jsonb;
  claimed_token text;
  claimed_expires_at timestamptz;
begin
  if p_project_key !~ '^[a-z0-9][a-z0-9_-]{0,63}$'
    or nullif(btrim(p_claimed_by), '') is null
    or p_lease_seconds not between 30 and 3600
    or p_limit not between 1 and 100 then
    raise exception 'invalid Hermes callback claim';
  end if;

  update public.hermes_design_callback_jobs exhausted
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
             'Callback worker lease expired after the maximum attempt count.',
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
      from public.hermes_design_callback_jobs queued
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
    update public.hermes_design_callback_jobs saved
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

create or replace function public.compare_and_swap_hermes_design_callback_job(
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
  current_job public.hermes_design_callback_jobs%rowtype;
  saved_job public.hermes_design_callback_jobs%rowtype;
begin
  if p_project_key !~ '^[a-z0-9][a-z0-9_-]{0,63}$'
    or nullif(btrim(p_job_id), '') is null then
    raise exception 'invalid Hermes callback job identity';
  end if;
  if jsonb_typeof(p_job) <> 'object' or pg_column_size(p_job) > 1048576 then
    raise exception 'Hermes callback job must be an object no larger than 1 MiB';
  end if;

  select queued.*
    into current_job
    from public.hermes_design_callback_jobs queued
   where queued.organization_id = p_organization_id
     and queued.project_key = p_project_key
     and queued.job_id = p_job_id
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
  if p_job->>'id' <> current_job.job_id
    or p_job->>'idempotencyKey' <> current_job.idempotency_key
    or p_job->>'taskId' <> current_job.task_id
    or p_job->>'callbackId' <> current_job.callback_id
    or p_job->>'requestHash' <> current_job.request_hash then
    raise exception 'Hermes callback job identity cannot change';
  end if;

  update public.hermes_design_callback_jobs saved
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

create or replace function public.get_hermes_callback_queue_snapshot(
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
    'hermes_callbacks_queued', (
      select count(*) from public.hermes_design_callback_jobs queued
      where queued.organization_id = p_organization_id
        and queued.project_key = p_project_key
        and queued.status in ('queued', 'failed')
    ),
    'hermes_callbacks_running', (
      select count(*) from public.hermes_design_callback_jobs running
      where running.organization_id = p_organization_id
        and running.project_key = p_project_key
        and running.status = 'claimed'
    ),
    'hermes_callbacks_dead_letter', (
      select count(*) from public.hermes_design_callback_jobs dead
      where dead.organization_id = p_organization_id
        and dead.project_key = p_project_key
        and dead.status = 'dead_letter'
    ),
    'hermes_callbacks_due', (
      select count(*) from public.hermes_design_callback_jobs due
      where due.organization_id = p_organization_id
        and due.project_key = p_project_key
        and due.status in ('queued', 'failed', 'claimed')
        and due.next_run_at <= now()
        and (due.lease_expires_at is null or due.lease_expires_at <= now())
        and due.attempt_count < due.max_attempts
    ),
    'hermes_callback_expired_leases', (
      select count(*) from public.hermes_design_callback_jobs leased
      where leased.organization_id = p_organization_id
        and leased.project_key = p_project_key
        and leased.status = 'claimed'
        and leased.lease_expires_at <= now()
    ),
    'hermes_callback_oldest_due_seconds', coalesce((
      select greatest(
        0,
        floor(extract(epoch from (now() - min(due.next_run_at))))
      )::bigint
      from public.hermes_design_callback_jobs due
      where due.organization_id = p_organization_id
        and due.project_key = p_project_key
        and due.status in ('queued', 'failed', 'claimed')
        and due.next_run_at <= now()
        and (due.lease_expires_at is null or due.lease_expires_at <= now())
        and due.attempt_count < due.max_attempts
    ), 0)
  );
$$;

revoke all on function public.enqueue_hermes_design_callback_job(
  uuid, text, jsonb
) from public, anon, authenticated, service_role;
revoke all on function public.authorize_and_enqueue_hermes_design_callback(
  uuid, text, text, text, text, text, timestamptz, integer, jsonb
) from public, anon, authenticated, service_role;
revoke all on function public.claim_hermes_design_callback_jobs(
  uuid, text, text, timestamptz, integer, integer
) from public, anon, authenticated, service_role;
revoke all on function public.compare_and_swap_hermes_design_callback_job(
  uuid, text, text, bigint, text, jsonb
) from public, anon, authenticated, service_role;
revoke all on function public.get_hermes_callback_queue_snapshot(uuid, text)
  from public, anon, authenticated, service_role;

grant execute on function public.enqueue_hermes_design_callback_job(
  uuid, text, jsonb
) to service_role;
grant execute on function public.authorize_and_enqueue_hermes_design_callback(
  uuid, text, text, text, text, text, timestamptz, integer, jsonb
) to service_role;
grant execute on function public.claim_hermes_design_callback_jobs(
  uuid, text, text, timestamptz, integer, integer
) to service_role;
grant execute on function public.compare_and_swap_hermes_design_callback_job(
  uuid, text, text, bigint, text, jsonb
) to service_role;
grant execute on function public.get_hermes_callback_queue_snapshot(uuid, text)
  to service_role;
