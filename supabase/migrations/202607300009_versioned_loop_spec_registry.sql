-- Tenant-scoped immutable LoopSpec versions and one active registry.
-- Hosted Hermes materialization commits versions, active entries, the
-- workspace revision, and the discovery-session transition in one transaction.

create table if not exists public.loop_spec_workspaces (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  project_key text not null,
  payload jsonb not null,
  revision bigint not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (organization_id, project_key),
  constraint loop_spec_workspaces_project_key_check
    check (project_key ~ '^[a-z0-9][a-z0-9_-]{0,63}$'),
  constraint loop_spec_workspaces_payload_object_check
    check (jsonb_typeof(payload) = 'object'),
  constraint loop_spec_workspaces_payload_size_check
    check (pg_column_size(payload) <= 4194304),
  constraint loop_spec_workspaces_revision_check
    check (revision >= 0)
);

create table if not exists public.loop_spec_versions (
  organization_id uuid not null,
  project_key text not null,
  loop_id text not null,
  version_hash text not null,
  spec jsonb not null,
  entry jsonb not null,
  fixtures jsonb not null default '{}'::jsonb,
  source text not null,
  source_ref text not null,
  created_at timestamptz not null,
  primary key (organization_id, project_key, loop_id, version_hash),
  foreign key (organization_id, project_key)
    references public.loop_spec_workspaces(organization_id, project_key)
    on delete cascade,
  constraint loop_spec_versions_project_key_check
    check (project_key ~ '^[a-z0-9][a-z0-9_-]{0,63}$'),
  constraint loop_spec_versions_identity_check
    check (
      length(loop_id) between 1 and 512
      and version_hash ~ '^[a-f0-9]{64}$'
      and length(source_ref) between 1 and 2048
    ),
  constraint loop_spec_versions_source_check
    check (source in ('hermes_design', 'semantic_graph', 'design_studio', 'import')),
  constraint loop_spec_versions_spec_object_check
    check (jsonb_typeof(spec) = 'object'),
  constraint loop_spec_versions_entry_object_check
    check (jsonb_typeof(entry) = 'object'),
  constraint loop_spec_versions_fixtures_object_check
    check (jsonb_typeof(fixtures) = 'object'),
  constraint loop_spec_versions_spec_size_check
    check (pg_column_size(spec) <= 4194304),
  constraint loop_spec_versions_entry_size_check
    check (pg_column_size(entry) <= 65536),
  constraint loop_spec_versions_fixtures_size_check
    check (pg_column_size(fixtures) <= 4194304)
);

create index if not exists loop_spec_versions_created_idx
  on public.loop_spec_versions(
    organization_id,
    project_key,
    created_at desc,
    loop_id
  );

create table if not exists public.loop_spec_registry (
  organization_id uuid not null,
  project_key text not null,
  loop_id text not null,
  active_version_hash text not null,
  spec jsonb not null,
  entry jsonb not null,
  fixtures jsonb not null default '{}'::jsonb,
  source text not null,
  source_ref text not null,
  activated_at timestamptz not null,
  updated_at timestamptz not null default now(),
  primary key (organization_id, project_key, loop_id),
  foreign key (organization_id, project_key, loop_id, active_version_hash)
    references public.loop_spec_versions(
      organization_id,
      project_key,
      loop_id,
      version_hash
    )
    on delete restrict,
  constraint loop_spec_registry_project_key_check
    check (project_key ~ '^[a-z0-9][a-z0-9_-]{0,63}$'),
  constraint loop_spec_registry_identity_check
    check (
      length(loop_id) between 1 and 512
      and active_version_hash ~ '^[a-f0-9]{64}$'
      and length(source_ref) between 1 and 2048
    ),
  constraint loop_spec_registry_source_check
    check (source in ('hermes_design', 'semantic_graph', 'design_studio', 'import')),
  constraint loop_spec_registry_spec_object_check
    check (jsonb_typeof(spec) = 'object'),
  constraint loop_spec_registry_entry_object_check
    check (jsonb_typeof(entry) = 'object'),
  constraint loop_spec_registry_fixtures_object_check
    check (jsonb_typeof(fixtures) = 'object')
);

create index if not exists loop_spec_registry_department_idx
  on public.loop_spec_registry(
    organization_id,
    project_key,
    ((entry->>'department')),
    loop_id
  );

create table if not exists public.loop_spec_commits (
  organization_id uuid not null,
  project_key text not null,
  commit_id text not null,
  idempotency_key text not null,
  expected_workspace_revision bigint not null,
  artifact_bindings jsonb not null,
  result_workspace jsonb not null,
  result_workspace_revision bigint not null,
  result_artifacts jsonb not null,
  result_discovery_session jsonb,
  committed_at timestamptz not null,
  primary key (organization_id, project_key, commit_id),
  unique (organization_id, project_key, idempotency_key),
  foreign key (organization_id, project_key)
    references public.loop_spec_workspaces(organization_id, project_key)
    on delete cascade,
  constraint loop_spec_commits_project_key_check
    check (project_key ~ '^[a-z0-9][a-z0-9_-]{0,63}$'),
  constraint loop_spec_commits_identity_check
    check (
      length(commit_id) between 1 and 512
      and length(idempotency_key) between 1 and 512
    ),
  constraint loop_spec_commits_bindings_array_check
    check (jsonb_typeof(artifact_bindings) = 'array'),
  constraint loop_spec_commits_workspace_object_check
    check (jsonb_typeof(result_workspace) = 'object'),
  constraint loop_spec_commits_artifacts_array_check
    check (jsonb_typeof(result_artifacts) = 'array'),
  constraint loop_spec_commits_revision_check
    check (
      expected_workspace_revision >= 0
      and result_workspace_revision = expected_workspace_revision + 1
    )
);

alter table public.loop_spec_workspaces enable row level security;
alter table public.loop_spec_versions enable row level security;
alter table public.loop_spec_registry enable row level security;
alter table public.loop_spec_commits enable row level security;

revoke all on public.loop_spec_workspaces
  from public, anon, authenticated, service_role;
revoke all on public.loop_spec_versions
  from public, anon, authenticated, service_role;
revoke all on public.loop_spec_registry
  from public, anon, authenticated, service_role;
revoke all on public.loop_spec_commits
  from public, anon, authenticated, service_role;

grant select on public.loop_spec_workspaces to service_role;
grant select on public.loop_spec_versions to service_role;
grant select on public.loop_spec_registry to service_role;
grant select on public.loop_spec_commits to service_role;

create or replace function public.commit_loop_spec_registry(
  p_organization_id uuid,
  p_project_key text,
  p_project_root text,
  p_commit_id text,
  p_idempotency_key text,
  p_expected_workspace_revision bigint,
  p_committed_at timestamptz,
  p_workspace_seed jsonb,
  p_artifacts jsonb,
  p_discovery_session_id text default null,
  p_expected_discovery_revision bigint default null,
  p_discovery_session jsonb default null
)
returns table (
  workspace jsonb,
  workspace_revision bigint,
  artifacts jsonb,
  discovery_session jsonb,
  created boolean
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_workspace public.loop_spec_workspaces%rowtype;
  existing_commit public.loop_spec_commits%rowtype;
  current_session public.discovery_sessions%rowtype;
  saved_session public.discovery_sessions%rowtype;
  artifact jsonb;
  stored_version public.loop_spec_versions%rowtype;
  next_workspace jsonb;
  next_entries jsonb;
  result_artifacts jsonb := '[]'::jsonb;
  artifact_bindings jsonb := '[]'::jsonb;
  v_loop_id text;
  v_version_hash text;
  v_source text;
  v_source_ref text;
  v_entry jsonb;
  v_spec jsonb;
  v_fixtures jsonb;
begin
  if p_project_key !~ '^[a-z0-9][a-z0-9_-]{0,63}$'
    or nullif(btrim(p_project_root), '') is null
    or nullif(btrim(p_commit_id), '') is null
    or nullif(btrim(p_idempotency_key), '') is null
    or p_expected_workspace_revision < 0 then
    raise exception 'invalid LoopSpec registry commit identity';
  end if;
  if jsonb_typeof(p_workspace_seed) <> 'object'
    or pg_column_size(p_workspace_seed) > 4194304 then
    raise exception 'LoopSpec workspace seed is invalid or too large';
  end if;
  if jsonb_typeof(p_artifacts) <> 'array'
    or jsonb_array_length(p_artifacts) < 1
    or jsonb_array_length(p_artifacts) > 32
    or pg_column_size(p_artifacts) > 33554432 then
    raise exception 'LoopSpec registry commit must contain 1 to 32 bounded artifacts';
  end if;

  select commits.*
    into existing_commit
    from public.loop_spec_commits commits
   where commits.organization_id = p_organization_id
     and commits.project_key = p_project_key
     and (
       commits.commit_id = p_commit_id
       or commits.idempotency_key = p_idempotency_key
     )
   order by (commits.commit_id = p_commit_id) desc
   limit 1;
  if found then
    if existing_commit.commit_id <> p_commit_id
      or existing_commit.idempotency_key <> p_idempotency_key then
      raise exception 'LoopSpec commit identity conflicts with an existing receipt';
    end if;
    workspace := existing_commit.result_workspace;
    workspace_revision := existing_commit.result_workspace_revision;
    artifacts := existing_commit.result_artifacts;
    discovery_session := existing_commit.result_discovery_session;
    created := false;
    return next;
    return;
  end if;

  insert into public.loop_spec_workspaces (
    organization_id,
    project_key,
    payload,
    revision,
    created_at,
    updated_at
  ) values (
    p_organization_id,
    p_project_key,
    p_workspace_seed,
    0,
    p_committed_at,
    p_committed_at
  )
  on conflict do nothing;

  select stored.*
    into current_workspace
    from public.loop_spec_workspaces stored
   where stored.organization_id = p_organization_id
     and stored.project_key = p_project_key
   for update;
  if current_workspace.revision <> p_expected_workspace_revision then
    raise exception 'LoopSpec workspace revision conflict: expected %, found %',
      p_expected_workspace_revision,
      current_workspace.revision;
  end if;

  next_entries := coalesce(
    current_workspace.payload->'registeredSpecs',
    '[]'::jsonb
  );

  for artifact in
    select value from jsonb_array_elements(p_artifacts)
  loop
    if jsonb_typeof(artifact) <> 'object' then
      raise exception 'LoopSpec artifact must be an object';
    end if;
    v_loop_id := nullif(btrim(artifact->>'loopId'), '');
    v_version_hash := nullif(btrim(artifact->>'versionHash'), '');
    v_source := nullif(btrim(artifact->>'source'), '');
    v_source_ref := nullif(btrim(artifact->>'sourceRef'), '');
    v_entry := artifact->'entry';
    v_spec := artifact->'spec';
    v_fixtures := coalesce(artifact->'fixtures', '{}'::jsonb);
    if v_loop_id is null
      or v_version_hash !~ '^[a-f0-9]{64}$'
      or v_source not in ('hermes_design', 'semantic_graph', 'design_studio', 'import')
      or v_source_ref is null
      or jsonb_typeof(v_entry) <> 'object'
      or jsonb_typeof(v_spec) <> 'object'
      or jsonb_typeof(v_fixtures) <> 'object'
      or v_entry->>'id' <> v_loop_id
      or v_entry->>'path' <> v_source_ref
      or v_spec->'metadata'->>'id' <> v_loop_id then
      raise exception 'LoopSpec artifact identity is invalid';
    end if;
    if pg_column_size(v_entry) > 65536
      or pg_column_size(v_spec) > 4194304
      or pg_column_size(v_fixtures) > 4194304 then
      raise exception 'LoopSpec artifact payload is too large';
    end if;

    insert into public.loop_spec_versions (
      organization_id,
      project_key,
      loop_id,
      version_hash,
      spec,
      entry,
      fixtures,
      source,
      source_ref,
      created_at
    ) values (
      p_organization_id,
      p_project_key,
      v_loop_id,
      v_version_hash,
      v_spec,
      v_entry,
      v_fixtures,
      v_source,
      v_source_ref,
      p_committed_at
    )
    on conflict do nothing
    returning * into stored_version;

    if not found then
      select versions.*
        into stored_version
        from public.loop_spec_versions versions
       where versions.organization_id = p_organization_id
         and versions.project_key = p_project_key
         and versions.loop_id = v_loop_id
         and versions.version_hash = v_version_hash;
      if not found
        or stored_version.spec <> v_spec
        or stored_version.entry <> v_entry
        or stored_version.fixtures <> v_fixtures then
        raise exception 'LoopSpec immutable version conflict';
      end if;
    end if;

    insert into public.loop_spec_registry (
      organization_id,
      project_key,
      loop_id,
      active_version_hash,
      spec,
      entry,
      fixtures,
      source,
      source_ref,
      activated_at,
      updated_at
    ) values (
      p_organization_id,
      p_project_key,
      v_loop_id,
      v_version_hash,
      v_spec,
      v_entry,
      v_fixtures,
      v_source,
      v_source_ref,
      p_committed_at,
      p_committed_at
    )
    on conflict (organization_id, project_key, loop_id)
    do update
       set active_version_hash = excluded.active_version_hash,
           spec = excluded.spec,
           entry = excluded.entry,
           fixtures = excluded.fixtures,
           source = excluded.source,
           source_ref = excluded.source_ref,
           activated_at = excluded.activated_at,
           updated_at = excluded.updated_at;

    select coalesce(jsonb_agg(value order by value->>'name'), '[]'::jsonb)
      into next_entries
      from jsonb_array_elements(next_entries) entries(value)
     where value->>'id' <> v_loop_id;
    next_entries := next_entries || jsonb_build_array(v_entry);
    result_artifacts := result_artifacts || jsonb_build_array(artifact);
    artifact_bindings := artifact_bindings || jsonb_build_array(
      jsonb_build_object(
        'loopId', v_loop_id,
        'versionHash', v_version_hash
      )
    );
  end loop;

  select coalesce(jsonb_agg(value order by value->>'name'), '[]'::jsonb)
    into next_entries
    from jsonb_array_elements(next_entries) entries(value);
  next_workspace := jsonb_set(
    current_workspace.payload,
    '{registeredSpecs}',
    next_entries,
    true
  );
  next_workspace := jsonb_set(
    next_workspace,
    '{projectRoot}',
    to_jsonb(p_project_root),
    true
  );
  next_workspace := jsonb_set(
    next_workspace,
    '{updatedAt}',
    to_jsonb(p_committed_at::text),
    true
  );

  update public.loop_spec_workspaces stored
     set payload = next_workspace,
         revision = current_workspace.revision + 1,
         updated_at = p_committed_at
   where stored.organization_id = p_organization_id
     and stored.project_key = p_project_key
  returning * into current_workspace;

  if p_discovery_session_id is not null
    or p_expected_discovery_revision is not null
    or p_discovery_session is not null then
    if p_discovery_session_id is null
      or p_expected_discovery_revision is null
      or jsonb_typeof(p_discovery_session) <> 'object' then
      raise exception 'discovery session transition is incomplete';
    end if;
    select sessions.*
      into current_session
      from public.discovery_sessions sessions
     where sessions.organization_id = p_organization_id
       and sessions.project_key = p_project_key
       and sessions.session_id = p_discovery_session_id
     for update;
    if not found then
      raise exception 'discovery session not found for LoopSpec materialization';
    end if;
    if current_session.revision <> p_expected_discovery_revision
      or p_discovery_session->>'id' <> current_session.session_id
      or p_discovery_session->>'companyId' <> current_session.company_id
      or p_discovery_session->>'createdAt' <> current_session.payload->>'createdAt'
      or coalesce((p_discovery_session->>'revision')::bigint, -1)
        <> p_expected_discovery_revision + 1 then
      raise exception 'discovery session transition conflicts with LoopSpec materialization';
    end if;
    update public.discovery_sessions sessions
       set status = p_discovery_session->>'status',
           active_stage = p_discovery_session->>'activeStage',
           payload = p_discovery_session,
           revision = p_expected_discovery_revision + 1,
           updated_at = (p_discovery_session->>'updatedAt')::timestamptz
     where sessions.organization_id = p_organization_id
       and sessions.project_key = p_project_key
       and sessions.session_id = p_discovery_session_id
    returning * into saved_session;
  end if;

  insert into public.loop_spec_commits (
    organization_id,
    project_key,
    commit_id,
    idempotency_key,
    expected_workspace_revision,
    artifact_bindings,
    result_workspace,
    result_workspace_revision,
    result_artifacts,
    result_discovery_session,
    committed_at
  ) values (
    p_organization_id,
    p_project_key,
    p_commit_id,
    p_idempotency_key,
    p_expected_workspace_revision,
    artifact_bindings,
    current_workspace.payload,
    current_workspace.revision,
    result_artifacts,
    case when p_discovery_session_id is null then null else saved_session.payload end,
    p_committed_at
  );

  workspace := current_workspace.payload;
  workspace_revision := current_workspace.revision;
  artifacts := result_artifacts;
  discovery_session :=
    case when p_discovery_session_id is null then null else saved_session.payload end;
  created := true;
  return next;
end;
$$;

create or replace function public.get_loop_spec_registry_snapshot(
  p_organization_id uuid,
  p_project_key text
)
returns table (
  workspace_count bigint,
  active_loop_spec_count bigint,
  immutable_loop_spec_version_count bigint,
  loop_spec_commit_count bigint,
  workspace_revision bigint
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    (
      select count(*)
      from public.loop_spec_workspaces workspaces
      where workspaces.organization_id = p_organization_id
        and workspaces.project_key = p_project_key
    ),
    (
      select count(*)
      from public.loop_spec_registry registry
      where registry.organization_id = p_organization_id
        and registry.project_key = p_project_key
    ),
    (
      select count(*)
      from public.loop_spec_versions versions
      where versions.organization_id = p_organization_id
        and versions.project_key = p_project_key
    ),
    (
      select count(*)
      from public.loop_spec_commits commits
      where commits.organization_id = p_organization_id
        and commits.project_key = p_project_key
    ),
    coalesce(
      (
        select workspaces.revision
        from public.loop_spec_workspaces workspaces
        where workspaces.organization_id = p_organization_id
          and workspaces.project_key = p_project_key
      ),
      0
    );
$$;

revoke all on function public.commit_loop_spec_registry(
  uuid, text, text, text, text, bigint, timestamptz, jsonb, jsonb,
  text, bigint, jsonb
) from public, anon, authenticated, service_role;
revoke all on function public.get_loop_spec_registry_snapshot(uuid, text)
  from public, anon, authenticated, service_role;

grant execute on function public.commit_loop_spec_registry(
  uuid, text, text, text, text, bigint, timestamptz, jsonb, jsonb,
  text, bigint, jsonb
) to service_role;
grant execute on function public.get_loop_spec_registry_snapshot(uuid, text)
  to service_role;
