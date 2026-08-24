-- Extend the metadata-only App lifecycle journal to pause and resume. Each
-- rollout operation binds the exact source state/mode, destination state/mode,
-- actor, artifact, and owned LoopSpec set so a cross-store interruption can
-- resume without broadening authority or touching provider work.

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
  v_operation jsonb;
begin
  if p_project_key !~ '^[a-z0-9][a-z0-9_-]{0,63}$'
    or length(p_workspace_id) not between 1 and 160
    or jsonb_typeof(p_registry) <> 'object'
    or pg_column_size(p_registry) > 8388608
    or p_registry->>'schemaVersion' <> 'loopgraph-app-install/v1alpha1'
    or p_registry->>'workspaceId' <> p_workspace_id
    or coalesce(p_registry->>'revision', '') !~ '^[0-9]+$'
    or (p_lock is not null and (jsonb_typeof(p_lock) <> 'object' or pg_column_size(p_lock) > 2097152))
    or (
      p_registry->'lifecycleOperations' is not null
      and (
        jsonb_typeof(p_registry->'lifecycleOperations') <> 'array'
        or jsonb_array_length(p_registry->'lifecycleOperations') > 100
        or exists (
          select 1
          from jsonb_array_elements(p_registry->'lifecycleOperations') as item(value)
          where jsonb_typeof(item.value) is distinct from 'object'
            or item.value - array[
              'id', 'idempotencyKey', 'installationId', 'appId', 'action',
              'targetArtifactDigest', 'status', 'desired', 'activation', 'rollout', 'actor',
              'startedAt', 'updatedAt', 'completedAt', 'resultReceiptId', 'failureCode'
            ]::text[] <> '{}'::jsonb
            or item.value::text ~* '"(access[_-]?token|api[_-]?key|authorization|client[_-]?secret|cookie|credential|password|private[_-]?key|refresh[_-]?token|secret|webhook[_-]?secret)"[[:space:]]*:'
            or item.value::text ~* '(Bearer[[:space:]]+[A-Za-z0-9._~+/=-]{12,}|gh[opsu]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|(sk|rk)_(live|test)_[A-Za-z0-9]{12,}|xox[baprs]-[A-Za-z0-9-]{10,}|BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY)'
            or coalesce(item.value->>'action', '') not in ('install', 'uninstall', 'activate', 'pause', 'resume')
            or coalesce(item.value->>'status', '') not in ('prepared', 'requires_reconciliation', 'completed')
            or (item.value->>'failureCode' is not null and item.value->>'failureCode' <> 'operation_interrupted')
            or (item.value->>'status' = 'completed' and item.value->>'completedAt' is null)
            or (item.value->>'status' <> 'completed' and (item.value->>'completedAt' is not null or item.value->>'resultReceiptId' is not null))
            or ((item.value->>'status' = 'requires_reconciliation') <> (item.value->>'failureCode' is not null))
            or (item.value->>'resultReceiptId' is not null and item.value->>'action' <> 'uninstall')
            or length(coalesce(item.value->>'id', '')) not between 1 and 160
            or length(coalesce(item.value->>'idempotencyKey', '')) not between 16 and 160
            or length(coalesce(item.value->>'installationId', '')) not between 1 and 160
            or length(coalesce(item.value->>'appId', '')) not between 1 and 160
            or length(coalesce(item.value->>'targetArtifactDigest', '')) not between 16 and 160
            or length(coalesce(item.value->>'actor', '')) not between 1 and 160
            or jsonb_typeof(item.value->'desired') is distinct from 'object'
            or item.value->'desired' - array['loopIds', 'fieldMappingIds', 'companyContextKeys']::text[] <> '{}'::jsonb
            or jsonb_typeof(item.value#>'{desired,loopIds}') is distinct from 'array'
            or jsonb_array_length(item.value#>'{desired,loopIds}') > 100
            or jsonb_typeof(item.value#>'{desired,fieldMappingIds}') is distinct from 'array'
            or jsonb_array_length(item.value#>'{desired,fieldMappingIds}') > 200
            or jsonb_typeof(item.value#>'{desired,companyContextKeys}') is distinct from 'array'
            or jsonb_array_length(item.value#>'{desired,companyContextKeys}') > 100
            or (
              item.value->>'action' = 'activate'
              and (
                jsonb_typeof(item.value->'activation') is distinct from 'object'
                or item.value->'activation' - array[
                  'approvalReceiptId', 'approvalDigest', 'fromState', 'targetMode'
                ]::text[] <> '{}'::jsonb
                or coalesce(item.value#>>'{activation,approvalReceiptId}', '') !~ '^activation-approval\.[0-9a-f]{16}$'
                or coalesce(item.value#>>'{activation,approvalDigest}', '') !~ '^sha256:[0-9a-f]{64}$'
                or coalesce(item.value#>>'{activation,fromState}', '') not in (
                  'selected', 'resolving', 'waiting_for_connections', 'waiting_for_configuration',
                  'ready_to_test', 'simulation_passed', 'shadow', 'recommend',
                  'execute_with_approval', 'live', 'paused', 'broken', 'degraded',
                  'update_available', 'deprecated', 'revoked', 'uninstalling', 'rolled_back'
                )
                or coalesce(item.value#>>'{activation,targetMode}', '') not in (
                  'shadow', 'recommend', 'execute_with_approval'
                )
                or jsonb_array_length(item.value#>'{desired,fieldMappingIds}') <> 0
                or jsonb_array_length(item.value#>'{desired,companyContextKeys}') <> 0
              )
            )
            or (item.value->>'action' <> 'activate' and item.value->'activation' is not null)
            or (
              item.value->>'action' in ('pause', 'resume')
              and (
                jsonb_typeof(item.value->'rollout') is distinct from 'object'
                or item.value->'rollout' - array[
                  'fromState', 'fromMode', 'fromUpdatedAt', 'targetState', 'targetMode'
                ]::text[] <> '{}'::jsonb
                or coalesce(item.value#>>'{rollout,fromMode}', '') not in (
                  'shadow', 'recommend', 'execute_with_approval'
                )
                or coalesce(item.value#>>'{rollout,targetMode}', '') not in (
                  'shadow', 'recommend', 'execute_with_approval'
                )
                or coalesce(item.value#>>'{rollout,fromUpdatedAt}', '') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}([.][0-9]{3})?Z$'
                or jsonb_array_length(item.value#>'{desired,fieldMappingIds}') <> 0
                or jsonb_array_length(item.value#>'{desired,companyContextKeys}') <> 0
                or (
                  item.value->>'action' = 'pause'
                  and (
                    coalesce(item.value#>>'{rollout,fromState}', '') not in (
                      'shadow', 'recommend', 'execute_with_approval'
                    )
                    or (item.value#>>'{rollout,fromMode}') is distinct from (item.value#>>'{rollout,fromState}')
                    or coalesce(item.value#>>'{rollout,targetState}', '') <> 'paused'
                    or (item.value#>>'{rollout,targetMode}') is distinct from (item.value#>>'{rollout,fromMode}')
                  )
                )
                or (
                  item.value->>'action' = 'resume'
                  and (
                    coalesce(item.value#>>'{rollout,fromState}', '') <> 'paused'
                    or (item.value#>>'{rollout,targetState}') is distinct from (item.value#>>'{rollout,targetMode}')
                    or (item.value#>>'{rollout,fromMode}') is distinct from (item.value#>>'{rollout,targetMode}')
                  )
                )
              )
            )
            or (item.value->>'action' not in ('pause', 'resume') and item.value->'rollout' is not null)
        )
      )
    )
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

  if coalesce(p_registry->'lifecycleOperations', '[]'::jsonb)
    is distinct from coalesce(v_row.registry_payload->'lifecycleOperations', '[]'::jsonb)
  then
    select item.value into v_operation
    from jsonb_array_elements(coalesce(p_registry->'lifecycleOperations', '[]'::jsonb)) as item(value)
    where not exists (
      select 1
      from jsonb_array_elements(coalesce(v_row.registry_payload->'lifecycleOperations', '[]'::jsonb)) as prior(value)
      where prior.value = item.value
    )
    order by item.value->>'updatedAt' desc
    limit 1;
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
      v_operation->>'actor',
      p_registry#>>'{lifecycleReceipts,-1,actor}',
      p_registry#>>'{installations,-1,installedBy}',
      'loopgraph-system'
    );
    v_action := case
      when v_operation is not null then concat('lifecycle.', v_operation->>'action', '.', v_operation->>'status')
      else coalesce(p_registry#>>'{lifecycleReceipts,-1,action}', 'install')
    end;
    perform private.append_security_audit_event(
      p_organization_id, p_project_key, 'app.installation_registry.committed', 'accepted', 'user',
      v_actor, 'app.installation.manage', null, gen_random_uuid()::text,
      'app_installation_registry', 'workspace', p_workspace_id,
      jsonb_strip_nulls(jsonb_build_object(
        'workspaceId', p_workspace_id,
        'revision', v_next_revision,
        'action', v_action,
        'installationCount', jsonb_array_length(p_registry->'installations'),
        'lifecycleOperationId', v_operation->>'id',
        'lifecycleOperationStatus', v_operation->>'status'
      ))
    );
  end if;
  return p_registry;
end;
$$;

revoke all on function public.commit_loopgraph_app_installation_registry(uuid, text, text, bigint, uuid, jsonb, jsonb)
  from public, anon, authenticated, service_role;
grant execute on function public.commit_loopgraph_app_installation_registry(uuid, text, text, bigint, uuid, jsonb, jsonb)
  to service_role;
