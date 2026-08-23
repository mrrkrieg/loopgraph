-- One-time staging authority for the hosted learning and entity-resolution
-- active probe. A reserved-looking project key is not ownership proof: every
-- destructive cleanup must consume an unexpired nonce authorization created
-- while the exact tenant/project scope was empty.

create table if not exists public.loopgraph_learning_entity_probe_authorizations (
  organization_id uuid not null,
  project_key text not null,
  token_hash text not null,
  created_at timestamptz not null default pg_catalog.clock_timestamp(),
  expires_at timestamptz not null,
  primary key (organization_id, project_key),
  constraint learning_entity_probe_project_key_check
    check (project_key ~ '^learning_probe_[a-f0-9]{24}$'),
  constraint learning_entity_probe_token_hash_check
    check (token_hash ~ '^[a-f0-9]{64}$'),
  constraint learning_entity_probe_expiry_check
    check (expires_at > created_at and expires_at <= created_at + interval '30 minutes')
);

alter table public.loopgraph_learning_entity_probe_authorizations owner to postgres;
alter table public.loopgraph_learning_entity_probe_authorizations enable row level security;
revoke all on public.loopgraph_learning_entity_probe_authorizations
  from public, anon, authenticated, service_role;

create or replace function public.loopgraph_learning_entity_probe_authorize(
  p_organization_id uuid,
  p_project_key text,
  p_probe_token text
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_now timestamptz := pg_catalog.clock_timestamp();
begin
  if p_project_key !~ '^learning_probe_[a-f0-9]{24}$'
     or p_probe_token !~ '^[a-f0-9]{64}$' then
    raise exception 'Invalid hosted learning/entity probe authority';
  end if;

  if exists (
    select 1
    from public.loopgraph_evidence_records
    where organization_id = p_organization_id
      and project_key = p_project_key
  ) or exists (
    select 1
    from public.canonical_company_entities
    where organization_id = p_organization_id
      and project_key = p_project_key
  ) or exists (
    select 1
    from public.canonical_company_entity_aliases
    where organization_id = p_organization_id
      and project_key = p_project_key
  ) then
    raise exception 'Hosted learning/entity probe scope is not empty';
  end if;

  insert into public.loopgraph_learning_entity_probe_authorizations (
    organization_id,
    project_key,
    token_hash,
    created_at,
    expires_at
  ) values (
    p_organization_id,
    p_project_key,
    pg_catalog.encode(extensions.digest(p_probe_token, 'sha256'), 'hex'),
    v_now,
    v_now + interval '30 minutes'
  );

  return pg_catalog.jsonb_build_object(
    'schemaVersion', 'hosted-learning-entity-probe-authorization/v1',
    'authorized', true
  );
end;
$$;

alter function public.loopgraph_learning_entity_probe_authorize(uuid, text, text)
  owner to postgres;
revoke all on function public.loopgraph_learning_entity_probe_authorize(uuid, text, text)
  from public, anon, authenticated, service_role;
grant execute on function public.loopgraph_learning_entity_probe_authorize(uuid, text, text)
  to service_role;

create or replace function public.loopgraph_learning_entity_probe_cleanup(
  p_organization_id uuid,
  p_project_key text,
  p_probe_token text
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_authorization public.loopgraph_learning_entity_probe_authorizations%rowtype;
  v_evidence_deleted bigint;
  v_entities_deleted bigint;
begin
  if p_project_key !~ '^learning_probe_[a-f0-9]{24}$'
     or p_probe_token !~ '^[a-f0-9]{64}$' then
    raise exception 'Invalid hosted learning/entity probe authority';
  end if;

  select *
    into v_authorization
    from public.loopgraph_learning_entity_probe_authorizations
   where organization_id = p_organization_id
     and project_key = p_project_key
   for update;

  if not found
     or v_authorization.expires_at <= pg_catalog.clock_timestamp()
     or v_authorization.token_hash <> pg_catalog.encode(
       extensions.digest(p_probe_token, 'sha256'),
       'hex'
     ) then
    raise exception 'Hosted learning/entity probe cleanup is not authorized';
  end if;

  -- Alias rows are removed by the canonical-entity foreign key cascade. Keeping
  -- the entity delete as the only alias mutation makes the cleanup atomic.
  delete from public.canonical_company_entities
  where organization_id = p_organization_id
    and project_key = p_project_key;
  get diagnostics v_entities_deleted = row_count;

  delete from public.loopgraph_evidence_records
  where organization_id = p_organization_id
    and project_key = p_project_key;
  get diagnostics v_evidence_deleted = row_count;

  if exists (
    select 1
    from public.loopgraph_evidence_records
    where organization_id = p_organization_id
      and project_key = p_project_key
  ) or exists (
    select 1
    from public.canonical_company_entities
    where organization_id = p_organization_id
      and project_key = p_project_key
  ) or exists (
    select 1
    from public.canonical_company_entity_aliases
    where organization_id = p_organization_id
      and project_key = p_project_key
  ) then
    raise exception 'Hosted learning/entity probe cleanup left residual rows';
  end if;

  delete from public.loopgraph_learning_entity_probe_authorizations
  where organization_id = p_organization_id
    and project_key = p_project_key
    and token_hash = v_authorization.token_hash;

  if not found then
    raise exception 'Hosted learning/entity probe authority was not consumed';
  end if;

  return pg_catalog.jsonb_build_object(
    'schemaVersion', 'hosted-learning-entity-probe-cleanup/v2',
    'evidenceClean', true,
    'entitiesClean', true,
    'aliasesClean', true,
    'authorizationConsumed', true,
    'evidenceDeleted', v_evidence_deleted,
    'entitiesDeleted', v_entities_deleted
  );
end;
$$;

alter function public.loopgraph_learning_entity_probe_cleanup(uuid, text, text)
  owner to postgres;
revoke all on function public.loopgraph_learning_entity_probe_cleanup(uuid, text, text)
  from public, anon, authenticated, service_role;
grant execute on function public.loopgraph_learning_entity_probe_cleanup(uuid, text, text)
  to service_role;

create or replace function public.loopgraph_learning_entity_probe_sweep_expired(
  p_organization_id uuid
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_scope record;
  v_deleted bigint;
  v_authorizations_swept bigint := 0;
  v_evidence_deleted bigint := 0;
  v_entities_deleted bigint := 0;
begin
  for v_scope in
    select project_key
      from public.loopgraph_learning_entity_probe_authorizations
     where organization_id = p_organization_id
       and expires_at <= pg_catalog.clock_timestamp()
     order by project_key
     for update skip locked
  loop
    delete from public.canonical_company_entities
    where organization_id = p_organization_id
      and project_key = v_scope.project_key;
    get diagnostics v_deleted = row_count;
    v_entities_deleted := v_entities_deleted + v_deleted;

    delete from public.loopgraph_evidence_records
    where organization_id = p_organization_id
      and project_key = v_scope.project_key;
    get diagnostics v_deleted = row_count;
    v_evidence_deleted := v_evidence_deleted + v_deleted;

    if exists (
      select 1
      from public.loopgraph_evidence_records
      where organization_id = p_organization_id
        and project_key = v_scope.project_key
    ) or exists (
      select 1
      from public.canonical_company_entities
      where organization_id = p_organization_id
        and project_key = v_scope.project_key
    ) or exists (
      select 1
      from public.canonical_company_entity_aliases
      where organization_id = p_organization_id
        and project_key = v_scope.project_key
    ) then
      raise exception 'Expired hosted learning/entity probe cleanup left residual rows';
    end if;

    delete from public.loopgraph_learning_entity_probe_authorizations
    where organization_id = p_organization_id
      and project_key = v_scope.project_key
      and expires_at <= pg_catalog.clock_timestamp();
    get diagnostics v_deleted = row_count;
    if v_deleted <> 1 then
      raise exception 'Expired hosted learning/entity probe authority was not consumed';
    end if;
    v_authorizations_swept := v_authorizations_swept + 1;
  end loop;

  return pg_catalog.jsonb_build_object(
    'schemaVersion', 'hosted-learning-entity-probe-expired-sweep/v1',
    'authorizationsSwept', v_authorizations_swept,
    'evidenceDeleted', v_evidence_deleted,
    'entitiesDeleted', v_entities_deleted
  );
end;
$$;

alter function public.loopgraph_learning_entity_probe_sweep_expired(uuid)
  owner to postgres;
revoke all on function public.loopgraph_learning_entity_probe_sweep_expired(uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.loopgraph_learning_entity_probe_sweep_expired(uuid)
  to service_role;
