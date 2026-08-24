-- Workload-identity delivery for Hermes and CLI marketplace consumers.
--
-- Every function is service-role-only. The application authenticates a
-- short-lived OIDC workload JWT, checks its durable marketplace.consume grant,
-- and passes the JWT-bound organization into these functions. Artifact object
-- keys never enter searchable catalog responses.

create or replace function private.can_organization_read_marketplace_app(
  p_organization_id uuid,
  p_app_id text
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
      from public.marketplace_apps app
     where app.app_id = p_app_id
       and (
         app.visibility in ('public', 'official')
         or app.owner_organization_id = p_organization_id
         or exists (
           select 1
             from public.private_catalog_access catalog_access
            where catalog_access.app_id = app.app_id
              and catalog_access.grantee_organization_id = p_organization_id
         )
       )
  );
$$;

revoke all on function private.can_organization_read_marketplace_app(uuid, text) from public;

create or replace function public.search_marketplace_apps_for_organization(
  p_organization_id uuid,
  p_query text default null,
  p_department text default null,
  p_capability text default null,
  p_limit integer default 20,
  p_offset integer default 0
)
returns table (
  app_id text,
  version text,
  artifact_digest text,
  snapshot_digest text,
  release_status text,
  app_metadata jsonb,
  version_payload jsonb,
  published_at timestamptz,
  verified_at timestamptz,
  status_message text,
  status_updated_at timestamptz,
  relevance_score integer,
  matched_terms text[]
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if auth.role() is distinct from 'service_role' then
    raise exception using errcode = '42501', message = 'trusted marketplace service required';
  end if;
  if p_organization_id is null
    or p_limit not between 1 and 100
    or p_offset not between 0 and 10000
    or length(coalesce(p_query, '')) > 160
    or length(coalesce(p_department, '')) > 120
    or length(coalesce(p_capability, '')) > 240 then
    raise exception 'invalid marketplace organization search';
  end if;

  return query
  with visible as (
    select distinct on (v.app_id)
      v.app_id,
      v.version,
      v.artifact_digest,
      v.snapshot_digest,
      v.release_status,
      v.app_metadata,
      v.version_payload,
      v.published_at,
      v.verified_at,
      v.status_message,
      v.status_updated_at
    from public.marketplace_app_versions v
    where v.release_status in ('active', 'deprecated')
      and private.can_organization_read_marketplace_app(p_organization_id, v.app_id)
      and (
        nullif(trim(p_department), '') is null
        or lower(v.app_metadata->>'department') = lower(trim(p_department))
      )
      and (
        nullif(trim(p_capability), '') is null
        or exists (
          select 1
            from public.marketplace_app_connector_requirements c
           where c.app_id = v.app_id
             and c.version = v.version
             and c.capability = trim(p_capability)
        )
      )
    order by v.app_id, v.published_at desc, v.version desc
  ), scored as (
    select visible.*,
      case
        when nullif(trim(p_query), '') is null then 1
        when lower(visible.app_id) = lower(trim(p_query)) then 100
        when lower(visible.app_id) like lower(trim(p_query)) || '%' then 80
        when lower(visible.app_metadata->>'name') like '%' || lower(trim(p_query)) || '%' then 60
        when lower(visible.app_metadata->>'summary') like '%' || lower(trim(p_query)) || '%' then 40
        when lower(coalesce(visible.app_metadata->>'description', '')) like '%' || lower(trim(p_query)) || '%' then 20
        else 0
      end as relevance_score,
      case when nullif(trim(p_query), '') is null then array[]::text[] else
        array_remove(array[
          case when lower(visible.app_id) like '%' || lower(trim(p_query)) || '%' then 'id' end,
          case when lower(visible.app_metadata->>'name') like '%' || lower(trim(p_query)) || '%' then 'name' end,
          case when lower(visible.app_metadata->>'summary') like '%' || lower(trim(p_query)) || '%' then 'summary' end,
          case when lower(coalesce(visible.app_metadata->>'description', '')) like '%' || lower(trim(p_query)) || '%' then 'description' end
        ], null)
      end as matched_terms
    from visible
  )
  select scored.* from scored
   where scored.relevance_score > 0
   order by scored.relevance_score desc, scored.app_id asc
   limit p_limit
  offset p_offset;
end;
$$;

revoke all on function public.search_marketplace_apps_for_organization(uuid, text, text, text, integer, integer) from public;
grant execute on function public.search_marketplace_apps_for_organization(uuid, text, text, text, integer, integer) to service_role;

create or replace function public.list_marketplace_versions_for_organization(
  p_organization_id uuid,
  p_app_id text,
  p_include_deprecated boolean default true
)
returns table (
  app_id text,
  version text,
  artifact_digest text,
  snapshot_digest text,
  release_status text,
  app_metadata jsonb,
  version_payload jsonb,
  published_at timestamptz,
  verified_at timestamptz,
  status_message text,
  status_updated_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if auth.role() is distinct from 'service_role' then
    raise exception using errcode = '42501', message = 'trusted marketplace service required';
  end if;
  if p_organization_id is null
    or p_app_id !~ '^[a-z0-9](?:[a-z0-9._-]{1,158}[a-z0-9])?$' then
    raise exception 'invalid marketplace app lookup';
  end if;

  return query
  select
    v.app_id,
    v.version,
    v.artifact_digest,
    v.snapshot_digest,
    v.release_status,
    v.app_metadata,
    v.version_payload,
    v.published_at,
    v.verified_at,
    v.status_message,
    v.status_updated_at
  from public.marketplace_app_versions v
  where v.app_id = p_app_id
    and v.release_status = any (
      case when p_include_deprecated
        then array['active', 'deprecated']::text[]
        else array['active']::text[]
      end
    )
    and private.can_organization_read_marketplace_app(p_organization_id, v.app_id)
  order by v.published_at asc, v.version asc;
end;
$$;

revoke all on function public.list_marketplace_versions_for_organization(uuid, text, boolean) from public;
grant execute on function public.list_marketplace_versions_for_organization(uuid, text, boolean) to service_role;

create or replace function public.get_marketplace_delivery_for_organization(
  p_organization_id uuid,
  p_app_id text,
  p_version text,
  p_artifact_digest text
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_delivery jsonb;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception using errcode = '42501', message = 'trusted marketplace service required';
  end if;
  if p_organization_id is null
    or p_app_id !~ '^[a-z0-9](?:[a-z0-9._-]{1,158}[a-z0-9])?$'
    or p_version !~ '^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(-[0-9A-Za-z-]+(\.[0-9A-Za-z-]+)*)?(\+[0-9A-Za-z-]+(\.[0-9A-Za-z-]+)*)?$'
    or p_artifact_digest !~ '^sha256:[a-f0-9]{64}$' then
    raise exception 'invalid marketplace delivery identity';
  end if;

  select jsonb_build_object(
    'appId', v.app_id,
    'version', v.version,
    'artifactDigest', v.artifact_digest,
    'releaseStatus', v.release_status,
    'verifiedAt', v.verified_at,
    'artifactObjectKey', v.artifact_object_key,
    'publisherId', s.publisher_id,
    'algorithm', s.algorithm,
    'keyId', s.key_id,
    'publicKey', s.public_key
  )
    into v_delivery
    from public.marketplace_app_versions v
    join public.marketplace_release_signatures s
      on s.app_id = v.app_id and s.version = v.version
   where v.app_id = p_app_id
     and v.version = p_version
     and v.artifact_digest = p_artifact_digest
     and v.release_status in ('active', 'deprecated')
     and v.verified_at is not null
     and private.can_organization_read_marketplace_app(p_organization_id, v.app_id);

  return v_delivery;
end;
$$;

revoke all on function public.get_marketplace_delivery_for_organization(uuid, text, text, text) from public;
grant execute on function public.get_marketplace_delivery_for_organization(uuid, text, text, text) to service_role;
