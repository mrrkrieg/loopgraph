-- Durable, approved company context used by hosted Hermes App planning.
-- This store is for reviewed business policy and configuration, never provider credentials.

create table if not exists public.loopgraph_company_contexts (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  project_key text not null,
  workspace_id text not null,
  company_id text not null,
  revision bigint not null,
  payload jsonb not null,
  updated_at timestamptz not null,
  primary key (organization_id, project_key, workspace_id, company_id),
  constraint loopgraph_company_context_project_check check (project_key ~ '^[a-z0-9][a-z0-9_-]{0,63}$'),
  constraint loopgraph_company_context_workspace_check check (workspace_id ~ '^[a-z0-9](?:[a-z0-9._-]*[a-z0-9])?$' and length(workspace_id) between 3 and 160),
  constraint loopgraph_company_context_company_check check (company_id ~ '^[a-z0-9](?:[a-z0-9._-]*[a-z0-9])?$' and length(company_id) between 3 and 160),
  constraint loopgraph_company_context_revision_check check (revision > 0),
  constraint loopgraph_company_context_payload_check check (jsonb_typeof(payload) = 'object' and pg_column_size(payload) <= 1048576)
);

alter table public.loopgraph_company_contexts enable row level security;
revoke all on public.loopgraph_company_contexts from public, anon, authenticated, service_role;
grant select on public.loopgraph_company_contexts to service_role;

create or replace function public.commit_loopgraph_company_context(
  p_organization_id uuid,
  p_project_key text,
  p_workspace_id text,
  p_company_id text,
  p_expected_revision bigint,
  p_context jsonb,
  p_action text,
  p_actor text,
  p_reference text
)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_current_revision bigint;
  v_current_payload jsonb;
  v_next_revision bigint;
begin
  if p_project_key !~ '^[a-z0-9][a-z0-9_-]{0,63}$'
    or p_workspace_id !~ '^[a-z0-9](?:[a-z0-9._-]*[a-z0-9])?$'
    or length(p_workspace_id) not between 3 and 160
    or p_company_id !~ '^[a-z0-9](?:[a-z0-9._-]*[a-z0-9])?$'
    or length(p_company_id) not between 3 and 160
    or p_expected_revision < 0
    or p_action not in ('approve', 'attach', 'detach')
    or length(p_actor) not between 1 and 300
    or length(p_reference) not between 1 and 500
    or jsonb_typeof(p_context) <> 'object'
    or pg_column_size(p_context) > 1048576
    or p_context->>'schemaVersion' <> 'loopgraph-company-context/v1alpha1'
    or p_context->>'workspaceId' <> p_workspace_id
    or p_context->>'companyId' <> p_company_id
    or (p_context->>'revision')::bigint <> p_expected_revision + 1
    or p_context->>'updatedBy' <> p_actor
    or jsonb_typeof(p_context->'values') <> 'array'
    or jsonb_array_length(p_context->'values') > 500
    or p_context::text ~* '"(access[_-]?token|api[_-]?key|authorization|client[_-]?secret|cookie|credential|password|private[_-]?key|refresh[_-]?token|secret|webhook[_-]?secret)"[[:space:]]*:'
    or p_context::text ~* '(Bearer[[:space:]]+[A-Za-z0-9._~+/=-]{12,}|gh[opsu]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|(sk|rk)_(live|test)_[A-Za-z0-9]{12,}|xox[baprs]-[A-Za-z0-9-]{10,}|BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY)'
    or exists (
      select 1
      from jsonb_array_elements(p_context->'values') as item(value)
      where item.value->>'verified' <> 'true'
        or length(coalesce(item.value->>'key', '')) not between 1 and 500
        or length(coalesce(item.value->>'confirmedBy', '')) < 1
        or item.value->>'confirmedAt' is null
        or jsonb_typeof(item.value->'consumerInstallationIds') <> 'array'
        or jsonb_array_length(item.value->'consumerInstallationIds') > 1000
    )
  then raise exception 'invalid or secret-bearing Loopgraph company context'; end if;

  select revision, payload into v_current_revision, v_current_payload
    from public.loopgraph_company_contexts
    where organization_id = p_organization_id and project_key = p_project_key
      and workspace_id = p_workspace_id and company_id = p_company_id
    for update;

  if found then
    if v_current_revision <> p_expected_revision then
      raise exception 'Loopgraph company context revision conflict';
    end if;
    if v_current_payload->>'workspaceId' <> p_workspace_id or v_current_payload->>'companyId' <> p_company_id then
      raise exception 'Loopgraph company context identity conflict';
    end if;
  elsif p_expected_revision <> 0 then
    raise exception 'Loopgraph company context revision conflict';
  end if;

  v_next_revision := p_expected_revision + 1;
  insert into public.loopgraph_company_contexts (
    organization_id, project_key, workspace_id, company_id, revision, payload, updated_at
  ) values (
    p_organization_id, p_project_key, p_workspace_id, p_company_id,
    v_next_revision, p_context, (p_context->>'updatedAt')::timestamptz
  ) on conflict (organization_id, project_key, workspace_id, company_id)
  do update set revision = excluded.revision, payload = excluded.payload, updated_at = excluded.updated_at;

  perform private.append_security_audit_event(
    p_organization_id, p_project_key, 'app.company_context.' || p_action, 'accepted', 'user',
    p_actor, 'app.company_context.manage', null, gen_random_uuid()::text,
    'app_company_context', 'company_context', p_company_id,
    jsonb_build_object(
      'workspaceId', p_workspace_id,
      'revision', v_next_revision,
      'referenceDigest', encode(sha256(convert_to(p_reference, 'UTF8')), 'hex'),
      'valueCount', jsonb_array_length(p_context->'values')
    )
  );
  return v_next_revision;
end;
$$;

revoke all on function public.commit_loopgraph_company_context(uuid, text, text, text, bigint, jsonb, text, text, text) from public, anon, authenticated;
grant execute on function public.commit_loopgraph_company_context(uuid, text, text, text, bigint, jsonb, text, text, text) to service_role;
