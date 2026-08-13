-- Expand the reviewed Hermes Connector Broker allowlist for bounded warehouse
-- evidence used by Management and Operations/Finance LoopPacks. Provider IDs
-- remain explicit and the adapters expose only configured read templates.

alter table public.connector_installations
  drop constraint if exists connector_installations_provider_check;

alter table public.connector_installations
  add constraint connector_installations_provider_check check (provider_id in (
    'hubspot', 'google_ads', 'slack', 'notion', 'salesforce', 'stripe', 'github',
    'zendesk', 'intercom', 'workday', 'greenhouse', 'netsuite', 'quickbooks',
    'gmail', 'google_calendar', 'outlook', 'teams', 'posthog', 'amplitude',
    'linear', 'jira', 'gitlab', 'bigquery', 'snowflake'
  ));

comment on constraint connector_installations_provider_check on public.connector_installations is
  'Reviewed Hermes Connector Broker provider adapters only; adding a provider requires schema, onboarding, capability, bounded operation, normalization, fixture, and migration coverage.';
