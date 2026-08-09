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

## Removal and shared assets

Every generated asset records owner installation IDs and a reference count. Uninstall removes only assets exclusively owned by the target installation. Shared connections, field mappings, company context, entity identities, and historical evidence remain available to other installations.

## Public contracts

The strict Zod schemas and generated JSON Schemas live in `packages/loopgraph/src/core/app-platform.ts`. They are exported from `loopgraph/core` and must be reused by runtime services, CLI, MCP, and browser APIs. A client-specific shadow schema is not allowed.

