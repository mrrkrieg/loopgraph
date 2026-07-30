# Hosted authentication and tenant security

Loopgraph is local-first. A production web deployment is a different trust boundary: browsers,
users, organizations, and machine workers must not share an implicit administrator context.

## What this repository enforces

- Supabase Auth sessions are refreshed in middleware and verified with signed claims.
- Browser pages and user-facing APIs require a verified session when
  `LOOPGRAPH_HOSTED_MODE=1` or the app is a production Vercel deployment with Supabase configured.
- Mutating browser API requests must be same-origin.
- Independently authenticated machine routes remain protected by their webhook signature,
  callback signature, worker bearer token, or cron secret.
- Organization access comes from `organization_memberships`, never editable user metadata.
- Roles are monotonic: `viewer`, `operator`, `admin`, and `owner`.
- Request-bound Design Studio reads and writes use the user's cookie-bound Supabase client.
- The application resolves the user's selected organization instead of selecting the first
  organization in the database.
- The service-role client is server-only and limited to provisioning, background persistence,
  and seed operations.
- Runtime persistence requires `LOOPGRAPH_HOSTED_ORGANIZATION_ID`; every service-role read and
  write is filtered to that organization.
- Row Level Security covers every exposed workspace and runtime table. Authorization helpers live
  in a non-exposed `private` schema and derive identity from `auth.uid()`.
- A fresh hosted organization and a fresh local project both start empty.

## Required deployment configuration

```dotenv
NEXT_PUBLIC_SUPABASE_URL=https://YOUR_PROJECT.supabase.co
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=YOUR_PUBLISHABLE_KEY
SUPABASE_SERVICE_ROLE_KEY=YOUR_SERVER_ONLY_SERVICE_ROLE_KEY
LOOPGRAPH_HOSTED_MODE=1
LOOPGRAPH_HOSTED_ORGANIZATION_ID=YOUR_ORGANIZATION_UUID
LOOPGRAPH_HOSTED_RUNTIME_ROOT=/var/lib/loopgraph
LOOPGRAPH_HOSTED_PROJECT_KEY=main
CRON_SECRET=LONG_RANDOM_SECRET
LOOPGRAPH_CRON_CREDENTIAL_ID=cron_primary
LOOPGRAPH_WORKER_API_TOKEN=SEPARATE_LONG_RANDOM_TOKEN
LOOPGRAPH_WORKER_CREDENTIAL_ID=worker_primary
LOOPGRAPH_HERMES_CALLBACK_SECRET=SEPARATE_LONG_RANDOM_SECRET
LOOPGRAPH_HERMES_CALLBACK_CREDENTIAL_ID=hermes_callback
GITHUB_WEBHOOK_SECRET=SEPARATE_LONG_RANDOM_SECRET
LOOPGRAPH_GITHUB_WEBHOOK_CREDENTIAL_ID=github_forwarder
LOOPGRAPH_OBSERVABILITY_API_TOKEN=SEPARATE_READ_ONLY_LONG_RANDOM_TOKEN
LOOPGRAPH_OBSERVABILITY_CREDENTIAL_ID=metrics_primary
```

Never expose `SUPABASE_SERVICE_ROLE_KEY` through a `NEXT_PUBLIC_` variable or copy provider OAuth
tokens into Loopgraph. Hermes or an approved secrets manager owns provider credentials; Loopgraph
stores opaque references and evidence receipts.

Configure the Supabase magic-link redirect URL:

```text
https://YOUR_HOST/auth/callback
```

Apply migrations in order:

```bash
supabase db push
```

The hosted security migration is
`supabase/migrations/202607300001_hosted_tenant_security.sql`. This repository's automated test
checks that the migration covers every current public table, but a real deployment must also run
Supabase's database linter and an integration test against the target project.

## Role capabilities

| Capability | Viewer | Operator | Admin | Owner |
|---|---:|---:|---:|---:|
| Read workspace | Yes | Yes | Yes | Yes |
| Design/update loops | No | Yes | Yes | Yes |
| Start runs and submit reviews | No | Yes | Yes | Yes |
| Export security audit | No | No | Yes | Yes |
| Rename organization | No | No | Yes | Yes |
| Manage members | No | No | Yes | Yes |
| Delete organization | No | No | No | Yes |

Profile role fields are display-only. The authoritative role is the active membership row.

## Public preview

`loopgraph.vercel.app` is an explicit sample deployment and does not hold private customer data.
`LOOPGRAPH_PREVIEW_CONTENT=1` may be used for an equivalent public demo. Never set that flag on a
deployment connected to customer or company data.

## Current production limitation

The browser persistence boundary and the hosted routing store are tenant-aware. Routing state and
route-job claims are database-backed, service-role-only, and scoped by organization/project, so
multiple worker replicas can safely claim this queue. The worker token is still a deployment
credential bound to one configured organization/project.

Design, graph, controller, measurement, outcome, and generated-artifact stores are not all
distributed yet. Keep those subsystems to one active writer until their database migrations ship,
and never operate multiple customer organizations through one shared filesystem namespace.

See [Distributed Hermes routing store](./DISTRIBUTED-ROUTING-STORE.md) and
[Hosted runtime namespaces](./HOSTED-RUNTIME-NAMESPACES.md).

Machine routes additionally require tenant/project-bound replay receipts and durable rate windows.
See [Scoped machine request guards](./MACHINE-REQUEST-GUARDS.md).

Machine decisions also append to a tamper-evident security audit chain. Public health responses
contain status only; detailed metrics and audit export remain separately authorized. See
[Operational audit and observability](./OPERATIONAL-AUDIT-OBSERVABILITY.md).

The remaining hosted production work is tracked in
[Current build state](./CURRENT-STATE.md#remaining-product-layers).
