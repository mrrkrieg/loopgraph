# Scoped machine request guards

Hosted workers, controller operators, graph transaction clients, measurement collectors,
schedulers, signed Hermes callbacks, and signed provider-forwarding webhooks cross a different
trust boundary from browser users. A bearer token or valid signature proves possession of a
secret; it does not by itself prevent replay, identify the service, bind the request to a tenant,
or constrain request volume.

## Hosted request contract

Every non-platform hosted machine request provides:

```http
Authorization: Bearer <short-lived workload JWT>
X-Loopgraph-Organization-Id: 123e4567-e89b-12d3-a456-426614174000
X-Loopgraph-Project-Key: main
X-Loopgraph-Request-Id: request_01J...
X-Loopgraph-Timestamp: 2026-07-30T15:00:00.000Z
```

- The JWT signature, issuer, audience, expiry/not-before/issued-at time, subject pattern, exact
  capability, organization, and project are verified against `LOOPGRAPH_WORKLOAD_IDENTITY_ISSUERS`.
- A non-secret credential ID is derived from issuer + subject.
- Organization and project headers, when supplied, must equal the deployment binding.
- Request IDs are unique per tenant/project/credential for 24 hours.
- Timestamps must be within five minutes.
- Method, path, query, and up to 1 MiB of body are hashed into the durable receipt.
- A Supabase RPC atomically records replay identity and increments the one-minute rate window.
- Replays return `409`; rate limits return `429` with `Retry-After`.
- Hosted requests fail closed if the service-role database guard is unavailable.

Local development may keep the simpler exact bearer-token check and does not require Supabase.
Production static machine tokens fail closed unless the temporary
`LOOPGRAPH_ALLOW_LEGACY_MACHINE_TOKENS=true` compatibility flag is set.

## Capabilities

Requests are recorded under the narrow route capability:

- `routing.worker`
- `routing.jobs`
- `controller.operate`
- `graph.transact`
- `hermes.design_callback`
- `hermes.route_activation`
- `measurements.collect`
- `observability.read`
- `provider.github_forward`
- `provider.connector_broker`
- `provider.oauth_worker`
- `provider.revocation_worker`
- `schedule.controller`
- `schedule.connector_oauth`
- `schedule.connector_revocations`
- `schedule.measurements`
- `schedule.management`
- `schedule.app_evidence_health`
- `schedule.app_action_reconciliation`

Workload issuers should mint a different short-lived subject/audience/capability set for each worker
class. The issuer JSON is public verification policy; it does not contain private keys or tokens.

`hermes.route_activation` is a deployment/admin workload capability, never a webhook-router capability. Its API accepts only a versioned current-plan digest; the controller target, outbound workload identity, tenant scope, and receipt store are deployment configuration. Do not grant it to provider event turns or lifecycle turns.

```dotenv
LOOPGRAPH_WORKLOAD_IDENTITY_ISSUERS=[{"issuer":"https://issuer.example","jwksUri":"https://issuer.example/.well-known/jwks.json","audiences":["loopgraph"],"allowedSubjectPatterns":["spiffe://company/*"],"capabilityClaim":"capabilities","organizationClaim":"organization_id","projectClaim":"project_key"}]
LOOPGRAPH_WORKLOAD_IDENTITY_TOKEN_FILE=/var/run/secrets/loopgraph/broker.jwt
LOOPGRAPH_WORKER_RATE_LIMIT_PER_MINUTE=120

LOOPGRAPH_HERMES_ROUTE_ACTIVATION_CREDENTIAL_ID=hermes_route_deployer
# Local compatibility only; production uses the signed workload identity above.
LOOPGRAPH_HERMES_ROUTE_ACTIVATION_API_TOKEN=

LOOPGRAPH_CRON_RATE_LIMIT_PER_MINUTE=20

LOOPGRAPH_HERMES_CALLBACK_CREDENTIAL_ID=hermes_callback
LOOPGRAPH_HERMES_CALLBACK_RATE_LIMIT_PER_MINUTE=60

LOOPGRAPH_GITHUB_WEBHOOK_CREDENTIAL_ID=github_forwarder
LOOPGRAPH_GITHUB_WEBHOOK_RATE_LIMIT_PER_MINUTE=120

LOOPGRAPH_OBSERVABILITY_RATE_LIMIT_PER_MINUTE=60
```

Hermes callback and GitHub forwarder receipts are recorded only after their existing HMAC
signature checks pass. Their signed callback or delivery identities become durable replay keys.
In hosted mode, the GitHub compatibility forwarder also requires `x-github-delivery`.

## Vercel schedules

Vercel Cron currently supplies `Authorization: Bearer $CRON_SECRET`. Deployments using that platform
adapter must temporarily set `LOOPGRAPH_ALLOW_LEGACY_MACHINE_TOKENS=true` until the schedule invokes
Loopgraph through a workload-identity gateway. For those scheduled calls, Loopgraph
derives the durable request ID from Vercel's request identity and uses the configured cron
credential ID. The controller schedule is registered every 15 minutes, measurement reconciliation
hourly, management review weekly, and App action receipt reconciliation every five minutes. Each
schedule still needs only its own narrow `schedule.*` capability.

Vercel schedules run only on production deployments. Private durable company work must still use
the persistent runtime topology described in
[Hosted runtime namespaces](./HOSTED-RUNTIME-NAMESPACES.md); an ephemeral function filesystem is not
a durable worker.

## Database migration

Apply:

```text
supabase/migrations/202607300002_machine_request_guards.sql
```

The migration creates tenant-scoped replay receipts, rate windows, and the service-role-only
`authorize_machine_request` RPC. Both tables have RLS enabled and no browser role receives access.

Receipts are an operational security control, not the final immutable audit export. Production
audit decisions are hash chained by the subsequent operational-audit migration, but independent
retention, deployed alerting, and backup verification remain separate release gates.
