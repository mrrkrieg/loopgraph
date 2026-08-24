# Local Loopgraph supervisor

`loopgraph setup` and `loopgraph start` are the default local operating path. The lower-level commands remain available for diagnosis and hosted worker deployment, but a local user should not need to coordinate them manually.

## Setup contract

From a repository clone:

```bash
npm run loopgraph -- setup --project . --activate
```

Setup performs a bounded, recoverable sequence:

1. Initialize an empty `.loopgraph` workspace with preview data disabled.
2. Generate the project-local Hermes skills and least-privilege MCP profiles.
3. Optionally apply Hermes MCP and skill registrations when `--activate` is present.
4. Compile and synchronize non-secret provider and lifecycle route metadata.
5. Verify the generated route manifest against the active routing catalog.
6. Prepare the Studio launch plan using the same explicit project root.
7. Print the first Hermes prompt and any blocking recovery action.

Setup never installs a LoopPack, creates a demo loop, enables a provider write, or copies a provider credential into `.loopgraph`. Without `--activate`, it writes project-local artifacts only so an operator can inspect them before changing Hermes configuration.

## Start contract

```bash
npm run loopgraph -- start --project .
```

From a repository clone, one command starts the Next.js Studio and the local supervisor. From a package that does not bundle Studio, the same command runs headlessly and explains that limitation. `Ctrl+C` sends a graceful stop to both processes.

The supervisor owns these components:

| Component | Responsibility | Default cadence |
|---|---|---:|
| Workspace | Preserve an empty-or-user-owned local registry; never inject preview loops | 5 minutes |
| Hermes | Verify generated artifacts, MCP exposure, protocol compatibility, and CLI availability | 5 minutes |
| Routes | Recompile Loopgraph-managed route metadata while preserving sanitized external route references | 5 minutes |
| Connections | Reconcile required capabilities, scopes, health, route state, and overdue evidence | 1 hour |
| Measurements | Create idempotent jobs for due metric windows; Hermes still owns provider collection | 1 minute |
| Route worker | Claim and process governed route jobs through their configured activation mode | 5 seconds |
| Opportunities | Detect repeated problems, corrections, failures, friction, and missing loops | 15 minutes |
| App updates | Compare installed immutable versions with trusted catalog versions without applying changes | 1 hour |
| Controller | Process durable improvement triggers under controller policy | 5 seconds |

The fast poll never causes slow components to run early. The first cycle and every new supervisor process run a complete check; later cycles reuse the last component result until that component is due.

## Ownership and crash safety

The supervisor acquires `.loopgraph/supervisor/lock.json` with an exclusive filesystem create. A second process cannot own the same project. A stale lock from a dead process on the same host is reclaimed once; a lock from another host fails closed because local code cannot prove the remote owner is dead.

Every completed cycle atomically replaces `.loopgraph/supervisor/status.json`. It records component health, bounded counts, redacted errors, and recommended actions—not raw provider payloads, bearer tokens, OAuth material, vault references, or arbitrary connector responses. The Brain page reads this projection to show running/stopped state and the latest aggregate result.

## Health semantics

- **Healthy**: the component completed and found no execution blocker.
- **Degraded**: useful operation can continue, but a non-critical check or queued item needs attention.
- **Blocked**: a safety or runtime boundary prevents affected work from proceeding.

One component failure does not stop unrelated components in the same cycle. Errors pass through the central secret redactor before persistence or CLI output. Aggregate health is the most severe current component result.

## Diagnostic mode

Run every component once without starting Studio:

```bash
npm run loopgraph -- start --project . --once
```

Use `--json` for one machine-readable status object. A blocked one-cycle result exits non-zero. The default human output includes component summaries, recommended next actions, and the status-file location.

## Safety boundaries

- Route synchronization changes project-local metadata only; Hermes owns real webhook subscriptions.
- Measurement scheduling creates bounded jobs only; provider reads require a connected, capability-scoped Hermes collector.
- App update checks are read-only. Updates still require graph/permission diff review and an explicit apply action.
- The worker does not bypass activation, connection, approval, immutable-spec, or prepared-action checks.
- The controller remains constrained by policy; auto-applied changes are limited and stay in shadow mode.
- Provider tokens remain in Hermes or an approved vault. The supervisor receives only non-secret metadata and governed runtime receipts.

## Advanced controls

The existing commands remain supported:

```bash
npm run loopgraph -- studio --project . --start
npm run loopgraph -- worker run --project . --watch
npm run loopgraph -- controller run --project . --watch
npm run loopgraph -- measurements schedule --project .
npm run loopgraph -- connections reconcile --project .
npm run loopgraph -- hermes webhooks sync --project .
```

Do not run a standalone watcher against the same local project while `loopgraph start` owns that subsystem unless you are deliberately testing lease and idempotency behavior.
