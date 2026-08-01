-- Durable hosted machine-request replay and rate guards.

create table if not exists public.machine_request_receipts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  project_key text not null,
  credential_id text not null,
  capability text not null,
  request_id text not null,
  request_hash text not null,
  requested_at timestamptz not null,
  received_at timestamptz not null default now(),
  decision text not null default 'accepted',
  expires_at timestamptz not null default (now() + interval '24 hours'),
  unique (organization_id, project_key, credential_id, request_id),
  constraint machine_request_receipts_project_key_check
    check (project_key ~ '^[a-z0-9][a-z0-9_-]{0,63}$'),
  constraint machine_request_receipts_credential_id_check
    check (credential_id ~ '^[a-z0-9][a-z0-9_-]{2,63}$'),
  constraint machine_request_receipts_decision_check
    check (decision in ('accepted', 'rate_limited'))
);

create index if not exists machine_request_receipts_expiry_idx
  on public.machine_request_receipts(expires_at);
create index if not exists machine_request_receipts_tenant_received_idx
  on public.machine_request_receipts(
    organization_id,
    project_key,
    received_at desc
  );

create table if not exists public.machine_rate_limit_windows (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  project_key text not null,
  credential_id text not null,
  capability text not null,
  window_started_at timestamptz not null,
  request_count integer not null default 0,
  updated_at timestamptz not null default now(),
  primary key (
    organization_id,
    project_key,
    credential_id,
    capability,
    window_started_at
  ),
  constraint machine_rate_limit_windows_count_check check (request_count >= 0)
);

create index if not exists machine_rate_limit_windows_updated_idx
  on public.machine_rate_limit_windows(updated_at);

alter table public.machine_request_receipts enable row level security;
alter table public.machine_rate_limit_windows enable row level security;
revoke all on public.machine_request_receipts from public, anon, authenticated;
revoke all on public.machine_rate_limit_windows from public, anon, authenticated;
grant all on public.machine_request_receipts to service_role;
grant all on public.machine_rate_limit_windows to service_role;

create or replace function public.authorize_machine_request(
  p_organization_id uuid,
  p_project_key text,
  p_credential_id text,
  p_capability text,
  p_request_id text,
  p_request_hash text,
  p_requested_at timestamptz,
  p_rate_limit integer
)
returns table (
  authorized boolean,
  reason text,
  retry_after_seconds integer
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  inserted_receipt uuid;
  current_count integer;
  current_window timestamptz := date_trunc('minute', now());
begin
  if p_rate_limit < 1 or p_rate_limit > 10000 then
    return query select false, 'invalid_rate_limit'::text, null::integer;
    return;
  end if;

  delete from public.machine_request_receipts
    where organization_id = p_organization_id
      and expires_at < now();
  delete from public.machine_rate_limit_windows
    where organization_id = p_organization_id
      and updated_at < now() - interval '1 day';

  insert into public.machine_request_receipts (
    organization_id,
    project_key,
    credential_id,
    capability,
    request_id,
    request_hash,
    requested_at
  ) values (
    p_organization_id,
    p_project_key,
    p_credential_id,
    p_capability,
    p_request_id,
    p_request_hash,
    p_requested_at
  )
  on conflict (organization_id, project_key, credential_id, request_id) do nothing
  returning id into inserted_receipt;

  if inserted_receipt is null then
    return query select false, 'replayed_request'::text, null::integer;
    return;
  end if;

  insert into public.machine_rate_limit_windows (
    organization_id,
    project_key,
    credential_id,
    capability,
    window_started_at,
    request_count
  ) values (
    p_organization_id,
    p_project_key,
    p_credential_id,
    p_capability,
    current_window,
    1
  )
  on conflict (
    organization_id,
    project_key,
    credential_id,
    capability,
    window_started_at
  ) do update
    set request_count = public.machine_rate_limit_windows.request_count + 1,
        updated_at = now()
    where public.machine_rate_limit_windows.request_count < p_rate_limit
  returning request_count into current_count;

  if current_count is null then
    update public.machine_request_receipts
      set decision = 'rate_limited'
      where id = inserted_receipt;
    return query select false, 'rate_limited'::text,
      greatest(1, 60 - extract(second from now())::integer);
    return;
  end if;

  return query select true, 'accepted'::text, null::integer;
end;
$$;

revoke all on function public.authorize_machine_request(
  uuid,
  text,
  text,
  text,
  text,
  text,
  timestamptz,
  integer
) from public, anon, authenticated;
grant execute on function public.authorize_machine_request(
  uuid,
  text,
  text,
  text,
  text,
  text,
  timestamptz,
  integer
) to service_role;
