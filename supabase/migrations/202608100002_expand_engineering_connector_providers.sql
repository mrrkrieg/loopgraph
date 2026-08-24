-- Expand the reviewed Hermes Connector Broker allowlist for Engineering and
-- Product issue/release workflows. Provider IDs stay explicit so an arbitrary
-- string cannot create a credential namespace or installation record.

alter table public.connector_installations
  drop constraint if exists connector_installations_provider_check;

alter table public.connector_installations
  add constraint connector_installations_provider_check check (provider_id in (
    'hubspot', 'google_ads', 'slack', 'notion', 'salesforce', 'stripe', 'github',
    'zendesk', 'intercom', 'workday', 'greenhouse', 'netsuite', 'quickbooks',
    'gmail', 'google_calendar', 'outlook', 'teams', 'posthog', 'amplitude',
    'linear', 'jira', 'gitlab'
  ));

comment on constraint connector_installations_provider_check on public.connector_installations is
  'Reviewed Hermes Connector Broker provider adapters only; adding a provider requires schema, onboarding, capability, operation, normalization, fixture, webhook-security, and migration coverage.';
