# Native Hermes Plugin

Loopgraph ships a narrow native plugin for [Hermes Agent](https://github.com/NousResearch/hermes-agent). It turns the GitHub repository into an opt-in Hermes integration without putting routing policy, provider credentials, or business execution inside Python plugin code.

## Install

From an existing empty company project directory:

```bash
hermes plugins install mrrkrieg/loopgraph/integrations/hermes-plugin --enable
hermes plugins doctor loopgraph --ci
hermes loopgraph plan --project .
hermes loopgraph install --project . --yes
```

Restart Hermes, then say `start Loopgraph`.

Hermes supports repository subdirectory installs. Loopgraph intentionally uses that form because the full repository contains security regression fixtures with fake credentials and hostile prompt text. Those fixtures must remain testable application source, but they are not part of the executable plugin boundary. Hermes scans only `integrations/hermes-plugin` during plugin installation.

## Trust and bootstrap contract

Plugin registration is standard-library-only, offline, and read-only. It registers:

- the `loopgraph:design` skill;
- the `loopgraph:event-router` skill;
- an exact `start Loopgraph` onboarding hint;
- `/loopgraph` help;
- `hermes loopgraph plan|install|doctor|start|webhooks|version`.

It does not register business-operation tools. Those come from Loopgraph's existing scoped MCP servers after explicit setup.

`hermes loopgraph plan` performs no writes. It reads Hermes's installation metadata and returns the exact 40-character Git revision, expected package-lock digest, target project, commands, and write boundaries.

`hermes loopgraph install --yes` then:

1. initializes a plugin-owned staging repository;
2. fetches only the exact revision recorded by Hermes—never a mutable tag or branch;
3. verifies the checked-out commit, package version, trusted origin, and package-lock SHA-256;
4. runs `npm ci --ignore-scripts` so dependency lifecycle scripts cannot execute during installation;
5. explicitly builds the Loopgraph package;
6. requires `npm audit --omit=dev` to pass;
7. atomically replaces the plugin-owned runtime;
8. delegates to the existing Loopgraph setup and Doctor paths.

The generated MCP registrations use exact argv arrays and three different exposures: interactive administration, isolated webhook routing, and notification-only lifecycle routing. No shell command strings are constructed.

## Data and credential boundary

The plugin may write its reproducible runtime under its own installed directory and project state under the operator-selected `.loopgraph/` directory. It never accepts OAuth tokens, webhook signing secrets, provider API keys, raw provider records, or vault material. Those remain in Hermes Connector Broker or an approved enterprise secret store.

Local installation starts empty. Hosted-preview loops and example operations are never copied into a company project.

## Update and recovery

Inspect the current adapter and runtime binding:

```bash
hermes loopgraph version
hermes loopgraph doctor --project .
```

Update the adapter through Hermes, review the new immutable plan, and rebuild its plugin-owned runtime:

```bash
hermes plugins update loopgraph
hermes plugins doctor loopgraph --ci
hermes loopgraph plan --project .
hermes loopgraph install --project . --yes
```

If Hermes installation metadata is unavailable in a contributor checkout, pass an exact commit explicitly:

```bash
hermes loopgraph plan --project . --ref <40-character-commit-sha>
```

The adapter refuses short SHAs, mutable refs, a different origin, version drift, and package-lock drift. A failed staged build does not replace the last complete runtime.

## Webhook rehearsal

The plugin delegates to the same non-secret route contract as the CLI:

```bash
hermes loopgraph webhooks plan --project .
hermes loopgraph webhooks sync --project . --dry-run
hermes loopgraph webhooks doctor --project .
hermes loopgraph webhooks test --project . --fixture event.json --require-synced-manifest
```

These commands do not create provider credentials or grant live execution. Real provider subscriptions and signing material remain Hermes-owned, and new routes remain shadow-only until their separate activation receipt is current.

## Disconnect and remove

Disconnect the three Loopgraph MCP registrations before removing the plugin:

```bash
hermes loopgraph disconnect --project . --yes
hermes plugins remove loopgraph
```

Disconnect preserves the project's `.loopgraph/` company data, Hermes-managed provider credentials, installed skills, unrelated MCP servers, and other plugins. It removes the local activation receipt only after all three Hermes MCP removals succeed; an incomplete removal preserves the receipt so Doctor cannot report a false clean disconnect.
