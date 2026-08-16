-- Tenant-scoped hosted marketplace registry.
--
-- Published versions are immutable. An authenticated publisher may stage a
-- signed private release, but only a service-role verifier may attest the exact
-- digest and make it active. Artifact bytes are deliberately not stored here;
-- artifact_object_key is a tenant-prefixed opaque reference for the separate
-- signed-delivery service.

create table if not exists public.marketplace_publishers (
  publisher_id text primary key,
  owner_organization_id uuid not null references public.organizations(id) on delete cascade,
  display_name text not null,
  website_url text,
  verification_state text not null default 'private_owner',
  created_by uuid not null,
  created_at timestamptz not null default now(),
  constraint marketplace_publishers_id_check
    check (publisher_id ~ '^[a-z0-9](?:[a-z0-9._-]{1,158}[a-z0-9])?$'),
  constraint marketplace_publishers_name_check
    check (length(display_name) between 1 and 120),
  constraint marketplace_publishers_website_check
    check (website_url is null or (length(website_url) <= 2048 and website_url ~ '^https://')),
  constraint marketplace_publishers_verification_check
    check (verification_state in ('private_owner', 'verified_partner', 'official'))
);

create table if not exists public.marketplace_apps (
  app_id text primary key,
  publisher_id text not null references public.marketplace_publishers(publisher_id),
  owner_organization_id uuid not null references public.organizations(id) on delete cascade,
  visibility text not null default 'private',
  created_by uuid not null,
  created_at timestamptz not null default now(),
  constraint marketplace_apps_id_check
    check (app_id ~ '^[a-z0-9](?:[a-z0-9._-]{1,158}[a-z0-9])?$'),
  constraint marketplace_apps_namespace_check
    check (app_id like publisher_id || '.%'),
  constraint marketplace_apps_visibility_check
    check (visibility in ('private', 'public', 'official'))
);

create index if not exists marketplace_apps_owner_idx
  on public.marketplace_apps(owner_organization_id, visibility, app_id);

create table if not exists public.marketplace_app_versions (
  app_id text not null references public.marketplace_apps(app_id) on delete cascade,
  version text not null,
  artifact_digest text not null,
  manifest_digest text not null,
  file_index_digest text not null,
  snapshot_digest text not null,
  artifact_object_key text not null,
  release_status text not null default 'pending_verification',
  app_metadata jsonb not null,
  version_payload jsonb not null,
  manifest_payload jsonb not null,
  file_index_payload jsonb not null,
  published_by uuid not null,
  published_at timestamptz not null,
  verified_at timestamptz,
  verification_receipt_digest text,
  status_message text,
  status_updated_at timestamptz,
  status_updated_by uuid,
  primary key (app_id, version),
  constraint marketplace_app_versions_semver_check
    check (
      version ~ '^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(-[0-9A-Za-z-]+(\.[0-9A-Za-z-]+)*)?(\+[0-9A-Za-z-]+(\.[0-9A-Za-z-]+)*)?$'
    ),
  constraint marketplace_app_versions_digest_check
    check (
      artifact_digest ~ '^sha256:[a-f0-9]{64}$'
      and manifest_digest ~ '^sha256:[a-f0-9]{64}$'
      and file_index_digest ~ '^sha256:[a-f0-9]{64}$'
      and snapshot_digest ~ '^sha256:[a-f0-9]{64}$'
      and (
        verification_receipt_digest is null
        or verification_receipt_digest ~ '^sha256:[a-f0-9]{64}$'
      )
    ),
  constraint marketplace_app_versions_object_key_check
    check (
      length(artifact_object_key) between 1 and 512
      and artifact_object_key !~ '(^|/)\.\.(/|$)'
      and artifact_object_key !~ '[\\]'
      and artifact_object_key !~ '://'
      and artifact_object_key !~ '^/'
    ),
  constraint marketplace_app_versions_status_check
    check (release_status in (
      'pending_verification', 'active', 'deprecated', 'revoked', 'rejected'
    )),
  constraint marketplace_app_versions_payload_check
    check (
      jsonb_typeof(app_metadata) = 'object'
      and jsonb_typeof(version_payload) = 'object'
      and jsonb_typeof(manifest_payload) = 'object'
      and jsonb_typeof(file_index_payload) = 'array'
      and pg_column_size(app_metadata) <= 524288
      and pg_column_size(version_payload) <= 1048576
      and pg_column_size(manifest_payload) <= 2097152
      and pg_column_size(file_index_payload) <= 2097152
    ),
  constraint marketplace_app_versions_status_metadata_check
    check (
      (release_status = 'pending_verification' and verified_at is null and verification_receipt_digest is null)
      or (release_status in ('active', 'deprecated', 'revoked') and verified_at is not null and verification_receipt_digest is not null)
      or (release_status = 'rejected' and status_message is not null)
    )
);

create index if not exists marketplace_app_versions_status_idx
  on public.marketplace_app_versions(app_id, release_status, published_at desc);

create table if not exists public.marketplace_app_artifacts (
  app_id text not null,
  version text not null,
  path text not null,
  digest text not null,
  size_bytes bigint not null,
  media_type text not null,
  primary key (app_id, version, path),
  foreign key (app_id, version)
    references public.marketplace_app_versions(app_id, version) on delete cascade,
  constraint marketplace_app_artifacts_path_check
    check (
      length(path) between 1 and 512
      and path !~ '(^|/)\.\.(/|$)'
      and path !~ '[\\]'
      and path !~ '^/'
    ),
  constraint marketplace_app_artifacts_digest_check
    check (digest ~ '^sha256:[a-f0-9]{64}$'),
  constraint marketplace_app_artifacts_size_check check (size_bytes between 0 and 1073741824),
  constraint marketplace_app_artifacts_media_check check (length(media_type) between 1 and 200)
);

create table if not exists public.marketplace_app_dependencies (
  app_id text not null,
  version text not null,
  dependency_app_id text not null,
  version_range text not null,
  optional boolean not null default false,
  primary key (app_id, version, dependency_app_id),
  foreign key (app_id, version)
    references public.marketplace_app_versions(app_id, version) on delete cascade,
  constraint marketplace_app_dependencies_identity_check
    check (
      dependency_app_id ~ '^[a-z0-9](?:[a-z0-9._-]{1,158}[a-z0-9])?$'
      and length(version_range) between 1 and 100
    )
);

create table if not exists public.marketplace_app_connector_requirements (
  app_id text not null,
  version text not null,
  capability text not null,
  requirement_mode text not null,
  primary key (app_id, version, capability),
  foreign key (app_id, version)
    references public.marketplace_app_versions(app_id, version) on delete cascade,
  constraint marketplace_connector_capability_check
    check (capability ~ '^[a-z][a-z0-9_-]*(\.[a-z][a-z0-9_-]*){2,}$'),
  constraint marketplace_connector_mode_check check (requirement_mode in ('required', 'optional'))
);

create table if not exists public.marketplace_app_presets (
  app_id text not null,
  version text not null,
  preset_id text not null,
  payload jsonb not null,
  primary key (app_id, version, preset_id),
  foreign key (app_id, version)
    references public.marketplace_app_versions(app_id, version) on delete cascade,
  constraint marketplace_app_presets_id_check
    check (length(preset_id) between 1 and 160),
  constraint marketplace_app_presets_payload_check
    check (jsonb_typeof(payload) = 'object' and pg_column_size(payload) <= 262144)
);

create table if not exists public.marketplace_app_eval_results (
  app_id text not null,
  version text not null,
  evaluation_id text not null,
  result_status text not null,
  result_payload jsonb not null,
  recorded_at timestamptz not null default now(),
  primary key (app_id, version, evaluation_id),
  foreign key (app_id, version)
    references public.marketplace_app_versions(app_id, version) on delete cascade,
  constraint marketplace_app_eval_results_id_check
    check (length(evaluation_id) between 1 and 240),
  constraint marketplace_app_eval_results_status_check
    check (result_status in ('passed', 'failed', 'incomplete')),
  constraint marketplace_app_eval_results_payload_check
    check (jsonb_typeof(result_payload) = 'object' and pg_column_size(result_payload) <= 1048576)
);

create table if not exists public.marketplace_release_signatures (
  app_id text not null,
  version text not null,
  publisher_id text not null references public.marketplace_publishers(publisher_id),
  algorithm text not null,
  key_id text not null,
  public_key text not null,
  signature_value text not null,
  primary key (app_id, version),
  foreign key (app_id, version)
    references public.marketplace_app_versions(app_id, version) on delete cascade,
  constraint marketplace_release_signatures_algorithm_check
    check (algorithm in ('ed25519', 'ecdsa-p256-sha256')),
  constraint marketplace_release_signatures_bounded_check
    check (
      length(key_id) between 3 and 160
      and length(public_key) between 32 and 8192
      and length(signature_value) between 32 and 16384
    )
);

create table if not exists public.private_catalog_access (
  app_id text not null references public.marketplace_apps(app_id) on delete cascade,
  owner_organization_id uuid not null references public.organizations(id) on delete cascade,
  grantee_organization_id uuid not null references public.organizations(id) on delete cascade,
  granted_by uuid not null,
  granted_at timestamptz not null default now(),
  primary key (app_id, grantee_organization_id),
  constraint private_catalog_access_distinct_org_check
    check (owner_organization_id <> grantee_organization_id)
);

create index if not exists private_catalog_access_grantee_idx
  on public.private_catalog_access(grantee_organization_id, app_id);

create or replace function private.can_read_marketplace_app(requested_app_id text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select auth.uid() is not null and exists (
    select 1
      from public.marketplace_apps app
     where app.app_id = requested_app_id
       and (
         app.visibility in ('public', 'official')
         or exists (
           select 1 from public.organization_memberships membership
            where membership.organization_id = app.owner_organization_id
              and membership.user_id = auth.uid()
              and membership.status = 'active'
         )
         or exists (
           select 1
             from public.private_catalog_access catalog_access
             join public.organization_memberships membership
               on membership.organization_id = catalog_access.grantee_organization_id
            where catalog_access.app_id = app.app_id
              and membership.user_id = auth.uid()
              and membership.status = 'active'
         )
       )
  );
$$;

create or replace function private.can_manage_marketplace_app(
  requested_app_id text,
  requested_organization_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.is_org_member(
    requested_organization_id,
    array['admin', 'owner']
  ) and exists (
    select 1 from public.marketplace_apps app
     where app.app_id = requested_app_id
       and app.owner_organization_id = requested_organization_id
  );
$$;

revoke all on function private.can_read_marketplace_app(text) from public;
revoke all on function private.can_manage_marketplace_app(text, uuid) from public;
grant execute on function private.can_read_marketplace_app(text) to authenticated, service_role;
grant execute on function private.can_manage_marketplace_app(text, uuid) to authenticated, service_role;

do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'marketplace_publishers',
    'marketplace_apps',
    'marketplace_app_versions',
    'marketplace_app_artifacts',
    'marketplace_app_dependencies',
    'marketplace_app_connector_requirements',
    'marketplace_app_presets',
    'marketplace_app_eval_results',
    'marketplace_release_signatures',
    'private_catalog_access'
  ]
  loop
    execute format('alter table public.%I enable row level security', table_name);
    execute format(
      'revoke all on public.%I from public, anon, authenticated, service_role',
      table_name
    );
    execute format('grant select on public.%I to service_role', table_name);
  end loop;
end
$$;

grant select on public.marketplace_publishers to authenticated;
grant select on public.marketplace_apps to authenticated;
grant select (
  app_id, version, artifact_digest, snapshot_digest, release_status,
  app_metadata, version_payload, published_at, verified_at,
  status_message, status_updated_at
) on public.marketplace_app_versions to authenticated;
grant select on public.marketplace_app_artifacts to authenticated;
grant select on public.marketplace_app_dependencies to authenticated;
grant select on public.marketplace_app_connector_requirements to authenticated;
grant select on public.marketplace_app_presets to authenticated;
grant select on public.marketplace_app_eval_results to authenticated;
grant select on public.private_catalog_access to authenticated;

drop policy if exists marketplace_publishers_visible_select on public.marketplace_publishers;
create policy marketplace_publishers_visible_select
  on public.marketplace_publishers for select to authenticated
  using (
    private.is_org_member(owner_organization_id)
    or exists (
      select 1 from public.marketplace_apps app
       where app.publisher_id = marketplace_publishers.publisher_id
         and private.can_read_marketplace_app(app.app_id)
    )
  );

drop policy if exists marketplace_apps_visible_select on public.marketplace_apps;
create policy marketplace_apps_visible_select
  on public.marketplace_apps for select to authenticated
  using (private.can_read_marketplace_app(app_id));

drop policy if exists marketplace_app_versions_visible_select on public.marketplace_app_versions;
create policy marketplace_app_versions_visible_select
  on public.marketplace_app_versions for select to authenticated
  using (private.can_read_marketplace_app(app_id));

drop policy if exists marketplace_app_artifacts_visible_select on public.marketplace_app_artifacts;
create policy marketplace_app_artifacts_visible_select
  on public.marketplace_app_artifacts for select to authenticated
  using (private.can_read_marketplace_app(app_id));

drop policy if exists marketplace_app_dependencies_visible_select on public.marketplace_app_dependencies;
create policy marketplace_app_dependencies_visible_select
  on public.marketplace_app_dependencies for select to authenticated
  using (private.can_read_marketplace_app(app_id));

drop policy if exists marketplace_connector_requirements_visible_select on public.marketplace_app_connector_requirements;
create policy marketplace_connector_requirements_visible_select
  on public.marketplace_app_connector_requirements for select to authenticated
  using (private.can_read_marketplace_app(app_id));

drop policy if exists marketplace_app_presets_visible_select on public.marketplace_app_presets;
create policy marketplace_app_presets_visible_select
  on public.marketplace_app_presets for select to authenticated
  using (private.can_read_marketplace_app(app_id));

drop policy if exists marketplace_app_eval_results_visible_select on public.marketplace_app_eval_results;
create policy marketplace_app_eval_results_visible_select
  on public.marketplace_app_eval_results for select to authenticated
  using (private.can_read_marketplace_app(app_id));

drop policy if exists marketplace_release_signatures_visible_select on public.marketplace_release_signatures;
create policy marketplace_release_signatures_visible_select
  on public.marketplace_release_signatures for select to authenticated
  using (private.can_read_marketplace_app(app_id));

drop policy if exists private_catalog_access_member_select on public.private_catalog_access;
create policy private_catalog_access_member_select
  on public.private_catalog_access for select to authenticated
  using (
    private.is_org_member(owner_organization_id)
    or private.is_org_member(grantee_organization_id)
  );

create or replace function public.publish_private_marketplace_app_version(
  p_organization_id uuid,
  p_artifact_object_key text,
  p_payload jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_id uuid := auth.uid();
  v_app_id text;
  v_publisher_id text;
  v_version text;
  v_artifact_digest text;
  v_manifest_digest text;
  v_file_index_digest text;
  v_snapshot_digest text;
  v_source_uri text := 'hosted://catalog/' || p_organization_id::text;
  v_expected_artifact_uri text;
  v_existing_owner uuid;
  v_existing_publisher_id text;
  v_existing_version public.marketplace_app_versions%rowtype;
  v_created boolean := false;
  v_file jsonb;
  v_dependency jsonb;
  v_capability jsonb;
  v_preset jsonb;
begin
  if v_actor_id is null then
    raise exception using errcode = '42501', message = 'authentication required';
  end if;
  if not private.is_org_member(p_organization_id, array['admin', 'owner']) then
    raise exception using errcode = '42501', message = 'marketplace publication permission denied';
  end if;
  if jsonb_typeof(p_payload) is distinct from 'object'
    or pg_column_size(p_payload) > 4194304
    or p_payload->>'schemaVersion' is distinct from 'hosted-marketplace-publication/v1alpha1'
    or jsonb_typeof(p_payload->'publisher') is distinct from 'object'
    or jsonb_typeof(p_payload->'app') is distinct from 'object'
    or jsonb_typeof(p_payload->'version') is distinct from 'object'
    or jsonb_typeof(p_payload->'artifact') is distinct from 'object' then
    raise exception 'invalid hosted marketplace publication';
  end if;

  v_app_id := p_payload->'app'->>'id';
  v_publisher_id := p_payload->'publisher'->>'id';
  v_version := p_payload->'version'->>'version';
  v_artifact_digest := p_payload->'artifact'->>'digest';
  v_manifest_digest := p_payload->>'manifestDigest';
  v_file_index_digest := p_payload->>'fileIndexDigest';
  v_snapshot_digest := p_payload->'version'->'source'->>'snapshotDigest';
  v_expected_artifact_uri := 'hosted://marketplace/' || v_app_id || '/' || v_version;

  if v_publisher_id is null
    or v_publisher_id !~ '^[a-z0-9](?:[a-z0-9._-]{1,158}[a-z0-9])?$'
    or v_app_id is null
    or v_app_id !~ '^[a-z0-9](?:[a-z0-9._-]{1,158}[a-z0-9])?$'
    or v_app_id not like v_publisher_id || '.%'
    or v_version is null
    or v_version !~ '^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(-[0-9A-Za-z-]+(\.[0-9A-Za-z-]+)*)?(\+[0-9A-Za-z-]+(\.[0-9A-Za-z-]+)*)?$'
    or v_artifact_digest is null
    or v_artifact_digest !~ '^sha256:[a-f0-9]{64}$'
    or v_manifest_digest is null
    or v_manifest_digest !~ '^sha256:[a-f0-9]{64}$'
    or v_file_index_digest is null
    or v_file_index_digest !~ '^sha256:[a-f0-9]{64}$'
    or v_snapshot_digest is null
    or v_snapshot_digest !~ '^sha256:[a-f0-9]{64}$'
    or p_artifact_object_key is null
    or length(p_artifact_object_key) not between 1 and 512
    or p_artifact_object_key not like p_organization_id::text || '/marketplace/%'
    or p_artifact_object_key ~ '(^|/)\.\.(/|$)'
    or p_artifact_object_key ~ '[\\]'
    or p_artifact_object_key ~ '://'
    or p_payload->'app'->>'schemaVersion' is distinct from 'loopgraph-marketplace/v1alpha1'
    or p_payload->'version'->>'schemaVersion' is distinct from 'loopgraph-marketplace/v1alpha1'
    or p_payload->'app'->>'visibility' is distinct from 'private'
    or jsonb_typeof(p_payload->'app'->'searchTerms') is distinct from 'array'
    or jsonb_array_length(p_payload->'app'->'searchTerms') > 50
    or (
      p_payload->'app' ? 'iconUri'
      and p_payload->'app'->>'iconUri' !~ '^https://[^/@:]+(?:/|$)'
    )
    or (
      p_payload->'app' ? 'readmeUri'
      and p_payload->'app'->>'readmeUri' !~ '^https://[^/@:]+(?:/|$)'
    )
    or v_publisher_id = 'loopgraph'
    or v_app_id like 'loopgraph.%'
    or p_payload->'publisher'->>'verified' is distinct from 'false'
    or p_payload->'app'->'publisher'->>'verified' is distinct from 'false'
    or p_payload->'artifact'->'manifest'->'metadata'->'publisher'->>'verified' is distinct from 'false'
    or p_payload->'app'->'publisher'->>'id' is distinct from v_publisher_id
    or p_payload->'app'->'publisher' is distinct from p_payload->'publisher'
    or p_payload->'artifact'->'manifest'->'metadata'->'publisher' is distinct from p_payload->'publisher'
    or p_payload->'app'->>'name' is distinct from p_payload->'artifact'->'manifest'->'metadata'->>'name'
    or p_payload->'app'->>'summary' is distinct from p_payload->'artifact'->'manifest'->'metadata'->>'summary'
    or p_payload->'app'->>'description' is distinct from p_payload->'artifact'->'manifest'->'metadata'->>'description'
    or p_payload->'app'->>'department' is distinct from p_payload->'artifact'->'manifest'->'metadata'->>'department'
    or p_payload->'app'->'tags' is distinct from p_payload->'artifact'->'manifest'->'metadata'->'tags'
    or p_payload->'artifact'->'manifest'->'metadata'->>'visibility' is distinct from 'private'
    or p_payload->'version'->>'appId' is distinct from v_app_id
    or p_payload->'version'->>'digest' is distinct from v_artifact_digest
    or p_payload->'version'->>'maturity' is distinct from 'concept'
    or p_payload->'version'->>'provenanceVerified' is distinct from 'false'
    or p_payload->'version'->>'deprecated' is distinct from 'false'
    or p_payload->'version'->'compatibility' is distinct from p_payload->'artifact'->'manifest'->'compatibility'
    or p_payload->'version'->'dependencies' is distinct from p_payload->'artifact'->'manifest'->'dependencies'
    or p_payload->'version'->'permissions' is distinct from p_payload->'artifact'->'manifest'->'permissions'
    or p_payload->'version'->'requiredCapabilities' is distinct from p_payload->'artifact'->'manifest'->'requiredCapabilities'
    or p_payload->'version'->'presets' is distinct from p_payload->'artifact'->'manifest'->'presets'
    or p_payload->'version'->'modules' is distinct from p_payload->'artifact'->'manifest'->'modules'
    or p_payload->'version'->>'artifactUri' is distinct from v_expected_artifact_uri
    or p_payload->'version'->'source'->>'sourceType' is distinct from 'hosted'
    or p_payload->'version'->'source'->>'sourceUri' is distinct from v_source_uri
    or p_payload->'version'->'source'->>'sourceRef' is distinct from v_version
    or p_payload->'version'->'source'->>'trustPolicy' is distinct from 'signed'
    or p_payload->'artifact'->>'schemaVersion' is distinct from 'loopgraph-pack/v1alpha1'
    or p_payload->'artifact'->'manifest'->'metadata'->>'id' is distinct from v_app_id
    or p_payload->'artifact'->'manifest'->'metadata'->>'version' is distinct from v_version
    or p_payload->'artifact'->'manifest'->'metadata'->'publisher'->>'id' is distinct from v_publisher_id
    or p_payload->'artifact'->'provenance'->>'sourceType' is distinct from 'hosted'
    or p_payload->'artifact'->'provenance'->>'sourceUri' is distinct from v_source_uri
    or p_payload->'artifact'->'provenance'->>'sourceRef' is distinct from v_version
    or jsonb_typeof(p_payload->'artifact'->'files') is distinct from 'array'
    or jsonb_array_length(p_payload->'artifact'->'files') not between 1 and 1000
    or jsonb_typeof(p_payload->'artifact'->'manifest'->'dependencies') is distinct from 'array'
    or jsonb_typeof(p_payload->'artifact'->'manifest'->'requiredCapabilities') is distinct from 'array'
    or jsonb_typeof(p_payload->'artifact'->'manifest'->'optionalCapabilities') is distinct from 'array'
    or jsonb_typeof(p_payload->'artifact'->'manifest'->'presets') is distinct from 'array'
    or jsonb_typeof(p_payload->'artifact'->'provenance'->'signature') is distinct from 'object'
    or p_payload->'artifact'->'provenance'->'signature'->>'publisherId' is distinct from v_publisher_id then
    raise exception 'invalid hosted marketplace publication';
  end if;

  begin
    if (p_payload->'version'->>'publishedAt')::timestamptz is null
      or (p_payload->'version'->>'publishedAt')::timestamptz > now() + interval '1 day' then
      raise exception 'invalid hosted marketplace publication timestamp';
    end if;
  exception when others then
    raise exception 'invalid hosted marketplace publication timestamp';
  end;

  -- Namespace claims are serialized before any ownership observation. The
  -- fixed publisher-then-app order avoids deadlocks between concurrent claims.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('marketplace-publisher:' || v_publisher_id, 0)
  );
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('marketplace-app:' || v_app_id, 0)
  );

  select owner_organization_id into v_existing_owner
    from public.marketplace_publishers
   where publisher_id = v_publisher_id;
  if found and v_existing_owner is distinct from p_organization_id then
    raise exception using errcode = '23505', message = 'publisher namespace is already owned';
  end if;

  insert into public.marketplace_publishers (
    publisher_id, owner_organization_id, display_name, website_url,
    verification_state, created_by
  ) values (
    v_publisher_id,
    p_organization_id,
    p_payload->'publisher'->>'name',
    nullif(p_payload->'publisher'->>'url', ''),
    'private_owner',
    v_actor_id
  ) on conflict (publisher_id) do nothing;

  select owner_organization_id into v_existing_owner
    from public.marketplace_publishers
   where publisher_id = v_publisher_id;
  if not found or v_existing_owner is distinct from p_organization_id then
    raise exception using errcode = '23505', message = 'publisher namespace is already owned';
  end if;

  select owner_organization_id, publisher_id
    into v_existing_owner, v_existing_publisher_id
    from public.marketplace_apps
   where app_id = v_app_id;
  if found and (
    v_existing_owner is distinct from p_organization_id
    or v_existing_publisher_id is distinct from v_publisher_id
  ) then
    raise exception using errcode = '23505', message = 'app namespace is already bound';
  end if;

  insert into public.marketplace_apps (
    app_id, publisher_id, owner_organization_id, visibility, created_by
  ) values (
    v_app_id, v_publisher_id, p_organization_id, 'private', v_actor_id
  ) on conflict (app_id) do nothing;

  select owner_organization_id, publisher_id
    into v_existing_owner, v_existing_publisher_id
    from public.marketplace_apps
   where app_id = v_app_id;
  if not found or (
    v_existing_owner is distinct from p_organization_id
    or v_existing_publisher_id is distinct from v_publisher_id
  ) then
    raise exception using errcode = '23505', message = 'app namespace is already bound';
  end if;

  insert into public.marketplace_app_versions (
    app_id, version, artifact_digest, manifest_digest, file_index_digest,
    snapshot_digest, artifact_object_key,
    release_status, app_metadata, version_payload, manifest_payload,
    file_index_payload,
    published_by, published_at
  ) values (
    v_app_id,
    v_version,
    v_artifact_digest,
    v_manifest_digest,
    v_file_index_digest,
    v_snapshot_digest,
    p_artifact_object_key,
    'pending_verification',
    p_payload->'app',
    p_payload->'version',
    p_payload->'artifact'->'manifest',
    p_payload->'artifact'->'files',
    v_actor_id,
    (p_payload->'version'->>'publishedAt')::timestamptz
  ) on conflict do nothing
  returning true into v_created;

  if not coalesce(v_created, false) then
    select * into v_existing_version
      from public.marketplace_app_versions
     where app_id = v_app_id and version = v_version;
    if v_existing_version.artifact_digest is distinct from v_artifact_digest
      or v_existing_version.manifest_digest is distinct from v_manifest_digest
      or v_existing_version.file_index_digest is distinct from v_file_index_digest
      or v_existing_version.snapshot_digest is distinct from v_snapshot_digest
      or v_existing_version.artifact_object_key is distinct from p_artifact_object_key
      or v_existing_version.app_metadata is distinct from p_payload->'app'
      or v_existing_version.version_payload is distinct from p_payload->'version'
      or v_existing_version.manifest_payload is distinct from p_payload->'artifact'->'manifest'
      or v_existing_version.file_index_payload is distinct from p_payload->'artifact'->'files' then
      raise exception using errcode = '23505', message = 'immutable hosted marketplace version conflict';
    end if;
    return jsonb_build_object(
      'appId', v_app_id,
      'version', v_version,
      'artifactDigest', v_existing_version.artifact_digest,
      'releaseStatus', v_existing_version.release_status,
      'created', false
    );
  end if;

  for v_file in select value from jsonb_array_elements(p_payload->'artifact'->'files')
  loop
    insert into public.marketplace_app_artifacts (
      app_id, version, path, digest, size_bytes, media_type
    ) values (
      v_app_id,
      v_version,
      v_file->>'path',
      v_file->>'digest',
      (v_file->>'sizeBytes')::bigint,
      v_file->>'mediaType'
    );
  end loop;

  for v_dependency in
    select value from jsonb_array_elements(p_payload->'artifact'->'manifest'->'dependencies')
  loop
    insert into public.marketplace_app_dependencies (
      app_id, version, dependency_app_id, version_range, optional
    ) values (
      v_app_id,
      v_version,
      v_dependency->>'appId',
      v_dependency->>'version',
      coalesce((v_dependency->>'optional')::boolean, false)
    );
  end loop;

  for v_capability in
    select value from jsonb_array_elements(p_payload->'artifact'->'manifest'->'requiredCapabilities')
  loop
    insert into public.marketplace_app_connector_requirements (
      app_id, version, capability, requirement_mode
    ) values (v_app_id, v_version, v_capability #>> '{}', 'required');
  end loop;

  for v_capability in
    select value from jsonb_array_elements(p_payload->'artifact'->'manifest'->'optionalCapabilities')
  loop
    insert into public.marketplace_app_connector_requirements (
      app_id, version, capability, requirement_mode
    ) values (v_app_id, v_version, v_capability #>> '{}', 'optional');
  end loop;

  for v_preset in
    select value from jsonb_array_elements(p_payload->'artifact'->'manifest'->'presets')
  loop
    insert into public.marketplace_app_presets (
      app_id, version, preset_id, payload
    ) values (v_app_id, v_version, v_preset->>'id', v_preset);
  end loop;

  insert into public.marketplace_release_signatures (
    app_id, version, publisher_id, algorithm, key_id, public_key, signature_value
  ) values (
    v_app_id,
    v_version,
    v_publisher_id,
    p_payload->'artifact'->'provenance'->'signature'->>'algorithm',
    p_payload->'artifact'->'provenance'->'signature'->>'keyId',
    p_payload->'artifact'->'provenance'->'signature'->>'publicKey',
    p_payload->'artifact'->'provenance'->'signature'->>'value'
  );

  return jsonb_build_object(
    'appId', v_app_id,
    'version', v_version,
    'artifactDigest', v_artifact_digest,
    'releaseStatus', 'pending_verification',
    'created', true
  );
exception
  when invalid_text_representation or numeric_value_out_of_range or check_violation then
    raise exception 'invalid hosted marketplace publication';
end;
$$;

create or replace function public.attest_hosted_marketplace_release(
  p_app_id text,
  p_version text,
  p_artifact_digest text,
  p_manifest_digest text,
  p_file_index_digest text,
  p_verified_manifest jsonb,
  p_verified_file_index jsonb,
  p_verification_receipt_digest text,
  p_accepted boolean,
  p_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_release public.marketplace_app_versions%rowtype;
  v_target_status text;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception using errcode = '42501', message = 'trusted marketplace verifier required';
  end if;
  if p_artifact_digest !~ '^sha256:[a-f0-9]{64}$'
    or p_manifest_digest !~ '^sha256:[a-f0-9]{64}$'
    or p_file_index_digest !~ '^sha256:[a-f0-9]{64}$'
    or p_verification_receipt_digest !~ '^sha256:[a-f0-9]{64}$'
    or jsonb_typeof(p_verified_manifest) is distinct from 'object'
    or jsonb_typeof(p_verified_file_index) is distinct from 'array'
    or pg_column_size(p_verified_manifest) > 2097152
    or pg_column_size(p_verified_file_index) > 2097152
    or p_reason is not null and length(p_reason) > 1000 then
    raise exception 'invalid marketplace verification attestation';
  end if;

  select * into v_release
    from public.marketplace_app_versions
   where app_id = p_app_id and version = p_version
   for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'marketplace release not found';
  end if;
  if v_release.artifact_digest is distinct from p_artifact_digest
    or v_release.manifest_digest is distinct from p_manifest_digest
    or v_release.file_index_digest is distinct from p_file_index_digest
    or v_release.manifest_payload is distinct from p_verified_manifest
    or v_release.file_index_payload is distinct from p_verified_file_index then
    raise exception 'marketplace verification digest mismatch';
  end if;
  if v_release.release_status is distinct from 'pending_verification' then
    if v_release.verification_receipt_digest = p_verification_receipt_digest then
      return jsonb_build_object(
        'appId', p_app_id,
        'version', p_version,
        'artifactDigest', v_release.artifact_digest,
        'releaseStatus', v_release.release_status,
        'created', false
      );
    end if;
    raise exception 'marketplace release is no longer awaiting verification';
  end if;

  v_target_status := case when p_accepted then 'active' else 'rejected' end;
  update public.marketplace_app_versions
     set release_status = v_target_status,
         verified_at = case when p_accepted then now() else null end,
         verification_receipt_digest = p_verification_receipt_digest,
         status_message = case
           when p_accepted then null else coalesce(nullif(p_reason, ''), 'verification rejected')
         end,
         status_updated_at = now()
   where app_id = p_app_id and version = p_version;

  return jsonb_build_object(
    'appId', p_app_id,
    'version', p_version,
    'artifactDigest', p_artifact_digest,
    'releaseStatus', v_target_status,
    'created', true
  );
end;
$$;

create or replace function public.set_private_marketplace_release_status(
  p_organization_id uuid,
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
  v_actor_id uuid := auth.uid();
  v_release public.marketplace_app_versions%rowtype;
begin
  if v_actor_id is null then
    raise exception using errcode = '42501', message = 'authentication required';
  end if;
  if not private.can_manage_marketplace_app(p_app_id, p_organization_id) then
    raise exception using errcode = '42501', message = 'marketplace lifecycle permission denied';
  end if;
  if p_release_status not in ('deprecated', 'revoked')
    or nullif(p_reason, '') is null
    or length(p_reason) > 1000 then
    raise exception 'invalid marketplace release lifecycle transition';
  end if;
  select * into v_release
    from public.marketplace_app_versions
   where app_id = p_app_id and version = p_version
   for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'marketplace release not found';
  end if;
  if not (
    (v_release.release_status = 'active' and p_release_status in ('deprecated', 'revoked'))
    or (v_release.release_status = 'deprecated' and p_release_status = 'revoked')
    or v_release.release_status = p_release_status
  ) then
    raise exception 'invalid marketplace release lifecycle transition';
  end if;
  update public.marketplace_app_versions
     set release_status = p_release_status,
         status_message = p_reason,
         status_updated_at = now(),
         status_updated_by = v_actor_id
   where app_id = p_app_id and version = p_version;
  return jsonb_build_object(
    'appId', p_app_id,
    'version', p_version,
    'artifactDigest', v_release.artifact_digest,
    'releaseStatus', p_release_status,
    'created', v_release.release_status is distinct from p_release_status
  );
end;
$$;

create or replace function public.grant_private_marketplace_app_access(
  p_organization_id uuid,
  p_app_id text,
  p_grantee_organization_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_id uuid := auth.uid();
  v_created boolean := false;
begin
  if v_actor_id is null then
    raise exception using errcode = '42501', message = 'authentication required';
  end if;
  if not private.can_manage_marketplace_app(p_app_id, p_organization_id) then
    raise exception using errcode = '42501', message = 'private catalog access permission denied';
  end if;
  if p_grantee_organization_id = p_organization_id
    or not exists (select 1 from public.organizations where id = p_grantee_organization_id) then
    raise exception 'invalid private catalog grantee';
  end if;
  insert into public.private_catalog_access (
    app_id, owner_organization_id, grantee_organization_id, granted_by
  ) values (
    p_app_id, p_organization_id, p_grantee_organization_id, v_actor_id
  ) on conflict do nothing
  returning true into v_created;
  return jsonb_build_object(
    'appId', p_app_id,
    'granteeOrganizationId', p_grantee_organization_id,
    'granted', true,
    'created', coalesce(v_created, false)
  );
end;
$$;

create or replace function public.revoke_private_marketplace_app_access(
  p_organization_id uuid,
  p_app_id text,
  p_grantee_organization_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_deleted boolean := false;
begin
  if auth.uid() is null then
    raise exception using errcode = '42501', message = 'authentication required';
  end if;
  if not private.can_manage_marketplace_app(p_app_id, p_organization_id) then
    raise exception using errcode = '42501', message = 'private catalog access permission denied';
  end if;
  delete from public.private_catalog_access
   where app_id = p_app_id
     and owner_organization_id = p_organization_id
     and grantee_organization_id = p_grantee_organization_id
  returning true into v_deleted;
  return jsonb_build_object(
    'appId', p_app_id,
    'granteeOrganizationId', p_grantee_organization_id,
    'granted', false,
    'created', coalesce(v_deleted, false)
  );
end;
$$;

revoke all on function public.publish_private_marketplace_app_version(uuid, text, jsonb)
  from public, anon, authenticated, service_role;
revoke all on function public.attest_hosted_marketplace_release(text, text, text, text, text, jsonb, jsonb, text, boolean, text)
  from public, anon, authenticated, service_role;
revoke all on function public.set_private_marketplace_release_status(uuid, text, text, text, text)
  from public, anon, authenticated, service_role;
revoke all on function public.grant_private_marketplace_app_access(uuid, text, uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.revoke_private_marketplace_app_access(uuid, text, uuid)
  from public, anon, authenticated, service_role;

grant execute on function public.publish_private_marketplace_app_version(uuid, text, jsonb)
  to authenticated;
grant execute on function public.attest_hosted_marketplace_release(text, text, text, text, text, jsonb, jsonb, text, boolean, text)
  to service_role;
grant execute on function public.set_private_marketplace_release_status(uuid, text, text, text, text)
  to authenticated;
grant execute on function public.grant_private_marketplace_app_access(uuid, text, uuid)
  to authenticated;
grant execute on function public.revoke_private_marketplace_app_access(uuid, text, uuid)
  to authenticated;
