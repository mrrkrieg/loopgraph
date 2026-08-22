-- Extend the atomic App registry audit wrapper to cover activation authority.
-- Approval text and evidence references remain in the authoritative registry;
-- the security audit chain receives only bounded identities, digests, states,
-- expiry, and counts.

create or replace function public.commit_loopgraph_app_installation_registry_with_audit(
  p_organization_id uuid,
  p_project_key text,
  p_workspace_id text,
  p_expected_revision bigint,
  p_lease_token uuid,
  p_registry jsonb,
  p_lock jsonb,
  p_audit_context jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_result jsonb;
  v_metadata jsonb;
begin
  if jsonb_typeof(p_audit_context) is distinct from 'object'
    or pg_column_size(p_audit_context) > 4096
    or p_audit_context - array['actor', 'action', 'targetType', 'targetId', 'metadata']::text[] <> '{}'::jsonb
    or length(coalesce(p_audit_context->>'actor', '')) not between 1 and 300
    or coalesce(p_audit_context->>'action', '') not in (
      'app.onboarding_draft.saved',
      'app.onboarding_draft.reset',
      'app.activation.approved',
      'app.activation.consumed'
    )
    or length(coalesce(p_audit_context->>'targetId', '')) not between 1 and 160
    or jsonb_typeof(p_audit_context->'metadata') is distinct from 'object'
    or p_audit_context::text ~* '"(access[_-]?token|api[_-]?key|authorization|client[_-]?secret|cookie|credential|password|private[_-]?key|refresh[_-]?token|secret|webhook[_-]?secret)"[[:space:]]*:'
    or p_audit_context::text ~* '(Bearer[[:space:]]+[A-Za-z0-9._~+/=-]{12,}|gh[opsu]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|(sk|rk)_(live|test)_[A-Za-z0-9]{12,}|xox[baprs]-[A-Za-z0-9-]{10,}|BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY)'
  then raise exception 'invalid Loopgraph App installation audit context'; end if;

  if p_audit_context->>'action' in ('app.onboarding_draft.saved', 'app.onboarding_draft.reset') then
    if p_audit_context->>'targetType' <> 'app_onboarding_draft'
      or p_audit_context->'metadata' - array[
        'appIdDigest', 'presetIdDigest', 'draftRevision', 'presetChanged',
        'selectedModuleCount', 'answerCount', 'fieldMappingCount'
      ]::text[] <> '{}'::jsonb
      or coalesce(p_audit_context#>>'{metadata,appIdDigest}', '') !~ '^sha256:[0-9a-f]{64}$'
      or coalesce(p_audit_context#>>'{metadata,presetIdDigest}', '') !~ '^sha256:[0-9a-f]{64}$'
      or coalesce(p_audit_context#>>'{metadata,draftRevision}', '') !~ '^[1-9][0-9]*$'
      or jsonb_typeof(p_audit_context#>'{metadata,presetChanged}') is distinct from 'boolean'
      or coalesce(p_audit_context#>>'{metadata,selectedModuleCount}', '') !~ '^[0-9]+$'
      or (p_audit_context#>>'{metadata,selectedModuleCount}')::integer > 100
      or coalesce(p_audit_context#>>'{metadata,answerCount}', '') !~ '^[0-9]+$'
      or (p_audit_context#>>'{metadata,answerCount}')::integer > 20
      or coalesce(p_audit_context#>>'{metadata,fieldMappingCount}', '') !~ '^[0-9]+$'
      or (p_audit_context#>>'{metadata,fieldMappingCount}')::integer > 200
    then raise exception 'invalid Loopgraph App onboarding audit context'; end if;
  elsif p_audit_context->>'action' in ('app.activation.approved', 'app.activation.consumed') then
    if p_audit_context->>'targetType' <> 'app_activation_approval'
      or coalesce(p_audit_context->>'targetId', '') !~ '^activation-approval\.[0-9a-f]{16}$'
      or p_audit_context->'metadata' - array[
        'installationIdDigest', 'appIdDigest', 'artifactDigest', 'approvalDigest',
        'fromState', 'requestedMode', 'evidenceRefCount', 'expiresAt'
      ]::text[] <> '{}'::jsonb
      or coalesce(p_audit_context#>>'{metadata,installationIdDigest}', '') !~ '^sha256:[0-9a-f]{64}$'
      or coalesce(p_audit_context#>>'{metadata,appIdDigest}', '') !~ '^sha256:[0-9a-f]{64}$'
      or coalesce(p_audit_context#>>'{metadata,artifactDigest}', '') !~ '^sha256:[0-9a-f]{64}$'
      or coalesce(p_audit_context#>>'{metadata,approvalDigest}', '') !~ '^sha256:[0-9a-f]{64}$'
      or coalesce(p_audit_context#>>'{metadata,fromState}', '') not in (
        'selected', 'resolving', 'waiting_for_connections', 'waiting_for_configuration',
        'ready_to_test', 'simulation_passed', 'shadow', 'recommend',
        'execute_with_approval', 'live', 'paused', 'broken', 'degraded',
        'update_available', 'deprecated', 'revoked', 'uninstalling', 'rolled_back'
      )
      or coalesce(p_audit_context#>>'{metadata,requestedMode}', '') not in (
        'shadow', 'recommend', 'execute_with_approval'
      )
      or coalesce(p_audit_context#>>'{metadata,evidenceRefCount}', '') !~ '^[0-9]+$'
      or (p_audit_context#>>'{metadata,evidenceRefCount}')::integer > 100
      or coalesce(p_audit_context#>>'{metadata,expiresAt}', '') !~ '^20[0-9]{2}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(\.[0-9]{1,6})?Z$'
    then raise exception 'invalid Loopgraph App activation audit context'; end if;

    begin
      perform (p_audit_context#>>'{metadata,expiresAt}')::timestamptz;
    exception when others then
      raise exception 'invalid Loopgraph App activation audit expiry';
    end;
  else
    raise exception 'unsupported Loopgraph App installation audit action';
  end if;

  v_result := public.commit_loopgraph_app_installation_registry(
    p_organization_id,
    p_project_key,
    p_workspace_id,
    p_expected_revision,
    p_lease_token,
    p_registry,
    p_lock
  );

  if coalesce(v_result->>'revision', '') <> (p_expected_revision + 1)::text then
    raise exception 'audited Loopgraph App installation commit must advance the registry revision';
  end if;

  v_metadata := jsonb_build_object(
    'registryRevision', p_expected_revision + 1
  ) || (p_audit_context->'metadata');

  perform private.append_security_audit_event(
    p_organization_id,
    p_project_key,
    p_audit_context->>'action',
    'accepted',
    'user',
    p_audit_context->>'actor',
    'app.installation.manage',
    null,
    gen_random_uuid()::text,
    p_audit_context->>'targetType',
    'workspace',
    p_audit_context->>'targetId',
    v_metadata
  );

  return v_result;
end;
$$;

revoke all on function public.commit_loopgraph_app_installation_registry_with_audit(uuid, text, text, bigint, uuid, jsonb, jsonb, jsonb)
  from public, anon, authenticated, service_role;
grant execute on function public.commit_loopgraph_app_installation_registry_with_audit(uuid, text, text, bigint, uuid, jsonb, jsonb, jsonb)
  to service_role;
