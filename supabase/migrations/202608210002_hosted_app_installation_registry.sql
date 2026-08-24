-- Distributed, tenant-scoped App installation state. The registry and lock are
-- committed together behind a revision-bound lease so concurrent serverless
-- instances cannot independently advance one workspace lifecycle.

create table if not exists public.loopgraph_app_installation_registries (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  project_key text not null,
  workspace_id text not null,
  revision bigint not null default 0,
  registry_payload jsonb not null,
  lock_payload jsonb,
  lease_token uuid,
  lease_expires_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (organization_id, project_key, workspace_id),
  constraint loopgraph_app_installation_project_check check (project_key ~ '^[a-z0-9][a-z0-9_-]{0,63}$'),
  constraint loopgraph_app_installation_workspace_check check (length(workspace_id) between 1 and 160),
  constraint loopgraph_app_installation_revision_check check (revision >= 0),
  constraint loopgraph_app_installation_registry_shape_check check (
    jsonb_typeof(registry_payload) = 'object'
    and registry_payload->>'schemaVersion' = 'loopgraph-app-install/v1alpha1'
    and registry_payload->>'workspaceId' = workspace_id
    and (registry_payload->>'revision') ~ '^[0-9]+$'
    and (registry_payload->>'revision')::bigint = revision
    and pg_column_size(registry_payload) <= 8388608
  ),
  constraint loopgraph_app_installation_lock_shape_check check (
    lock_payload is null
    or (jsonb_typeof(lock_payload) = 'object' and pg_column_size(lock_payload) <= 2097152)
  ),
  constraint loopgraph_app_installation_lease_pair_check check (
    (lease_token is null and lease_expires_at is null)
    or (lease_token is not null and lease_expires_at is not null)
  )
);

create index if not exists loopgraph_app_installation_registry_activity_idx
  on public.loopgraph_app_installation_registries (organization_id, project_key, updated_at desc);

alter table public.loopgraph_app_installation_registries enable row level security;
revoke all on public.loopgraph_app_installation_registries from public, anon, authenticated, service_role;
grant select on public.loopgraph_app_installation_registries to service_role;

create or replace function public.acquire_loopgraph_app_installation_lease(
  p_organization_id uuid,
  p_project_key text,
  p_workspace_id text,
  p_expected_revision bigint,
  p_lease_token uuid,
  p_lease_seconds integer
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.loopgraph_app_installation_registries%rowtype;
begin
  if p_project_key !~ '^[a-z0-9][a-z0-9_-]{0,63}$'
    or length(p_workspace_id) not between 1 and 160
    or p_expected_revision < 0
    or p_lease_seconds not between 30 and 900
  then raise exception 'invalid Loopgraph App installation lease request'; end if;

  insert into public.loopgraph_app_installation_registries (
    organization_id, project_key, workspace_id, revision, registry_payload
  ) values (
    p_organization_id,
    p_project_key,
    p_workspace_id,
    0,
    jsonb_build_object(
      'schemaVersion', 'loopgraph-app-install/v1alpha1',
      'workspaceId', p_workspace_id,
      'revision', 0,
      'installations', '[]'::jsonb,
      'assets', '[]'::jsonb,
      'evaluations', '[]'::jsonb,
      'lifecycleReceipts', '[]'::jsonb,
      'activationApprovals', '[]'::jsonb,
      'updatedAt', '1970-01-01T00:00:00.000Z'
    )
  ) on conflict do nothing;

  select * into strict v_row
    from public.loopgraph_app_installation_registries
    where organization_id = p_organization_id
      and project_key = p_project_key
      and workspace_id = p_workspace_id
    for update;

  if v_row.revision <> p_expected_revision then
    raise exception 'Loopgraph App installation registry revision conflict';
  end if;
  if v_row.lease_token is not null and v_row.lease_expires_at > now() then
    raise exception 'Loopgraph App installation registry is already being mutated';
  end if;

  update public.loopgraph_app_installation_registries
    set lease_token = p_lease_token,
        lease_expires_at = now() + make_interval(secs => p_lease_seconds)
    where organization_id = p_organization_id
      and project_key = p_project_key
      and workspace_id = p_workspace_id;

  return jsonb_build_object(
    'registry_payload', v_row.registry_payload,
    'lock_payload', v_row.lock_payload
  );
end;
$$;

create or replace function public.commit_loopgraph_app_installation_registry(
  p_organization_id uuid,
  p_project_key text,
  p_workspace_id text,
  p_expected_revision bigint,
  p_lease_token uuid,
  p_registry jsonb,
  p_lock jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.loopgraph_app_installation_registries%rowtype;
  v_next_revision bigint;
  v_actor text;
  v_action text;
begin
  if p_project_key !~ '^[a-z0-9][a-z0-9_-]{0,63}$'
    or length(p_workspace_id) not between 1 and 160
    or jsonb_typeof(p_registry) <> 'object'
    or pg_column_size(p_registry) > 8388608
    or p_registry->>'schemaVersion' <> 'loopgraph-app-install/v1alpha1'
    or p_registry->>'workspaceId' <> p_workspace_id
    or coalesce(p_registry->>'revision', '') !~ '^[0-9]+$'
    or (p_lock is not null and (jsonb_typeof(p_lock) <> 'object' or pg_column_size(p_lock) > 2097152))
  then raise exception 'invalid Loopgraph App installation registry commit'; end if;
  v_next_revision := (p_registry->>'revision')::bigint;
  if v_next_revision not in (p_expected_revision, p_expected_revision + 1) then
    raise exception 'Loopgraph App installation revision must remain stable or advance by one';
  end if;

  select * into strict v_row
    from public.loopgraph_app_installation_registries
    where organization_id = p_organization_id
      and project_key = p_project_key
      and workspace_id = p_workspace_id
    for update;
  if v_row.revision <> p_expected_revision then
    raise exception 'Loopgraph App installation registry revision conflict';
  end if;
  if v_row.lease_token is distinct from p_lease_token or v_row.lease_expires_at <= now() then
    raise exception 'Loopgraph App installation mutation lease is invalid or expired';
  end if;
  if v_next_revision = p_expected_revision and p_registry <> v_row.registry_payload then
    raise exception 'Loopgraph App installation mutation changed content without advancing revision';
  end if;

  update public.loopgraph_app_installation_registries
    set revision = v_next_revision,
        registry_payload = p_registry,
        lock_payload = p_lock,
        lease_token = null,
        lease_expires_at = null,
        updated_at = case when v_next_revision > p_expected_revision then now() else updated_at end
    where organization_id = p_organization_id
      and project_key = p_project_key
      and workspace_id = p_workspace_id;

  if v_next_revision > p_expected_revision then
    v_actor := coalesce(
      p_registry#>>'{lifecycleReceipts,-1,actor}',
      p_registry#>>'{installations,-1,installedBy}',
      'loopgraph-system'
    );
    v_action := coalesce(p_registry#>>'{lifecycleReceipts,-1,action}', 'install');
    perform private.append_security_audit_event(
      p_organization_id, p_project_key, 'app.installation_registry.committed', 'accepted', 'user',
      v_actor, 'app.installation.manage', null, gen_random_uuid()::text,
      'app_installation_registry', 'workspace', p_workspace_id,
      jsonb_build_object(
        'workspaceId', p_workspace_id,
        'revision', v_next_revision,
        'action', v_action,
        'installationCount', jsonb_array_length(p_registry->'installations')
      )
    );
  end if;
  return p_registry;
end;
$$;

create or replace function public.release_loopgraph_app_installation_lease(
  p_organization_id uuid,
  p_project_key text,
  p_workspace_id text,
  p_lease_token uuid
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.loopgraph_app_installation_registries
    set lease_token = null, lease_expires_at = null
    where organization_id = p_organization_id
      and project_key = p_project_key
      and workspace_id = p_workspace_id
      and lease_token = p_lease_token;
  return found;
end;
$$;

revoke all on function public.acquire_loopgraph_app_installation_lease(uuid, text, text, bigint, uuid, integer) from public, anon, authenticated;
revoke all on function public.commit_loopgraph_app_installation_registry(uuid, text, text, bigint, uuid, jsonb, jsonb) from public, anon, authenticated;
revoke all on function public.release_loopgraph_app_installation_lease(uuid, text, text, uuid) from public, anon, authenticated;
grant execute on function public.acquire_loopgraph_app_installation_lease(uuid, text, text, bigint, uuid, integer) to service_role;
grant execute on function public.commit_loopgraph_app_installation_registry(uuid, text, text, bigint, uuid, jsonb, jsonb) to service_role;
grant execute on function public.release_loopgraph_app_installation_lease(uuid, text, text, uuid) to service_role;
