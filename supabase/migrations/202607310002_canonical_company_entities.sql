-- Tenant-scoped canonical company objects and exact provider aliases.
create table if not exists public.canonical_company_entities (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  project_key text not null,
  entity_id text not null,
  workspace_id text not null,
  company_id text not null,
  entity_type text not null,
  status text not null,
  revision integer not null,
  payload jsonb not null,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  primary key (organization_id, project_key, entity_id),
  constraint canonical_entities_project_key_check check (project_key ~ '^[a-z0-9][a-z0-9_-]{0,63}$'),
  constraint canonical_entities_type_check check (entity_type in ('account','campaign','incident','customer','contract','contact','deal','employee','invoice','repository','support_ticket','custom')),
  constraint canonical_entities_status_check check (status in ('active','merged','retired')),
  constraint canonical_entities_payload_check check (jsonb_typeof(payload) = 'object' and pg_column_size(payload) <= 524288)
);

create table if not exists public.canonical_company_entity_aliases (
  organization_id uuid not null,
  project_key text not null,
  entity_id text not null,
  provider text not null,
  external_type text not null,
  external_id text not null,
  account_scope text not null default '',
  primary key (organization_id, project_key, provider, external_type, external_id, account_scope),
  foreign key (organization_id, project_key, entity_id) references public.canonical_company_entities(organization_id, project_key, entity_id) on delete cascade
);

create index if not exists canonical_entities_company_idx on public.canonical_company_entities (organization_id, project_key, workspace_id, company_id, entity_type, updated_at desc);
alter table public.canonical_company_entities enable row level security;
alter table public.canonical_company_entity_aliases enable row level security;
revoke all on public.canonical_company_entities from public, anon, authenticated, service_role;
revoke all on public.canonical_company_entity_aliases from public, anon, authenticated, service_role;
grant select on public.canonical_company_entities to service_role;
grant select on public.canonical_company_entity_aliases to service_role;

create or replace function public.upsert_canonical_company_entity(p_organization_id uuid, p_project_key text, p_payload jsonb, p_expected_revision integer default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_id text := p_payload->>'id'; v_current_revision integer; v_alias jsonb;
begin
  if p_project_key !~ '^[a-z0-9][a-z0-9_-]{0,63}$' or jsonb_typeof(p_payload) <> 'object' or pg_column_size(p_payload) > 524288 or nullif(v_id,'') is null then raise exception 'invalid canonical entity'; end if;
  select revision into v_current_revision from public.canonical_company_entities where organization_id=p_organization_id and project_key=p_project_key and entity_id=v_id for update;
  if p_expected_revision is not null and coalesce(v_current_revision,0) <> p_expected_revision then raise exception 'canonical entity revision conflict'; end if;
  insert into public.canonical_company_entities (organization_id,project_key,entity_id,workspace_id,company_id,entity_type,status,revision,payload,created_at,updated_at)
  values (p_organization_id,p_project_key,v_id,p_payload->>'workspaceId',p_payload->>'companyId',p_payload->>'type',p_payload->>'status',(p_payload->>'revision')::integer,p_payload,(p_payload->>'createdAt')::timestamptz,(p_payload->>'updatedAt')::timestamptz)
  on conflict (organization_id,project_key,entity_id) do update set status=excluded.status,revision=excluded.revision,payload=excluded.payload,updated_at=excluded.updated_at;
  delete from public.canonical_company_entity_aliases where organization_id=p_organization_id and project_key=p_project_key and entity_id=v_id;
  for v_alias in select value from jsonb_array_elements(coalesce(p_payload->'aliases','[]'::jsonb)) loop
    insert into public.canonical_company_entity_aliases (organization_id,project_key,entity_id,provider,external_type,external_id,account_scope)
    values (p_organization_id,p_project_key,v_id,v_alias->>'provider',v_alias->>'externalType',v_alias->>'externalId',coalesce(v_alias->>'accountScope',''));
  end loop;
  return p_payload;
end; $$;

revoke all on function public.upsert_canonical_company_entity(uuid,text,jsonb,integer) from public,anon,authenticated;
grant execute on function public.upsert_canonical_company_entity(uuid,text,jsonb,integer) to service_role;
