-- Authenticated, tenant-scoped graph-editor receipts and layout state.
-- Semantic edits are immutable proposals; only layout operations update the
-- visual projection. Runnable topology still changes through the separate
-- semantic graph approval and commit pipeline.

create table if not exists public.graph_editor_transactions (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  project_key text not null,
  transaction_id text not null,
  actor_id uuid not null,
  expected_topology_hash text not null,
  status text not null,
  contains_semantic_operations boolean not null,
  payload jsonb not null,
  created_at timestamptz not null,
  primary key (organization_id, project_key, transaction_id),
  constraint graph_editor_transactions_project_key_check
    check (project_key ~ '^[a-z0-9][a-z0-9_-]{0,63}$'),
  constraint graph_editor_transactions_identity_check
    check (
      length(transaction_id) between 1 and 512
      and expected_topology_hash ~ '^[a-f0-9]{16}$'
    ),
  constraint graph_editor_transactions_status_check
    check (status in ('layout_applied', 'proposal_pending', 'rejected')),
  constraint graph_editor_transactions_payload_check
    check (jsonb_typeof(payload) = 'object' and pg_column_size(payload) <= 524288)
);

create index if not exists graph_editor_transactions_created_idx
  on public.graph_editor_transactions(
    organization_id, project_key, created_at desc, transaction_id
  );

create table if not exists public.graph_editor_layouts (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  project_key text not null,
  topology_hash text not null,
  positions jsonb not null default '{}'::jsonb,
  revision bigint not null default 1,
  updated_by uuid not null,
  updated_at timestamptz not null default now(),
  primary key (organization_id, project_key),
  constraint graph_editor_layouts_project_key_check
    check (project_key ~ '^[a-z0-9][a-z0-9_-]{0,63}$'),
  constraint graph_editor_layouts_hash_check
    check (topology_hash ~ '^[a-f0-9]{16}$'),
  constraint graph_editor_layouts_positions_check
    check (jsonb_typeof(positions) = 'object' and pg_column_size(positions) <= 4194304),
  constraint graph_editor_layouts_revision_check check (revision >= 1)
);

alter table public.graph_editor_transactions enable row level security;
alter table public.graph_editor_layouts enable row level security;

revoke all on public.graph_editor_transactions
  from public, anon, authenticated, service_role;
revoke all on public.graph_editor_layouts
  from public, anon, authenticated, service_role;

grant select on public.graph_editor_transactions to authenticated, service_role;
grant select on public.graph_editor_layouts to authenticated, service_role;

drop policy if exists graph_editor_transactions_member_select
  on public.graph_editor_transactions;
create policy graph_editor_transactions_member_select
  on public.graph_editor_transactions
  for select to authenticated
  using (private.is_org_member(organization_id));

drop policy if exists graph_editor_layouts_member_select
  on public.graph_editor_layouts;
create policy graph_editor_layouts_member_select
  on public.graph_editor_layouts
  for select to authenticated
  using (private.is_org_member(organization_id));

create or replace function public.submit_graph_editor_transaction(
  p_organization_id uuid,
  p_project_key text,
  p_payload jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_id uuid;
  v_created_at timestamptz;
  v_existing jsonb;
  v_operation jsonb;
  v_positions jsonb := '{}'::jsonb;
  v_semantic boolean := false;
begin
  if auth.uid() is null then
    raise exception using errcode = '42501', message = 'authentication required';
  end if;
  if not private.is_org_member(
    p_organization_id,
    array['operator', 'admin', 'owner']
  ) then
    raise exception using errcode = '42501', message = 'graph authoring permission denied';
  end if;
  if p_project_key is null
    or p_project_key !~ '^[a-z0-9][a-z0-9_-]{0,63}$'
    or jsonb_typeof(p_payload) is distinct from 'object'
    or pg_column_size(p_payload) > 524288
    or p_payload->>'schemaVersion' is distinct from 'graph-editor-transaction/v1alpha1'
    or nullif(p_payload->>'id', '') is null
    or length(p_payload->>'id') > 512
    or p_payload->>'workspaceId' is distinct from p_project_key
    or p_payload->>'companyId' is distinct from p_organization_id::text
    or nullif(p_payload->>'expectedTopologyHash', '') is null
    or p_payload->>'expectedTopologyHash' !~ '^[a-f0-9]{16}$'
    or jsonb_typeof(p_payload->'operations') is distinct from 'array' then
    raise exception 'invalid graph editor transaction';
  end if;
  if jsonb_array_length(p_payload->'operations') not between 1 and 200 then
    raise exception 'invalid graph editor transaction';
  end if;

  begin
    v_actor_id := (p_payload->>'actorId')::uuid;
    v_created_at := (p_payload->>'createdAt')::timestamptz;
  exception when others then
    raise exception 'invalid graph editor actor or timestamp';
  end;
  if v_actor_id is distinct from auth.uid() then
    raise exception using errcode = '42501', message = 'graph editor actor mismatch';
  end if;
  if v_created_at is null
    or v_created_at < now() - interval '10 minutes'
    or v_created_at > now() + interval '1 minute' then
    raise exception 'stale graph editor transaction';
  end if;

  for v_operation in
    select value from jsonb_array_elements(p_payload->'operations')
  loop
    if jsonb_typeof(v_operation) is distinct from 'object'
      or nullif(v_operation->>'kind', '') is null
      or v_operation->>'kind' not in ('move_node', 'propose_node', 'propose_edge') then
      raise exception 'invalid graph editor operation';
    end if;
    if v_operation->>'kind' = 'move_node' then
      if nullif(v_operation->>'nodeId', '') is null
        or length(v_operation->>'nodeId') > 240
        or jsonb_typeof(v_operation->'x') is distinct from 'number'
        or jsonb_typeof(v_operation->'y') is distinct from 'number' then
        raise exception 'invalid graph editor move operation';
      end if;
      if abs((v_operation->>'x')::numeric) > 1000000
        or abs((v_operation->>'y')::numeric) > 1000000 then
        raise exception 'invalid graph editor move operation';
      end if;
      v_positions := v_positions || jsonb_build_object(
        v_operation->>'nodeId',
        jsonb_build_object(
          'x', (v_operation->>'x')::numeric,
          'y', (v_operation->>'y')::numeric
        )
      );
    elsif v_operation->>'kind' = 'propose_node' then
      v_semantic := true;
      if nullif(v_operation->>'temporaryId', '') is null
        or length(v_operation->>'temporaryId') > 240
        or nullif(v_operation->>'nodeType', '') is null
        or v_operation->>'nodeType' not in ('department_loop', 'workflow_loop')
        or nullif(v_operation->>'label', '') is null
        or length(v_operation->>'label') > 200
        or nullif(v_operation->>'departmentId', '') is null
        or v_operation->>'departmentId' !~ '^[a-z0-9][a-z0-9_-]*$'
        or nullif(v_operation->>'purpose', '') is null
        or length(v_operation->>'purpose') > 2000 then
        raise exception 'invalid graph editor node proposal';
      end if;
    else
      v_semantic := true;
      if nullif(v_operation->>'sourceId', '') is null
        or length(v_operation->>'sourceId') > 240
        or nullif(v_operation->>'targetId', '') is null
        or length(v_operation->>'targetId') > 240
        or nullif(v_operation->>'relation', '') is null
        or v_operation->>'relation' not in (
          'brain_routes_to', 'department_contains_loop', 'learning_returns_to'
        )
        or nullif(v_operation->>'reason', '') is null
        or length(v_operation->>'reason') > 2000 then
        raise exception 'invalid graph editor edge proposal';
      end if;
    end if;
  end loop;

  if (v_semantic and p_payload->>'status' is distinct from 'proposal_pending')
    or (not v_semantic and p_payload->>'status' is distinct from 'layout_applied') then
    raise exception 'graph editor transaction status does not match its operations';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended(p_organization_id::text || ':' || p_project_key || ':graph-editor', 0)
  );
  insert into public.graph_editor_transactions (
    organization_id, project_key, transaction_id, actor_id,
    expected_topology_hash, status, contains_semantic_operations,
    payload, created_at
  ) values (
    p_organization_id, p_project_key, p_payload->>'id', v_actor_id,
    p_payload->>'expectedTopologyHash', p_payload->>'status', v_semantic,
    p_payload, v_created_at
  )
  on conflict do nothing
  returning payload into v_existing;

  if not found then
    select payload into v_existing
      from public.graph_editor_transactions
     where organization_id = p_organization_id
       and project_key = p_project_key
       and transaction_id = p_payload->>'id';
    if v_existing is distinct from p_payload then
      raise exception 'graph editor transaction identity conflict';
    end if;
  end if;

  if not v_semantic then
    insert into public.graph_editor_layouts (
      organization_id, project_key, topology_hash, positions,
      revision, updated_by, updated_at
    ) values (
      p_organization_id, p_project_key, p_payload->>'expectedTopologyHash',
      v_positions, 1, v_actor_id, v_created_at
    )
    on conflict (organization_id, project_key) do update set
      topology_hash = excluded.topology_hash,
      positions = public.graph_editor_layouts.positions || excluded.positions,
      revision = public.graph_editor_layouts.revision + 1,
      updated_by = excluded.updated_by,
      updated_at = excluded.updated_at;
  end if;

  return p_payload;
end;
$$;

revoke all on function public.submit_graph_editor_transaction(uuid, text, jsonb)
  from public, anon;
grant execute on function public.submit_graph_editor_transaction(uuid, text, jsonb)
  to authenticated;
