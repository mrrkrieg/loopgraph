# Hermes Route Controller contract

Loopgraph plans which events Hermes should receive and which restricted routing profile each event family may use. Hermes owns the live gateway, provider subscription, signature material, and route secret. The Route Controller protocol joins those responsibilities without copying credentials into Loopgraph or allowing an untrusted webhook turn to reconfigure itself.

## Trust boundary

```text
Provider connection + webhook secret
              |
              v
      Hermes Route Controller
              |
       signed/verified event
              v
      restricted Hermes route
              |
       normalized EventEnvelope
              v
     Loopgraph routing contract
```

Loopgraph sends only a desired-state contract. It never sends or receives provider access tokens, refresh tokens, client secrets, webhook secrets, signature keys, or raw provider payloads through this protocol.

The controller must:

- authenticate Loopgraph with workload identity;
- resolve provider credentials only inside the Hermes credential boundary;
- configure provider-specific signature and replay verification;
- select the named, reviewed `EventEnvelope` transformer;
- bind the exact `loopgraph_webhook_router` or `loopgraph_lifecycle_router` profile;
- expose only the exact listed Loopgraph MCP tools;
- keep every new route in log/shadow mode;
- return a secret-free receipt proving the applied contract;
- leave removals unapplied because the v1 protocol never authorizes destructive reconciliation.

## Protocol

Loopgraph sends `hermes-route-controller-request/v1alpha1` to one configured reconcile endpoint. The request is content-bound to:

- the current project and routing catalog;
- `.loopgraph/hermes-routes.json`;
- every route ID, source pattern, and event allowlist;
- the Hermes profile, skill, and restricted MCP tools;
- the reviewed transformer version;
- the existing Hermes-managed connection IDs;
- the App's required logical capabilities and exact installed connection bindings when the route belongs to an installed App;
- shadow/log activation;
- `destructiveChangesAllowed=false`.

Hermes returns `hermes-route-controller-receipt/v1alpha1`. Loopgraph rejects the receipt unless its request, project, catalog, manifest, plan, route set, config digests, profiles, skills, tool lists, and transformers match exactly. A shadow route cannot claim readiness without signature verification. A provider route cannot claim an active subscription without a bound connection, and a required provider route cannot use `not_applicable` to bypass subscription setup.

The accepted receipt uses one storage-neutral runtime contract. Local projects write it atomically to `.loopgraph/hermes-route-activation.json` with user-only permissions. Hosted projects append it to an organization/project/workspace-scoped Supabase ledger through a bounded service-role RPC; direct client writes are revoked and RLS is enabled. Both adapters revalidate every route digest, the complete plan digest, the exact receipt scope, non-destructive authority, and computed readiness before accepting or returning a record. URLs containing credentials, query parameters, or fragments and secret-shaped receipt content are rejected.

## Operator flow

First synchronize and test the local route contracts:

```bash
loopgraph hermes webhooks sync --project .
loopgraph hermes webhooks doctor --project .
loopgraph hermes webhooks test --project . --fixture <event.json> --require-synced-manifest
```

Prepare the exact activation contract:

```bash
loopgraph hermes webhooks prepare --project .
```

Review the output, then pass its exact `planDigest` to the apply command. The controller token must be a short-lived projected workload token in an absolute regular file that is not readable or writable by group or other users:

```bash
loopgraph hermes webhooks activate \
  --project . \
  --controller-url https://hermes.example.com/v1/loopgraph/routes/reconcile \
  --token-file /run/secrets/loopgraph/hermes-route-controller.jwt \
  --audience loopgraph-hermes-route-controller \
  --confirm <planDigest>
```

Check whether the stored receipt still matches the active Loopgraph catalog:

```bash
loopgraph hermes webhooks activation-status --project .
```

In the hosted runtime, Installed App maturity, activation gates, the Management routing read model, and measurement reconciliation resolve the same tenant-scoped distributed receipt. Hosted storage configuration fails closed instead of falling back to deployment-local disk, so separate replicas cannot disagree about whether Hermes actually applied the route contract.

Trusted Hermes administration turns can inspect the same plan and status through `loopgraph_hermes_webhooks_prepare` and `loopgraph_hermes_webhooks_activation_status`. Those tools are read-only and are absent from the isolated webhook-router and lifecycle-router MCP profiles. The mutating activation operation remains CLI/deployment-only so an incoming event can never change its own route or request a controller credential.

`ready=false` is expected while a provider connection or administrator confirmation is pending. It grants no execution authority. Provider writes remain controlled by connector capabilities, action fingerprints, approvals, and the normal Loopgraph promotion gates.

Installed App readiness uses this same receipt at Loop-ID granularity. Loopgraph matches the App's owned routed loops to the exact receipt routes. A provider-agnostic App route is specialized to the provider connection selected by its installation; another connected provider cannot silently claim the route. Business events emitted by Hermes or Loopgraph compile as authenticated internal routes with no provider subscription. Missing coverage, a stale plan, missing authentication verification, or any required non-active provider subscription blocks `connected` maturity and every App activation approval. A pending route for another App remains visible but does not block an otherwise complete App.

## Controller implementation requirements

The Hermes-side controller is intentionally a narrow adapter, not an arbitrary shell or HTTP proxy. It should implement one operation: reconcile the supplied additions and updates into shadow routes, then return the versioned receipt. It must not accept caller-supplied commands, scripts, provider URLs, secrets, or tool names outside the desired contract.

The current Loopgraph repository contains the client schemas, validation, CLI, local and distributed receipt stores, RLS migration, and fake-controller contract tests. Deploying a real controller, applying the migration to a hosted environment, and registering real provider applications remain environment-specific operations because an open-source repository cannot contain an enterprise's credentials, public domains, or cloud workload identities.
