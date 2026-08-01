# Hermes provider onboarding

Hermes owns authorization, signing secrets, webhook/stream lifecycle, and provider execution. Loopgraph owns the versioned non-secret contract, normalized event boundary, canonical entity mapping, routing validation, and durable evidence.

## Supported contracts

| Provider | Authorization | Intake owned by Hermes |
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
2. Call `loopgraph_provider_install_prepare`. The default response redacts the OAuth state and PKCE verifier.
3. When Hermes is ready to persist them immediately in its secret store, repeat with `includeOneTime: true`, open the authorization URL, and exchange the callback code inside Hermes.
4. Store the token under the returned opaque `credentialRef`; never submit it to Loopgraph.
5. Apply the declared subscription API, event stream, provider-console route, or scheduled detector in Hermes.
6. Verify the provider signature before calling `loopgraph_provider_event_normalize`.
7. Submit the normalized `EventEnvelope` to the isolated webhook-router MCP surface.
8. Register only non-secret connection metadata and health receipts with Loopgraph.

Provider application registration, admin consent, callback-domain verification, and live subscription calls require credentials in the operator's provider tenant. The repository provides the executable contract and tests; it cannot manufacture those external grants.

## Security invariants

- Start read-only. Add write scopes only for an accepted LoopSpec with an approval-bound action fingerprint.
- One external provider route can feed many loops. Never create one public webhook per loop.
- Reject unsigned or stale deliveries before normalization.
- Do not persist raw HR records, message bodies, OAuth codes, tokens, client secrets, or signing keys in Loopgraph.
- Entity resolution uses exact provider aliases and deterministic keys. Ambiguous matches abstain; fuzzy automatic merges are disabled.
- Replayed provider deliveries preserve the same event/problem identity so routing and execution remain idempotent.
