# Hosted learning and entity staging gate

Loopgraph's hosted evidence and entity-resolution stores are production authority for Hermes's
cross-loop learning. Unit tests prove the adapters, but production promotion also needs evidence
that the deployed PostgreSQL functions preserve their concurrency and immutability guarantees.

The repository contains the active check, its database authority, and a protected release-workflow
job whose receipt is mandatory for signed promotion evidence. A failed, pending, stale, or
wrong-scope proof therefore blocks production instead of becoming an optional workflow result. The
command never runs during local startup, preview rendering, webhook intake, or a production request.

## What the gate proves

The probe creates a random `learning_probe_<24 hex characters>` project under the release tenant and
uses two independent service clients to prove:

1. two workers racing for one due measurement job receive exactly one lease;
2. a stale lease hash cannot finalize the claimed job;
3. the valid finalization is visible through the other client;
4. metric samples, observed outcomes, and value-ledger entries accept exact replay but reject a
   changed payload at the database RPC boundary;
5. a canonical entity written by one client is visible to the other;
6. a provider alias cannot be assigned to a second canonical entity; and
7. all evidence, entities, aliases, and the one-time cleanup authority in the random probe scope are
   removed before a healthy receipt is returned.

The receipt contains only the pinned scope digest, timing, and nine boolean control results. It does
not contain the Supabase origin, organization ID, random project key, entity IDs, provider aliases,
lease tokens, evidence payloads, or credentials.

## Database prerequisite

Apply these migrations to the staging database before running the job:

- `202607310001_enterprise_evidence_and_entities.sql`
- `202607310002_canonical_company_entities.sql`
- `20260823045212_hosted_learning_entity_probe.sql`

The probe functions are `SECURITY DEFINER` only because the evidence/entity tables deliberately grant
the service role read access but no direct delete authority. A reserved project-key pattern is not
treated as ownership. Before writing anything, the probe sweeps only expired scopes that already have
a durable authorization, then registers its random empty scope with a 256-bit nonce hash and a
30-minute expiry. Cleanup locks that exact authorization, requires the matching unexpired nonce,
deletes only that organization/project pair, verifies evidence, entities, and aliases are empty, and
consumes the authority atomically. A collision with pre-existing rows is refused instead of cleaned.
All three functions use an empty search path and fully qualified relations; the authorization table is
RLS-enabled with no direct grants, default/public execution is revoked, and only `service_role` can
invoke the functions.

## Protected environment configuration

Create a GitHub environment named `learning-entity-staging` with required reviewers. Configure:

- `LOOPGRAPH_STAGING_SUPABASE_URL`: the bare HTTPS staging Supabase origin;
- `LOOPGRAPH_STAGING_SUPABASE_SERVICE_ROLE_KEY_FILE`: an absolute runner-local projected secret file,
  owned by the runner user and mode `0600`;
- `LOOPGRAPH_EXPECTED_LEARNING_ENTITY_PROBE_SCOPE_DIGEST`: the independently reviewed digest for the
  staging origin, lowercase organization UUID, and fixed `learning_probe` namespace.

Generate the digest on a trusted operator machine without a credential:

```bash
LOOPGRAPH_LEARNING_ENTITY_PROBE_SUPABASE_URL=https://example.supabase.co \
LOOPGRAPH_LEARNING_ENTITY_PROBE_ORGANIZATION_ID=00000000-0000-4000-8000-000000000000 \
npm run --silent print:learning-entity-probe-scope
```

Do not put a service-role key in GitHub YAML, a repository variable, a command-line argument, or the
receipt. Project it into the protected self-hosted runner from the enterprise secret manager and
remove the file when the job ends.

## Manual staging invocation

The command requires exact mutation confirmation and the pinned scope digest:

```bash
LOOPGRAPH_LEARNING_ENTITY_PROBE_ALLOW_MUTATION=yes \
LOOPGRAPH_LEARNING_ENTITY_PROBE_SUPABASE_URL=https://example.supabase.co \
LOOPGRAPH_LEARNING_ENTITY_PROBE_SERVICE_ROLE_KEY_FILE=/run/secrets/loopgraph-staging-service-role \
LOOPGRAPH_LEARNING_ENTITY_PROBE_ORGANIZATION_ID=00000000-0000-4000-8000-000000000000 \
LOOPGRAPH_EXPECTED_LEARNING_ENTITY_PROBE_SCOPE_DIGEST=sha256:... \
npm run --silent validate:learning-entities-staging
```

A failed assertion, authorization, or cleanup returns a non-zero exit and no healthy receipt. An
abruptly terminated runner leaves only a short-lived authorization; a later run can sweep it after
expiry. Database restore remains a separate isolated recovery rehearsal; this probe never treats
deletion in the primary staging database as restore proof.

The workflow uploads `learning-entity-staging-receipt.json` as a 90-day artifact. The v9 production
evidence compiler independently reconstructs the scope from the validated release Storage origin,
lowercase organization UUID, and `learning_probe` namespace, requires all nine controls exactly
once, rechecks freshness, and includes the receipt digest in the signed evidence-set digest. The
production job downloads the same artifact and repeats the reconstruction before promotion.
