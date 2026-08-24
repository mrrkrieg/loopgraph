-- MFA is enforced at the application boundary. This service-role RPC rechecks
-- the actor's durable administrator membership and commits an exact release
-- status transition with its append-only audit event in one transaction.

create or replace function public.admin_set_private_marketplace_release_status(
  p_organization_id uuid,
  p_project_key text,
  p_actor_user_id uuid,
  p_app_id text,
  p_version text,
  p_release_status text,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_release public.marketplace_app_versions%rowtype;
  v_correlation_id text := 'marketplace_release_status_' || gen_random_uuid()::text;
  v_changed boolean;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception using errcode = '42501', message = 'trusted marketplace administrator required';
  end if;
  if p_project_key !~ '^[a-z0-9][a-z0-9_-]{0,63}$'
    or p_app_id !~ '^[a-z0-9](?:[a-z0-9._-]*[a-z0-9])?$'
    or length(p_app_id) not between 3 and 160
    or length(p_version) not between 1 and 100
    or p_release_status not in ('deprecated', 'revoked')
    or length(btrim(coalesce(p_reason, ''))) not between 3 and 1000 then
    raise exception using errcode = '22023', message = 'invalid marketplace release status request';
  end if;
  if not exists (
    select 1
      from public.organization_memberships membership
     where membership.organization_id = p_organization_id
       and membership.user_id = p_actor_user_id
       and membership.status = 'active'
       and membership.role in ('admin', 'owner')
  ) then
    raise exception using errcode = '42501', message = 'marketplace administrator membership required';
  end if;

  select version.* into v_release
    from public.marketplace_app_versions version
    join public.marketplace_apps app on app.app_id = version.app_id
   where version.app_id = p_app_id
     and version.version = p_version
     and app.owner_organization_id = p_organization_id
   for update of version;
  if not found then
    raise exception using errcode = 'P0002', message = 'marketplace release not found';
  end if;
  if not (
    (v_release.release_status = 'active' and p_release_status in ('deprecated', 'revoked'))
    or (v_release.release_status = 'deprecated' and p_release_status = 'revoked')
    or v_release.release_status = p_release_status
  ) then
    raise exception using errcode = '22023', message = 'invalid marketplace release lifecycle transition';
  end if;

  v_changed := v_release.release_status is distinct from p_release_status;
  update public.marketplace_app_versions
     set release_status = p_release_status,
         status_message = btrim(p_reason),
         status_updated_at = now(),
         status_updated_by = p_actor_user_id
   where app_id = p_app_id
     and version = p_version;

  perform private.append_security_audit_event(
    p_organization_id,
    p_project_key,
    'marketplace.release.status_changed',
    'accepted',
    'user',
    p_actor_user_id::text,
    'marketplace.publish',
    null,
    v_correlation_id,
    'marketplace-release-admin',
    'marketplace_release',
    p_app_id || '@' || p_version,
    jsonb_build_object(
      'previous_status', v_release.release_status,
      'release_status', p_release_status,
      'changed', v_changed,
      'artifact_digest', v_release.artifact_digest,
      'reason_recorded', true,
      'reason_sha256', encode(sha256(convert_to(btrim(p_reason), 'UTF8')), 'hex')
    )
  );

  return jsonb_build_object(
    'appId', p_app_id,
    'version', p_version,
    'artifactDigest', v_release.artifact_digest,
    'previousStatus', v_release.release_status,
    'releaseStatus', p_release_status,
    'changed', v_changed,
    'correlationId', v_correlation_id
  );
end;
$$;

revoke all on function public.admin_set_private_marketplace_release_status(uuid, text, uuid, text, text, text, text)
  from public, anon, authenticated;
grant execute on function public.admin_set_private_marketplace_release_status(uuid, text, uuid, text, text, text, text)
  to service_role;

-- Close the older direct authenticated mutation path. Hosted lifecycle changes
-- must cross the MFA application boundary and the atomic audited RPC above.
revoke all on function public.set_private_marketplace_release_status(uuid, text, text, text, text)
  from public, anon, authenticated, service_role;
