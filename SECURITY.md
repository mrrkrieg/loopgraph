# Security

Loopgraph is designed to be local-first and safe-by-default. Hermes is the company brain and production webhook ingress point; Loopgraph stores local workspace state, generated LoopSpecs, routing contracts, route receipts, traces, review packets, and simulation results.

## Reporting a vulnerability

Please report security issues privately to the maintainers. Do not open public issues for sensitive vulnerabilities, secrets, exploit details, or provider payloads.

Include:

- the affected commit or release;
- reproduction steps using redacted fixtures where possible;
- the expected vs actual security boundary;
- whether live credentials, webhook secrets, customer data, or provider payloads were exposed.

## Safe defaults

- `loopgraph hermes setup --project .` writes only project-local files under `.loopgraph/`.
- Generated Hermes MCP config contains local command paths, tool names, protocol versions, and skill directories only.
- Provider webhooks should terminate at Hermes, not directly at Loopgraph workflow routes.
- OAuth tokens, API keys, webhook signing secrets, and raw provider payloads must stay in Hermes or an approved credential store.
- New loops start in shadow/simulation mode.
- Live external writes require connected capabilities, policy approval, and fingerprint-bound prepared actions.
- Sensitive departments should stay in shadow mode unless explicit expert approval is configured.

## Dependency checks

Before connecting live provider credentials or production webhook routes, run:

```bash
npm run audit:prod
```

Treat production dependency audit findings as blockers for live credentials. It is acceptable to use local discovery, generated loop design, redacted fixtures, and simulation while remediating audit findings because those flows do not store provider secrets or perform live external writes.

`npm install` and plain `npm audit` include developer-only lint/build tooling. Those findings still matter for contributor machines, but they are separate from the live-credential gate because they are not part of the shipped Loopgraph/Hermes runtime path.

Avoid `npm audit fix --force` unless you have reviewed the dependency graph and tested the resulting app/runtime. Forced fixes can downgrade major framework versions, break the lint toolchain, or change transitive runtime behavior.

## Generated files and secrets

The following files are expected to be non-secret and safe to review:

```text
.loopgraph/workspace.json
.loopgraph/hermes/install.json
.loopgraph/hermes/mcp.loopgraph.yaml
.loopgraph/hermes/skills/
.loopgraph/hermes-routes.json
```

Do not commit or paste:

- provider API keys;
- OAuth refresh/access tokens;
- webhook signing secrets;
- raw customer data or unredacted provider payloads;
- exported Hermes credential stores.

## Supported security posture

The current public flow supports local discovery, governed loop design, route planning, webhook fixture rehearsal, simulation, traces, reviews, and case resolution. Live execution and OAuth connector enablement should be treated as an explicit deployment decision, not a default install behavior.

Authenticated hosted deployments additionally require the Supabase Auth, organization membership,
RLS, and server-only credential boundary described in
[Hosted authentication and tenant security](docs/HOSTED-SECURITY.md). The current hosted runtime is
safe only as one organization/project and one active writer per persistent runtime deployment; a
shared multi-customer filesystem worker is not a supported production topology. See
[Hosted runtime namespaces](docs/HOSTED-RUNTIME-NAMESPACES.md).

Hosted worker, scheduler, signed Hermes callback, and signed provider-forwarding endpoints also
require the scoped identity, replay, body, and durable rate controls in
[Machine request guards](docs/MACHINE-REQUEST-GUARDS.md).
