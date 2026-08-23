# Interactive CLI device authorization

Loopgraph supports two deliberately separate identities for hosted marketplace access:

- Hermes and managed runners use short-lived workload identity plus a durable
  `marketplace.consume` grant.
- A person at a terminal uses browser-approved device authorization tied to their
  active organization membership.

The human path follows the OAuth device-authorization interaction pattern. It does
not mint a workload identity, receive a Supabase cookie, expose a service key, or
gain provider access.

## User flow

```bash
npx loopgraph auth login \
  --url https://loopgraph.example \
  --audience https://loopgraph.example/marketplace
```

The CLI prints an eight-character code, opens the hosted `/device` page, and waits.
After the signed-in organization member confirms that exact code, the terminal
receives a 15-minute access token and a rotating refresh token. The command stores
the profile in a current-user-only `0600` file and never prints either token.

Subsequent marketplace commands discover the active profile automatically:

```bash
npx loopgraph apps search "renewal risk"
npx loopgraph auth status
npx loopgraph auth logout
```

`auth status` prints only origin, audience, organization, project, scope, and expiry
metadata. `auth logout` revokes the server session and removes the local profile. If
the hosted deployment cannot be reached, it removes the local profile and clearly
reports that remote revocation still needs to be completed by an administrator.

Set `LOOPGRAPH_CLI_CREDENTIALS_FILE` to an absolute path to select a different
credential file. Loopgraph rejects symlinks, non-regular files, files not owned by
the current Unix user, files larger than 1 MiB, and Unix permissions broader than
`0600`. The parent directory is forced to `0700` and updates use an atomic temporary
file. Enterprise endpoints should also use full-disk encryption and device
management; a local credential file cannot protect a compromised user account.

## Hosted flow

```mermaid
sequenceDiagram
  participant C as "Loopgraph CLI"
  participant A as "Hosted authorization API"
  participant B as "Authenticated browser"
  participant D as "Tenant database"
  participant M as "Marketplace API"
  C->>A: "Request device code"
  A->>D: "Store device/user-code hashes, scope, expiry"
  A-->>C: "One-time device code + browser URL"
  B->>A: "Approve exact user code with hosted session"
  A->>D: "Verify active organization membership"
  C->>A: "Poll exact device code"
  A->>D: "Atomically consume approval; store token hashes"
  A-->>C: "15-minute access + rotating refresh token"
  C->>M: "Access token + fresh request ID/timestamp"
  M->>D: "Check token, membership, scope, replay and rate"
  M-->>C: "Tenant-visible signed marketplace data"
```

Apply these migrations in order:

```text
supabase/migrations/202608170003_cli_device_authorization.sql
supabase/migrations/202608170004_cli_session_administration.sql
supabase/migrations/20260823044639_cli_refresh_replay_detection.sql
```

Configure:

```bash
LOOPGRAPH_PUBLIC_URL=https://loopgraph.example
LOOPGRAPH_HOSTED_ORGANIZATION_ID=123e4567-e89b-12d3-a456-426614174000
LOOPGRAPH_HOSTED_PROJECT_KEY=main
LOOPGRAPH_DEVICE_AUTH_FINGERPRINT_SECRET=<at-least-32-random-characters>
LOOPGRAPH_TRUSTED_PROXY_HEADERS=false
LOOPGRAPH_MARKETPLACE_RATE_LIMIT_PER_MINUTE=120
```

`LOOPGRAPH_PUBLIC_URL` is the trusted browser origin returned to the CLI; production
requires HTTPS. The fingerprint secret HMACs bounded network/client metadata for
device-code issuance throttling. Raw addresses and user agents are not persisted.
Vercel's forwarded address is used only when `VERCEL=1`. A self-hosted deployment
may set `LOOPGRAPH_TRUSTED_PROXY_HEADERS=true` only when its ingress strips and
rewrites `X-Forwarded-For`.

## Security contract

- Device and user codes expire after 10 minutes. High-entropy device codes use a
  SHA-256 digest; user codes use an HMAC-peppered digest so a database snapshot is
  not sufficient to enumerate pending browser codes.
- Atomic database rate-window reservations limit a request fingerprint to five
  device authorizations per minute, including under concurrent requests.
- A deployment organization also has a 500-code-per-minute issuance ceiling so
  spoofed network metadata cannot create an unbounded write path. This ceiling is
  atomic and remains authoritative when no trusted client address is available.
- An authenticated member can submit at most ten browser code decisions per minute.
- Polling starts at five seconds and receives `slow_down` when it violates the
  server interval.
- Browser approval is same-origin, authenticated, and bound to the deployment
  organization.
- Access tokens expire after 15 minutes. Refresh tokens expire after 30 days and
  rotate on every successful use.
- Replaced refresh values survive only as SHA-256 digests in a private,
  expiry-bounded history. Presenting an earlier generation revokes the current
  session family atomically, records one tenant audit event without token
  material, and requires a new browser login.
- The database stores access and refresh digests, never raw CLI secrets.
- The only allowed first-release capability is `marketplace.consume`.
- Active organization membership is rechecked during approval, exchange, refresh,
  and every marketplace request.
- Each request still requires a fresh request identity and timestamp and calls the
  existing durable replay/rate/audit guard.
- Workload identity takes precedence when an ambient identity is configured, so a
  human session cannot silently replace Hermes production identity.
- The CLI session cannot publish apps, mutate the company graph, call provider
  tools, enable writes, or run loops.

## Revocation and deployment proof

Removing organization membership invalidates the next refresh or request. `auth
logout` revokes one session immediately. Hosted admins and owners can open
`/settings/cli-sessions` to inspect safe session metadata and revoke one device,
every session owned by one user, or all human CLI sessions in the organization.
The same page identifies a family revoked because refresh-token reuse was
detected, but never queries or returns a current or historical token digest. The
CLI removes its local profile after replay, invalid-grant, or membership denial so
it cannot repeatedly submit a credential the server has invalidated.
The page and its API never select token digests. Revocation requires MFA step-up,
rechecks the actor's active admin/owner membership inside the database, binds the
update to the exact organization and project, and atomically appends a hash-chained
security audit event. The audit record retains a reason digest rather than the
operator's raw reason text. Workload identities and provider credentials are not
affected by this human-session control.

Before production, validate device-code issuance saturation, concurrent polling,
refresh-token replay and family revocation, cross-replica rotation, clock skew, membership removal,
single/user/organization revocation, MFA enforcement, and audit-retention export
against the real staging database.
