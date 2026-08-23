# Hosted CLI administrator staging gate

`npm run validate:cli-admin-staging` proves the deployed MFA and emergency-revocation boundary for
human CLI sessions. It uses an isolated staging organization, two ephemeral administrator browser
sessions at different authentication assurance levels, and one disposable CLI session.

The gate proves all of the following against the deployed application and shared database:

1. an authenticated administrator at AAL1 receives `step_up_required` when attempting revocation;
2. the disposable CLI session remains revocable after that denied request;
3. an administrator at AAL2 revokes exactly that one session;
4. the safe inventory immediately projects the target as revoked;
5. the target access token is denied at the marketplace boundary; and
6. the verified tenant audit chain contains the exact correlation ID, target, scope, revoked count,
   and fixed synthetic-reason digest committed by the revocation transaction.

## Isolated staging preparation

Create one disposable CLI session after the staging deployment is ready. It must be among the most
recent 100 sessions because the validator intentionally performs one bounded inventory read rather
than scanning an unbounded tenant history. Project its UUID as a non-secret environment value and
its current access token as a private file.

Project two separate Supabase session bundles for active staging administrators or owners:

- the AAL1 bundle must not contain a successful MFA authentication method; and
- the AAL2 bundle must contain a current MFA step-up accepted by the deployed identity provider.

Each JSON bundle contains only `access_token` and `refresh_token`. Store it in an absolute, regular,
non-symlink file readable only by its owner. The runner exchanges each bundle for browser cookies in
memory. Cookies, user identities, CLI tokens, and the target session UUID are never written to the
receipt.

```dotenv
LOOPGRAPH_STAGING_CLI_ADMIN_URL=https://loopgraph.staging.example
LOOPGRAPH_STAGING_CLI_ADMIN_ORGANIZATION_ID=123e4567-e89b-42d3-a456-426614174000
LOOPGRAPH_STAGING_CLI_ADMIN_PROJECT_KEY=main
LOOPGRAPH_STAGING_CLI_ADMIN_TARGET_SESSION_ID=123e4567-e89b-42d3-a456-426614174010
LOOPGRAPH_STAGING_SUPABASE_URL=https://database.example
LOOPGRAPH_STAGING_SUPABASE_PUBLISHABLE_KEY=publishable-key
LOOPGRAPH_STAGING_CLI_ADMIN_AAL1_SESSION_FILE=/run/secrets/loopgraph/cli-admin-aal1.json
LOOPGRAPH_STAGING_CLI_ADMIN_AAL2_SESSION_FILE=/run/secrets/loopgraph/cli-admin-aal2.json
LOOPGRAPH_STAGING_CLI_ADMIN_TARGET_ACCESS_TOKEN_FILE=/run/secrets/loopgraph/cli-admin-target-access
LOOPGRAPH_STAGING_OBSERVABILITY_TOKEN_FILE=/run/secrets/loopgraph/observability.jwt
```

Run the destructive staging rehearsal once:

```bash
npm run validate:cli-admin-staging > cli-admin-staging-receipt.json
```

## Mutation and output boundary

The validator sends the fixed reason `Disposable staging CLI MFA revocation drill` and permanently
revokes the one projected CLI session. It never revokes the administrator browser sessions, reads
provider data, or performs provider writes. Do not run it against production or a person's real CLI
session.

The `hosted-cli-admin-staging-validation/v1` receipt contains the deployment origin, tenant/project,
six named checks, aggregate controls, the revoked count, and the audit correlation/checkpoint. It
excludes browser cookies, Supabase tokens, CLI tokens, session and user identities, and reason text.
The protected release workflow must validate and retain this receipt before it can become production
promotion evidence.
