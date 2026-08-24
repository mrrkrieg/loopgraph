-- Staging-only active probe for the hosted App snapshot mutation fence.
-- The registry probe executes insert, content-changing update, and delete in one
-- transaction against a random reserved project scope, verifies every generation
-- advance, and removes both the probe row and generation row before returning.

create or replace function public.loopgraph_app_snapshot_registry_fence_probe(
  p_organization_id uuid,
  p_project_key text
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_workspace_id text := 'fence-probe-' || pg_catalog.replace(extensions.gen_random_uuid()::text, '-', '');
  v_before bigint;
  v_after_insert bigint;
  v_after_update bigint;
  v_after_delete bigint;
begin
  if p_project_key !~ '^fence_probe_[a-f0-9]{24}$' then
    raise exception 'Invalid hosted App snapshot fence probe scope';
  end if;

  select coalesce(generation, 0)
    into v_before
  from public.loopgraph_app_snapshot_inventory_generations
  where organization_id = p_organization_id
    and project_key = p_project_key;
  v_before := coalesce(v_before, 0);

  insert into public.loopgraph_app_installation_registries (
    organization_id,
    project_key,
    workspace_id,
    revision,
    registry_payload
  ) values (
    p_organization_id,
    p_project_key,
    v_workspace_id,
    0,
    pg_catalog.jsonb_build_object(
      'schemaVersion', 'loopgraph-app-install/v1alpha1',
      'workspaceId', v_workspace_id,
      'revision', 0,
      'installations', '[]'::jsonb,
      'assets', '[]'::jsonb,
      'evaluations', '[]'::jsonb,
      'lifecycleReceipts', '[]'::jsonb,
      'activationApprovals', '[]'::jsonb,
      'updatedAt', '1970-01-01T00:00:00.000Z'
    )
  );

  select generation into strict v_after_insert
  from public.loopgraph_app_snapshot_inventory_generations
  where organization_id = p_organization_id
    and project_key = p_project_key;
  if v_after_insert <= v_before then
    raise exception 'Hosted App snapshot registry insert did not advance the fence';
  end if;

  update public.loopgraph_app_installation_registries
  set revision = 1,
      registry_payload = registry_payload
        || pg_catalog.jsonb_build_object(
          'revision', 1,
          'updatedAt', '1970-01-01T00:00:01.000Z'
        ),
      updated_at = now()
  where organization_id = p_organization_id
    and project_key = p_project_key
    and workspace_id = v_workspace_id;

  select generation into strict v_after_update
  from public.loopgraph_app_snapshot_inventory_generations
  where organization_id = p_organization_id
    and project_key = p_project_key;
  if v_after_update <= v_after_insert then
    raise exception 'Hosted App snapshot registry update did not advance the fence';
  end if;

  delete from public.loopgraph_app_installation_registries
  where organization_id = p_organization_id
    and project_key = p_project_key
    and workspace_id = v_workspace_id;

  select generation into strict v_after_delete
  from public.loopgraph_app_snapshot_inventory_generations
  where organization_id = p_organization_id
    and project_key = p_project_key;
  if v_after_delete <= v_after_update then
    raise exception 'Hosted App snapshot registry delete did not advance the fence';
  end if;

  if exists (
    select 1
    from public.loopgraph_app_installation_registries
    where organization_id = p_organization_id
      and project_key = p_project_key
  ) then
    raise exception 'Hosted App snapshot registry probe cleanup was incomplete';
  end if;

  delete from public.loopgraph_app_snapshot_inventory_generations
  where organization_id = p_organization_id
    and project_key = p_project_key;

  return pg_catalog.jsonb_build_object(
    'schemaVersion', 'hosted-app-snapshot-registry-fence-probe/v1',
    'insertAdvanced', true,
    'updateAdvanced', true,
    'deleteAdvanced', true,
    'registryClean', true,
    'generationClean', true
  );
end;
$$;

create or replace function public.loopgraph_app_snapshot_storage_fence_probe_cleanup(
  p_organization_id uuid,
  p_project_key text
)
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_prefix text;
begin
  if p_project_key !~ '^fence_probe_[a-f0-9]{24}$' then
    raise exception 'Invalid hosted App snapshot fence probe scope';
  end if;
  v_prefix := p_organization_id::text || '/' || p_project_key || '/';

  if exists (
    select 1
    from public.loopgraph_app_installation_registries
    where organization_id = p_organization_id
      and project_key = p_project_key
  ) or exists (
    select 1
    from storage.objects
    where bucket_id = 'loopgraph-app-snapshots'
      and pg_catalog.left(name, pg_catalog.length(v_prefix)) = v_prefix
  ) then
    raise exception 'Hosted App snapshot fence probe cleanup refused residual authority';
  end if;

  delete from public.loopgraph_app_snapshot_inventory_generations
  where organization_id = p_organization_id
    and project_key = p_project_key;
  return true;
end;
$$;

alter function public.loopgraph_app_snapshot_registry_fence_probe(uuid, text)
  owner to postgres;
alter function public.loopgraph_app_snapshot_storage_fence_probe_cleanup(uuid, text)
  owner to postgres;

revoke all on function public.loopgraph_app_snapshot_registry_fence_probe(uuid, text)
  from public, anon, authenticated;
revoke all on function public.loopgraph_app_snapshot_storage_fence_probe_cleanup(uuid, text)
  from public, anon, authenticated;
grant execute on function public.loopgraph_app_snapshot_registry_fence_probe(uuid, text)
  to service_role;
grant execute on function public.loopgraph_app_snapshot_storage_fence_probe_cleanup(uuid, text)
  to service_role;
