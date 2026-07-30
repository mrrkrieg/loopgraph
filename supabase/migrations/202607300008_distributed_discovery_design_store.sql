-- Tenant-scoped discovery evidence and immutable design artifacts.
-- Local CLI installations remain file-backed. Hosted replicas use these
-- records so discovery can begin on one server and Hermes design can complete
-- on another without relying on an ephemeral runtime filesystem.

create table if not exists public.discovery_sessions (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  project_key text not null,
  session_id text not null,
  company_id text not null,
  status text not null,
  active_stage text not null,
  payload jsonb not null,
  revision bigint not null,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  primary key (organization_id, project_key, session_id),
  constraint discovery_sessions_project_key_check
    check (project_key ~ '^[a-z0-9][a-z0-9_-]{0,63}$'),
  constraint discovery_sessions_identity_check
    check (
      length(session_id) between 1 and 512
      and length(company_id) between 1 and 512
    ),
  constraint discovery_sessions_payload_object_check
    check (jsonb_typeof(payload) = 'object'),
  constraint discovery_sessions_payload_size_check
    check (pg_column_size(payload) <= 4194304),
  constraint discovery_sessions_revision_check
    check (revision >= 0)
);

create index if not exists discovery_sessions_updated_idx
  on public.discovery_sessions(
    organization_id,
    project_key,
    updated_at desc,
    session_id
  );
create index if not exists discovery_sessions_company_idx
  on public.discovery_sessions(
    organization_id,
    project_key,
    company_id,
    updated_at desc
  );

create table if not exists public.discovery_evidence_gap_sets (
  organization_id uuid not null,
  project_key text not null,
  session_id text not null,
  company_id text not null,
  revision bigint not null,
  payload jsonb not null,
  generated_at timestamptz not null,
  updated_at timestamptz not null default now(),
  primary key (organization_id, project_key, session_id),
  foreign key (organization_id, project_key, session_id)
    references public.discovery_sessions(organization_id, project_key, session_id)
    on delete cascade,
  constraint discovery_evidence_gap_sets_project_key_check
    check (project_key ~ '^[a-z0-9][a-z0-9_-]{0,63}$'),
  constraint discovery_evidence_gap_sets_identity_check
    check (
      length(session_id) between 1 and 512
      and length(company_id) between 1 and 512
    ),
  constraint discovery_evidence_gap_sets_payload_object_check
    check (jsonb_typeof(payload) = 'object'),
  constraint discovery_evidence_gap_sets_payload_size_check
    check (pg_column_size(payload) <= 4194304),
  constraint discovery_evidence_gap_sets_revision_check
    check (revision >= 0)
);

create table if not exists public.loop_design_artifacts (
  organization_id uuid not null,
  project_key text not null,
  design_run_id text not null,
  session_id text not null,
  department_type text not null,
  submission_idempotency_key text,
  input_hash text not null,
  output_hash text not null,
  design_context jsonb not null,
  design_run jsonb not null,
  proposal_set jsonb not null,
  created_at timestamptz not null,
  primary key (organization_id, project_key, design_run_id),
  foreign key (organization_id, project_key, session_id)
    references public.discovery_sessions(organization_id, project_key, session_id)
    on delete cascade,
  constraint loop_design_artifacts_project_key_check
    check (project_key ~ '^[a-z0-9][a-z0-9_-]{0,63}$'),
  constraint loop_design_artifacts_identity_check
    check (
      length(design_run_id) between 1 and 512
      and length(session_id) between 1 and 512
      and length(department_type) between 1 and 128
      and length(input_hash) between 1 and 512
      and length(output_hash) between 1 and 512
      and (
        submission_idempotency_key is null
        or length(submission_idempotency_key) between 1 and 512
      )
    ),
  constraint loop_design_artifacts_context_object_check
    check (jsonb_typeof(design_context) = 'object'),
  constraint loop_design_artifacts_run_object_check
    check (jsonb_typeof(design_run) = 'object'),
  constraint loop_design_artifacts_proposal_object_check
    check (jsonb_typeof(proposal_set) = 'object'),
  constraint loop_design_artifacts_context_size_check
    check (pg_column_size(design_context) <= 4194304),
  constraint loop_design_artifacts_run_size_check
    check (pg_column_size(design_run) <= 1048576),
  constraint loop_design_artifacts_proposal_size_check
    check (pg_column_size(proposal_set) <= 4194304)
);

create unique index if not exists loop_design_artifacts_idempotency_idx
  on public.loop_design_artifacts(
    organization_id,
    project_key,
    submission_idempotency_key
  )
  where submission_idempotency_key is not null;
create index if not exists loop_design_artifacts_session_idx
  on public.loop_design_artifacts(
    organization_id,
    project_key,
    session_id,
    created_at desc
  );
create index if not exists loop_design_artifacts_department_idx
  on public.loop_design_artifacts(
    organization_id,
    project_key,
    department_type,
    created_at desc
  );

alter table public.discovery_sessions enable row level security;
alter table public.discovery_evidence_gap_sets enable row level security;
alter table public.loop_design_artifacts enable row level security;
revoke all on public.discovery_sessions
  from public, anon, authenticated, service_role;
revoke all on public.discovery_evidence_gap_sets
  from public, anon, authenticated, service_role;
revoke all on public.loop_design_artifacts
  from public, anon, authenticated, service_role;
grant select on public.discovery_sessions to service_role;
grant select on public.discovery_evidence_gap_sets to service_role;
grant select on public.loop_design_artifacts to service_role;

create or replace function public.create_discovery_session(
  p_organization_id uuid,
  p_project_key text,
  p_session jsonb
)
returns table (
  session jsonb,
  created boolean,
  revision bigint,
  conflict_reason text
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  inserted_session public.discovery_sessions%rowtype;
  existing_session public.discovery_sessions%rowtype;
begin
  if p_project_key !~ '^[a-z0-9][a-z0-9_-]{0,63}$' then
    raise exception 'invalid discovery project key';
  end if;
  if jsonb_typeof(p_session) <> 'object'
    or pg_column_size(p_session) > 4194304 then
    raise exception 'discovery session must be an object no larger than 4 MiB';
  end if;
  if nullif(btrim(p_session->>'id'), '') is null
    or nullif(btrim(p_session->>'companyId'), '') is null
    or nullif(btrim(p_session->>'status'), '') is null
    or nullif(btrim(p_session->>'activeStage'), '') is null
    or nullif(btrim(p_session->>'createdAt'), '') is null
    or nullif(btrim(p_session->>'updatedAt'), '') is null then
    raise exception 'discovery session identity is incomplete';
  end if;
  if coalesce((p_session->>'revision')::bigint, -1) <> 0 then
    raise exception 'new discovery session must start at revision 0';
  end if;

  insert into public.discovery_sessions (
    organization_id,
    project_key,
    session_id,
    company_id,
    status,
    active_stage,
    payload,
    revision,
    created_at,
    updated_at
  ) values (
    p_organization_id,
    p_project_key,
    p_session->>'id',
    p_session->>'companyId',
    p_session->>'status',
    p_session->>'activeStage',
    p_session,
    0,
    (p_session->>'createdAt')::timestamptz,
    (p_session->>'updatedAt')::timestamptz
  )
  on conflict do nothing
  returning * into inserted_session;

  if found then
    return query
      select inserted_session.payload, true, inserted_session.revision, null::text;
    return;
  end if;

  select stored.*
    into existing_session
    from public.discovery_sessions stored
   where stored.organization_id = p_organization_id
     and stored.project_key = p_project_key
     and stored.session_id = p_session->>'id';
  if not found then
    raise exception 'discovery session conflict could not be resolved';
  end if;
  return query
    select existing_session.payload, false, existing_session.revision, 'already_exists'::text;
end;
$$;

create or replace function public.compare_and_swap_discovery_session(
  p_organization_id uuid,
  p_project_key text,
  p_session_id text,
  p_expected_revision bigint,
  p_session jsonb
)
returns table (
  updated boolean,
  session jsonb,
  revision bigint,
  conflict_reason text
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_session public.discovery_sessions%rowtype;
  saved_session public.discovery_sessions%rowtype;
begin
  if p_project_key !~ '^[a-z0-9][a-z0-9_-]{0,63}$'
    or nullif(btrim(p_session_id), '') is null then
    raise exception 'invalid discovery session identity';
  end if;
  if jsonb_typeof(p_session) <> 'object'
    or pg_column_size(p_session) > 4194304 then
    raise exception 'discovery session must be an object no larger than 4 MiB';
  end if;

  select stored.*
    into current_session
    from public.discovery_sessions stored
   where stored.organization_id = p_organization_id
     and stored.project_key = p_project_key
     and stored.session_id = p_session_id
   for update;
  if not found then
    return query
      select false, null::jsonb, null::bigint, 'not_found'::text;
    return;
  end if;
  if current_session.revision <> p_expected_revision then
    return query
      select false, current_session.payload, current_session.revision,
        'revision_conflict'::text;
    return;
  end if;
  if p_session->>'id' <> current_session.session_id
    or p_session->>'companyId' <> current_session.company_id
    or p_session->>'createdAt' <> current_session.payload->>'createdAt' then
    return query
      select false, current_session.payload, current_session.revision,
        'identity_conflict'::text;
    return;
  end if;
  if coalesce((p_session->>'revision')::bigint, -1)
    <> p_expected_revision + 1 then
    return query
      select false, current_session.payload, current_session.revision,
        'invalid_next_revision'::text;
    return;
  end if;

  update public.discovery_sessions stored
     set status = p_session->>'status',
         active_stage = p_session->>'activeStage',
         payload = p_session,
         revision = p_expected_revision + 1,
         updated_at = (p_session->>'updatedAt')::timestamptz
   where stored.organization_id = p_organization_id
     and stored.project_key = p_project_key
     and stored.session_id = p_session_id
  returning * into saved_session;

  return query
    select true, saved_session.payload, saved_session.revision, null::text;
end;
$$;

create or replace function public.put_discovery_evidence_gap_set(
  p_organization_id uuid,
  p_project_key text,
  p_gap_set jsonb
)
returns table (
  gap_set jsonb,
  revision bigint,
  stored boolean
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_session public.discovery_sessions%rowtype;
  saved_gap_set public.discovery_evidence_gap_sets%rowtype;
begin
  if p_project_key !~ '^[a-z0-9][a-z0-9_-]{0,63}$' then
    raise exception 'invalid discovery evidence project key';
  end if;
  if jsonb_typeof(p_gap_set) <> 'object'
    or pg_column_size(p_gap_set) > 4194304 then
    raise exception 'discovery evidence gap set must be an object no larger than 4 MiB';
  end if;
  if nullif(btrim(p_gap_set->>'sessionId'), '') is null
    or nullif(btrim(p_gap_set->>'companyId'), '') is null
    or nullif(btrim(p_gap_set->>'generatedAt'), '') is null
    or coalesce((p_gap_set->>'revision')::bigint, -1) < 0 then
    raise exception 'discovery evidence gap identity is incomplete';
  end if;

  select sessions.*
    into current_session
    from public.discovery_sessions sessions
   where sessions.organization_id = p_organization_id
     and sessions.project_key = p_project_key
     and sessions.session_id = p_gap_set->>'sessionId'
   for share;
  if not found then
    raise exception 'discovery session not found for evidence gaps';
  end if;
  if current_session.company_id <> p_gap_set->>'companyId'
    or (p_gap_set->>'revision')::bigint > current_session.revision then
    raise exception 'discovery evidence gaps do not match the session';
  end if;

  insert into public.discovery_evidence_gap_sets (
    organization_id,
    project_key,
    session_id,
    company_id,
    revision,
    payload,
    generated_at,
    updated_at
  ) values (
    p_organization_id,
    p_project_key,
    p_gap_set->>'sessionId',
    p_gap_set->>'companyId',
    (p_gap_set->>'revision')::bigint,
    p_gap_set,
    (p_gap_set->>'generatedAt')::timestamptz,
    now()
  )
  on conflict (organization_id, project_key, session_id)
  do update
     set company_id = excluded.company_id,
         revision = excluded.revision,
         payload = excluded.payload,
         generated_at = excluded.generated_at,
         updated_at = now()
   where public.discovery_evidence_gap_sets.revision <= excluded.revision
  returning * into saved_gap_set;

  if found then
    return query
      select saved_gap_set.payload, saved_gap_set.revision, true;
    return;
  end if;

  select gaps.*
    into saved_gap_set
    from public.discovery_evidence_gap_sets gaps
   where gaps.organization_id = p_organization_id
     and gaps.project_key = p_project_key
     and gaps.session_id = p_gap_set->>'sessionId';
  return query
    select saved_gap_set.payload, saved_gap_set.revision, false;
end;
$$;

create or replace function public.create_loop_design_artifact(
  p_organization_id uuid,
  p_project_key text,
  p_design_context jsonb,
  p_design_run jsonb,
  p_proposal_set jsonb,
  p_submission_idempotency_key text default null
)
returns table (
  design_context jsonb,
  design_run jsonb,
  proposal_set jsonb,
  session jsonb,
  created boolean,
  conflict_reason text
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  inserted_artifact public.loop_design_artifacts%rowtype;
  existing_artifact public.loop_design_artifacts%rowtype;
  current_session public.discovery_sessions%rowtype;
  next_session_payload jsonb;
  next_design_run_ids jsonb;
  v_run_id text;
  v_session_id text;
  v_department_type text;
  v_input_hash text;
  v_output_hash text;
begin
  if p_project_key !~ '^[a-z0-9][a-z0-9_-]{0,63}$' then
    raise exception 'invalid loop design project key';
  end if;
  if jsonb_typeof(p_design_context) <> 'object'
    or pg_column_size(p_design_context) > 4194304
    or jsonb_typeof(p_design_run) <> 'object'
    or pg_column_size(p_design_run) > 1048576
    or jsonb_typeof(p_proposal_set) <> 'object'
    or pg_column_size(p_proposal_set) > 4194304 then
    raise exception 'loop design artifact payload is invalid or too large';
  end if;

  v_run_id := nullif(btrim(p_design_run->>'id'), '');
  v_session_id := nullif(btrim(p_design_run->>'sessionId'), '');
  v_department_type := nullif(btrim(p_design_run->>'departmentType'), '');
  v_input_hash := nullif(btrim(p_design_run->>'inputHash'), '');
  v_output_hash := nullif(btrim(p_design_run->>'outputHash'), '');
  if v_run_id is null
    or v_session_id is null
    or v_department_type is null
    or v_input_hash is null
    or v_output_hash is null
    or nullif(btrim(p_design_run->>'startedAt'), '') is null then
    raise exception 'loop design artifact identity is incomplete';
  end if;
  if p_design_context->>'sessionId' <> v_session_id
    or p_proposal_set->>'sessionId' <> v_session_id
    or p_design_context->>'departmentType' <> v_department_type
    or p_proposal_set->>'departmentType' <> v_department_type
    or p_design_context->>'contextHash' <> v_input_hash then
    raise exception 'loop design artifact identities do not match';
  end if;
  if p_submission_idempotency_key is not null
    and (
      length(p_submission_idempotency_key) < 1
      or length(p_submission_idempotency_key) > 512
    ) then
    raise exception 'loop design submission idempotency key is invalid';
  end if;

  select stored.*
    into current_session
    from public.discovery_sessions stored
   where stored.organization_id = p_organization_id
     and stored.project_key = p_project_key
     and stored.session_id = v_session_id
   for update;
  if not found then
    raise exception 'discovery session not found for loop design artifact';
  end if;
  if p_design_context->>'companyId' <> current_session.company_id then
    raise exception 'loop design artifact company does not match its discovery session';
  end if;

  insert into public.loop_design_artifacts (
    organization_id,
    project_key,
    design_run_id,
    session_id,
    department_type,
    submission_idempotency_key,
    input_hash,
    output_hash,
    design_context,
    design_run,
    proposal_set,
    created_at
  ) values (
    p_organization_id,
    p_project_key,
    v_run_id,
    v_session_id,
    v_department_type,
    p_submission_idempotency_key,
    v_input_hash,
    v_output_hash,
    p_design_context,
    p_design_run,
    p_proposal_set,
    coalesce(
      (p_design_run->>'completedAt')::timestamptz,
      (p_design_run->>'startedAt')::timestamptz
    )
  )
  on conflict do nothing
  returning * into inserted_artifact;

  if found then
    existing_artifact := inserted_artifact;
    created := true;
    conflict_reason := null;
  else
    select stored.*
      into existing_artifact
      from public.loop_design_artifacts stored
     where stored.organization_id = p_organization_id
       and stored.project_key = p_project_key
       and (
         stored.design_run_id = v_run_id
         or (
           p_submission_idempotency_key is not null
           and stored.submission_idempotency_key = p_submission_idempotency_key
         )
       )
     order by (stored.design_run_id = v_run_id) desc, stored.created_at desc
     limit 1;
    if not found then
      raise exception 'loop design artifact conflict could not be resolved';
    end if;
    created := false;
    conflict_reason := 'already_exists';
  end if;

  if not coalesce(
    current_session.payload->'designRunIds',
    '[]'::jsonb
  ) @> jsonb_build_array(existing_artifact.design_run_id) then
    select coalesce(jsonb_agg(value), '[]'::jsonb)
      into next_design_run_ids
      from (
        select value
          from jsonb_array_elements(
            coalesce(current_session.payload->'designRunIds', '[]'::jsonb)
          )
        union all
        select to_jsonb(existing_artifact.design_run_id)
      ) ids;
    next_session_payload := jsonb_set(
      current_session.payload,
      '{designRunIds}',
      next_design_run_ids,
      true
    );
    next_session_payload := jsonb_set(
      next_session_payload,
      '{activeStage}',
      to_jsonb('proposal_review'::text),
      true
    );
    next_session_payload := jsonb_set(
      next_session_payload,
      '{revision}',
      to_jsonb(current_session.revision + 1),
      true
    );
    next_session_payload := jsonb_set(
      next_session_payload,
      '{updatedAt}',
      to_jsonb(existing_artifact.created_at::text),
      true
    );
    update public.discovery_sessions stored
       set active_stage = 'proposal_review',
           payload = next_session_payload,
           revision = current_session.revision + 1,
           updated_at = existing_artifact.created_at
     where stored.organization_id = p_organization_id
       and stored.project_key = p_project_key
       and stored.session_id = v_session_id
    returning * into current_session;
  end if;

  design_context := existing_artifact.design_context;
  design_run := existing_artifact.design_run;
  proposal_set := existing_artifact.proposal_set;
  session := current_session.payload;
  return next;
end;
$$;

create or replace function public.get_discovery_design_snapshot(
  p_organization_id uuid,
  p_project_key text
)
returns table (
  session_count bigint,
  active_session_count bigint,
  evidence_gap_set_count bigint,
  design_artifact_count bigint,
  oldest_active_session_seconds bigint
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    (
      select count(*)
      from public.discovery_sessions sessions
      where sessions.organization_id = p_organization_id
        and sessions.project_key = p_project_key
    ),
    (
      select count(*)
      from public.discovery_sessions sessions
      where sessions.organization_id = p_organization_id
        and sessions.project_key = p_project_key
        and sessions.status <> 'completed'
    ),
    (
      select count(*)
      from public.discovery_evidence_gap_sets gaps
      where gaps.organization_id = p_organization_id
        and gaps.project_key = p_project_key
    ),
    (
      select count(*)
      from public.loop_design_artifacts artifacts
      where artifacts.organization_id = p_organization_id
        and artifacts.project_key = p_project_key
    ),
    (
      select coalesce(
        extract(epoch from now() - min(sessions.updated_at))::bigint,
        0
      )
      from public.discovery_sessions sessions
      where sessions.organization_id = p_organization_id
        and sessions.project_key = p_project_key
        and sessions.status <> 'completed'
    );
$$;

revoke all on function public.create_discovery_session(uuid, text, jsonb)
  from public, anon, authenticated, service_role;
revoke all on function public.compare_and_swap_discovery_session(
  uuid, text, text, bigint, jsonb
) from public, anon, authenticated, service_role;
revoke all on function public.put_discovery_evidence_gap_set(
  uuid, text, jsonb
) from public, anon, authenticated, service_role;
revoke all on function public.create_loop_design_artifact(
  uuid, text, jsonb, jsonb, jsonb, text
) from public, anon, authenticated, service_role;
revoke all on function public.get_discovery_design_snapshot(uuid, text)
  from public, anon, authenticated, service_role;

grant execute on function public.create_discovery_session(uuid, text, jsonb)
  to service_role;
grant execute on function public.compare_and_swap_discovery_session(
  uuid, text, text, bigint, jsonb
) to service_role;
grant execute on function public.put_discovery_evidence_gap_set(
  uuid, text, jsonb
) to service_role;
grant execute on function public.create_loop_design_artifact(
  uuid, text, jsonb, jsonb, jsonb, text
) to service_role;
grant execute on function public.get_discovery_design_snapshot(uuid, text)
  to service_role;
