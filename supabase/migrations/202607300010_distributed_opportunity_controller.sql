-- Tenant-scoped opportunity discovery and one lease-safe autonomous controller.
-- Local CLI workspaces retain file storage; hosted replicas share these records.

create table if not exists public.loop_opportunities (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  project_key text not null,
  opportunity_id text not null,
  fingerprint text not null,
  generation integer not null,
  status text not null,
  department text not null,
  score numeric not null,
  payload jsonb not null,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  primary key (organization_id, project_key, opportunity_id),
  unique (organization_id, project_key, fingerprint, generation),
  constraint loop_opportunities_project_key_check
    check (project_key ~ '^[a-z0-9][a-z0-9_-]{0,63}$'),
  constraint loop_opportunities_identity_check
    check (
      length(opportunity_id) between 1 and 512
      and length(fingerprint) between 1 and 512
      and generation >= 1
    ),
  constraint loop_opportunities_status_check
    check (status in (
      'detected', 'qualified', 'design_requested', 'designing',
      'proposal_ready', 'dismissed', 'implemented'
    )),
  constraint loop_opportunities_department_check
    check (department in (
      'management', 'marketing', 'sales', 'product', 'customer_success',
      'engineering', 'ops_finance', 'hr_talent', 'legal_compliance', 'custom'
    )),
  constraint loop_opportunities_score_check check (score >= 0 and score <= 100),
  constraint loop_opportunities_payload_check
    check (jsonb_typeof(payload) = 'object' and pg_column_size(payload) <= 2097152)
);

create index if not exists loop_opportunities_query_idx
  on public.loop_opportunities(
    organization_id, project_key, status, department, score desc, updated_at desc
  );

create table if not exists public.loop_graph_change_sets (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  project_key text not null,
  change_set_id text not null,
  opportunity_id text not null,
  version integer not null,
  status text not null,
  payload jsonb not null,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  primary key (organization_id, project_key, change_set_id),
  unique (organization_id, project_key, opportunity_id, version),
  constraint loop_graph_change_sets_project_key_check
    check (project_key ~ '^[a-z0-9][a-z0-9_-]{0,63}$'),
  constraint loop_graph_change_sets_identity_check
    check (
      length(change_set_id) between 1 and 512
      and length(opportunity_id) between 1 and 512
      and version >= 1
    ),
  constraint loop_graph_change_sets_status_check
    check (status in (
      'proposed', 'approved', 'applied', 'rejected',
      'superseded', 'rolled_back'
    )),
  constraint loop_graph_change_sets_payload_check
    check (jsonb_typeof(payload) = 'object' and pg_column_size(payload) <= 2097152)
);

create index if not exists loop_graph_change_sets_opportunity_idx
  on public.loop_graph_change_sets(
    organization_id, project_key, opportunity_id, version desc
  );

create table if not exists public.loop_controller_runs (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  project_key text not null,
  run_id text not null,
  idempotency_key text not null,
  status text not null,
  payload jsonb not null,
  started_at timestamptz not null,
  updated_at timestamptz not null default now(),
  primary key (organization_id, project_key, run_id),
  unique (organization_id, project_key, idempotency_key),
  constraint loop_controller_runs_project_key_check
    check (project_key ~ '^[a-z0-9][a-z0-9_-]{0,63}$'),
  constraint loop_controller_runs_identity_check
    check (
      length(run_id) between 1 and 512
      and length(idempotency_key) between 1 and 512
    ),
  constraint loop_controller_runs_status_check
    check (status in ('running', 'completed', 'failed', 'disabled')),
  constraint loop_controller_runs_payload_check
    check (jsonb_typeof(payload) = 'object' and pg_column_size(payload) <= 4194304)
);

create index if not exists loop_controller_runs_started_idx
  on public.loop_controller_runs(
    organization_id, project_key, started_at desc, run_id
  );

create table if not exists public.loop_controller_state (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  project_key text not null,
  state_type text not null,
  payload jsonb not null,
  revision bigint not null default 1,
  updated_at timestamptz not null default now(),
  primary key (organization_id, project_key, state_type),
  constraint loop_controller_state_project_key_check
    check (project_key ~ '^[a-z0-9][a-z0-9_-]{0,63}$'),
  constraint loop_controller_state_type_check
    check (state_type in ('policy', 'checkpoint')),
  constraint loop_controller_state_payload_check
    check (jsonb_typeof(payload) = 'object' and pg_column_size(payload) <= 1048576),
  constraint loop_controller_state_revision_check check (revision >= 1)
);

create table if not exists public.loop_controller_triggers (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  project_key text not null,
  trigger_record_id text not null,
  project_root_id text not null,
  trigger_type text not null,
  trigger_id text not null,
  status text not null,
  attempts integer not null default 0,
  lease_id uuid,
  lease_expires_at timestamptz,
  payload jsonb not null,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  primary key (organization_id, project_key, trigger_record_id),
  unique (organization_id, project_key, project_root_id, trigger_type, trigger_id),
  constraint loop_controller_triggers_project_key_check
    check (project_key ~ '^[a-z0-9][a-z0-9_-]{0,63}$'),
  constraint loop_controller_triggers_identity_check
    check (
      length(trigger_record_id) between 1 and 512
      and length(project_root_id) between 1 and 512
      and length(trigger_id) between 1 and 512
    ),
  constraint loop_controller_triggers_type_check
    check (trigger_type in (
      'manual', 'schedule', 'routing_event', 'route_job', 'review',
      'outcome_window', 'connector_health', 'management_cycle'
    )),
  constraint loop_controller_triggers_status_check
    check (status in ('pending', 'processing', 'completed', 'failed')),
  constraint loop_controller_triggers_attempts_check check (attempts >= 0),
  constraint loop_controller_triggers_lease_check
    check (
      (status = 'processing' and lease_id is not null and lease_expires_at is not null)
      or
      (status <> 'processing' and lease_id is null and lease_expires_at is null)
    ),
  constraint loop_controller_triggers_payload_check
    check (jsonb_typeof(payload) = 'object' and pg_column_size(payload) <= 1048576)
);

create index if not exists loop_controller_triggers_claim_idx
  on public.loop_controller_triggers(
    organization_id, project_key, status, lease_expires_at, created_at
  );

create table if not exists public.loop_controller_leases (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  project_key text not null,
  lock_name text not null,
  lease_id uuid not null,
  lease_expires_at timestamptz not null,
  updated_at timestamptz not null,
  primary key (organization_id, project_key, lock_name),
  constraint loop_controller_leases_project_key_check
    check (project_key ~ '^[a-z0-9][a-z0-9_-]{0,63}$'),
  constraint loop_controller_leases_name_check
    check (length(lock_name) between 1 and 64)
);

alter table public.loop_opportunities enable row level security;
alter table public.loop_graph_change_sets enable row level security;
alter table public.loop_controller_runs enable row level security;
alter table public.loop_controller_state enable row level security;
alter table public.loop_controller_triggers enable row level security;
alter table public.loop_controller_leases enable row level security;

revoke all on public.loop_opportunities from public, anon, authenticated, service_role;
revoke all on public.loop_graph_change_sets from public, anon, authenticated, service_role;
revoke all on public.loop_controller_runs from public, anon, authenticated, service_role;
revoke all on public.loop_controller_state from public, anon, authenticated, service_role;
revoke all on public.loop_controller_triggers from public, anon, authenticated, service_role;
revoke all on public.loop_controller_leases from public, anon, authenticated, service_role;

grant select on public.loop_opportunities to service_role;
grant select on public.loop_graph_change_sets to service_role;
grant select on public.loop_controller_runs to service_role;
grant select on public.loop_controller_state to service_role;
grant select on public.loop_controller_triggers to service_role;
grant select on public.loop_controller_leases to service_role;

create or replace function public.upsert_loop_opportunity(
  p_organization_id uuid,
  p_project_key text,
  p_payload jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  existing public.loop_opportunities%rowtype;
  saved public.loop_opportunities%rowtype;
  v_id text := p_payload->>'id';
  v_fingerprint text := p_payload->>'fingerprint';
  v_generation integer := (p_payload->>'generation')::integer;
begin
  if p_project_key !~ '^[a-z0-9][a-z0-9_-]{0,63}$'
    or nullif(v_id, '') is null
    or nullif(v_fingerprint, '') is null
    or jsonb_typeof(p_payload) <> 'object'
    or pg_column_size(p_payload) > 2097152 then
    raise exception 'invalid loop opportunity';
  end if;
  select * into existing
    from public.loop_opportunities
   where organization_id = p_organization_id
     and project_key = p_project_key
     and opportunity_id = v_id
   for update;
  if found and (
    existing.fingerprint <> v_fingerprint
    or existing.generation <> v_generation
  ) then
    raise exception 'loop opportunity identity conflict';
  end if;
  insert into public.loop_opportunities (
    organization_id, project_key, opportunity_id, fingerprint, generation,
    status, department, score, payload, created_at, updated_at
  ) values (
    p_organization_id, p_project_key, v_id, v_fingerprint, v_generation,
    p_payload->>'status', p_payload->>'department',
    (p_payload#>>'{score,total}')::numeric, p_payload,
    (p_payload->>'createdAt')::timestamptz,
    (p_payload->>'updatedAt')::timestamptz
  )
  on conflict (organization_id, project_key, opportunity_id)
  do update set
    status = excluded.status,
    department = excluded.department,
    score = excluded.score,
    payload = excluded.payload,
    updated_at = excluded.updated_at
  returning * into saved;
  return saved.payload;
end;
$$;

create or replace function public.upsert_loop_graph_change_set(
  p_organization_id uuid,
  p_project_key text,
  p_payload jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  existing public.loop_graph_change_sets%rowtype;
  saved public.loop_graph_change_sets%rowtype;
  v_id text := p_payload->>'id';
  v_opportunity_id text := p_payload->>'opportunityId';
  v_version integer := (p_payload->>'version')::integer;
begin
  if p_project_key !~ '^[a-z0-9][a-z0-9_-]{0,63}$'
    or nullif(v_id, '') is null
    or nullif(v_opportunity_id, '') is null
    or jsonb_typeof(p_payload) <> 'object'
    or pg_column_size(p_payload) > 2097152 then
    raise exception 'invalid loop graph change set';
  end if;
  select * into existing
    from public.loop_graph_change_sets
   where organization_id = p_organization_id
     and project_key = p_project_key
     and change_set_id = v_id
   for update;
  if found and (
    existing.opportunity_id <> v_opportunity_id
    or existing.version <> v_version
  ) then
    raise exception 'loop graph change-set identity conflict';
  end if;
  insert into public.loop_graph_change_sets (
    organization_id, project_key, change_set_id, opportunity_id,
    version, status, payload, created_at, updated_at
  ) values (
    p_organization_id, p_project_key, v_id, v_opportunity_id,
    v_version, p_payload->>'status', p_payload,
    (p_payload->>'createdAt')::timestamptz,
    (p_payload->>'updatedAt')::timestamptz
  )
  on conflict (organization_id, project_key, change_set_id)
  do update set
    status = excluded.status,
    payload = excluded.payload,
    updated_at = excluded.updated_at
  returning * into saved;
  return saved.payload;
end;
$$;

create or replace function public.save_loop_controller_run(
  p_organization_id uuid,
  p_project_key text,
  p_payload jsonb
)
returns table (run jsonb, duplicate boolean)
language plpgsql
security definer
set search_path = ''
as $$
declare
  existing public.loop_controller_runs%rowtype;
  saved public.loop_controller_runs%rowtype;
  v_id text := p_payload->>'id';
  v_key text := p_payload->>'idempotencyKey';
  v_status text := p_payload->>'status';
begin
  if p_project_key !~ '^[a-z0-9][a-z0-9_-]{0,63}$'
    or nullif(v_id, '') is null or nullif(v_key, '') is null
    or jsonb_typeof(p_payload) <> 'object'
    or pg_column_size(p_payload) > 4194304 then
    raise exception 'invalid loop controller run';
  end if;
  select * into existing
    from public.loop_controller_runs
   where organization_id = p_organization_id
     and project_key = p_project_key
     and (run_id = v_id or idempotency_key = v_key)
   order by (run_id = v_id) desc
   limit 1
   for update;
  if found and (existing.run_id <> v_id or existing.idempotency_key <> v_key) then
    raise exception 'loop controller run identity conflict';
  end if;
  if found and existing.status in ('completed', 'failed', 'disabled')
    and existing.status <> v_status then
    raise exception 'terminal loop controller run cannot transition';
  end if;
  insert into public.loop_controller_runs (
    organization_id, project_key, run_id, idempotency_key,
    status, payload, started_at, updated_at
  ) values (
    p_organization_id, p_project_key, v_id, v_key,
    v_status, p_payload, (p_payload->>'startedAt')::timestamptz, now()
  )
  on conflict (organization_id, project_key, run_id)
  do update set
    status = excluded.status,
    payload = excluded.payload,
    updated_at = now()
  returning * into saved;
  run := saved.payload;
  duplicate := found and existing.status in ('completed', 'failed', 'disabled');
  return next;
end;
$$;

create or replace function public.save_loop_controller_state(
  p_organization_id uuid,
  p_project_key text,
  p_state_type text,
  p_payload jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare saved public.loop_controller_state%rowtype;
begin
  if p_project_key !~ '^[a-z0-9][a-z0-9_-]{0,63}$'
    or p_state_type not in ('policy', 'checkpoint')
    or jsonb_typeof(p_payload) <> 'object'
    or pg_column_size(p_payload) > 1048576 then
    raise exception 'invalid loop controller state';
  end if;
  insert into public.loop_controller_state (
    organization_id, project_key, state_type, payload
  ) values (
    p_organization_id, p_project_key, p_state_type, p_payload
  )
  on conflict (organization_id, project_key, state_type)
  do update set
    payload = excluded.payload,
    revision = public.loop_controller_state.revision + 1,
    updated_at = now()
  returning * into saved;
  return saved.payload;
end;
$$;

create or replace function public.enqueue_loop_controller_trigger(
  p_organization_id uuid,
  p_project_key text,
  p_payload jsonb
)
returns table (record jsonb, duplicate boolean)
language plpgsql
security definer
set search_path = ''
as $$
declare
  existing public.loop_controller_triggers%rowtype;
  saved public.loop_controller_triggers%rowtype;
  v_id text := p_payload->>'id';
  v_project_root_id text := p_payload->>'projectRootId';
  v_trigger_type text := p_payload#>>'{trigger,type}';
  v_trigger_id text := p_payload#>>'{trigger,id}';
begin
  if p_project_key !~ '^[a-z0-9][a-z0-9_-]{0,63}$'
    or nullif(v_id, '') is null
    or nullif(v_project_root_id, '') is null
    or nullif(v_trigger_type, '') is null
    or nullif(v_trigger_id, '') is null
    or jsonb_typeof(p_payload) <> 'object'
    or pg_column_size(p_payload) > 1048576 then
    raise exception 'invalid loop controller trigger';
  end if;
  insert into public.loop_controller_triggers (
    organization_id, project_key, trigger_record_id, project_root_id,
    trigger_type, trigger_id, status, attempts, payload, created_at, updated_at
  ) values (
    p_organization_id, p_project_key, v_id, v_project_root_id,
    v_trigger_type, v_trigger_id, 'pending', 0, p_payload,
    (p_payload->>'createdAt')::timestamptz,
    (p_payload->>'updatedAt')::timestamptz
  )
  on conflict do nothing
  returning * into saved;
  if found then
    record := saved.payload;
    duplicate := false;
    return next;
    return;
  end if;

  select * into existing
    from public.loop_controller_triggers
   where organization_id = p_organization_id
     and project_key = p_project_key
     and (
       trigger_record_id = v_id
       or (
         project_root_id = v_project_root_id
         and trigger_type = v_trigger_type
         and trigger_id = v_trigger_id
       )
     )
   order by (trigger_record_id = v_id) desc
   limit 1;
  if not found then
    raise exception 'loop controller trigger conflict could not be resolved';
  end if;
  if existing.trigger_record_id <> v_id
    or existing.project_root_id <> v_project_root_id
    or existing.trigger_type <> v_trigger_type
    or existing.trigger_id <> v_trigger_id then
    raise exception 'loop controller trigger identity conflict';
  end if;
  record := existing.payload;
  duplicate := true;
  return next;
end;
$$;

create or replace function public.claim_loop_controller_triggers(
  p_organization_id uuid,
  p_project_key text,
  p_limit integer,
  p_max_attempts integer,
  p_lease_seconds integer,
  p_now timestamptz
)
returns setof jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_project_key !~ '^[a-z0-9][a-z0-9_-]{0,63}$'
    or p_limit < 1 or p_limit > 100
    or p_max_attempts < 1 or p_max_attempts > 20
    or p_lease_seconds < 30 or p_lease_seconds > 3600 then
    raise exception 'invalid loop controller trigger claim';
  end if;
  return query
  with eligible as (
    select t.organization_id, t.project_key, t.trigger_record_id,
           gen_random_uuid() as next_lease_id
      from public.loop_controller_triggers t
     where t.organization_id = p_organization_id
       and t.project_key = p_project_key
       and t.attempts < p_max_attempts
       and (
         t.status in ('pending', 'failed')
         or (t.status = 'processing' and t.lease_expires_at <= p_now)
       )
     order by t.created_at, t.trigger_record_id
     for update skip locked
     limit p_limit
  ), claimed as (
    update public.loop_controller_triggers t
       set status = 'processing',
           attempts = t.attempts + 1,
           lease_id = eligible.next_lease_id,
           lease_expires_at = p_now + make_interval(secs => p_lease_seconds),
           updated_at = p_now,
           payload = t.payload
             || jsonb_build_object(
               'status', 'processing',
               'attempts', t.attempts + 1,
               'leaseId', eligible.next_lease_id::text,
               'leaseExpiresAt', p_now + make_interval(secs => p_lease_seconds),
               'updatedAt', p_now
             )
             - 'error'
      from eligible
     where t.organization_id = eligible.organization_id
       and t.project_key = eligible.project_key
       and t.trigger_record_id = eligible.trigger_record_id
    returning t.payload
  )
  select claimed.payload from claimed;
end;
$$;

create or replace function public.settle_loop_controller_trigger(
  p_organization_id uuid,
  p_project_key text,
  p_trigger_record_id text,
  p_expected_lease_id uuid,
  p_payload jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare saved public.loop_controller_triggers%rowtype;
begin
  if p_project_key !~ '^[a-z0-9][a-z0-9_-]{0,63}$'
    or nullif(p_trigger_record_id, '') is null
    or p_payload->>'id' <> p_trigger_record_id
    or p_payload->>'status' not in ('completed', 'failed')
    or jsonb_typeof(p_payload) <> 'object'
    or pg_column_size(p_payload) > 1048576 then
    raise exception 'invalid loop controller trigger settlement';
  end if;
  update public.loop_controller_triggers
     set status = p_payload->>'status',
         attempts = (p_payload->>'attempts')::integer,
         lease_id = null,
         lease_expires_at = null,
         payload = p_payload - 'leaseId' - 'leaseExpiresAt',
         updated_at = (p_payload->>'updatedAt')::timestamptz
   where organization_id = p_organization_id
     and project_key = p_project_key
     and trigger_record_id = p_trigger_record_id
     and status = 'processing'
     and lease_id = p_expected_lease_id
  returning * into saved;
  if not found then
    raise exception 'loop controller trigger lease is no longer owned';
  end if;
  return saved.payload;
end;
$$;

create or replace function public.acquire_loop_controller_lease(
  p_organization_id uuid,
  p_project_key text,
  p_lock_name text,
  p_lease_id uuid,
  p_lease_seconds integer,
  p_now timestamptz
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare affected_rows integer;
begin
  if p_project_key !~ '^[a-z0-9][a-z0-9_-]{0,63}$'
    or length(p_lock_name) not between 1 and 64
    or p_lease_seconds < 30 or p_lease_seconds > 3600 then
    raise exception 'invalid loop controller lease';
  end if;
  insert into public.loop_controller_leases (
    organization_id, project_key, lock_name, lease_id,
    lease_expires_at, updated_at
  ) values (
    p_organization_id, p_project_key, p_lock_name, p_lease_id,
    p_now + make_interval(secs => p_lease_seconds), p_now
  )
  on conflict (organization_id, project_key, lock_name)
  do update set
    lease_id = excluded.lease_id,
    lease_expires_at = excluded.lease_expires_at,
    updated_at = excluded.updated_at
  where public.loop_controller_leases.lease_expires_at <= p_now
     or public.loop_controller_leases.lease_id = p_lease_id;
  get diagnostics affected_rows = row_count;
  return affected_rows > 0;
end;
$$;

create or replace function public.renew_loop_controller_lease(
  p_organization_id uuid,
  p_project_key text,
  p_lock_name text,
  p_lease_id uuid,
  p_lease_seconds integer,
  p_now timestamptz
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare affected_rows integer;
begin
  update public.loop_controller_leases
     set lease_expires_at = p_now + make_interval(secs => p_lease_seconds),
         updated_at = p_now
   where organization_id = p_organization_id
     and project_key = p_project_key
     and lock_name = p_lock_name
     and lease_id = p_lease_id
     and lease_expires_at > p_now;
  get diagnostics affected_rows = row_count;
  return affected_rows > 0;
end;
$$;

create or replace function public.release_loop_controller_lease(
  p_organization_id uuid,
  p_project_key text,
  p_lock_name text,
  p_lease_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare affected_rows integer;
begin
  delete from public.loop_controller_leases
   where organization_id = p_organization_id
     and project_key = p_project_key
     and lock_name = p_lock_name
     and lease_id = p_lease_id;
  get diagnostics affected_rows = row_count;
  return affected_rows > 0;
end;
$$;

create or replace function public.get_opportunity_controller_snapshot(
  p_organization_id uuid,
  p_project_key text
)
returns table (
  opportunities_total bigint,
  opportunities_qualified bigint,
  graph_changes_proposed bigint,
  controller_runs_total bigint,
  controller_runs_failed bigint,
  controller_triggers_pending bigint,
  controller_triggers_processing bigint,
  controller_triggers_failed bigint,
  controller_trigger_expired_leases bigint,
  controller_oldest_pending_seconds bigint,
  controller_active_leases bigint
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    count(*) filter (where source = 'opportunity'),
    count(*) filter (
      where source = 'opportunity'
        and status in ('qualified', 'design_requested', 'designing', 'proposal_ready')
    ),
    count(*) filter (where source = 'change_set' and status = 'proposed'),
    count(*) filter (where source = 'run'),
    count(*) filter (where source = 'run' and status = 'failed'),
    count(*) filter (where source = 'trigger' and status = 'pending'),
    count(*) filter (where source = 'trigger' and status = 'processing'),
    count(*) filter (where source = 'trigger' and status = 'failed'),
    count(*) filter (
      where source = 'trigger'
        and status = 'processing'
        and lease_expires_at <= now()
    ),
    coalesce(
      extract(epoch from (
        now() - min(created_at) filter (
          where source = 'trigger' and status in ('pending', 'failed')
        )
      ))::bigint,
      0
    ),
    count(*) filter (
      where source = 'lease' and lease_expires_at > now()
    )
  from (
    select 'opportunity'::text as source, status, created_at,
           null::timestamptz as lease_expires_at
      from public.loop_opportunities
     where organization_id = p_organization_id and project_key = p_project_key
    union all
    select 'change_set', status, created_at, null::timestamptz
      from public.loop_graph_change_sets
     where organization_id = p_organization_id and project_key = p_project_key
    union all
    select 'run', status, started_at, null::timestamptz
      from public.loop_controller_runs
     where organization_id = p_organization_id and project_key = p_project_key
    union all
    select 'trigger', status, created_at, lease_expires_at
      from public.loop_controller_triggers
     where organization_id = p_organization_id and project_key = p_project_key
    union all
    select 'lease', null::text, updated_at, lease_expires_at
      from public.loop_controller_leases
     where organization_id = p_organization_id and project_key = p_project_key
  ) records;
$$;

revoke all on function public.upsert_loop_opportunity(uuid, text, jsonb)
  from public, anon, authenticated;
revoke all on function public.upsert_loop_graph_change_set(uuid, text, jsonb)
  from public, anon, authenticated;
revoke all on function public.save_loop_controller_run(uuid, text, jsonb)
  from public, anon, authenticated;
revoke all on function public.save_loop_controller_state(uuid, text, text, jsonb)
  from public, anon, authenticated;
revoke all on function public.enqueue_loop_controller_trigger(uuid, text, jsonb)
  from public, anon, authenticated;
revoke all on function public.claim_loop_controller_triggers(uuid, text, integer, integer, integer, timestamptz)
  from public, anon, authenticated;
revoke all on function public.settle_loop_controller_trigger(uuid, text, text, uuid, jsonb)
  from public, anon, authenticated;
revoke all on function public.acquire_loop_controller_lease(uuid, text, text, uuid, integer, timestamptz)
  from public, anon, authenticated;
revoke all on function public.renew_loop_controller_lease(uuid, text, text, uuid, integer, timestamptz)
  from public, anon, authenticated;
revoke all on function public.release_loop_controller_lease(uuid, text, text, uuid)
  from public, anon, authenticated;
revoke all on function public.get_opportunity_controller_snapshot(uuid, text)
  from public, anon, authenticated, service_role;

grant execute on function public.upsert_loop_opportunity(uuid, text, jsonb)
  to service_role;
grant execute on function public.upsert_loop_graph_change_set(uuid, text, jsonb)
  to service_role;
grant execute on function public.save_loop_controller_run(uuid, text, jsonb)
  to service_role;
grant execute on function public.save_loop_controller_state(uuid, text, text, jsonb)
  to service_role;
grant execute on function public.enqueue_loop_controller_trigger(uuid, text, jsonb)
  to service_role;
grant execute on function public.claim_loop_controller_triggers(uuid, text, integer, integer, integer, timestamptz)
  to service_role;
grant execute on function public.settle_loop_controller_trigger(uuid, text, text, uuid, jsonb)
  to service_role;
grant execute on function public.acquire_loop_controller_lease(uuid, text, text, uuid, integer, timestamptz)
  to service_role;
grant execute on function public.renew_loop_controller_lease(uuid, text, text, uuid, integer, timestamptz)
  to service_role;
grant execute on function public.release_loop_controller_lease(uuid, text, text, uuid)
  to service_role;
grant execute on function public.get_opportunity_controller_snapshot(uuid, text)
  to service_role;
