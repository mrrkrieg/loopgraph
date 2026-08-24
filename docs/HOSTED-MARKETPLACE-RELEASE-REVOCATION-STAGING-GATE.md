# Hosted marketplace release revocation staging gate

`npm run validate:marketplace-release-revocation-staging` proves that a deployed marketplace can
remove one compromised release from both workload delivery and the disposable local cache without
allowing a non-MFA publisher to mutate it.

The gate uses one active, signed, disposable private release; two publisher browser sessions at
different authentication assurance levels; one `marketplace.consume` workload identity; and one
independent `observability.read` identity. It proves:

1. the exact active release downloads, verifies, and enters a disposable content-addressed cache;
2. an AAL1 publisher receives `step_up_required` and the exact release remains active and cached;
3. an AAL2 publisher revokes that one active release through the atomic audited transaction;
4. the workload can no longer resolve the release and re-authorization evicts its exact cache
   source; and
5. the verified tenant audit chain contains the exact app/version/digest, active-to-revoked
   transition, correlation ID, changed flag, and fixed synthetic-reason digest.

## Disposable staging preparation

Publish a new signed private App version used only for this drill and grant the workload tenant
access. The version must be `active`, not deprecated, and absent from production. Every successful
run permanently revokes it, so provision a new exact version before the next run.

Project the AAL1/AAL2 Supabase session bundles and workload JWTs as absolute mode-`0600` regular
files. Session bundles contain only `access_token` and `refresh_token`; the runner exchanges them for
browser cookies in memory. Do not store cookies or JWT values in GitHub variables, commands, or
artifacts.

```dotenv
LOOPGRAPH_STAGING_RELEASE_REVOCATION_URL=https://loopgraph.staging.example
LOOPGRAPH_STAGING_RELEASE_REVOCATION_AUDIENCE=https://loopgraph.staging.example/marketplace
LOOPGRAPH_STAGING_RELEASE_REVOCATION_ORGANIZATION_ID=123e4567-e89b-42d3-a456-426614174000
LOOPGRAPH_STAGING_RELEASE_REVOCATION_PROJECT_KEY=main
LOOPGRAPH_STAGING_RELEASE_REVOCATION_APP_ID=staging.release.revocation.probe
LOOPGRAPH_STAGING_RELEASE_REVOCATION_APP_VERSION=1.0.0
LOOPGRAPH_STAGING_RELEASE_REVOCATION_ARTIFACT_DIGEST=sha256:<64-lowercase-hex>
LOOPGRAPH_STAGING_SUPABASE_URL=https://database.example
LOOPGRAPH_STAGING_SUPABASE_PUBLISHABLE_KEY=publishable-key
LOOPGRAPH_STAGING_RELEASE_REVOCATION_AAL1_SESSION_FILE=/run/secrets/loopgraph/release-aal1.json
LOOPGRAPH_STAGING_RELEASE_REVOCATION_AAL2_SESSION_FILE=/run/secrets/loopgraph/release-aal2.json
LOOPGRAPH_STAGING_RELEASE_REVOCATION_WORKLOAD_TOKEN_FILE=/run/secrets/loopgraph/release-consumer.jwt
LOOPGRAPH_STAGING_OBSERVABILITY_TOKEN_FILE=/run/secrets/loopgraph/observability.jwt
```

Run once:

```bash
npm run validate:marketplace-release-revocation-staging \
  > marketplace-release-revocation-staging-receipt.json
```

## Mutation and evidence boundary

The only persistent mutation is revocation of the exact disposable release. The tool never changes
private grants, installed Apps, provider connections, or production data. Its local cache lives in a
random temporary directory and is removed even after failure.

The `hosted-marketplace-release-revocation-staging-validation/v1` receipt contains only deployment
origin, tenant/project, exact non-secret release identity, six named control results, changed flag,
correlation ID, and audit checkpoint. It excludes cookies, JWTs, users, provider data, archive bytes,
and reason text. The protected release workflow validates and retains this receipt, the independent
audit drain proves its exact checkpoint, and the v16 production manifest rejects a missing, stale,
cross-scope, digest-substituted, status-altered, or audit-unbound receipt. The first
environment-specific execution remains external operational evidence.
