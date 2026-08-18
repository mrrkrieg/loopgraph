-- Stable, independently retainable audit exports. A drain first obtains one
-- fully verified chain checkpoint and then pages only through that immutable
-- head while newer audit events continue to append.

create or replace function public.get_verified_security_audit_checkpoint(
  p_organization_id uuid,
  p_project_key text,
  p_through_sequence bigint default null
)
returns table (
  valid boolean,
  events_checked bigint,
  head_sequence bigint,
  head_hash text,
  current_head_sequence bigint
)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  verification record;
  selected_sequence bigint;
  selected_hash text;
  selected_count bigint;
  current_sequence bigint;
begin
  select * into strict verification
    from public.verify_security_audit_chain(p_organization_id, p_project_key);

  select coalesce(max(audit.sequence_number), 0)
    into current_sequence
    from public.security_audit_events audit
    where audit.organization_id = p_organization_id
      and audit.project_key = p_project_key;

  selected_sequence := coalesce(p_through_sequence, current_sequence);
  if selected_sequence < 0 or selected_sequence > current_sequence then
    raise exception 'invalid audit retention checkpoint';
  end if;

  if selected_sequence = 0 then
    selected_hash := repeat('0', 64);
    selected_count := 0;
  else
    select audit.event_hash
      into selected_hash
      from public.security_audit_events audit
      where audit.organization_id = p_organization_id
        and audit.project_key = p_project_key
        and audit.sequence_number = selected_sequence;
    if selected_hash is null then
      raise exception 'audit retention checkpoint does not identify a tenant event';
    end if;
    select count(*)
      into selected_count
      from public.security_audit_events audit
      where audit.organization_id = p_organization_id
        and audit.project_key = p_project_key
      and audit.sequence_number <= selected_sequence;
  end if;

  -- A concurrent append must never let the initial request select a head that
  -- was not part of the full-chain verification snapshot. Fail closed and let
  -- the caller retry against a fresh checkpoint.
  if p_through_sequence is null
    and verification.valid
    and (
      selected_count <> verification.events_checked
      or selected_hash <> verification.head_hash
    ) then
    raise exception 'audit retention checkpoint moved during verification';
  end if;

  return query select
    verification.valid,
    selected_count,
    selected_sequence,
    selected_hash,
    current_sequence;
end;
$$;

create or replace function public.export_security_audit_events_bounded(
  p_organization_id uuid,
  p_project_key text,
  p_after_sequence bigint,
  p_through_sequence bigint,
  p_limit integer default 100
)
returns setof public.security_audit_events
language sql
stable
security invoker
set search_path = ''
as $$
  select audit.*
    from public.security_audit_events audit
    where audit.organization_id = p_organization_id
      and audit.project_key = p_project_key
      and audit.sequence_number > greatest(p_after_sequence, 0)
      and audit.sequence_number <= greatest(p_through_sequence, 0)
    order by audit.sequence_number
    limit least(greatest(p_limit, 1), 500);
$$;

revoke all on function public.get_verified_security_audit_checkpoint(uuid, text, bigint)
  from public, anon, authenticated;
revoke all on function public.export_security_audit_events_bounded(uuid, text, bigint, bigint, integer)
  from public, anon, authenticated;
grant execute on function public.get_verified_security_audit_checkpoint(uuid, text, bigint)
  to service_role;
grant execute on function public.export_security_audit_events_bounded(uuid, text, bigint, bigint, integer)
  to service_role;
