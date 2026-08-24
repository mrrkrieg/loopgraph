# Hosted CLI session staging gate

`npm run validate:cli-session-staging` turns the human CLI security checklist into one bounded,
secret-safe deployment rehearsal. It targets an isolated staging organization through two distinct
HTTPS replica origins backed by the same tenant database.

The gate proves:

1. one request fingerprint receives five device codes and the sixth request returns `429`;
2. an unapproved device code returns `authorization_pending`, then an immediate repeat returns
   `slow_down`;
3. the primary replica rotates a disposable refresh generation;
4. a second replica observes that commit and rotates the next generation;
5. a valid session with a timestamp ten minutes in the past is rejected before authorization;
6. a pre-issued session whose membership is now suspended returns `membership_required`;
7. a pre-revoked session returns `invalid_or_expired_session`;
8. exactly the configured staging request limit succeeds across both replicas and the next request
   returns `rate_limited`;
9. replaying generation zero returns `refresh_token_reused` and the newest access generation then
   fails on the other replica; and
10. the independently authorized audit export contains the exact accepted human-session request.

## Isolated staging preparation

Use a staging-only organization and two deployment origins that route to separate application
replicas but share the same database. Configure `LOOPGRAPH_MARKETPLACE_RATE_LIMIT_PER_MINUTE` on
both replicas to the same integer from 2 through 20. Pass that exact value to the runner as
`LOOPGRAPH_STAGING_CLI_REQUEST_RATE_LIMIT`.

Prepare three disposable human session states:

- one active current refresh token that the gate is allowed to rotate and permanently revoke;
- one access token issued before its user's organization membership was suspended; and
- one access token whose session was explicitly revoked.

Project those values and an independent `observability.read` workload JWT into an ephemeral runner
as absolute, regular, non-symlink files readable only by their owner. Do not place raw credentials
in GitHub variables, workflow commands, logs, or artifacts.

```dotenv
LOOPGRAPH_STAGING_CLI_PRIMARY_URL=https://cli-a.staging.example
LOOPGRAPH_STAGING_CLI_REPLICA_URL=https://cli-b.staging.example
LOOPGRAPH_STAGING_CLI_ORGANIZATION_ID=123e4567-e89b-12d3-a456-426614174000
LOOPGRAPH_STAGING_CLI_PROJECT_KEY=main
LOOPGRAPH_STAGING_CLI_REQUEST_RATE_LIMIT=5
LOOPGRAPH_STAGING_CLI_DISPOSABLE_REFRESH_TOKEN_FILE=/run/secrets/loopgraph/cli-refresh
LOOPGRAPH_STAGING_CLI_SUSPENDED_ACCESS_TOKEN_FILE=/run/secrets/loopgraph/cli-suspended
LOOPGRAPH_STAGING_CLI_REVOKED_ACCESS_TOKEN_FILE=/run/secrets/loopgraph/cli-revoked
LOOPGRAPH_STAGING_OBSERVABILITY_TOKEN_FILE=/run/secrets/loopgraph/observability.jwt
```

Then run:

```bash
npm run validate:cli-session-staging > cli-session-staging-receipt.json
```

## Mutation and cleanup boundary

This is intentionally a mutating staging drill. It creates five pending device authorizations that
expire automatically, fills one disposable request-rate window, revokes the suspended session on
first use, and consumes then revokes the active refresh family. It never reads provider data,
customer records, token hashes, raw database rows, or marketplace artifacts. Do not run it against a
production organization or a person's real CLI session.

The emitted `hosted-cli-session-staging-validation/v1` receipt contains only origins, tenant scope,
bounded control values, status codes, ten named checks, and one verified audit checkpoint. Returned
access and refresh values remain process-local and are never serialized.

The protected `cli-session-staging` release job validates the exact ten names and statuses before it
uploads this receipt. `audit:drain` then proves the receipt's accepted-request checkpoint in the
pinned tenant chain, and `release:evidence:build` binds the complete receipt and the resulting
`audit-drain/v8` proof into `loopgraph-production-promotion-evidence/v16`. Production re-reads the
same immutable artifacts; omitting, aging, changing scope, collapsing the two origins, or changing a
control blocks promotion.

This receipt proves the deployed human-session path. Live identity-provider JWKS rotation and
hosted App release revocation remain separate deployment drills. MFA administrator revocation is
proved by the separate `cli-admin-staging` protected job, while exact disposable marketplace-release
revocation is proved by its own protected job; both are bound into the same v16 manifest.
