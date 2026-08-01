-- Enterprise Hermes Connector Broker control-plane state.
-- Provider credentials are never stored in these tables: only opaque vault references.

create table if not exists public.connector_installations (
  id text not null,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  project_key text not null default 'default',
  provider_id text not null,
  display_name text not null,
  environment text not null default 'development',
  status text not null,
  credential_ref text not null,
  credential_namespace text not null,
  customer_managed_key_ref text,
  webhook_secret_ref text,
  webhook_secret_previous_ref text,
  provider_subscription_id text,
  webhook_status text not null default 'not_configured',
  granted_scopes text[] not null default '{}',
  allowed_capabilities text[] not null default '{}',
  connected_by text,
  connected_at timestamptz,
  last_health_check_at timestamptz,
  last_rotated_at timestamptz,
  token_expires_at timestamptz,
  refresh_lease_until timestamptz,
  refresh_attempt_count integer not null default 0,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (organization_id, project_key, id),
  unique (id),
  constraint connector_installations_project_key_check check (project_key ~ '^[a-z0-9][a-z0-9_-]{0,63}$'),
  constraint connector_installations_environment_check check (environment in ('development', 'staging', 'production')),
  constraint connector_installations_provider_check check (provider_id in (
    'hubspot', 'google_ads', 'slack', 'notion', 'salesforce', 'stripe', 'github',
    'zendesk', 'intercom', 'workday', 'greenhouse', 'netsuite', 'quickbooks'
  )),
  constraint connector_installations_status_check check (status in (
    'prepared', 'awaiting_consent', 'exchanging', 'connected', 'subscription_pending', 'active',
    'degraded', 'rotating', 'disabling', 'locally_disabled', 'provider_revocation_pending',
    'subscriptions_removing', 'revoking', 'revoked', 'deletion_pending', 'deleted',
    'disconnected', 'failed'
  )),
  constraint connector_installations_credential_ref_check check (
    credential_ref ~ '^(broker|hermes|aws-sm|gcp-sm|azure-kv|vault|keychain|env-ref)://'
    and credential_ref !~ '[?#]'
  ),
  constraint connector_installations_cmk_ref_check check (
    customer_managed_key_ref is null
    or (
      customer_managed_key_ref ~ '^(aws-kms|gcp-kms|azure-key|vault-transit)://'
      and customer_managed_key_ref !~ '[?#]'
    )
  ),
  constraint connector_installations_webhook_ref_check check (
    webhook_secret_ref is null
    or (
      webhook_secret_ref ~ '^(broker|hermes|aws-sm|gcp-sm|azure-kv|vault|keychain)://'
      and webhook_secret_ref !~ '[?#]'
    )
  ),
  constraint connector_installations_previous_webhook_ref_check check (
    webhook_secret_previous_ref is null
    or (
      webhook_secret_previous_ref ~ '^(broker|hermes|aws-sm|gcp-sm|azure-kv|vault|keychain)://'
      and webhook_secret_previous_ref !~ '[?#]'
    )
  ),
  constraint connector_installations_webhook_status_check check (
    webhook_status in ('not_configured', 'pending', 'active', 'degraded', 'revoked')
  ),
  constraint connector_installations_refresh_attempt_check check (refresh_attempt_count >= 0)
);

create index if not exists connector_installations_tenant_status_idx
  on public.connector_installations(organization_id, project_key, status, provider_id);

create table if not exists public.credential_namespaces (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  project_key text not null,
  namespace text not null,
  provider_id text not null,
  installation_id text not null,
  environment text not null,
  customer_managed_key_ref text,
  status text not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (organization_id, project_key, namespace),
  unique (organization_id, project_key, installation_id),
  foreign key (organization_id, project_key, installation_id)
    references public.connector_installations(organization_id, project_key, id) on delete cascade,
  constraint credential_namespace_status_check check (status in ('active', 'disabled', 'revoked')),
  constraint credential_namespace_environment_check check (environment in ('development', 'staging', 'production')),
  constraint credential_namespace_value_check check (namespace ~ '^organizations/[A-Za-z0-9._%-]+/projects/[a-z0-9][a-z0-9_-]{0,63}/environments/(development|staging|production)/providers/[a-z0-9_]+/installations/[A-Za-z0-9._%-]+$')
);

create table if not exists public.tenant_key_bindings (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  project_key text not null,
  environment text not null,
  key_provider text not null,
  key_reference text not null,
  key_version text,
  region text,
  data_residency_region text,
  provider_id text,
  status text not null default 'active',
  bound_by text not null,
  created_at timestamptz not null default now(),
  verified_at timestamptz,
  rotated_at timestamptz,
  revoked_at timestamptz,
  unique nulls not distinct (organization_id, project_key, environment, provider_id),
  constraint tenant_key_binding_environment_check check (environment in ('development', 'staging', 'production')),
  constraint tenant_key_binding_provider_check check (key_provider in ('aws-kms', 'gcp-kms', 'azure-key', 'vault-transit')),
  constraint tenant_key_binding_status_check check (status in ('active', 'rotating', 'revoked')),
  constraint tenant_key_binding_reference_check check (
    key_reference ~ '^(aws-kms|gcp-kms|azure-key|vault-transit)://' and key_reference !~ '[?#]'
  )
);

create table if not exists public.provider_credential_versions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  project_key text not null,
  installation_id text not null,
  version_number integer not null,
  credential_ref text not null,
  lifecycle_event text not null,
  status text not null default 'active',
  granted_scopes text[] not null default '{}',
  token_expires_at timestamptz,
  created_by text not null,
  created_at timestamptz not null default now(),
  retired_at timestamptz,
  revoked_at timestamptz,
  foreign key (organization_id, project_key, installation_id)
    references public.connector_installations(organization_id, project_key, id) on delete cascade,
  unique (organization_id, project_key, installation_id, version_number),
  constraint provider_credential_version_positive_check check (version_number > 0),
  constraint provider_credential_version_event_check check (lifecycle_event in ('connected', 'refreshed', 'rotated', 'recovered')),
  constraint provider_credential_version_status_check check (status in ('active', 'retired', 'revoked')),
  constraint provider_credential_version_ref_check check (
    credential_ref ~ '^(broker|hermes|aws-sm|gcp-sm|azure-kv|vault|keychain|env-ref)://' and credential_ref !~ '[?#]'
  )
);

create index if not exists provider_credential_versions_active_idx
  on public.provider_credential_versions(organization_id, project_key, installation_id, version_number desc)
  where status = 'active';

create table if not exists public.credential_access_receipts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  project_key text not null,
  installation_id text not null,
  credential_version integer,
  actor_type text not null,
  actor_id text not null,
  capability text not null,
  operation text not null,
  environment text,
  company_object_type text,
  company_object_id text,
  loop_id text,
  route_job_id text,
  decision text not null,
  reason_code text,
  correlation_id text not null,
  occurred_at timestamptz not null default now(),
  foreign key (organization_id, project_key, installation_id)
    references public.connector_installations(organization_id, project_key, id) on delete cascade,
  constraint credential_access_decision_check check (decision in ('accepted', 'denied', 'error')),
  constraint credential_access_actor_type_check check (actor_type in ('workload', 'user', 'system')),
  constraint credential_access_environment_check check (environment is null or environment in ('development', 'staging', 'production'))
);

create index if not exists credential_access_receipts_tenant_time_idx
  on public.credential_access_receipts(organization_id, project_key, occurred_at desc);

create table if not exists public.connector_oauth_transactions (
  id text primary key,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  project_key text not null,
  installation_id text not null,
  provider_id text not null,
  state_hash text not null,
  verifier_ref text,
  requested_scopes text[] not null default '{}',
  expires_at timestamptz not null,
  consumed_at timestamptz,
  created_at timestamptz not null default now(),
  unique (state_hash),
  foreign key (organization_id, project_key, installation_id)
    references public.connector_installations(organization_id, project_key, id) on delete cascade,
  constraint connector_oauth_state_hash_check check (state_hash ~ '^[a-f0-9]{64}$'),
  constraint connector_oauth_verifier_ref_check check (
    verifier_ref is null or (
      verifier_ref ~ '^(broker|hermes|aws-sm|gcp-sm|azure-kv|vault|keychain)://'
      and verifier_ref !~ '[?#]'
    )
  )
);

create index if not exists connector_oauth_expiry_idx
  on public.connector_oauth_transactions(expires_at)
  where consumed_at is null;

create table if not exists public.connector_operation_receipts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  project_key text not null,
  installation_id text not null,
  provider_id text not null,
  request_id text not null,
  idempotency_key text not null,
  correlation_id text not null,
  capability text not null,
  operation text not null,
  actor_subject text not null,
  actor_type text not null,
  context_hash text,
  environment text,
  workspace_id text,
  agent_instance_id text,
  company_object_type text,
  company_object_id text,
  loop_id text,
  loop_spec_hash text,
  route_job_id text,
  activation_mode text,
  outcome text not null,
  reason_code text,
  input_hash text not null,
  output_hash text,
  response jsonb not null,
  occurred_at timestamptz not null default now(),
  unique (organization_id, project_key, idempotency_key),
  constraint connector_receipt_outcome_check check (outcome in ('accepted', 'denied', 'error')),
  constraint connector_receipt_actor_type_check check (actor_type in ('workload', 'user', 'system')),
  constraint connector_receipt_context_hash_check check (context_hash is null or context_hash ~ '^[a-f0-9]{64}$'),
  constraint connector_receipt_environment_check check (environment is null or environment in ('development', 'staging', 'production')),
  constraint connector_receipt_loop_spec_hash_check check (loop_spec_hash is null or loop_spec_hash ~ '^[a-f0-9]{64}$'),
  constraint connector_receipt_activation_mode_check check (activation_mode is null or activation_mode in ('shadow', 'recommend', 'execute')),
  constraint connector_receipt_input_hash_check check (input_hash ~ '^[a-f0-9]{64}$'),
  constraint connector_receipt_output_hash_check check (output_hash is null or output_hash ~ '^[a-f0-9]{64}$')
);

create index if not exists connector_receipts_tenant_time_idx
  on public.connector_operation_receipts(organization_id, project_key, occurred_at desc);

create table if not exists public.connector_idempotency_claims (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  project_key text not null,
  idempotency_key text not null,
  request_hash text not null,
  status text not null default 'processing',
  lease_until timestamptz not null,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (organization_id, project_key, idempotency_key),
  constraint connector_idempotency_hash_check check (request_hash ~ '^[a-f0-9]{64}$'),
  constraint connector_idempotency_status_check check (status in ('processing', 'completed'))
);

create index if not exists connector_idempotency_lease_idx
  on public.connector_idempotency_claims(lease_until)
  where status = 'processing';

create table if not exists public.connector_prepared_actions (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  project_key text not null,
  action_id text not null,
  provider_id text not null,
  installation_id text not null,
  capability text not null,
  operation text not null,
  invocation_context jsonb not null,
  canonical_input jsonb not null,
  fingerprint text not null,
  prepared_by text not null,
  prepared_at timestamptz not null,
  expires_at timestamptz not null,
  status text not null default 'prepared',
  approval_required boolean not null default true,
  risk_class text not null,
  committed_at timestamptz,
  primary key (organization_id, project_key, action_id),
  foreign key (organization_id, project_key, installation_id)
    references public.connector_installations(organization_id, project_key, id) on delete cascade,
  constraint connector_prepared_action_fingerprint_check check (fingerprint ~ '^[a-f0-9]{64}$'),
  constraint connector_prepared_action_status_check check (status in ('prepared', 'committing', 'committed', 'expired', 'revoked')),
  constraint connector_prepared_action_risk_check check (risk_class in ('read', 'draft', 'write', 'privileged')),
  constraint connector_prepared_action_input_size_check check (octet_length(canonical_input::text) <= 262144),
  constraint connector_prepared_action_context_size_check check (octet_length(invocation_context::text) <= 32768)
);

create index if not exists connector_prepared_action_expiry_idx
  on public.connector_prepared_actions(expires_at)
  where status = 'prepared';

create table if not exists public.connector_action_approvals (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  project_key text not null,
  approval_id text not null,
  action_id text not null,
  fingerprint text not null,
  approved_by text not null,
  approved_at timestamptz not null default now(),
  expires_at timestamptz not null,
  status text not null default 'approved',
  consumed_at timestamptz,
  reason text not null,
  primary key (organization_id, project_key, approval_id),
  foreign key (organization_id, project_key, action_id)
    references public.connector_prepared_actions(organization_id, project_key, action_id) on delete cascade,
  constraint connector_action_approval_fingerprint_check check (fingerprint ~ '^[a-f0-9]{64}$'),
  constraint connector_action_approval_status_check check (status in ('approved', 'consumed', 'revoked', 'expired')),
  constraint connector_action_approval_reason_check check (length(reason) between 3 and 1000)
);

create index if not exists connector_action_approval_expiry_idx
  on public.connector_action_approvals(expires_at)
  where status = 'approved';

create table if not exists public.workload_principals (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  project_key text not null,
  credential_id text not null,
  issuer text not null,
  subject text not null,
  audience text not null,
  environment text not null,
  workload_type text not null,
  status text not null default 'active',
  not_before timestamptz,
  expires_at timestamptz,
  confirmation_key_thumbprint text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (organization_id, project_key, credential_id),
  unique (organization_id, project_key, issuer, subject, audience, environment),
  constraint workload_principal_status_check check (status in ('active', 'disabled', 'revoked', 'expired')),
  constraint workload_principal_environment_check check (environment in ('development', 'staging', 'production'))
);

create table if not exists public.workload_capability_grants (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  project_key text not null,
  credential_id text not null,
  capability text not null,
  connection_id text,
  environment text not null,
  status text not null default 'active',
  expires_at timestamptz,
  granted_by text not null,
  reason text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (organization_id, project_key, credential_id)
    references public.workload_principals(organization_id, project_key, credential_id) on delete cascade,
  unique nulls not distinct (organization_id, project_key, credential_id, capability, connection_id, environment),
  constraint workload_grant_status_check check (status in ('active', 'disabled', 'revoked', 'expired')),
  constraint workload_grant_environment_check check (environment in ('development', 'staging', 'production')),
  constraint workload_grant_reason_check check (length(reason) between 3 and 1000)
);

create table if not exists public.workload_identity_audit_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  project_key text not null,
  credential_id text not null,
  capability text not null,
  connection_id text,
  decision text not null,
  reason_code text not null,
  token_id_hash text,
  authentication_method text not null default 'jwt',
  occurred_at timestamptz not null default now(),
  constraint workload_identity_decision_check check (decision in ('accepted', 'denied')),
  constraint workload_identity_token_hash_check check (token_id_hash is null or token_id_hash ~ '^[a-f0-9]{64}$')
);

create index if not exists workload_identity_audit_tenant_time_idx
  on public.workload_identity_audit_events(organization_id, project_key, occurred_at desc);

create table if not exists public.workload_identity_replay_claims (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  project_key text not null,
  token_id_hash text not null,
  credential_id text not null,
  expires_at timestamptz not null,
  claimed_at timestamptz not null default now(),
  primary key (organization_id, project_key, token_id_hash),
  constraint workload_replay_token_hash_check check (token_id_hash ~ '^[a-f0-9]{64}$')
);

create index if not exists workload_identity_replay_expiry_idx
  on public.workload_identity_replay_claims(expires_at);

create table if not exists public.connector_kill_switches (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  project_key text not null,
  scope_type text not null,
  scope_value text not null,
  environment text,
  status text not null default 'active',
  reason text not null,
  activated_by text not null,
  activated_at timestamptz not null default now(),
  expires_at timestamptz,
  cleared_by text,
  cleared_at timestamptz,
  unique nulls not distinct (organization_id, project_key, scope_type, scope_value, environment),
  constraint connector_kill_switch_scope_check check (scope_type in ('organization', 'environment', 'provider', 'connection', 'capability', 'loop', 'agent')),
  constraint connector_kill_switch_status_check check (status in ('active', 'cleared', 'expired')),
  constraint connector_kill_switch_environment_check check (environment is null or environment in ('development', 'staging', 'production')),
  constraint connector_kill_switch_reason_check check (length(reason) between 3 and 1000)
);

create index if not exists connector_kill_switch_active_idx
  on public.connector_kill_switches(organization_id, project_key, scope_type, scope_value)
  where status = 'active';

create table if not exists public.provider_webhook_deliveries (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  project_key text not null,
  installation_id text not null,
  provider_id text not null,
  delivery_id text not null,
  body_hash text not null,
  status text not null default 'claimed',
  attempt_count integer not null default 1,
  leased_until timestamptz not null default (now() + interval '5 minutes'),
  forwarded_at timestamptz,
  last_error_code text,
  received_at timestamptz not null default now(),
  expires_at timestamptz not null,
  unique (organization_id, project_key, installation_id, provider_id, delivery_id),
  constraint provider_webhook_body_hash_check check (body_hash ~ '^[a-f0-9]{64}$'),
  constraint provider_webhook_status_check check (status in ('claimed', 'queued', 'forwarded', 'failed'))
);

create index if not exists provider_webhook_expiry_idx on public.provider_webhook_deliveries(expires_at);

create table if not exists public.provider_webhook_inbox (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  project_key text not null,
  installation_id text not null,
  provider_id text not null,
  delivery_id text not null,
  raw_body_base64 text not null,
  verification_receipt jsonb not null,
  status text not null default 'queued',
  attempt_count integer not null default 0,
  available_at timestamptz not null default now(),
  leased_until timestamptz,
  last_error_code text,
  forwarded_at timestamptz,
  created_at timestamptz not null default now(),
  unique (organization_id, project_key, installation_id, provider_id, delivery_id),
  foreign key (organization_id, project_key, installation_id)
    references public.connector_installations(organization_id, project_key, id) on delete cascade,
  constraint provider_webhook_inbox_status_check check (status in ('queued', 'leased', 'forwarded', 'dead_letter')),
  constraint provider_webhook_inbox_body_size_check check (octet_length(raw_body_base64) <= 1398104)
);

create index if not exists provider_webhook_inbox_queue_idx
  on public.provider_webhook_inbox(status, available_at)
  where status in ('queued', 'leased');

create table if not exists public.connector_revocation_jobs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  project_key text not null,
  installation_id text not null,
  requested_by text not null,
  reason text not null,
  emergency boolean not null default false,
  status text not null default 'queued',
  attempt_count integer not null default 0,
  available_at timestamptz not null default now(),
  leased_until timestamptz,
  last_error_code text,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  constraint connector_revocation_status_check check (status in ('queued', 'leased', 'completed', 'failed'))
);

create index if not exists connector_revocation_queue_idx
  on public.connector_revocation_jobs(status, available_at)
  where status in ('queued', 'leased');

do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'connector_installations',
    'credential_namespaces',
    'tenant_key_bindings',
    'provider_credential_versions',
    'credential_access_receipts',
    'connector_oauth_transactions',
    'connector_operation_receipts',
    'connector_idempotency_claims',
    'connector_prepared_actions',
    'connector_action_approvals',
    'workload_principals',
    'workload_capability_grants',
    'workload_identity_audit_events',
    'workload_identity_replay_claims',
    'connector_kill_switches',
    'provider_webhook_deliveries',
    'provider_webhook_inbox',
    'connector_revocation_jobs'
  ]
  loop
    execute format('alter table public.%I enable row level security', table_name);
    execute format('revoke all on public.%I from public, anon, authenticated', table_name);
    execute format('grant all on public.%I to service_role', table_name);
  end loop;
end
$$;

drop policy if exists connector_installations_member_select on public.connector_installations;
drop policy if exists connector_installations_admin_insert on public.connector_installations;
drop policy if exists connector_installations_admin_update on public.connector_installations;
drop policy if exists connector_installations_admin_delete on public.connector_installations;
drop policy if exists connector_receipts_member_select on public.connector_operation_receipts;
drop policy if exists connector_revocation_member_select on public.connector_revocation_jobs;
drop policy if exists connector_revocation_admin_insert on public.connector_revocation_jobs;

-- Connector control-plane tables are never exposed through the browser Supabase client.
-- Authenticated users reach them only through permission-checked server routes, which use
-- the service role after binding every query to the authenticated organization and project.

create or replace function private.consume_connector_oauth_transaction(
  p_organization_id uuid,
  p_project_key text,
  p_transaction_id text,
  p_consumed_at timestamptz
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.connector_oauth_transactions
  set consumed_at = p_consumed_at
  where organization_id = p_organization_id
    and project_key = p_project_key
    and id = p_transaction_id
    and consumed_at is null
    and expires_at >= p_consumed_at;
  return found;
end;
$$;

create or replace function private.claim_provider_webhook_delivery(
  p_organization_id uuid,
  p_project_key text,
  p_installation_id text,
  p_provider_id text,
  p_delivery_id text,
  p_body_hash text,
  p_expires_at timestamptz
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.provider_webhook_deliveries as delivery (
    organization_id, project_key, installation_id, provider_id, delivery_id, body_hash,
    status, attempt_count, leased_until, expires_at
  ) values (
    p_organization_id, p_project_key, p_installation_id, p_provider_id, p_delivery_id, p_body_hash,
    'claimed', 1, now() + interval '5 minutes', p_expires_at
  ) on conflict (organization_id, project_key, installation_id, provider_id, delivery_id)
  do update set
    status = 'claimed',
    attempt_count = delivery.attempt_count + 1,
    leased_until = now() + interval '5 minutes',
    last_error_code = null
  where delivery.body_hash = excluded.body_hash
    and (delivery.status = 'failed' or delivery.leased_until < now());
  return found;
end;
$$;

revoke all on function private.consume_connector_oauth_transaction(uuid, text, text, timestamptz) from public, anon, authenticated;
revoke all on function private.claim_provider_webhook_delivery(uuid, text, text, text, text, text, timestamptz) from public, anon, authenticated;
grant execute on function private.consume_connector_oauth_transaction(uuid, text, text, timestamptz) to service_role;
grant execute on function private.claim_provider_webhook_delivery(uuid, text, text, text, text, text, timestamptz) to service_role;

create or replace function public.consume_connector_oauth_transaction(
  p_organization_id uuid,
  p_project_key text,
  p_transaction_id text,
  p_consumed_at timestamptz
)
returns boolean
language sql
security definer
set search_path = ''
as $$
  select private.consume_connector_oauth_transaction(
    p_organization_id, p_project_key, p_transaction_id, p_consumed_at
  );
$$;

create or replace function public.claim_provider_webhook_delivery(
  p_organization_id uuid,
  p_project_key text,
  p_installation_id text,
  p_provider_id text,
  p_delivery_id text,
  p_body_hash text,
  p_expires_at timestamptz
)
returns boolean
language sql
security definer
set search_path = ''
as $$
  select private.claim_provider_webhook_delivery(
    p_organization_id, p_project_key, p_installation_id, p_provider_id,
    p_delivery_id, p_body_hash, p_expires_at
  );
$$;

revoke all on function public.consume_connector_oauth_transaction(uuid, text, text, timestamptz) from public, anon, authenticated;
revoke all on function public.claim_provider_webhook_delivery(uuid, text, text, text, text, text, timestamptz) from public, anon, authenticated;
grant execute on function public.consume_connector_oauth_transaction(uuid, text, text, timestamptz) to service_role;
grant execute on function public.claim_provider_webhook_delivery(uuid, text, text, text, text, text, timestamptz) to service_role;

create or replace function public.claim_connector_refresh_due(
  p_before timestamptz,
  p_limit integer,
  p_now timestamptz
)
returns setof public.connector_installations
language plpgsql
security definer
set search_path = ''
as $$
begin
  return query
  with candidates as (
    select installation.organization_id, installation.project_key, installation.id
    from public.connector_installations installation
    where installation.token_expires_at is not null
      and installation.token_expires_at <= p_before
      and (
        (installation.status in ('connected', 'active', 'degraded')
          and (installation.refresh_lease_until is null or installation.refresh_lease_until < p_now))
        or (installation.status = 'rotating' and installation.refresh_lease_until < p_now)
      )
      and not exists (
        select 1 from public.connector_kill_switches kill_switch
        where kill_switch.organization_id = installation.organization_id
          and kill_switch.project_key = installation.project_key
          and kill_switch.status = 'active'
          and (kill_switch.expires_at is null or kill_switch.expires_at >= p_now)
          and (kill_switch.environment is null or kill_switch.environment = installation.environment)
          and (
            kill_switch.scope_type = 'organization'
            or (kill_switch.scope_type = 'environment' and kill_switch.scope_value = installation.environment)
            or (kill_switch.scope_type = 'provider' and kill_switch.scope_value = installation.provider_id)
            or (kill_switch.scope_type = 'connection' and kill_switch.scope_value = installation.id)
          )
      )
    order by installation.token_expires_at asc
    for update skip locked
    limit least(greatest(p_limit, 1), 100)
  ), claimed as (
    update public.connector_installations installation
    set status = 'rotating',
        refresh_lease_until = p_now + interval '5 minutes',
        refresh_attempt_count = installation.refresh_attempt_count + 1,
        updated_at = p_now
    from candidates
    where installation.organization_id = candidates.organization_id
      and installation.project_key = candidates.project_key
      and installation.id = candidates.id
    returning installation.*
  )
  select * from claimed;
end;
$$;

revoke all on function public.claim_connector_refresh_due(timestamptz, integer, timestamptz)
  from public, anon, authenticated;
grant execute on function public.claim_connector_refresh_due(timestamptz, integer, timestamptz)
  to service_role;

create or replace function public.claim_provider_webhook_inbox(
  p_limit integer default 20,
  p_lease_seconds integer default 60
)
returns setof public.provider_webhook_inbox
language plpgsql
security definer
set search_path = ''
as $$
begin
  return query
  with candidates as (
    select item.id
    from public.provider_webhook_inbox item
    where (
      item.status = 'queued'
      or (item.status = 'leased' and item.leased_until < now())
    ) and item.available_at <= now()
    order by item.created_at
    for update skip locked
    limit least(greatest(p_limit, 1), 100)
  )
  update public.provider_webhook_inbox item
  set status = 'leased',
      leased_until = now() + make_interval(secs => least(greatest(p_lease_seconds, 10), 300)),
      attempt_count = item.attempt_count + 1
  from candidates
  where item.id = candidates.id
  returning item.*;
end;
$$;

revoke all on function public.claim_provider_webhook_inbox(integer, integer) from public, anon, authenticated;
grant execute on function public.claim_provider_webhook_inbox(integer, integer) to service_role;

create or replace function public.claim_connector_idempotency(
  p_organization_id uuid,
  p_project_key text,
  p_idempotency_key text,
  p_request_hash text,
  p_lease_until timestamptz
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  existing public.connector_idempotency_claims%rowtype;
begin
  insert into public.connector_idempotency_claims (
    organization_id, project_key, idempotency_key, request_hash, lease_until
  ) values (
    p_organization_id, p_project_key, p_idempotency_key, p_request_hash, p_lease_until
  ) on conflict (organization_id, project_key, idempotency_key) do nothing;
  if found then return 'claimed'; end if;

  select * into existing
  from public.connector_idempotency_claims
  where organization_id = p_organization_id
    and project_key = p_project_key
    and idempotency_key = p_idempotency_key
  for update;
  if existing.request_hash <> p_request_hash then return 'conflict'; end if;
  if existing.status = 'completed' or existing.lease_until >= now() then return 'busy'; end if;

  update public.connector_idempotency_claims
  set lease_until = p_lease_until,
      updated_at = now()
  where organization_id = p_organization_id
    and project_key = p_project_key
    and idempotency_key = p_idempotency_key;
  return 'claimed';
end;
$$;

revoke all on function public.claim_connector_idempotency(uuid, text, text, text, timestamptz)
  from public, anon, authenticated;
grant execute on function public.claim_connector_idempotency(uuid, text, text, text, timestamptz)
  to service_role;

create or replace function public.claim_connector_prepared_action(
  p_organization_id uuid,
  p_project_key text,
  p_action_id text,
  p_fingerprint text,
  p_now timestamptz
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  action public.connector_prepared_actions%rowtype;
begin
  select * into action
  from public.connector_prepared_actions
  where organization_id = p_organization_id
    and project_key = p_project_key
    and action_id = p_action_id
  for update;
  if not found then return 'missing'; end if;
  if action.fingerprint <> p_fingerprint then return 'mismatch'; end if;
  if action.expires_at < p_now then
    update public.connector_prepared_actions
    set status = 'expired'
    where organization_id = p_organization_id and project_key = p_project_key and action_id = p_action_id;
    return 'expired';
  end if;
  if action.status = 'committed' then return 'completed'; end if;
  if action.status = 'committing' then return 'busy'; end if;
  if action.status <> 'prepared' then return 'expired'; end if;
  update public.connector_prepared_actions
  set status = 'committing'
  where organization_id = p_organization_id and project_key = p_project_key and action_id = p_action_id;
  return 'claimed';
end;
$$;

revoke all on function public.claim_connector_prepared_action(uuid, text, text, text, timestamptz)
  from public, anon, authenticated;
grant execute on function public.claim_connector_prepared_action(uuid, text, text, text, timestamptz)
  to service_role;

create or replace function public.consume_connector_action_approval(
  p_organization_id uuid,
  p_project_key text,
  p_approval_id text,
  p_action_id text,
  p_fingerprint text,
  p_now timestamptz
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.connector_action_approvals
  set status = 'consumed', consumed_at = p_now
  where organization_id = p_organization_id
    and project_key = p_project_key
    and approval_id = p_approval_id
    and action_id = p_action_id
    and fingerprint = p_fingerprint
    and status = 'approved'
    and expires_at >= p_now;
  return found;
end;
$$;

revoke all on function public.consume_connector_action_approval(uuid, text, text, text, text, timestamptz)
  from public, anon, authenticated;
grant execute on function public.consume_connector_action_approval(uuid, text, text, text, text, timestamptz)
  to service_role;

create or replace function public.authorize_connector_workload(
  p_organization_id uuid,
  p_project_key text,
  p_credential_id text,
  p_issuer text,
  p_subject text,
  p_audience text,
  p_environment text,
  p_capability text,
  p_connection_id text,
  p_token_id_hash text,
  p_confirmation_key_thumbprint text,
  p_now timestamptz
)
returns table (authorized boolean, reason text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  principal_ok boolean;
  grant_ok boolean;
  token_claimed boolean := true;
  token_claim_count integer := 0;
  decision_reason text;
begin
  select exists (
    select 1 from public.workload_principals principal
    where principal.organization_id = p_organization_id
      and principal.project_key = p_project_key
      and principal.credential_id = p_credential_id
      and principal.issuer = p_issuer
      and principal.subject = p_subject
      and principal.audience = p_audience
      and principal.environment = p_environment
      and principal.status = 'active'
      and (
        principal.confirmation_key_thumbprint is null
        or principal.confirmation_key_thumbprint = p_confirmation_key_thumbprint
      )
      and (principal.not_before is null or principal.not_before <= p_now)
      and (principal.expires_at is null or principal.expires_at >= p_now)
  ) into principal_ok;

  select exists (
    select 1 from public.workload_capability_grants grant_row
    where grant_row.organization_id = p_organization_id
      and grant_row.project_key = p_project_key
      and grant_row.credential_id = p_credential_id
      and grant_row.capability = p_capability
      and grant_row.environment = p_environment
      and grant_row.status = 'active'
      and (grant_row.connection_id is null or grant_row.connection_id = p_connection_id)
      and (grant_row.expires_at is null or grant_row.expires_at >= p_now)
  ) into grant_ok;

  if p_token_id_hash is not null then
    insert into public.workload_identity_replay_claims (
      organization_id, project_key, token_id_hash, credential_id, expires_at, claimed_at
    ) values (
      p_organization_id, p_project_key, p_token_id_hash, p_credential_id, p_now + interval '10 minutes', p_now
    ) on conflict (organization_id, project_key, token_id_hash) do nothing;
    get diagnostics token_claim_count = row_count;
    token_claimed := token_claim_count = 1;
  end if;

  decision_reason := case
    when not token_claimed then 'token_replayed'
    when not principal_ok then 'principal_not_active'
    when not grant_ok then 'workload_capability_not_granted'
    else 'accepted'
  end;
  insert into public.workload_identity_audit_events (
    organization_id, project_key, credential_id, capability, connection_id,
    decision, reason_code, token_id_hash, authentication_method, occurred_at
  ) values (
    p_organization_id, p_project_key, p_credential_id, p_capability, p_connection_id,
    case when token_claimed and principal_ok and grant_ok then 'accepted' else 'denied' end,
    decision_reason, p_token_id_hash,
    case when p_confirmation_key_thumbprint is null then 'jwt' else 'mtls_bound_jwt' end,
    p_now
  );
  return query select token_claimed and principal_ok and grant_ok, decision_reason;
end;
$$;

revoke all on function public.authorize_connector_workload(uuid, text, text, text, text, text, text, text, text, text, text, timestamptz)
  from public, anon, authenticated;
grant execute on function public.authorize_connector_workload(uuid, text, text, text, text, text, text, text, text, text, text, timestamptz)
  to service_role;

create or replace function public.record_provider_credential_version(
  p_organization_id uuid,
  p_project_key text,
  p_installation_id text,
  p_credential_ref text,
  p_lifecycle_event text,
  p_granted_scopes text[],
  p_token_expires_at timestamptz,
  p_created_by text,
  p_now timestamptz
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  next_version integer;
begin
  perform pg_advisory_xact_lock(hashtextextended(
    p_organization_id::text || ':' || p_project_key || ':' || p_installation_id,
    0
  ));
  update public.provider_credential_versions
  set status = 'retired', retired_at = p_now
  where organization_id = p_organization_id
    and project_key = p_project_key
    and installation_id = p_installation_id
    and status = 'active';
  select coalesce(max(version_number), 0) + 1 into next_version
  from public.provider_credential_versions
  where organization_id = p_organization_id
    and project_key = p_project_key
    and installation_id = p_installation_id;
  insert into public.provider_credential_versions (
    organization_id, project_key, installation_id, version_number,
    credential_ref, lifecycle_event, status, granted_scopes,
    token_expires_at, created_by, created_at
  ) values (
    p_organization_id, p_project_key, p_installation_id, next_version,
    p_credential_ref, p_lifecycle_event, 'active', coalesce(p_granted_scopes, '{}'),
    p_token_expires_at, p_created_by, p_now
  );
  return next_version;
end;
$$;

revoke all on function public.record_provider_credential_version(uuid, text, text, text, text, text[], timestamptz, text, timestamptz)
  from public, anon, authenticated;
grant execute on function public.record_provider_credential_version(uuid, text, text, text, text, text[], timestamptz, text, timestamptz)
  to service_role;

create or replace function public.activate_provider_credential_version(
  p_organization_id uuid,
  p_project_key text,
  p_installation_id text,
  p_credential_ref text,
  p_lifecycle_event text,
  p_status text,
  p_granted_scopes text[],
  p_allowed_capabilities text[],
  p_connected_by text,
  p_connected_at timestamptz,
  p_last_rotated_at timestamptz,
  p_token_expires_at timestamptz,
  p_created_by text,
  p_now timestamptz
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  activated_version integer;
begin
  select public.record_provider_credential_version(
    p_organization_id, p_project_key, p_installation_id, p_credential_ref,
    p_lifecycle_event, p_granted_scopes, p_token_expires_at, p_created_by, p_now
  ) into activated_version;
  update public.connector_installations
  set credential_ref = p_credential_ref,
      status = p_status,
      granted_scopes = coalesce(p_granted_scopes, '{}'),
      allowed_capabilities = coalesce(p_allowed_capabilities, '{}'),
      connected_by = coalesce(p_connected_by, connected_by),
      connected_at = coalesce(p_connected_at, connected_at),
      last_rotated_at = coalesce(p_last_rotated_at, last_rotated_at),
      token_expires_at = p_token_expires_at,
      refresh_lease_until = null,
      updated_at = p_now
  where organization_id = p_organization_id
    and project_key = p_project_key
    and id = p_installation_id;
  if not found then raise exception 'connector installation was not found'; end if;
  return activated_version;
end;
$$;

revoke all on function public.activate_provider_credential_version(uuid, text, text, text, text, text, text[], text[], text, timestamptz, timestamptz, timestamptz, text, timestamptz)
  from public, anon, authenticated;
grant execute on function public.activate_provider_credential_version(uuid, text, text, text, text, text, text[], text[], text, timestamptz, timestamptz, timestamptz, text, timestamptz)
  to service_role;

create or replace function public.evaluate_connector_kill_switch(
  p_organization_id uuid,
  p_project_key text,
  p_environment text,
  p_provider_id text,
  p_connection_id text,
  p_capability text,
  p_loop_id text,
  p_agent_id text,
  p_now timestamptz
)
returns text
language sql
security definer
set search_path = ''
as $$
  select kill_switch.scope_type || ':' || kill_switch.scope_value
  from public.connector_kill_switches kill_switch
  where kill_switch.organization_id = p_organization_id
    and kill_switch.project_key = p_project_key
    and kill_switch.status = 'active'
    and (kill_switch.expires_at is null or kill_switch.expires_at >= p_now)
    and (kill_switch.environment is null or kill_switch.environment = p_environment)
    and (
      (kill_switch.scope_type = 'organization' and kill_switch.scope_value = p_organization_id::text)
      or (kill_switch.scope_type = 'environment' and kill_switch.scope_value = p_environment)
      or (kill_switch.scope_type = 'provider' and kill_switch.scope_value = p_provider_id)
      or (kill_switch.scope_type = 'connection' and kill_switch.scope_value = p_connection_id)
      or (kill_switch.scope_type = 'capability' and kill_switch.scope_value = p_capability)
      or (kill_switch.scope_type = 'loop' and kill_switch.scope_value = p_loop_id)
      or (kill_switch.scope_type = 'agent' and kill_switch.scope_value = p_agent_id)
    )
  order by case kill_switch.scope_type
    when 'organization' then 1 when 'environment' then 2 when 'provider' then 3
    when 'connection' then 4 when 'capability' then 5 when 'loop' then 6 else 7 end
  limit 1;
$$;

revoke all on function public.evaluate_connector_kill_switch(uuid, text, text, text, text, text, text, text, timestamptz)
  from public, anon, authenticated;
grant execute on function public.evaluate_connector_kill_switch(uuid, text, text, text, text, text, text, text, timestamptz)
  to service_role;

create or replace function public.disable_connector_locally(
  p_organization_id uuid,
  p_project_key text,
  p_installation_id text,
  p_requested_by text,
  p_reason text,
  p_now timestamptz
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  if length(trim(p_reason)) < 3 or length(p_reason) > 1000 then
    raise exception 'invalid disable reason';
  end if;
  perform 1 from public.connector_installations installation
  where installation.organization_id = p_organization_id
    and installation.project_key = p_project_key
    and installation.id = p_installation_id
  for update;
  if not found then return false; end if;

  insert into public.connector_kill_switches (
    organization_id, project_key, scope_type, scope_value, environment,
    status, reason, activated_by, activated_at, expires_at, cleared_by, cleared_at
  ) values (
    p_organization_id, p_project_key, 'connection', p_installation_id, null,
    'active', p_reason, p_requested_by, p_now, null, null, null
  )
  on conflict (organization_id, project_key, scope_type, scope_value, environment)
  do update set status = 'active', reason = excluded.reason, activated_by = excluded.activated_by,
    activated_at = excluded.activated_at, expires_at = null, cleared_by = null, cleared_at = null;

  update public.connector_installations
  set status = 'locally_disabled', allowed_capabilities = '{}', updated_at = p_now
  where organization_id = p_organization_id and project_key = p_project_key and id = p_installation_id;
  update public.connector_prepared_actions
  set status = 'revoked'
  where organization_id = p_organization_id and project_key = p_project_key
    and installation_id = p_installation_id and status in ('prepared', 'committing');
  update public.connector_action_approvals approval
  set status = 'revoked'
  where approval.organization_id = p_organization_id and approval.project_key = p_project_key
    and approval.status = 'approved' and exists (
      select 1 from public.connector_prepared_actions action
      where action.organization_id = approval.organization_id and action.project_key = approval.project_key
        and action.action_id = approval.action_id and action.installation_id = p_installation_id
    );
  return true;
end;
$$;

revoke all on function public.disable_connector_locally(uuid, text, text, text, text, timestamptz)
  from public, anon, authenticated;
grant execute on function public.disable_connector_locally(uuid, text, text, text, text, timestamptz)
  to service_role;

create or replace function public.locally_disable_connector(
  p_organization_id uuid,
  p_project_key text,
  p_installation_id text,
  p_requested_by text,
  p_reason text,
  p_emergency boolean,
  p_now timestamptz
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  revocation_job_id uuid;
begin
  if length(trim(p_reason)) < 3 or length(p_reason) > 1000 then
    raise exception 'invalid revocation reason';
  end if;

  perform 1
  from public.connector_installations installation
  where installation.organization_id = p_organization_id
    and installation.project_key = p_project_key
    and installation.id = p_installation_id
  for update;
  if not found then raise exception 'connector installation was not found'; end if;

  insert into public.connector_kill_switches (
    organization_id, project_key, scope_type, scope_value, environment,
    status, reason, activated_by, activated_at, expires_at, cleared_by, cleared_at
  ) values (
    p_organization_id, p_project_key, 'connection', p_installation_id, null,
    'active', p_reason, p_requested_by, p_now, null, null, null
  )
  on conflict (organization_id, project_key, scope_type, scope_value, environment)
  do update set
    status = 'active', reason = excluded.reason, activated_by = excluded.activated_by,
    activated_at = excluded.activated_at, expires_at = null, cleared_by = null, cleared_at = null;

  update public.connector_installations
  set status = 'revoking', allowed_capabilities = '{}', updated_at = p_now
  where organization_id = p_organization_id
    and project_key = p_project_key
    and id = p_installation_id;

  update public.connector_prepared_actions
  set status = 'revoked'
  where organization_id = p_organization_id
    and project_key = p_project_key
    and installation_id = p_installation_id
    and status in ('prepared', 'committing');

  update public.connector_action_approvals approval
  set status = 'revoked'
  where approval.organization_id = p_organization_id
    and approval.project_key = p_project_key
    and approval.status = 'approved'
    and exists (
      select 1 from public.connector_prepared_actions action
      where action.organization_id = approval.organization_id
        and action.project_key = approval.project_key
        and action.action_id = approval.action_id
        and action.installation_id = p_installation_id
    );

  insert into public.connector_revocation_jobs (
    organization_id, project_key, installation_id, requested_by,
    reason, emergency, status, available_at, created_at
  ) values (
    p_organization_id, p_project_key, p_installation_id, p_requested_by,
    p_reason, p_emergency, 'queued', p_now, p_now
  ) returning id into revocation_job_id;

  return revocation_job_id;
end;
$$;

revoke all on function public.locally_disable_connector(uuid, text, text, text, text, boolean, timestamptz)
  from public, anon, authenticated;
grant execute on function public.locally_disable_connector(uuid, text, text, text, text, boolean, timestamptz)
  to service_role;

create or replace function public.claim_connector_revocation_jobs(
  p_limit integer default 20,
  p_lease_seconds integer default 60
)
returns setof public.connector_revocation_jobs
language plpgsql
security definer
set search_path = ''
as $$
begin
  return query
  with candidates as (
    select job.id
    from public.connector_revocation_jobs job
    where job.status = 'queued'
      and job.available_at <= now()
      and (job.leased_until is null or job.leased_until < now())
    order by job.emergency desc, job.created_at
    for update skip locked
    limit least(greatest(p_limit, 1), 100)
  )
  update public.connector_revocation_jobs job
  set status = 'leased',
      leased_until = now() + make_interval(secs => least(greatest(p_lease_seconds, 10), 300)),
      attempt_count = attempt_count + 1
  from candidates
  where job.id = candidates.id
  returning job.*;
end;
$$;

revoke all on function public.claim_connector_revocation_jobs(integer, integer) from public, anon, authenticated;
grant execute on function public.claim_connector_revocation_jobs(integer, integer) to service_role;

create or replace function public.append_connector_security_audit_event(
  p_organization_id uuid,
  p_project_key text,
  p_event_type text,
  p_outcome text,
  p_actor_type text,
  p_actor_id text,
  p_correlation_id text,
  p_resource_type text,
  p_resource_id text,
  p_metadata jsonb default '{}'::jsonb
)
returns table (sequence_number bigint, event_id uuid, event_hash text)
language sql
security definer
set search_path = ''
as $$
  select * from private.append_security_audit_event(
    p_organization_id,
    p_project_key,
    p_event_type,
    p_outcome,
    p_actor_type,
    p_actor_id,
    null,
    null,
    p_correlation_id,
    'connector-admin',
    p_resource_type,
    p_resource_id,
    p_metadata
  );
$$;

revoke all on function public.append_connector_security_audit_event(uuid, text, text, text, text, text, text, text, text, jsonb)
  from public, anon, authenticated;
grant execute on function public.append_connector_security_audit_event(uuid, text, text, text, text, text, text, text, text, jsonb)
  to service_role;

create or replace function public.reject_connector_receipt_mutation()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  raise exception 'connector operation receipts are append-only';
end;
$$;

drop trigger if exists connector_operation_receipts_immutable on public.connector_operation_receipts;
create trigger connector_operation_receipts_immutable
before update or delete on public.connector_operation_receipts
for each row execute function public.reject_connector_receipt_mutation();
