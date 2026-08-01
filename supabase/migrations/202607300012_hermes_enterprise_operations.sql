-- Durable, tenant-scoped Hermes agent registry and execution event ledger.
-- Hermes executes live work; Loopgraph stores immutable assignment-bound facts.

alter table public.route_jobs drop constraint if exists route_jobs_status_check;
alter table public.route_jobs add constraint route_jobs_status_check
  check (status in (
    'queued', 'claimed', 'dispatched', 'running', 'waiting_review',
    'completed', 'failed', 'dead_letter', 'cancelled'
  ));

create table if not exists public.hermes_agent_instances (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  project_key text not null,
  agent_instance_id text not null,
  workspace_id text not null,
  environment text not null,
  status text not null,
  last_heartbeat_at timestamptz not null,
  payload jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (organization_id, project_key, agent_instance_id),
  constraint hermes_agent_instances_project_key_check
    check (project_key ~ '^[a-z0-9][a-z0-9_-]{0,63}$'),
  constraint hermes_agent_instances_identity_check
    check (length(agent_instance_id) between 1 and 160 and length(workspace_id) between 1 and 160),
  constraint hermes_agent_instances_environment_check
    check (environment in ('local', 'sandbox', 'staging', 'production')),
  constraint hermes_agent_instances_status_check
    check (status in ('online', 'degraded', 'offline', 'disabled')),
  constraint hermes_agent_instances_payload_check
    check (jsonb_typeof(payload) = 'object' and pg_column_size(payload) <= 1048576)
);

create index if not exists hermes_agent_instances_health_idx
  on public.hermes_agent_instances(
    organization_id, project_key, workspace_id, environment, status, last_heartbeat_at desc
  );

create table if not exists public.hermes_execution_events (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  project_key text not null,
  execution_event_id text not null,
  idempotency_key text not null,
  workspace_id text not null,
  company_id text not null,
  agent_instance_id text not null,
  route_job_id text not null,
  run_id text not null,
  correlation_id text not null,
  event_type text not null,
  event_sequence integer not null,
  occurred_at timestamptz not null,
  payload jsonb not null,
  recorded_at timestamptz not null default now(),
  primary key (organization_id, project_key, execution_event_id),
  unique (organization_id, project_key, idempotency_key),
  unique (organization_id, project_key, run_id, event_sequence),
  foreign key (organization_id, project_key, agent_instance_id)
    references public.hermes_agent_instances(organization_id, project_key, agent_instance_id),
  foreign key (organization_id, project_key, route_job_id)
    references public.route_jobs(organization_id, project_key, job_id),
  constraint hermes_execution_events_project_key_check
    check (project_key ~ '^[a-z0-9][a-z0-9_-]{0,63}$'),
  constraint hermes_execution_events_identity_check
    check (
      length(execution_event_id) between 1 and 200
      and length(idempotency_key) between 1 and 250
      and length(workspace_id) between 1 and 160
      and length(company_id) between 1 and 160
      and length(run_id) between 1 and 200
      and event_sequence >= 0
    ),
  constraint hermes_execution_events_type_check
    check (event_type in (
      'assignment.received', 'run.started', 'task.started', 'task.completed',
      'task.failed', 'tool.started', 'tool.completed', 'tool.failed',
      'approval.requested', 'approval.resolved', 'output.created',
      'outcome.observed', 'run.completed', 'run.failed'
    )),
  constraint hermes_execution_events_payload_check
    check (jsonb_typeof(payload) = 'object' and pg_column_size(payload) <= 1048576)
);

create index if not exists hermes_execution_events_run_idx
  on public.hermes_execution_events(
    organization_id, project_key, run_id, event_sequence
  );
create index if not exists hermes_execution_events_activity_idx
  on public.hermes_execution_events(
    organization_id, project_key, occurred_at desc, execution_event_id
  );
create index if not exists hermes_execution_events_correlation_idx
  on public.hermes_execution_events(
    organization_id, project_key, correlation_id, occurred_at
  );

alter table public.hermes_agent_instances enable row level security;
alter table public.hermes_execution_events enable row level security;
revoke all on public.hermes_agent_instances from public, anon, authenticated, service_role;
revoke all on public.hermes_execution_events from public, anon, authenticated, service_role;
grant select on public.hermes_agent_instances to service_role;
grant select on public.hermes_execution_events to service_role;

create or replace function public.upsert_hermes_agent_instance(
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
  v_id text := p_payload->>'id';
begin
  if p_project_key !~ '^[a-z0-9][a-z0-9_-]{0,63}$'
    or jsonb_typeof(p_payload) <> 'object'
    or pg_column_size(p_payload) > 1048576
    or nullif(v_id, '') is null
    or nullif(p_payload->>'workspaceId', '') is null
    or (p_payload ? 'organizationId' and p_payload->>'organizationId' <> p_organization_id::text)
  then
    raise exception 'invalid Hermes agent payload';
  end if;

  insert into public.hermes_agent_instances (
    organization_id, project_key, agent_instance_id, workspace_id,
    environment, status, last_heartbeat_at, payload, created_at, updated_at
  ) values (
    p_organization_id, p_project_key, v_id, p_payload->>'workspaceId',
    p_payload->>'environment', p_payload->>'status',
    (p_payload->>'lastHeartbeatAt')::timestamptz, p_payload,
    (p_payload->>'registeredAt')::timestamptz, (p_payload->>'updatedAt')::timestamptz
  )
  on conflict (organization_id, project_key, agent_instance_id) do update set
    workspace_id = excluded.workspace_id,
    environment = excluded.environment,
    status = excluded.status,
    last_heartbeat_at = excluded.last_heartbeat_at,
    payload = excluded.payload,
    updated_at = excluded.updated_at;
  return p_payload;
end;
$$;

create or replace function public.append_hermes_execution_event(
  p_organization_id uuid,
  p_project_key text,
  p_payload jsonb
)
returns table(event jsonb, created boolean)
language plpgsql
security definer
set search_path = ''
as $$
declare
  existing jsonb;
begin
  if p_project_key !~ '^[a-z0-9][a-z0-9_-]{0,63}$'
    or jsonb_typeof(p_payload) <> 'object'
    or pg_column_size(p_payload) > 1048576
    or nullif(p_payload->>'id', '') is null
    or nullif(p_payload->>'idempotencyKey', '') is null
    or p_payload->>'organizationId' <> p_organization_id::text
  then
    raise exception 'invalid Hermes execution event payload';
  end if;

  insert into public.hermes_execution_events (
    organization_id, project_key, execution_event_id, idempotency_key,
    workspace_id, company_id, agent_instance_id, route_job_id, run_id,
    correlation_id, event_type, event_sequence, occurred_at, payload, recorded_at
  ) values (
    p_organization_id, p_project_key, p_payload->>'id', p_payload->>'idempotencyKey',
    p_payload->>'workspaceId', p_payload->>'companyId', p_payload->>'agentInstanceId',
    p_payload->>'routeJobId', p_payload->>'runId', p_payload->>'correlationId',
    p_payload->>'eventType', (p_payload->>'sequence')::integer,
    (p_payload->>'occurredAt')::timestamptz, p_payload,
    (p_payload->>'recordedAt')::timestamptz
  )
  on conflict (organization_id, project_key, idempotency_key) do nothing;
  if found then
    return query select p_payload, true;
    return;
  end if;

  select stored.payload into existing
  from public.hermes_execution_events stored
  where stored.organization_id = p_organization_id
    and stored.project_key = p_project_key
    and stored.idempotency_key = p_payload->>'idempotencyKey';
  if existing is distinct from p_payload then
    raise exception 'Hermes execution idempotency conflict';
  end if;
  return query select existing, false;
end;
$$;

revoke all on function public.upsert_hermes_agent_instance(uuid, text, jsonb)
  from public, anon, authenticated;
revoke all on function public.append_hermes_execution_event(uuid, text, jsonb)
  from public, anon, authenticated;
grant execute on function public.upsert_hermes_agent_instance(uuid, text, jsonb)
  to service_role;
grant execute on function public.append_hermes_execution_event(uuid, text, jsonb)
  to service_role;
