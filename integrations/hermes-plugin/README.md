# Loopgraph for Hermes Agent

This is the dependency-free native Hermes adapter for Loopgraph. Install this subdirectory so Hermes scans only the plugin boundary—not Loopgraph's security fixtures and full application source:

```bash
hermes plugins install mrrkrieg/loopgraph/integrations/hermes-plugin --enable
```

Then create or open an empty company project directory and run:

```bash
hermes loopgraph plan --project .
hermes loopgraph install --project . --yes
```

The first command is read-only. It prints the exact Git commit and package-lock digest. `--yes` fetches that immutable revision into plugin-owned runtime storage, rejects a different lockfile, installs dependencies with lifecycle scripts disabled, builds the package, requires a clean production audit, creates an empty local workspace, and registers the restricted MCP profiles.

Restart Hermes and say `start Loopgraph`. Provider credentials are not accepted or stored by this plugin.

Before removing the plugin, run `hermes loopgraph disconnect --project . --yes`. This removes only the three Loopgraph MCP registrations and preserves company data and Hermes-owned credentials.
