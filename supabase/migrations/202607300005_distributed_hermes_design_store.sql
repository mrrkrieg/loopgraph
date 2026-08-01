-- Shared, tenant-scoped Hermes design tasks and callback audit records.
-- Local CLI workspaces remain file-backed. Hosted replicas use these records
-- so a task can be dispatched, inspected, and completed on different servers.

create table if not exists public.hermes_design_tasks (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  project_key text not null,
  task_id text not null,
  idempotency_key text not null,
  session_id text not null,
  company_id text not null,
  status text not null,
  payload jsonb not null,
  revision bigint not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (organization_id, project_key, task_id),
  constraint hermes_design_tasks_project_key_check
    check (project_key ~ '^[a-z0-9][a-z0-9_-]{0,63}$'),
  constraint hermes_design_tasks_status_check
    check (status in (
      'queued',
      'needs_input',
      'awaiting_hermes',
      'designing',
      'needs_repair',
      'completed',
      'failed',
      'cancelled'
    )),
  constraint hermes_design_tasks_payload_object_check
    check (jsonb_typeof(payload) = 'object'),
  constraint hermes_design_tasks_payload_size_check
    check (pg_column_size(payload) <= 1048576),
  constraint hermes_design_tasks_revision_check
    check (revision >= 1)
);

create unique index if not exists hermes_design_tasks_active_idempotency_idx
  on public.hermes_design_tasks(organization_id, project_key, idempotency_key)
  where status not in ('failed', 'cancelled');
create index if not exists hermes_design_tasks_session_idx
  on public.hermes_design_tasks(
    organization_id,
    project_key,
    session_id,
    created_at desc
  );
create index if not exists hermes_design_tasks_status_idx
  on public.hermes_design_tasks(
    organization_id,
    project_key,
    status,
    updated_at desc
  );

create table if not exists public.hermes_design_callbacks (
  organization_id uuid not null,
  project_key text not null,
  callback_id text not null,
  task_id text not null,
  callback_type text not null,
  payload jsonb not null,
  received_at timestamptz not null default now(),
  primary key (organization_id, project_key, callback_id),
  foreign key (organization_id, project_key, task_id)
    references public.hermes_design_tasks(organization_id, project_key, task_id)
    on delete cascade,
  constraint hermes_design_callbacks_project_key_check
    check (project_key ~ '^[a-z0-9][a-z0-9_-]{0,63}$'),
  constraint hermes_design_callbacks_type_check
    check (callback_type in (
      'task.acknowledged',
      'task.questions_requested',
      'task.proposal_submitted',
      'task.failed'
    )),
  constraint hermes_design_callbacks_payload_object_check
    check (jsonb_typeof(payload) = 'object'),
  constraint hermes_design_callbacks_payload_size_check
    check (pg_column_size(payload) <= 1048576)
);

create index if not exists hermes_design_callbacks_task_idx
  on public.hermes_design_callbacks(
    organization_id,
    project_key,
    task_id,
    received_at desc
  );

alter table public.hermes_design_tasks enable row level security;
alter table public.hermes_design_callbacks enable row level security;
revoke all on public.hermes_design_tasks from public, anon, authenticated, service_role;
revoke all on public.hermes_design_callbacks from public, anon, authenticated, service_role;
grant select on public.hermes_design_tasks to service_role;
grant select on public.hermes_design_callbacks to service_role;

create or replace function public.create_hermes_design_task(
  p_organization_id uuid,
  p_project_key text,
  p_task jsonb
)
returns table (
  task jsonb,
  created boolean,
  revision bigint
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  inserted_task public.hermes_design_tasks%rowtype;
  existing_task public.hermes_design_tasks%rowtype;
begin
  if p_project_key !~ '^[a-z0-9][a-z0-9_-]{0,63}$' then
    raise exception 'invalid Hermes design project key';
  end if;
  if jsonb_typeof(p_task) <> 'object' or pg_column_size(p_task) > 1048576 then
    raise exception 'Hermes design task must be an object no larger than 1 MiB';
  end if;
  if nullif(btrim(p_task->>'id'), '') is null
    or nullif(btrim(p_task->>'idempotencyKey'), '') is null
    or nullif(btrim(p_task->>'sessionId'), '') is null
    or nullif(btrim(p_task->>'companyId'), '') is null then
    raise exception 'Hermes design task identity is incomplete';
  end if;

  insert into public.hermes_design_tasks (
    organization_id,
    project_key,
    task_id,
    idempotency_key,
    session_id,
    company_id,
    status,
    payload,
    created_at,
    updated_at
  ) values (
    p_organization_id,
    p_project_key,
    p_task->>'id',
    p_task->>'idempotencyKey',
    p_task->>'sessionId',
    p_task->>'companyId',
    p_task->>'status',
    p_task,
    coalesce((p_task->>'createdAt')::timestamptz, now()),
    coalesce((p_task->>'updatedAt')::timestamptz, now())
  )
  on conflict do nothing
  returning * into inserted_task;

  if found then
    return query select inserted_task.payload, true, inserted_task.revision;
    return;
  end if;

  select t.*
    into existing_task
    from public.hermes_design_tasks t
   where t.organization_id = p_organization_id
     and t.project_key = p_project_key
     and (
       t.task_id = p_task->>'id'
       or (
         t.idempotency_key = p_task->>'idempotencyKey'
         and t.status not in ('failed', 'cancelled')
       )
     )
   order by (t.task_id = p_task->>'id') desc, t.created_at desc
   limit 1;
  if not found then
    raise exception 'Hermes design task conflict could not be resolved';
  end if;
  return query select existing_task.payload, false, existing_task.revision;
end;
$$;

create or replace function public.compare_and_swap_hermes_design_task(
  p_organization_id uuid,
  p_project_key text,
  p_task_id text,
  p_expected_revision bigint,
  p_task jsonb
)
returns table (
  updated boolean,
  task jsonb,
  revision bigint,
  conflict_reason text
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_task public.hermes_design_tasks%rowtype;
  saved_task public.hermes_design_tasks%rowtype;
begin
  if p_project_key !~ '^[a-z0-9][a-z0-9_-]{0,63}$'
    or nullif(btrim(p_task_id), '') is null then
    raise exception 'invalid Hermes design task identity';
  end if;
  if jsonb_typeof(p_task) <> 'object' or pg_column_size(p_task) > 1048576 then
    raise exception 'Hermes design task must be an object no larger than 1 MiB';
  end if;

  select t.*
    into current_task
    from public.hermes_design_tasks t
   where t.organization_id = p_organization_id
     and t.project_key = p_project_key
     and t.task_id = p_task_id
   for update;
  if not found then
    return query select false, null::jsonb, null::bigint, 'not_found'::text;
    return;
  end if;
  if current_task.revision <> p_expected_revision then
    return query
      select false, current_task.payload, current_task.revision, 'revision_conflict'::text;
    return;
  end if;
  if p_task->>'id' <> current_task.task_id
    or p_task->>'idempotencyKey' <> current_task.idempotency_key
    or p_task->>'sessionId' <> current_task.session_id
    or p_task->>'companyId' <> current_task.company_id then
    raise exception 'Hermes design task identity cannot change';
  end if;

  update public.hermes_design_tasks t
     set status = p_task->>'status',
         payload = p_task,
         revision = t.revision + 1,
         updated_at = coalesce((p_task->>'updatedAt')::timestamptz, now())
   where t.organization_id = p_organization_id
     and t.project_key = p_project_key
     and t.task_id = p_task_id
  returning t.* into saved_task;
  return query select true, saved_task.payload, saved_task.revision, null::text;
end;
$$;

create or replace function public.apply_hermes_design_callback(
  p_organization_id uuid,
  p_project_key text,
  p_task_id text,
  p_callback_id text,
  p_expected_revision bigint,
  p_task jsonb,
  p_callback jsonb
)
returns table (
  applied boolean,
  duplicate boolean,
  updated boolean,
  task jsonb,
  revision bigint,
  conflict_reason text
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_task public.hermes_design_tasks%rowtype;
  saved_task public.hermes_design_tasks%rowtype;
  existing_callback public.hermes_design_callbacks%rowtype;
begin
  if p_project_key !~ '^[a-z0-9][a-z0-9_-]{0,63}$'
    or nullif(btrim(p_task_id), '') is null
    or nullif(btrim(p_callback_id), '') is null then
    raise exception 'invalid Hermes design callback identity';
  end if;
  if jsonb_typeof(p_task) <> 'object' or pg_column_size(p_task) > 1048576
    or jsonb_typeof(p_callback) <> 'object'
    or pg_column_size(p_callback) > 1048576 then
    raise exception 'Hermes design callback records must be objects no larger than 1 MiB';
  end if;
  if p_callback->>'callbackId' <> p_callback_id
    or p_callback->>'taskId' <> p_task_id then
    raise exception 'Hermes callback payload identity does not match the request';
  end if;

  select t.*
    into current_task
    from public.hermes_design_tasks t
   where t.organization_id = p_organization_id
     and t.project_key = p_project_key
     and t.task_id = p_task_id
   for update;
  if not found then
    return query
      select false, false, false, null::jsonb, null::bigint, 'not_found'::text;
    return;
  end if;

  select c.*
    into existing_callback
    from public.hermes_design_callbacks c
   where c.organization_id = p_organization_id
     and c.project_key = p_project_key
     and c.callback_id = p_callback_id;
  if found then
    if existing_callback.task_id <> p_task_id then
      raise exception 'Hermes callback identity is already bound to another task';
    end if;
    return query
      select false, true, false, current_task.payload, current_task.revision, null::text;
    return;
  end if;

  if current_task.revision <> p_expected_revision then
    return query
      select false, false, false, current_task.payload, current_task.revision,
        'revision_conflict'::text;
    return;
  end if;
  if p_task->>'id' <> current_task.task_id
    or p_task->>'idempotencyKey' <> current_task.idempotency_key
    or p_task->>'sessionId' <> current_task.session_id
    or p_task->>'companyId' <> current_task.company_id then
    raise exception 'Hermes design task identity cannot change';
  end if;
  if not coalesce((p_task->'callbackIds') ? p_callback_id, false) then
    raise exception 'Hermes design task must record the callback identity';
  end if;

  insert into public.hermes_design_callbacks (
    organization_id,
    project_key,
    callback_id,
    task_id,
    callback_type,
    payload
  ) values (
    p_organization_id,
    p_project_key,
    p_callback_id,
    p_task_id,
    p_callback->>'type',
    p_callback
  );

  update public.hermes_design_tasks t
     set status = p_task->>'status',
         payload = p_task,
         revision = t.revision + 1,
         updated_at = coalesce((p_task->>'updatedAt')::timestamptz, now())
   where t.organization_id = p_organization_id
     and t.project_key = p_project_key
     and t.task_id = p_task_id
  returning t.* into saved_task;
  return query
    select true, false, true, saved_task.payload, saved_task.revision, null::text;
end;
$$;

revoke all on function public.create_hermes_design_task(uuid, text, jsonb)
  from public, anon, authenticated;
revoke all on function public.compare_and_swap_hermes_design_task(
  uuid, text, text, bigint, jsonb
) from public, anon, authenticated;
revoke all on function public.apply_hermes_design_callback(
  uuid, text, text, text, bigint, jsonb, jsonb
) from public, anon, authenticated;
grant execute on function public.create_hermes_design_task(uuid, text, jsonb)
  to service_role;
grant execute on function public.compare_and_swap_hermes_design_task(
  uuid, text, text, bigint, jsonb
) to service_role;
grant execute on function public.apply_hermes_design_callback(
  uuid, text, text, text, bigint, jsonb, jsonb
) to service_role;
