-- Durable, tenant-scoped quotas for authenticated browser APIs.
-- Limits are owned by the database so an authenticated caller cannot raise its own quota.

create table if not exists public.user_api_quota_policy_overrides (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  bucket text not null,
  rate_limit integer not null,
  window_seconds integer not null default 60,
  updated_at timestamptz not null default now(),
  primary key (organization_id, bucket),
  constraint user_api_quota_policy_bucket_check
    check (bucket in ('read', 'write', 'compute', 'admin')),
  constraint user_api_quota_policy_limit_check
    check (rate_limit between 1 and 10000),
  constraint user_api_quota_policy_window_check
    check (window_seconds between 1 and 3600)
);

create table if not exists public.user_api_quota_windows (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  bucket text not null,
  window_started_at timestamptz not null,
  window_seconds integer not null,
  request_count integer not null default 0,
  updated_at timestamptz not null default now(),
  primary key (organization_id, user_id, bucket),
  constraint user_api_quota_windows_bucket_check
    check (bucket in ('read', 'write', 'compute', 'admin')),
  constraint user_api_quota_windows_count_check check (request_count >= 0),
  constraint user_api_quota_windows_window_check
    check (window_seconds between 1 and 3600)
);

create index if not exists user_api_quota_windows_updated_idx
  on public.user_api_quota_windows(updated_at);

alter table public.user_api_quota_policy_overrides enable row level security;
alter table public.user_api_quota_windows enable row level security;
revoke all on public.user_api_quota_policy_overrides from public, anon, authenticated;
revoke all on public.user_api_quota_windows from public, anon, authenticated;
grant all on public.user_api_quota_policy_overrides to service_role;
grant all on public.user_api_quota_windows to service_role;

create or replace function public.consume_user_api_quota(
  p_organization_id uuid,
  p_bucket text
)
returns table (
  allowed boolean,
  reason text,
  retry_after_seconds integer,
  remaining integer,
  quota_limit integer,
  reset_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_now timestamptz := clock_timestamp();
  v_rate_limit integer;
  v_window_seconds integer;
  v_window_started_at timestamptz;
  v_reset_at timestamptz;
  v_request_count integer;
begin
  if v_user_id is null then
    return query select false, 'authentication_required'::text, null::integer,
      0, 1, v_now;
    return;
  end if;

  if p_bucket is null or p_bucket not in ('read', 'write', 'compute', 'admin') then
    return query select false, 'invalid_bucket'::text, null::integer,
      0, 1, v_now;
    return;
  end if;

  if not exists (
    select 1
    from public.organization_memberships membership
    where membership.organization_id = p_organization_id
      and membership.user_id = v_user_id
      and membership.status = 'active'
  ) then
    return query select false, 'membership_required'::text, null::integer,
      0, 1, v_now;
    return;
  end if;

  select policy.rate_limit, policy.window_seconds
    into v_rate_limit, v_window_seconds
  from public.user_api_quota_policy_overrides policy
  where policy.organization_id = p_organization_id
    and policy.bucket = p_bucket;

  if v_rate_limit is null then
    v_rate_limit := case p_bucket
      when 'read' then 300
      when 'write' then 120
      when 'compute' then 30
      when 'admin' then 60
    end;
    v_window_seconds := 60;
  end if;

  v_window_started_at := to_timestamp(
    floor(extract(epoch from v_now) / v_window_seconds) * v_window_seconds
  );
  v_reset_at := v_window_started_at + make_interval(secs => v_window_seconds);

  insert into public.user_api_quota_windows as quota (
    organization_id,
    user_id,
    bucket,
    window_started_at,
    window_seconds,
    request_count,
    updated_at
  ) values (
    p_organization_id,
    v_user_id,
    p_bucket,
    v_window_started_at,
    v_window_seconds,
    1,
    v_now
  )
  on conflict (organization_id, user_id, bucket) do update
    set window_started_at = excluded.window_started_at,
        window_seconds = excluded.window_seconds,
        request_count = case
          when quota.window_started_at = excluded.window_started_at
            and quota.window_seconds = excluded.window_seconds
            then quota.request_count + 1
          else 1
        end,
        updated_at = excluded.updated_at
    where quota.window_started_at <> excluded.window_started_at
      or quota.window_seconds <> excluded.window_seconds
      or quota.request_count < v_rate_limit
  returning request_count into v_request_count;

  if v_request_count is null then
    return query select false, 'rate_limited'::text,
      greatest(1, ceil(extract(epoch from (v_reset_at - v_now)))::integer),
      0, v_rate_limit, v_reset_at;
    return;
  end if;

  return query select true, 'accepted'::text, null::integer,
    greatest(0, v_rate_limit - v_request_count),
    v_rate_limit,
    v_reset_at;
end;
$$;

revoke all on function public.consume_user_api_quota(uuid, text)
  from public, anon;
grant execute on function public.consume_user_api_quota(uuid, text)
  to authenticated, service_role;
