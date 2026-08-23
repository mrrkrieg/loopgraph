# Hosted workload issuer rotation staging gate

Loopgraph can verify new workload signing keys immediately, but a production claim needs more than
unit tests. This gate rotates one disposable staging issuer key through a protected controller,
observes the public JWKS directly, exercises two deployed Loopgraph origins, and proves the retired
key stops authorizing work.

The drill uses the existing `marketplace.consume` machine boundary because it includes issuer,
signature, audience, tenant/project, durable grant, replay, rate, and audit enforcement. It does not
read an App artifact, install anything, call a provider, or enable writes.

## Required lifecycle

Use a disposable previous/next key pair and two short-lived JWTs for the same staging workload:

1. The live JWKS contains the previous key and not the next key.
2. Both the primary and replica accept the previous-key token, warming independent verifier caches.
3. A narrow controller publishes both public keys.
4. Both deployments accept the next-key token before their old JWKS cache TTL expires. This proves
   the bounded rotation refresh path, not an ordinary cache refresh.
5. The controller removes the previous public key.
6. The validator observes the new-only JWKS and waits beyond Loopgraph's five-minute maximum JWKS
   cache lifetime.
7. Both deployments reject the still-unexpired previous-key token with `401` and continue accepting
   the next-key token.
8. The verified tenant audit chain contains the final accepted next-key request.

The verifier caps any provider-advertised JWKS `max-age` at 300 seconds. Unknown new key IDs still
trigger one immediate deduplicated refresh, while attacker-controlled misses remain throttled.

## Rotation controller protocol

The gate does not accept an arbitrary command, script, URL template, header map, or provider API
proxy. An enterprise supplies one reviewed HTTPS endpoint that implements exactly two operations:
`publish_overlap` and `retire_previous`.

Request:

```json
{
  "schemaVersion": "loopgraph-issuer-rotation-controller-request/v1",
  "rotationId": "staging-rotation-2026-08-23",
  "issuer": "https://identity.example",
  "operation": "publish_overlap",
  "previousKid": "staging-key-a",
  "nextKid": "staging-key-b"
}
```

Response:

```json
{
  "schemaVersion": "loopgraph-issuer-rotation-controller-receipt/v1",
  "receiptId": "issuer-receipt-001",
  "rotationId": "staging-rotation-2026-08-23",
  "issuer": "https://identity.example",
  "operation": "publish_overlap",
  "previousKid": "staging-key-a",
  "nextKid": "staging-key-b",
  "changed": true,
  "completedAt": "2026-08-23T12:00:00.000Z"
}
```

Build a small provider adapter behind this protocol. It must allow only the protected rotation ID
and exact two key IDs, use provider-native workload identity or an HSM/KMS-backed control plane,
reject replay, log its own administrative action, and return no private key material. The Loopgraph
runner independently verifies the resulting JWKS and deployed authorization behavior, so the
controller receipt alone cannot make the gate pass.

## Protected runner configuration

```dotenv
LOOPGRAPH_STAGING_ISSUER_ROTATION_PRIMARY_URL=https://staging.loopgraph.example
LOOPGRAPH_STAGING_ISSUER_ROTATION_REPLICA_URL=https://staging-replica.loopgraph.example
LOOPGRAPH_STAGING_ISSUER_ROTATION_AUDIENCE=https://staging.loopgraph.example/marketplace
LOOPGRAPH_STAGING_ISSUER_ROTATION_ORGANIZATION_ID=123e4567-e89b-42d3-a456-426614174000
LOOPGRAPH_STAGING_ISSUER_ROTATION_PROJECT_KEY=main
LOOPGRAPH_STAGING_ISSUER_ROTATION_ISSUER=https://identity.example
LOOPGRAPH_STAGING_ISSUER_ROTATION_JWKS_URI=https://identity.example/.well-known/jwks.json
LOOPGRAPH_STAGING_ISSUER_ROTATION_CONTROLLER_URL=https://rotation-broker.example/v1/issuer-rotation
LOOPGRAPH_STAGING_ISSUER_ROTATION_ID=staging-rotation-2026-08-23
LOOPGRAPH_STAGING_ISSUER_ROTATION_PREVIOUS_KID=staging-key-a
LOOPGRAPH_STAGING_ISSUER_ROTATION_NEXT_KID=staging-key-b
LOOPGRAPH_STAGING_ISSUER_ROTATION_MAX_PROPAGATION_SECONDS=120
LOOPGRAPH_STAGING_ISSUER_ROTATION_RETIREMENT_GRACE_SECONDS=305
LOOPGRAPH_STAGING_ISSUER_ROTATION_PREVIOUS_TOKEN_FILE=/run/secrets/loopgraph/issuer-previous.jwt
LOOPGRAPH_STAGING_ISSUER_ROTATION_NEXT_TOKEN_FILE=/run/secrets/loopgraph/issuer-next.jwt
LOOPGRAPH_STAGING_ISSUER_ROTATION_CONTROLLER_TOKEN_FILE=/run/secrets/loopgraph/issuer-controller.jwt
LOOPGRAPH_STAGING_OBSERVABILITY_TOKEN_FILE=/run/secrets/loopgraph/observability.jwt
```

All four token paths must be absolute, regular, non-symlink files with mode `0600`. The previous and
next tokens must be unexpired for at least two minutes when the drill starts, use distinct key IDs
and token IDs, carry the exact issuer/audience/tenant/project, and grant only
`marketplace.consume`. The controller and observability identities stay separate.

Run once from the protected, isolated runner:

```bash
npm run validate:workload-issuer-rotation-staging \
  > workload-issuer-rotation-staging-receipt.json
```

The receipt contains the two public origins, public issuer/JWKS identity, key IDs, controller-receipt
digests, eight fixed check results, and one verified audit checkpoint. It never contains JWTs,
private keys, controller credentials, App data, provider payloads, or raw audit events. Destroy the
disposable previous private key and rotate all projected tokens after the drill.

An environment-specific execution is still external evidence until this receipt is added to the
protected release workflow, independent audit retention, and production promotion manifest.
