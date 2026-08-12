# Hermes provider onboarding

The Hermes Connector Broker owns authorization, signing secrets, webhook/stream verification, and capability-scoped provider execution. Hermes owns semantic routing and loop execution. Loopgraph owns the versioned non-secret contract, normalized event boundary, canonical entity mapping, routing validation, and durable evidence.

## Supported contracts

| Provider | Authorization | Broker intake feeding Hermes |
| --- | --- | --- |
| HubSpot | OAuth 2.0 + PKCE | Webhook API subscriptions |
| Google Ads | OAuth 2.0 + PKCE | Scheduled anomaly detector |
| Slack | OAuth 2.0 + PKCE | Events API route |
| Notion | OAuth 2.0 + PKCE | Provider-console webhook |
| Salesforce | OAuth 2.0 + PKCE | Change Data Capture stream |
| Stripe | OAuth 2.0 | Webhook endpoint API |
| GitHub | GitHub App | App webhook |
| Zendesk | Admin-managed API identity | Provider-console webhook |
| Intercom | OAuth 2.0 + PKCE | Subscription API |
| Workday | Admin-managed connected app | Enterprise event route |
| Greenhouse | OAuth 2.0 + PKCE | Webhook API |
| NetSuite | Admin-managed connected app | Enterprise event route |
| QuickBooks | Admin-managed connected app | Provider-console webhook |
| Gmail | OAuth 2.0 + PKCE | Scheduled thread detector |
| Google Calendar | OAuth 2.0 + PKCE | Scheduled event detector |
| Microsoft Outlook | Microsoft identity OAuth 2.0 + PKCE | Microsoft Graph change notifications |
| Microsoft Teams | Microsoft identity OAuth 2.0 + PKCE | Microsoft Graph change notifications |
| PostHog | Admin-managed project API key | Scheduled saved-insight detector |
| Amplitude | Admin-managed project API + secret key | Scheduled event-metric detector |
| Linear | OAuth 2.0 + PKCE app actor | OAuth app organization webhooks |
| Jira Cloud | Atlassian OAuth 2.0 (3LO) + PKCE | Renewable dynamic webhooks |
| GitLab.com | OAuth 2.0 + PKCE | Project or group webhooks |

The executable source of truth is `PROVIDER_ONBOARDING_CATALOG`; the matching synthetic payloads are `PROVIDER_GOLDEN_FIXTURES`.

## Hermes flow

1. Call `loopgraph_provider_catalog_get` and choose a profile.
2. Call `loopgraph_provider_install_prepare` for a non-secret plan, or open **Settings → Integrations** to start live consent.
3. The broker generates OAuth state and PKCE, writes one-time material directly to the configured tenant vault, and returns only the provider authorization URL.
4. The broker consumes the callback once, exchanges the code at the catalog's fixed token endpoint, and writes the token bundle under the opaque `credentialRef`.
5. Apply the declared subscription API, event stream, provider-console route, or scheduled detector through a capability-scoped broker operation.
6. Send provider webhooks to `/api/connector-broker/v1/webhooks/{installationId}`. The installation selects the verifier; provider identity is never trusted from the webhook body or URL. The broker verifies the raw body, timestamp, and replay identity before normalization.
7. The broker sends the verified normalized `EventEnvelope` to Hermes using workload identity; Hermes decides which eligible loop should handle it.
8. Register only non-secret consent, scope, capability, health, and audit receipts with Loopgraph.
9. In **Settings → Integrations**, register the Hermes workload principal and grant only the exact
   provider capability and connection it needs. Use the hierarchical kill-switch panel for incident containment.

Provider application registration, admin consent, callback-domain verification, and live subscription calls require credentials in the operator's provider tenant. The repository provides the executable contract and tests; it cannot manufacture those external grants.

Default Gmail and Microsoft consent is read-only. Compose, send, or channel-post scopes require a separate capability escalation and are never inferred from installing an app. Google classifies broad server-side Gmail read and compose scopes as restricted, so a hosted public deployment must complete Google's applicable verification and security assessment before enabling them. Microsoft Graph notifications are accepted only when every notification in the batch contains the installation's secret `clientState`; endpoint validation echoes an opaque validation token only for an existing Outlook or Teams installation in a subscription-capable lifecycle state. PostHog reads saved insight IDs rather than accepting arbitrary HogQL, and Amplitude uses its fixed event-segmentation endpoint with a project-scoped API/secret-key pair.

Linear, Jira, and GitLab also begin read-only. Linear receives only the fixed issue/project queries declared by the broker; its replay identity comes from the provider-signed raw body instead of a mutable header. Jira uses `api.atlassian.com/ex/jira/{cloudId}`, never accepts arbitrary JQL or a caller-provided site URL, and requires an installation-bound callback parameter in addition to Atlassian's app JWT. The built-in GitLab adapter is fixed to `gitlab.com`. Linear issue mutations and Jira issue mutations exist as approval-bound broker operations, but they remain unavailable until a separate consent escalation grants the matching write scope. GitLab Self-Managed requires a reviewed custom connector with an explicit hostname policy rather than reusing a customer-controlled base URL.

## Security invariants

- Start read-only. Add write scopes only for an accepted LoopSpec with an approval-bound action fingerprint.
- One external provider route can feed many loops. Never create one public webhook per loop.
- Reject unsigned or stale deliveries before normalization.
- Do not persist raw HR records, message bodies, OAuth codes, tokens, client secrets, or signing keys in Loopgraph.
- Entity resolution uses exact provider aliases and deterministic keys. Ambiguous matches abstain; fuzzy automatic merges are disabled.
- Replayed provider deliveries preserve the same event/problem identity so routing and execution remain idempotent.
