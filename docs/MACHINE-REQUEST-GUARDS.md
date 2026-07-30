# Scoped machine request guards

Hosted workers, controller operators, graph transaction clients, measurement collectors,
schedulers, signed Hermes callbacks, and signed provider-forwarding webhooks cross a different
trust boundary from browser users. A bearer token or valid signature proves possession of a
secret; it does not by itself prevent replay, identify the service, bind the request to a tenant,
or constrain request volume.

## Hosted request contract

Every non-platform hosted machine request provides:

```http
Authorization: Bearer <capability secret>
X-Loopgraph-Credential-Id: worker_primary
X-Loopgraph-Organization-Id: 123e4567-e89b-12d3-a456-426614174000
X-Loopgraph-Project-Key: main
X-Loopgraph-Request-Id: request_01J...
X-Loopgraph-Timestamp: 2026-07-30T15:00:00.000Z
```

- The bearer secret is compared in constant time.
- The credential ID must equal the server-side configured identity.
- Organization and project headers, when supplied, must equal the deployment binding.
- Request IDs are unique per tenant/project/credential for 24 hours.
- Timestamps must be within five minutes.
- Method, path, query, and up to 1 MiB of body are hashed into the durable receipt.
- A Supabase RPC atomically records replay identity and increments the one-minute rate window.
- Replays return `409`; rate limits return `429` with `Retry-After`.
- Hosted requests fail closed if the service-role database guard is unavailable.

Local development keeps the simpler exact bearer-token check and does not require Supabase.

## Capabilities

Requests are recorded under the narrow route capability:

- `routing.worker`
- `routing.jobs`
- `controller.operate`
- `graph.transact`
- `hermes.design_callback`
- `measurements.collect`
- `provider.github_forward`
- `schedule.controller`
- `schedule.measurements`
- `schedule.management`

Worker and cron credentials remain separate. Deployments should use a different secret and
credential ID for each class and rotate them through the hosting secrets manager.

```dotenv
LOOPGRAPH_WORKER_API_TOKEN=<long random secret>
LOOPGRAPH_WORKER_CREDENTIAL_ID=worker_primary
LOOPGRAPH_WORKER_RATE_LIMIT_PER_MINUTE=120

CRON_SECRET=<different long random secret>
LOOPGRAPH_CRON_CREDENTIAL_ID=cron_primary
LOOPGRAPH_CRON_RATE_LIMIT_PER_MINUTE=20

LOOPGRAPH_HERMES_CALLBACK_CREDENTIAL_ID=hermes_callback
LOOPGRAPH_HERMES_CALLBACK_RATE_LIMIT_PER_MINUTE=60

LOOPGRAPH_GITHUB_WEBHOOK_CREDENTIAL_ID=github_forwarder
LOOPGRAPH_GITHUB_WEBHOOK_RATE_LIMIT_PER_MINUTE=120
```

Hermes callback and GitHub forwarder receipts are recorded only after their existing HMAC
signature checks pass. Their signed callback or delivery identities become durable replay keys.
In hosted mode, the GitHub compatibility forwarder also requires `x-github-delivery`.

## Vercel schedules

Vercel Cron supplies `Authorization: Bearer $CRON_SECRET`. For those scheduled calls, Loopgraph
derives the durable request ID from Vercel's request identity and uses the configured cron
credential ID. The controller schedule is registered every 15 minutes, measurement reconciliation
hourly, and the management review weekly.

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
audit export, retention policy, alerting, and backup verification remain separate release gates.
