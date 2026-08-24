-- Tenant-scoped operational App verification trust. Verifier private keys are
-- deliberately excluded: only approved public keys and signed receipts may be
-- persisted. All mutations cross bounded service-role functions and append to
-- the existing tamper-evident security audit chain.

create table if not exists public.loopgraph_app_verification_registries (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  project_key text not null,
  workspace_id text not null,
  revision bigint not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (organization_id, project_key, workspace_id),
  constraint loopgraph_app_verification_registry_project_check check (project_key ~ '^[a-z0-9][a-z0-9_-]{0,63}$'),
  constraint loopgraph_app_verification_registry_workspace_check check (length(workspace_id) between 1 and 160),
  constraint loopgraph_app_verification_registry_revision_check check (revision >= 0)
);

create table if not exists public.loopgraph_app_verifier_keys (
  organization_id uuid not null,
  project_key text not null,
  workspace_id text not null,
  verifier_id text not null,
  key_id text not null,
  payload jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (organization_id, project_key, workspace_id, verifier_id, key_id),
  foreign key (organization_id, project_key, workspace_id)
    references public.loopgraph_app_verification_registries(organization_id, project_key, workspace_id)
    on delete cascade,
  constraint loopgraph_app_verifier_id_check check (length(verifier_id) between 1 and 300),
  constraint loopgraph_app_verifier_key_id_check check (length(key_id) between 1 and 160),
  constraint loopgraph_app_verifier_payload_check check (jsonb_typeof(payload) = 'object' and pg_column_size(payload) <= 131072)
);

create table if not exists public.loopgraph_app_verification_receipts (
  organization_id uuid not null,
  project_key text not null,
  workspace_id text not null,
  receipt_id text not null,
  installation_id text not null,
  app_id text not null,
  artifact_digest text not null,
  payload jsonb not null,
  created_at timestamptz not null default now(),
  primary key (organization_id, project_key, workspace_id, receipt_id),
  foreign key (organization_id, project_key, workspace_id)
    references public.loopgraph_app_verification_registries(organization_id, project_key, workspace_id)
    on delete cascade,
  constraint loopgraph_app_verification_receipt_id_check check (length(receipt_id) between 1 and 240),
  constraint loopgraph_app_verification_installation_id_check check (length(installation_id) between 1 and 240),
  constraint loopgraph_app_verification_app_id_check check (length(app_id) between 1 and 240),
  constraint loopgraph_app_verification_digest_check check (artifact_digest ~ '^sha256:[a-f0-9]{64}$'),
  constraint loopgraph_app_verification_receipt_payload_check check (jsonb_typeof(payload) = 'object' and pg_column_size(payload) <= 262144)
);

create index if not exists loopgraph_app_verifier_key_activity_idx
  on public.loopgraph_app_verifier_keys (organization_id, project_key, workspace_id, updated_at desc);
create index if not exists loopgraph_app_verification_receipt_installation_idx
  on public.loopgraph_app_verification_receipts (organization_id, project_key, workspace_id, installation_id, created_at desc);

alter table public.loopgraph_app_verification_registries enable row level security;
alter table public.loopgraph_app_verifier_keys enable row level security;
alter table public.loopgraph_app_verification_receipts enable row level security;
revoke all on public.loopgraph_app_verification_registries from public, anon, authenticated, service_role;
revoke all on public.loopgraph_app_verifier_keys from public, anon, authenticated, service_role;
revoke all on public.loopgraph_app_verification_receipts from public, anon, authenticated, service_role;
grant select on public.loopgraph_app_verification_registries to service_role;
grant select on public.loopgraph_app_verifier_keys to service_role;
grant select on public.loopgraph_app_verification_receipts to service_role;

create or replace function public.trust_loopgraph_app_verifier_key(
  p_organization_id uuid,
  p_project_key text,
  p_workspace_id text,
  p_key jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_existing jsonb;
begin
  if p_project_key !~ '^[a-z0-9][a-z0-9_-]{0,63}$'
    or length(p_workspace_id) not between 1 and 160
    or jsonb_typeof(p_key) <> 'object'
    or pg_column_size(p_key) > 131072
    or p_key->>'algorithm' <> 'ed25519'
    or length(coalesce(p_key->>'verifierId', '')) not between 1 and 300
    or length(coalesce(p_key->>'keyId', '')) not between 1 and 160
    or length(coalesce(p_key->>'publicKey', '')) < 32
    or length(coalesce(p_key->>'approvedBy', '')) < 1
    or length(coalesce(p_key->>'approvalRef', '')) < 1
    or p_key ?| array['privateKey', 'privateKeyPem', 'secret', 'token']
  then
    raise exception 'invalid Loopgraph App verifier public key';
  end if;

  insert into public.loopgraph_app_verification_registries (
    organization_id, project_key, workspace_id
  ) values (p_organization_id, p_project_key, p_workspace_id)
  on conflict do nothing;
  perform 1 from public.loopgraph_app_verification_registries
    where organization_id = p_organization_id and project_key = p_project_key and workspace_id = p_workspace_id
    for update;

  select payload into v_existing from public.loopgraph_app_verifier_keys
    where organization_id = p_organization_id
      and project_key = p_project_key
      and workspace_id = p_workspace_id
      and verifier_id = p_key->>'verifierId'
      and key_id = p_key->>'keyId';
  if v_existing is not null then
    if v_existing <> p_key then raise exception 'Loopgraph App verifier key identity conflict'; end if;
    return v_existing;
  end if;

  insert into public.loopgraph_app_verifier_keys (
    organization_id, project_key, workspace_id, verifier_id, key_id, payload
  ) values (
    p_organization_id, p_project_key, p_workspace_id, p_key->>'verifierId', p_key->>'keyId', p_key
  );
  update public.loopgraph_app_verification_registries
    set revision = revision + 1, updated_at = now()
    where organization_id = p_organization_id and project_key = p_project_key and workspace_id = p_workspace_id;
  perform private.append_security_audit_event(
    p_organization_id, p_project_key, 'app.verifier_trust.added', 'accepted', 'user',
    p_key->>'approvedBy', 'app.verifier_trust.manage', null, gen_random_uuid()::text,
    'app_verification_registry', 'verifier_key', (p_key->>'verifierId') || '/' || (p_key->>'keyId'),
    jsonb_build_object('workspaceId', p_workspace_id, 'approvalRef', p_key->>'approvalRef')
  );
  return p_key;
end;
$$;

create or replace function public.revoke_loopgraph_app_verifier_key(
  p_organization_id uuid,
  p_project_key text,
  p_workspace_id text,
  p_verifier_id text,
  p_key_id text,
  p_revoked_by text,
  p_revocation_ref text,
  p_revoked_at timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_existing jsonb;
  v_revoked jsonb;
begin
  if p_project_key !~ '^[a-z0-9][a-z0-9_-]{0,63}$'
    or length(p_workspace_id) not between 1 and 160
    or length(p_verifier_id) not between 1 and 300
    or length(p_key_id) not between 1 and 160
    or nullif(btrim(p_revoked_by), '') is null
    or nullif(btrim(p_revocation_ref), '') is null
  then raise exception 'invalid Loopgraph App verifier revocation'; end if;

  perform 1 from public.loopgraph_app_verification_registries
    where organization_id = p_organization_id and project_key = p_project_key and workspace_id = p_workspace_id
    for update;
  select payload into strict v_existing from public.loopgraph_app_verifier_keys
    where organization_id = p_organization_id
      and project_key = p_project_key
      and workspace_id = p_workspace_id
      and verifier_id = p_verifier_id
      and key_id = p_key_id
    for update;
  v_revoked := v_existing || jsonb_build_object(
    'revokedAt', to_char(p_revoked_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'revokedBy', p_revoked_by,
    'revocationRef', p_revocation_ref
  );
  if v_existing ? 'revokedAt' then
    if v_existing <> v_revoked then raise exception 'Loopgraph App verifier key revocation conflict'; end if;
    return v_existing;
  end if;
  update public.loopgraph_app_verifier_keys
    set payload = v_revoked, updated_at = now()
    where organization_id = p_organization_id and project_key = p_project_key and workspace_id = p_workspace_id
      and verifier_id = p_verifier_id and key_id = p_key_id;
  update public.loopgraph_app_verification_registries
    set revision = revision + 1, updated_at = now()
    where organization_id = p_organization_id and project_key = p_project_key and workspace_id = p_workspace_id;
  perform private.append_security_audit_event(
    p_organization_id, p_project_key, 'app.verifier_trust.revoked', 'accepted', 'user',
    p_revoked_by, 'app.verifier_trust.manage', null, gen_random_uuid()::text,
    'app_verification_registry', 'verifier_key', p_verifier_id || '/' || p_key_id,
    jsonb_build_object('workspaceId', p_workspace_id, 'revocationRef', p_revocation_ref)
  );
  return v_revoked;
end;
$$;

create or replace function public.import_loopgraph_app_verification_receipt(
  p_organization_id uuid,
  p_project_key text,
  p_workspace_id text,
  p_receipt jsonb,
  p_imported_by text,
  p_import_ref text,
  p_imported_at timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_existing jsonb;
  v_key jsonb;
begin
  if p_project_key !~ '^[a-z0-9][a-z0-9_-]{0,63}$'
    or length(p_workspace_id) not between 1 and 160
    or jsonb_typeof(p_receipt) <> 'object'
    or pg_column_size(p_receipt) > 262144
    or length(coalesce(p_receipt->>'id', '')) not between 1 and 240
    or length(coalesce(p_receipt->>'installationId', '')) not between 1 and 240
    or length(coalesce(p_receipt->>'appId', '')) not between 1 and 240
    or coalesce(p_receipt->>'artifactDigest', '') !~ '^sha256:[a-f0-9]{64}$'
    or p_receipt#>>'{signature,algorithm}' <> 'ed25519'
    or nullif(btrim(p_imported_by), '') is null
    or nullif(btrim(p_import_ref), '') is null
    or p_receipt ?| array['privateKey', 'privateKeyPem', 'secret', 'token']
  then raise exception 'invalid Loopgraph App verification receipt'; end if;

  perform 1 from public.loopgraph_app_verification_registries
    where organization_id = p_organization_id and project_key = p_project_key and workspace_id = p_workspace_id
    for update;
  select payload into v_key from public.loopgraph_app_verifier_keys
    where organization_id = p_organization_id
      and project_key = p_project_key
      and workspace_id = p_workspace_id
      and verifier_id = p_receipt->>'verifierId'
      and key_id = p_receipt#>>'{signature,keyId}';
  if v_key is null or v_key ? 'revokedAt' then
    raise exception 'active trusted Loopgraph App verifier key not found';
  end if;
  select payload into v_existing from public.loopgraph_app_verification_receipts
    where organization_id = p_organization_id and project_key = p_project_key
      and workspace_id = p_workspace_id and receipt_id = p_receipt->>'id';
  if v_existing is not null then
    if v_existing <> p_receipt then raise exception 'immutable Loopgraph App verification receipt conflict'; end if;
    return v_existing;
  end if;
  insert into public.loopgraph_app_verification_receipts (
    organization_id, project_key, workspace_id, receipt_id, installation_id, app_id, artifact_digest, payload
  ) values (
    p_organization_id, p_project_key, p_workspace_id, p_receipt->>'id', p_receipt->>'installationId',
    p_receipt->>'appId', p_receipt->>'artifactDigest', p_receipt
  );
  update public.loopgraph_app_verification_registries
    set revision = revision + 1, updated_at = now()
    where organization_id = p_organization_id and project_key = p_project_key and workspace_id = p_workspace_id;
  perform private.append_security_audit_event(
    p_organization_id, p_project_key, 'app.verification_receipt.imported', 'accepted', 'user',
    p_imported_by, 'app.verification.import', null, gen_random_uuid()::text,
    'app_verification_registry', 'verification_receipt', p_receipt->>'id',
    jsonb_build_object(
      'workspaceId', p_workspace_id, 'importRef', p_import_ref, 'importedAt', p_imported_at,
      'installationId', p_receipt->>'installationId', 'appId', p_receipt->>'appId',
      'artifactDigest', p_receipt->>'artifactDigest'
    )
  );
  return p_receipt;
end;
$$;

revoke all on function public.trust_loopgraph_app_verifier_key(uuid, text, text, jsonb) from public, anon, authenticated;
revoke all on function public.revoke_loopgraph_app_verifier_key(uuid, text, text, text, text, text, text, timestamptz) from public, anon, authenticated;
revoke all on function public.import_loopgraph_app_verification_receipt(uuid, text, text, jsonb, text, text, timestamptz) from public, anon, authenticated;
grant execute on function public.trust_loopgraph_app_verifier_key(uuid, text, text, jsonb) to service_role;
grant execute on function public.revoke_loopgraph_app_verifier_key(uuid, text, text, text, text, text, text, timestamptz) to service_role;
grant execute on function public.import_loopgraph_app_verification_receipt(uuid, text, text, jsonb, text, text, timestamptz) to service_role;
