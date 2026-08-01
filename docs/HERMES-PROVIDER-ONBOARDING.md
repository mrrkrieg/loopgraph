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

## Security invariants

- Start read-only. Add write scopes only for an accepted LoopSpec with an approval-bound action fingerprint.
- One external provider route can feed many loops. Never create one public webhook per loop.
- Reject unsigned or stale deliveries before normalization.
- Do not persist raw HR records, message bodies, OAuth codes, tokens, client secrets, or signing keys in Loopgraph.
- Entity resolution uses exact provider aliases and deterministic keys. Ambiguous matches abstain; fuzzy automatic merges are disabled.
- Replayed provider deliveries preserve the same event/problem identity so routing and execution remain idempotent.
