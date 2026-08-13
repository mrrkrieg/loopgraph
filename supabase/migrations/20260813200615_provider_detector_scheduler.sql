create table if not exists public.provider_detector_schedules (
  id text primary key,
  organization_id uuid not null,
  project_key text not null,
  installation_id text not null,
  provider_id text not null check (provider_id in ('bigquery', 'snowflake')),
  detector_key text not null,
  operation text not null,
  event_type text not null,
  subject_type text not null,
  cadence_minutes integer not null check (cadence_minutes between 5 and 1440),
  window_minutes integer not null check (window_minutes between 5 and 525600),
  overlap_minutes integer not null check (overlap_minutes >= 0 and overlap_minutes < window_minutes),
  status text not null default 'active' check (status in ('active', 'paused', 'disabled')),
  run_state text not null default 'idle' check (run_state in ('idle', 'leased', 'retry', 'dead_letter')),
  checkpoint_at timestamptz,
  next_run_at timestamptz not null default now(),
  pending_window_start timestamptz,
  pending_window_end timestamptz,
  current_run_id uuid,
  attempt_count integer not null default 0 check (attempt_count between 0 and 100),
  available_at timestamptz not null default now(),
  lease_token_hash text,
  lease_until timestamptz,
  last_error_code text,
  last_started_at timestamptz,
  last_completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, project_key, installation_id, detector_key),
  foreign key (organization_id, project_key, installation_id)
    references public.connector_installations (organization_id, project_key, id)
    on delete cascade,
  check ((run_state = 'leased') = (lease_token_hash is not null and lease_until is not null)),
  check ((pending_window_start is null) = (pending_window_end is null)),
  check (pending_window_start is null or pending_window_start < pending_window_end)
);

create index if not exists provider_detector_schedules_due_idx
  on public.provider_detector_schedules (status, run_state, available_at, next_run_at, lease_until);

create table if not exists public.provider_detector_runs (
  id uuid primary key,
  schedule_id text not null references public.provider_detector_schedules (id) on delete cascade,
  organization_id uuid not null,
  project_key text not null,
  installation_id text not null,
  provider_id text not null,
  detector_key text not null,
  window_start timestamptz not null,
  window_end timestamptz not null,
  status text not null check (status in ('forwarded', 'no_change', 'retry', 'dead_letter')),
  attempt_count integer not null check (attempt_count between 1 and 100),
  broker_receipt_id text,
  result_hash text check (result_hash is null or result_hash ~ '^[a-f0-9]{64}$'),
  event_ids text[] not null default '{}',
  emitted_event_count integer not null default 0 check (emitted_event_count between 0 and 500),
  error_code text,
  started_at timestamptz not null,
  completed_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (window_start < window_end),
  check (cardinality(event_ids) <= 500)
);

create index if not exists provider_detector_runs_tenant_idx
  on public.provider_detector_runs (organization_id, project_key, completed_at desc);

alter table public.provider_detector_schedules enable row level security;
alter table public.provider_detector_runs enable row level security;
revoke all on table public.provider_detector_schedules from public, anon, authenticated;
revoke all on table public.provider_detector_runs from public, anon, authenticated;
grant select, insert, update, delete on table public.provider_detector_schedules to service_role;
grant select, insert, update, delete on table public.provider_detector_runs to service_role;

create or replace function public.claim_provider_detector_schedules(
  p_limit integer default 20,
  p_lease_seconds integer default 90,
  p_now timestamptz default now()
)
returns table (
  schedule_id text,
  run_id uuid,
  organization_id uuid,
  project_key text,
  installation_id text,
  provider_id text,
  detector_key text,
  operation text,
  event_type text,
  subject_type text,
  window_start timestamptz,
  window_end timestamptz,
  attempt_count integer,
  lease_token uuid
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  candidate record;
  v_token uuid;
  v_run_id uuid;
  v_window_start timestamptz;
  v_window_end timestamptz;
  v_attempt integer;
begin
  if p_limit < 1 or p_limit > 100 or p_lease_seconds < 30 or p_lease_seconds > 300 then
    raise exception 'invalid provider detector claim bounds';
  end if;

  for candidate in
    select schedule.*
      from public.provider_detector_schedules schedule
      join public.connector_installations installation
        on installation.organization_id = schedule.organization_id
       and installation.project_key = schedule.project_key
       and installation.id = schedule.installation_id
     where schedule.status = 'active'
       and installation.status = 'active'
       and installation.allowed_capabilities @> array['provider.events.emit']::text[]
       and not exists (
         select 1 from public.connector_kill_switches kill
          where kill.organization_id = schedule.organization_id
            and kill.project_key = schedule.project_key
            and kill.status = 'active'
            and (kill.expires_at is null or kill.expires_at >= p_now)
            and (kill.environment is null or kill.environment = installation.environment)
            and (
              (kill.scope_type = 'organization' and kill.scope_value = schedule.organization_id::text)
              or (kill.scope_type = 'environment' and kill.scope_value = installation.environment)
              or (kill.scope_type = 'provider' and kill.scope_value = schedule.provider_id)
              or (kill.scope_type = 'connection' and kill.scope_value = schedule.installation_id)
              or (kill.scope_type = 'capability' and kill.scope_value = 'provider.events.emit')
            )
       )
       and (
         (schedule.run_state = 'idle' and schedule.next_run_at <= p_now)
         or (schedule.run_state = 'retry' and schedule.available_at <= p_now)
         or (schedule.run_state = 'leased' and schedule.lease_until <= p_now)
       )
     order by coalesce(schedule.available_at, schedule.next_run_at), schedule.id
     for update of schedule skip locked
     limit p_limit
  loop
    v_token := gen_random_uuid();
    v_run_id := coalesce(candidate.current_run_id, gen_random_uuid());
    v_window_end := coalesce(candidate.pending_window_end, least(p_now, candidate.next_run_at));
    v_window_start := coalesce(candidate.pending_window_start,
      case when candidate.checkpoint_at is null
        then v_window_end - make_interval(mins => candidate.window_minutes)
        else candidate.checkpoint_at - make_interval(mins => candidate.overlap_minutes)
      end
    );
    v_attempt := case when candidate.current_run_id is null then 1 else candidate.attempt_count + 1 end;

    update public.provider_detector_schedules schedule
       set run_state = 'leased',
           pending_window_start = v_window_start,
           pending_window_end = v_window_end,
           current_run_id = v_run_id,
           attempt_count = v_attempt,
           lease_token_hash = encode(extensions.digest(v_token::text, 'sha256'), 'hex'),
           lease_until = p_now + make_interval(secs => p_lease_seconds),
           last_started_at = p_now,
           last_error_code = null,
           updated_at = p_now
     where schedule.id = candidate.id;

    schedule_id := candidate.id;
    run_id := v_run_id;
    organization_id := candidate.organization_id;
    project_key := candidate.project_key;
    installation_id := candidate.installation_id;
    provider_id := candidate.provider_id;
    detector_key := candidate.detector_key;
    operation := candidate.operation;
    event_type := candidate.event_type;
    subject_type := candidate.subject_type;
    window_start := v_window_start;
    window_end := v_window_end;
    attempt_count := v_attempt;
    lease_token := v_token;
    return next;
  end loop;
end;
$$;

create or replace function public.finalize_provider_detector_schedule(
  p_schedule_id text,
  p_run_id uuid,
  p_lease_token uuid,
  p_outcome text,
  p_broker_receipt_id text default null,
  p_result_hash text default null,
  p_event_ids text[] default '{}',
  p_error_code text default null,
  p_retry_at timestamptz default null,
  p_completed_at timestamptz default now()
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  schedule public.provider_detector_schedules%rowtype;
begin
  if p_outcome not in ('forwarded', 'no_change', 'retry', 'dead_letter')
     or cardinality(coalesce(p_event_ids, '{}')) > 500 then
    raise exception 'invalid provider detector finalization';
  end if;
  select * into schedule from public.provider_detector_schedules
   where id = p_schedule_id
     and current_run_id = p_run_id
     and run_state = 'leased'
     and lease_until > p_completed_at
     and lease_token_hash = encode(extensions.digest(p_lease_token::text, 'sha256'), 'hex')
   for update;
  if not found then return false; end if;

  insert into public.provider_detector_runs (
    id, schedule_id, organization_id, project_key, installation_id, provider_id,
    detector_key, window_start, window_end, status, attempt_count,
    broker_receipt_id, result_hash, event_ids, emitted_event_count, error_code,
    started_at, completed_at, updated_at
  ) values (
    p_run_id, schedule.id, schedule.organization_id, schedule.project_key,
    schedule.installation_id, schedule.provider_id, schedule.detector_key,
    schedule.pending_window_start, schedule.pending_window_end, p_outcome,
    schedule.attempt_count, p_broker_receipt_id, p_result_hash,
    coalesce(p_event_ids, '{}'), cardinality(coalesce(p_event_ids, '{}')), p_error_code,
    coalesce(schedule.last_started_at, p_completed_at), p_completed_at, p_completed_at
  )
  on conflict (id) do update set
    status = excluded.status,
    attempt_count = excluded.attempt_count,
    broker_receipt_id = excluded.broker_receipt_id,
    result_hash = excluded.result_hash,
    event_ids = excluded.event_ids,
    emitted_event_count = excluded.emitted_event_count,
    error_code = excluded.error_code,
    completed_at = excluded.completed_at,
    updated_at = excluded.updated_at;

  if p_outcome in ('forwarded', 'no_change') then
    update public.provider_detector_schedules set
      run_state = 'idle', checkpoint_at = pending_window_end,
      next_run_at = pending_window_end + make_interval(mins => cadence_minutes),
      pending_window_start = null, pending_window_end = null, current_run_id = null,
      attempt_count = 0, available_at = p_completed_at,
      lease_token_hash = null, lease_until = null, last_error_code = null,
      last_completed_at = p_completed_at, updated_at = p_completed_at
    where id = p_schedule_id;
  elsif p_outcome = 'retry' then
    if p_retry_at is null or p_retry_at <= p_completed_at then
      raise exception 'retry finalization requires a future retry time';
    end if;
    update public.provider_detector_schedules set
      run_state = 'retry', available_at = p_retry_at,
      lease_token_hash = null, lease_until = null, last_error_code = p_error_code,
      last_completed_at = p_completed_at, updated_at = p_completed_at
    where id = p_schedule_id;
  else
    update public.provider_detector_schedules set
      status = 'paused', run_state = 'dead_letter',
      lease_token_hash = null, lease_until = null, last_error_code = p_error_code,
      last_completed_at = p_completed_at, updated_at = p_completed_at
    where id = p_schedule_id;
  end if;
  return true;
end;
$$;

revoke all on function public.claim_provider_detector_schedules(integer, integer, timestamptz) from public, anon, authenticated;
revoke all on function public.finalize_provider_detector_schedule(text, uuid, uuid, text, text, text, text[], text, timestamptz, timestamptz) from public, anon, authenticated;
grant execute on function public.claim_provider_detector_schedules(integer, integer, timestamptz) to service_role;
grant execute on function public.finalize_provider_detector_schedule(text, uuid, uuid, text, text, text, text[], text, timestamptz, timestamptz) to service_role;
