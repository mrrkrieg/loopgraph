# Loopgraph App Platform contracts

Status: accepted for the local-first App Platform implementation.

## Decision

Loopgraph will expose an outcome-oriented application model while retaining the existing loop runtime as its execution substrate.

An installed app is computed from:

```text
immutable LoopPack version and digest
+ selected modules
+ connector recipe
+ preset
+ approved company context
+ installation configuration
+ typed workspace overlay
+ policy and rollout mode
```

The result is compiled into the existing Loopgraph primitives: LoopSpecs, Hermes skills, routing cards, event contracts, connection bindings, field mappings, schedules, metrics, fixtures, evaluations, graph nodes and edges, readiness checks, and asset ownership records.

## Why the boundary matters

The repository already has the technical pieces needed to run governed loops. It did not have one immutable, distributable unit that a company can discover, inspect, configure, rehearse, install, operate, update, and remove as a coherent product. `LoopPack` supplies that unit. `WorkspaceAppInstallation` records how a company uses it without mutating the upstream artifact.

## Three separate registries

The platform must not collapse three different sources of truth:

1. The marketplace registry lists available apps and immutable versions.
2. The installation registry records workspace configuration, overlays, provider bindings, permissions, lifecycle state, and owned assets.
3. The runtime registry contains the generated LoopSpecs and active runtime resources Hermes can route to.

Marketplace metadata cannot prove that an app is installed. An installation record cannot prove that its generated loops are active. Runtime resources cannot reconstruct publisher provenance or installation intent on their own.

## Trust and safety boundary

A pack is data, not executable code. It is untrusted until all of these checks pass:

- strict, versioned schema validation;
- safe relative-path and file-enumeration validation;
- canonical per-file and artifact digest verification;
- compatibility and dependency resolution;
- credential, token, and private-data scanning;
- explicit logical-capability and permission review;
- generated LoopSpec validation;
- synthetic conformance tests and promotion rehearsals.

Installation is content-bound by an `AppInstallPlan` digest and committed atomically. Provider writes are never enabled by installation. Every new app starts in simulation or shadow mode.

## Quality evidence and historical replay

Marketplace maturity is derived from recorded evidence, not publisher claims. Every marketplace-ready app must cover the happy path, missing context, exclusions, duplicates, ambiguity, low confidence, unavailable connectors, missing fields, approval gates, customer-facing actions, missing outcomes, retries/idempotency, and upgrade/rollback.

Synthetic conformance evaluates the declared fixture through the compiled routing contract and policy surface; referencing an existing fixture or loop ID alone is not a passing test. Historical replay accepts only a bounded normalized dataset:

- no more than 500 events;
- no more than a 90-day range;
- every event inside the approved range;
- read capabilities only and zero provider writes;
- payloads reduced to decision evidence in the durable evaluation record;
- entity ambiguity, missing context, connection state, exclusions, and approval policy remain active.

Reviewers may label each historical decision `correct`, `incomplete`, or `false_positive` and record review minutes. The promotion recommendation separates routing quality from review burden and always returns `canAutoPromote: false`; an accountable owner must still approve a lifecycle transition.

## Configuration precedence

Configuration is resolved in this deterministic order:

```text
pack default
< selected preset
< approved company context
< installation configuration
< workspace overlay
```

Every resolved value retains its winning layer and provenance. Hermes should infer values from trusted context first, explain the evidence, ask only for missing or uncertain values, and request confirmation for high-impact values before saving them to shared company context.

## Updates and customization

Published artifacts are immutable. Company changes are typed overlay operations. Updates use a three-way merge between the original base, the company overlay, and the new base. Permission changes and graph changes are visible before apply. Unresolved conflicts block the update. Rollback restores the previous pinned version and digest.

Every configure, overlay, repair, duplicate, detach, update, rollback, and uninstall mutation records a versioned lifecycle receipt with the previous and resulting registry revisions, artifact digests, accountable actor, retained-evidence flag, removed assets, and preserved shared assets. Mutations use optimistic content bindings so stale CLI, Hermes, or browser clients cannot overwrite a newer configuration, overlay, or artifact.

Private duplication namespaces every generated LoopSpec and installation-owned asset, so a derived app can coexist with its upstream installation without overwriting active routes. Detach copies the exact verified LoopPack bytes into a confined workspace snapshot, records the snapshot path, and disables future upstream updates. It does not rewrite the original marketplace artifact.

## Removal and shared assets

Every generated asset records owner installation IDs and a reference count. Uninstall removes only assets exclusively owned by the target installation. Shared connections, field mappings, company context, entity identities, and historical evidence remain available to other installations.

The runtime LoopSpec registry supports content-bound writes and removals in one revision. App uninstall removes the target installation's active generated LoopSpecs, releases its asset references, detaches—but does not delete—shared mapping and context consumer references, preserves evaluation history, and writes a final uninstall receipt.

## Public contracts

The strict Zod schemas and generated JSON Schemas live in `packages/loopgraph/src/core/app-platform.ts`. They are exported from `loopgraph/core` and must be reused by runtime services, CLI, MCP, and browser APIs. A client-specific shadow schema is not allowed.

## Publisher and catalog trust

The local-first publisher is a project-confined service shared by Hermes, MCP, and the CLI. `app init` creates a complete private starter and `app capture` derives a pack from an exact installed artifact. Capture never copies installation configuration values, secrets, credentials, or provider payloads; it reports only key names and overlay paths that require deliberate parameterization.

Before signing, the service performs strict pack validation, generated LoopSpec compilation, connector/setup/evaluation parsing, secret scanning, and the complete deterministic conformance suite with provider writes blocked. Third-party packs cannot mark their publisher verified or claim official visibility.

Pack signatures use a detached `loopgraph.pack.signature.json` sidecar over the canonical artifact digest. Project-local Ed25519 private keys are mode `0600` and excluded from Git through `.loopgraph/`. APIs return only the public key and its fingerprint. The detached signature is excluded from the content digest so a pack has one stable content identity, but archive and directory readers still verify the signature bytes and provenance.

A signed catalog trust policy pins all four trust attributes:

```text
publisher ID
+ signature algorithm
+ key ID
+ exact normalized public key
```

Key-ID equality alone is insufficient and is explicitly rejected. Marketplace refresh cryptographically verifies every signed pack against the source's pinned keys, and cached artifact reads reapply the same trust policy. Published `appId@version` content is immutable: the same digest is idempotent, while a different digest for the same version is rejected. Catalog release metadata can mark an exact digest deprecated or revoked; neither status is eligible for new resolution.

Private filesystem catalogs are the current distribution boundary. Hosted organization catalogs require authenticated tenant isolation, remote signing or customer-managed key custody, replicated immutable object storage, audit retention, and marketplace control-plane operations before being described as production hosted publishing.
