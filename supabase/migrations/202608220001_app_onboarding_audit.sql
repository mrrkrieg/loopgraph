-- Add an atomic, bounded audit envelope for accountable pre-install App
-- onboarding changes. The registry commit remains authoritative; this wrapper
-- adds a second action-specific event to the same transaction without copying
-- answers, provider fields, credentials, or mapping contents into the audit
-- chain.

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
      'app.onboarding_draft.reset'
    )
    or p_audit_context->>'targetType' <> 'app_onboarding_draft'
    or length(coalesce(p_audit_context->>'targetId', '')) not between 1 and 160
    or jsonb_typeof(p_audit_context->'metadata') is distinct from 'object'
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
    or p_audit_context::text ~* '"(access[_-]?token|api[_-]?key|authorization|client[_-]?secret|cookie|credential|password|private[_-]?key|refresh[_-]?token|secret|webhook[_-]?secret)"[[:space:]]*:'
    or p_audit_context::text ~* '(Bearer[[:space:]]+[A-Za-z0-9._~+/=-]{12,}|gh[opsu]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|(sk|rk)_(live|test)_[A-Za-z0-9]{12,}|xox[baprs]-[A-Za-z0-9-]{10,}|BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY)'
  then raise exception 'invalid Loopgraph App installation audit context'; end if;

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
