-- Bound pre-install App onboarding drafts inside the existing tenant-scoped,
-- revision-leased installation registry. Application validation remains the
-- authoritative strict schema and secret boundary; this database constraint
-- adds an independent collection and payload-size ceiling.

update public.loopgraph_app_installation_registries
set registry_payload = registry_payload || jsonb_build_object('onboardingDrafts', '[]'::jsonb)
where registry_payload->'onboardingDrafts' is null;

alter table public.loopgraph_app_installation_registries
  add constraint loopgraph_app_onboarding_drafts_shape
  check (
    jsonb_typeof(registry_payload->'onboardingDrafts') = 'array'
    and jsonb_array_length(registry_payload->'onboardingDrafts') <= 50
    and pg_column_size(registry_payload->'onboardingDrafts') <= 1048576
  );

comment on constraint loopgraph_app_onboarding_drafts_shape
  on public.loopgraph_app_installation_registries is
  'Pre-install drafts are tenant-scoped, revision-fenced, bounded snapshots; credentials and provider payloads are rejected by the shared App service before this registry can commit.';
