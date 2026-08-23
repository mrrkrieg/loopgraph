# Hosted authentication and tenant security

Loopgraph is local-first. A production web deployment is a different trust boundary: browsers,
users, organizations, and machine workers must not share an implicit administrator context.

## What this repository enforces

- Supabase Auth sessions are refreshed in middleware and verified with signed claims.
- Browser pages and user-facing APIs require a verified session when
  `LOOPGRAPH_HOSTED_MODE=1` or the app is a production Vercel deployment with Supabase configured.
- Mutating browser API requests must be same-origin.
- Independently authenticated machine routes verify signed workload identity against configured
  issuer/JWKS/audience/capability policy. Legacy worker bearer tokens are a temporary, explicit
  compatibility mode; provider webhooks use provider-specific raw-body verification and replay claims.
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
LOOPGRAPH_WORKLOAD_IDENTITY_ISSUERS=[{"issuer":"https://issuer.example","jwksUri":"https://issuer.example/.well-known/jwks.json","audiences":["loopgraph"],"allowedSubjectPatterns":["spiffe://company/*"],"capabilityClaim":"capabilities"}]
LOOPGRAPH_ALLOW_LEGACY_MACHINE_TOKENS=false
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

Provider access is managed through `/settings/integrations`. Admins can review consent and scopes,
run a fixed health operation, rotate tokens, immediately block capabilities, queue provider/vault
revocation, and delete revoked non-secret metadata. These actions append to the tenant audit chain.

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
| View connector status | Yes | Yes | Yes | Yes |
| Connect, rotate, revoke, or delete connectors | No | No | Yes | Yes |
| Rename organization | No | No | Yes | Yes |
| Manage members | No | No | Yes | Yes |
| Delete organization | No | No | No | Yes |

Profile role fields are display-only. The authoritative role is the active membership row.

## Public preview

`loopgraph.vercel.app` is an explicit sample deployment and does not hold private customer data.
`LOOPGRAPH_PREVIEW_CONTENT=1` may be used for an equivalent public demo. Never set that flag on a
deployment connected to customer or company data.

## Production activation boundary

The browser persistence boundary, hosted routing store, and connector control plane are tenant-aware.
Routing state, connector installation metadata, single-use OAuth state, operation receipts, webhook
replay claims, and revocation jobs are database-backed and scoped by organization/project. Provider
credential contents remain outside this database.

Hermes design tasks, outbound delivery, signed callback acceptance, callback-worker claims,
discovery/evidence sessions, and immutable design contexts/runs/proposals are distributed.
Discovery updates use revision fencing, evidence gaps are monotonic, and a design artifact plus
its session transition commit atomically. Accepted LoopSpecs, generated fixtures, the active
workspace registry, and discovery completion also commit atomically through the distributed
version registry. Opportunities, proposed graph changes, controller policies/checkpoints/runs,
and controller triggers now use a tenant/project-scoped database boundary with atomic claims,
UUID lease fencing, and a renewable controller lease. Graph snapshots, approvals, transactions,
promotions, measurements, outcomes, and value records also use the distributed tenant/project store.
Detached private App artifacts use the private `loopgraph-app-snapshots` Storage bucket. Only the
server-side service role may access that bucket; browser sessions, Hermes, and provider workers
receive logical snapshot receipts rather than object keys or download capabilities. Uploads are
immutable, tenant-scoped, and verified against both the App artifact and full file inventory before
they become replay authority. An all-command restrictive Storage policy denies the bucket to every
non-bypass role even if another project policy is broadly permissive.
The detached installation carries its complete immutable archive descriptor, so recovery remains
valid after bounded lifecycle-operation history ages out. A protected scheduled reconciliation scans
only one exact tenant/project registry scope, verifies every current detached App through the signed
LoopPack loader, fails closed on missing, corrupt, untracked, or unavailable archives, and emits only
aggregate counts plus an opaque scope digest. The protected job rejects arbitrary refs, binds the
runtime scope to a separately pinned digest, and requires an explicit policy before an empty detached
inventory can pass.

The protected production release chain repeats that reconciliation for the exact Storage origin and
tenant/project proven earlier in the same run. Its fresh, healthy aggregate receipt is a mandatory
input to `loopgraph-production-promotion-evidence/v5`; a missing, stale, cross-scope, incomplete, or
unhealthy receipt blocks promotion. The credential-bearing release workflow is accepted only as a
`staging-release` repository dispatch, which resolves the workflow and commit from the protected
default branch instead of accepting an arbitrary workflow ref.

Production activation still requires organization-specific provider sandbox validation, backup and
restore rehearsal, SLOs and alerts, revocation drills, audit export retention, and policy approval.
The repository provides the enforcement paths, but cannot prove a customer's cloud IAM, provider
application registration, or operational controls without running those deployment checks.

See [Distributed Hermes routing store](./DISTRIBUTED-ROUTING-STORE.md) and
[Hosted runtime namespaces](./HOSTED-RUNTIME-NAMESPACES.md). The signed inbound delivery boundary
is described in the
[Hermes design callback inbox](./HERMES-DESIGN-CALLBACK-INBOX.md).
The pre-materialization state boundary is described in
[Distributed discovery and design artifacts](./DISTRIBUTED-DISCOVERY-DESIGN-STORE.md).
The evidence-to-design control boundary is described in
[Distributed opportunity and controller runtime](./DISTRIBUTED-OPPORTUNITY-CONTROLLER.md).
The materialization boundary is described in the
[Versioned LoopSpec registry](./VERSIONED-LOOPSPEC-REGISTRY.md).
Detached artifact durability is described in
[Hosted App snapshots](./HOSTED-APP-SNAPSHOTS.md).

Machine routes additionally require tenant/project-bound replay receipts and durable rate windows.
See [Scoped machine request guards](./MACHINE-REQUEST-GUARDS.md).

Authenticated browser APIs consume database-owned, per-user/per-tenant quotas in stable read,
write, compute, and admin buckets. Callers cannot choose their own limit or open a new quota by
changing a resource ID. See [Hosted user API quotas](./USER-API-QUOTAS.md).

Machine decisions also append to a tamper-evident security audit chain. Public health responses
contain status only; detailed metrics and audit export remain separately authorized. See
[Operational audit and observability](./OPERATIONAL-AUDIT-OBSERVABILITY.md).

The remaining hosted production work is tracked in
[Current build state](./CURRENT-STATE.md#remaining-product-layers).
