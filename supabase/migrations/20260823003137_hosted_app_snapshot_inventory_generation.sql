-- Durable mutation generation for the detached-App registry plus private archive bucket.
-- Reconciliation reads this value before and after each complete registry plus
-- Storage pass. Database triggers advance the generation in the same PostgreSQL
-- transaction as every authoritative registry or archive mutation.

create table if not exists public.loopgraph_app_snapshot_inventory_generations (
  organization_id uuid not null,
  project_key text not null,
  generation bigint not null default 0,
  updated_at timestamptz not null default now(),
  primary key (organization_id, project_key),
  constraint loopgraph_app_snapshot_inventory_generation_project_key
    check (project_key ~ '^[a-z0-9][a-z0-9_-]{0,63}$'),
  constraint loopgraph_app_snapshot_inventory_generation_nonnegative
    check (generation >= 0)
);

alter table public.loopgraph_app_snapshot_inventory_generations enable row level security;
revoke all on table public.loopgraph_app_snapshot_inventory_generations from public, anon, authenticated;

create or replace function public.loopgraph_app_snapshot_inventory_generation_advance(
  p_organization_id uuid,
  p_project_key text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_project_key !~ '^[a-z0-9][a-z0-9_-]{0,63}$' then
    return;
  end if;

  insert into public.loopgraph_app_snapshot_inventory_generations (
    organization_id,
    project_key,
    generation,
    updated_at
  )
  values (p_organization_id, p_project_key, 1, now())
  on conflict (organization_id, project_key) do update
  set generation = public.loopgraph_app_snapshot_inventory_generations.generation + 1,
      updated_at = excluded.updated_at;
end;
$$;

create or replace function public.loopgraph_app_snapshot_inventory_generation_bump_scope(
  p_object_name text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_organization_text text := split_part(p_object_name, '/', 1);
  v_project_key text := split_part(p_object_name, '/', 2);
begin
  if v_organization_text !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
     or v_project_key !~ '^[a-z0-9][a-z0-9_-]{0,63}$' then
    return;
  end if;

  perform public.loopgraph_app_snapshot_inventory_generation_advance(
    v_organization_text::uuid,
    v_project_key
  );
end;
$$;

create or replace function public.loopgraph_app_snapshot_inventory_generation_bump()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    if old.bucket_id = 'loopgraph-app-snapshots' then
      perform public.loopgraph_app_snapshot_inventory_generation_bump_scope(old.name);
    end if;
    return old;
  end if;

  if tg_op = 'INSERT' then
    if new.bucket_id = 'loopgraph-app-snapshots' then
      perform public.loopgraph_app_snapshot_inventory_generation_bump_scope(new.name);
    end if;
    return new;
  end if;

  if old.bucket_id = 'loopgraph-app-snapshots' then
    perform public.loopgraph_app_snapshot_inventory_generation_bump_scope(old.name);
  end if;
  if new.bucket_id = 'loopgraph-app-snapshots'
     and (old.bucket_id, old.name) is distinct from (new.bucket_id, new.name) then
    perform public.loopgraph_app_snapshot_inventory_generation_bump_scope(new.name);
  end if;
  return new;
end;
$$;

drop trigger if exists loopgraph_app_snapshot_inventory_generation
  on storage.objects;
create trigger loopgraph_app_snapshot_inventory_generation
after insert or update or delete on storage.objects
for each row execute function public.loopgraph_app_snapshot_inventory_generation_bump();

create or replace function public.loopgraph_app_snapshot_inventory_generation_bump_registry()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    perform public.loopgraph_app_snapshot_inventory_generation_advance(
      old.organization_id,
      old.project_key
    );
    return old;
  end if;

  if tg_op = 'INSERT' then
    perform public.loopgraph_app_snapshot_inventory_generation_advance(
      new.organization_id,
      new.project_key
    );
    return new;
  end if;

  if (old.organization_id, old.project_key, old.registry_payload)
     is not distinct from
     (new.organization_id, new.project_key, new.registry_payload) then
    return new;
  end if;

  perform public.loopgraph_app_snapshot_inventory_generation_advance(
    old.organization_id,
    old.project_key
  );
  if (old.organization_id, old.project_key)
     is distinct from
     (new.organization_id, new.project_key) then
    perform public.loopgraph_app_snapshot_inventory_generation_advance(
      new.organization_id,
      new.project_key
    );
  end if;
  return new;
end;
$$;

drop trigger if exists loopgraph_app_snapshot_inventory_registry_generation
  on public.loopgraph_app_installation_registries;
create trigger loopgraph_app_snapshot_inventory_registry_generation
after insert or update or delete on public.loopgraph_app_installation_registries
for each row execute function public.loopgraph_app_snapshot_inventory_generation_bump_registry();

create or replace function public.loopgraph_app_snapshot_inventory_generation_get(
  p_organization_id uuid,
  p_project_key text
)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_generation bigint;
begin
  if p_project_key !~ '^[a-z0-9][a-z0-9_-]{0,63}$' then
    raise exception 'Invalid App snapshot inventory project scope';
  end if;

  select generation
    into v_generation
  from public.loopgraph_app_snapshot_inventory_generations
  where organization_id = p_organization_id
    and project_key = p_project_key;

  return coalesce(v_generation, 0);
end;
$$;

revoke all on function public.loopgraph_app_snapshot_inventory_generation_advance(uuid, text)
  from public, anon, authenticated;
revoke all on function public.loopgraph_app_snapshot_inventory_generation_bump_scope(text)
  from public, anon, authenticated;
revoke all on function public.loopgraph_app_snapshot_inventory_generation_bump()
  from public, anon, authenticated;
revoke all on function public.loopgraph_app_snapshot_inventory_generation_bump_registry()
  from public, anon, authenticated;
revoke all on function public.loopgraph_app_snapshot_inventory_generation_get(uuid, text)
  from public, anon, authenticated;
grant execute on function public.loopgraph_app_snapshot_inventory_generation_get(uuid, text)
  to service_role;
