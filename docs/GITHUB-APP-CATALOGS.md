# Signed GitHub App catalogs

Loopgraph can synchronize a signed App catalog from GitHub without treating repository content as executable code. The checkout is an untrusted staging area until the exact commit, canonical catalog digest, publisher signatures, pack schemas, path confinement, compatibility, and per-file artifact digests all pass.

## Publisher flow

Publish signed apps into a project-local catalog, then commit that catalog to a dedicated GitHub repository:

```bash
npm run loopgraph -- app keygen acme --id acme.release.primary
npm run loopgraph -- app sign apps/customer-risk --key acme.release.primary
npm run loopgraph -- app publish apps/customer-risk --catalog acme.private
```

The key-generation/signing output contains the exact publisher trust material. The publish result includes `catalogRoot` and `snapshotDigest`. Commit the catalog root without rewriting its files and record the resulting full Git commit hash.

## Consumer trust contract

Create a source document with all trust values supplied out of band by the catalog owner:

```json
{
  "schemaVersion": "loopgraph-marketplace/v1alpha1",
  "id": "acme-private-github",
  "type": "github",
  "uri": "https://github.com/acme/loopgraph-apps.git",
  "pinnedRef": "0123456789abcdef0123456789abcdef01234567",
  "expectedDigest": "sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
  "enabled": true,
  "trustPolicy": "signed",
  "trustedPublisherKeys": [
    {
      "publisherId": "acme",
      "keyId": "acme.release.primary",
      "algorithm": "ed25519",
      "publicKey": "-----BEGIN PUBLIC KEY-----\n...\n-----END PUBLIC KEY-----"
    }
  ]
}
```

Register and refresh it through the shared App Platform service:

```bash
npm run loopgraph -- app source-add --file acme-github-source.json
npm run loopgraph -- app source-refresh acme-private-github
npm run loopgraph -- app search
```

Hermes can call the equivalent `loopgraph_marketplace_source_add` and `loopgraph_marketplace_source_refresh` tools. The source contract must still contain the operator-approved commit, digest, and public keys; Hermes must not invent or silently trust them.

## Security properties

- Only HTTPS repository URLs on the configured trusted Git hosts are accepted. The default host is `github.com`.
- URLs containing credentials, custom ports, query parameters, fragments, or nested repository paths are rejected.
- Branches and tags are rejected. `pinnedRef` must be a full 40- or 64-character commit hash.
- Remote catalogs must use signed trust and pin the exact publisher ID, algorithm, key ID, and public key.
- Git runs non-interactively with repository hooks, external protocols, file transport, and credential helpers disabled.
- Git also ignores ambient `GIT_*`, global, and system configuration so an allowlisted repository cannot be silently rewritten by host Git settings.
- The checkout is validated in a unique staging directory. It is promoted to the content-addressed cache only when the computed catalog snapshot digest matches `expectedDigest`.
- Third-party app IDs must live under their publisher namespace (for example, `acme.sales.*`). The `loopgraph.*` and verified-publisher namespaces are reserved for bundled official apps, and one publisher cannot replace another publisher's existing app ID.
- A failed commit, signature, schema, path, file, or digest check removes the staging checkout and leaves the marketplace index unchanged.
- Cached artifacts are reloaded through the same signature and digest checks after process restart.
- Installing an app from the synchronized catalog still creates a separate read-only plan. Synchronization never installs an app, activates a LoopSpec, or enables provider writes.

GitHub Enterprise hosts are opt-in through the runtime's `trustedGitHosts` option or a comma-separated `LOOPGRAPH_TRUSTED_GIT_HOSTS` value for CLI and Hermes tools. Values are exact hostnames; wildcards and URL fragments are not accepted. The default Git transport is intentionally non-interactive and disables ambient credential helpers, so it is suitable for public repositories. A private-repository deployment must inject an authenticated `GitHubCatalogSynchronizer` backed by workload identity or another constrained broker; tokens must never be embedded in `uri`.

This transport is an immutable GitHub tap, not the hosted multi-tenant marketplace control plane. Organization identity, remote key custody, tenant-scoped object storage, billing, revocation fan-out, and independent retention remain separate hosted deployment layers.
