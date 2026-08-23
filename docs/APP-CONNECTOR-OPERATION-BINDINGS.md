# Executable App connector bindings

A connected provider is not enough to make a Loopgraph App runnable. Each required logical
capability must resolve to one exact operation that the governed runtime can execute.

```text
logical capability
  -> Connector Recipe provider operation
  -> canonical bounded operation
  -> executor and broker capability
  -> tenant-scoped connection
```

For example:

```text
crm.lead.read
  -> hubspot.contacts.read
  -> hubspot:crm.contacts.read
  -> connector_broker / provider.data.read
  -> provider_hubspot_main
```

The first name is the provider-independent contract used by LoopSpecs and Hermes. The second is
the provider-facing operation declared by an immutable Connector Recipe. The third and fourth
must resolve to a descriptor in the compiled Hermes Connector Broker catalog. The final reference
identifies a tenant-scoped installation; it is not a credential or vault reference.

## Planning rules

The installation planner resolves every required and optional capability before installation:

1. Select the immutable Connector Recipe from the chosen preset.
2. Find the recipe binding for the logical capability.
3. Resolve its provider operation to a canonical broker descriptor or a governed Loopgraph runtime
   operation.
4. Reject provider writes whose recipe understates the authority required by the broker descriptor.
5. Require the union of the recipe scopes and the broker descriptor scopes.
6. Match a healthy tenant connection that grants the logical or broker capability, exact scopes,
   and sufficient read/write policy.
7. Record the result and its explanation in the content-digested install plan.

A provider connection cannot make an unsupported operation appear ready by advertising an arbitrary
capability string. Unsupported required operations remain explicit blockers and tell the operator to
choose another preset or install a reviewed adapter.

The default Product (`intercom-posthog-linear`), Sales (`hubspot-gmail-slack`), and Marketing
(`google-ads-hubspot-posthog`) presets have automated conformance coverage proving that every
required operation resolves to a bounded read descriptor. Optional operations remain blocked unless
their exact adapter exists; the planner does not infer a broader write from a narrower catalog entry.

## Installed contract

An applied installation persists two related maps:

- `connectionBindings`: logical capability to tenant connection ID.
- `operationBindings`: logical capability to provider, declared operation, canonical operation,
  executor, broker capability, minimum scopes, and connection ID.

Governed Loopgraph operations use `loopgraph_runtime` and require no provider credential. Provider
operations use `connector_broker` and require both a connection and an allowlisted broker capability.
The schemas reject a broker binding without a connection or a runtime binding that pretends to use a
provider connection.

Operation bindings are part of installation history. Updates create bindings from the newly reviewed
plan; rollback restores the exact prior binding set. Connection-binding asset digests include the
canonical operation, executor, capability, and scopes so a changed execution route is a changed
installation contract.

## Readiness and visibility

Readiness fails when any required capability lacks an executable binding, or when its broker
connection disagrees with the persisted connection map. The `connected` operational-maturity gate
uses the same requirement. Older installation records parse safely with an empty binding map and are
therefore asked to re-plan instead of being trusted under the old label-only behavior.

Hermes, CLI, MCP, and browser status calls receive the same secret-free installation record. The
Installed App screen shows the canonical `provider:operation` route and connection separately. No
access token, refresh token, webhook secret, credential namespace, or vault reference enters the App
registry.

## Hermes resolution boundary

Hermes does not send a provider ID, provider operation, connection ID, URL, headers, or credentials.
It requests one logical capability for one loop owned by one installation:

```text
installation ID + loop ID + logical capability
```

The read-only `loopgraph_app_operation_resolve` tool resolves that request against the current
installation registry and the exact active LoopSpec. It fails closed when the installation does not
own the loop, the loop does not declare the capability, a lifecycle operation needs recovery, the
exact connection changed, permission is forbidden or unresolved, or the App is not in an active
mode. A successful result binds the pinned App digest, LoopSpec version hash, permission, provider,
canonical operation, executor, broker capability, scopes, and connection into a five-minute,
content-digested resolution.

The disposition is deliberately narrow:

- `invoke_read` permits a bounded Connector Broker read.
- `invoke_loopgraph_runtime` permits a bounded internal read.
- `prepare_action` permits preparation of an action; it is not execution or approval.
- `blocked` includes explicit reasons and has no executable binding.

Resolution itself never calls a provider and never returns secrets. The
`loopgraph_app_operation_invoke` executor accepts only the same installation, loop, and logical
capability plus a durable route-job ID, registered Hermes agent ID, call ID, and bounded operation
input. It re-resolves the binding immediately before use and derives the tenant, provider,
connection, canonical operation, company object, LoopSpec hash, environment, and activation mode
from trusted installation and routing state.

Invocation fails before the Connector Broker unless all of the following remain true:

- the route job is active, belongs to the selected loop, requires the capability, and is bound to
  the exact active LoopSpec version;
- the selected Hermes agent has a fresh heartbeat, the capability, the correct environment and
  organization, and an assignment to the loop;
- the durable event and business problem agree on workspace, company, and company-object identity;
- the current Broker projection still has the exact provider, environment, capability, scopes,
  connection identity, and healthy state used by the binding; and
- the operation input is JSON-bounded and passes the central secret boundary.

A provider-read disposition executes the exact allowlisted Broker read. The internal
`invoke_loopgraph_runtime` disposition enters a fixed read-only registry with exactly three current
operations: bounded active topology, secret-free Hermes routing history, and observed outcome/value
evidence. Each handler has a strict input schema, enforces workspace/company filters, caps record and
response size, and returns a content-digested result. It cannot load a module, choose a file or URL,
run SQL, or mutate graph state. A provider-write disposition can only call
`prepareAction`, returning the immutable fingerprint that a separate approval and commit path must
consume. Before returning success, Loopgraph also records a separate secret-free App action
ownership proof. That record binds the prepared Broker action and prepare receipt to the exact
workspace, company, installed artifact, LoopSpec version, logical capability, route job, assigned
Hermes agent, provider binding, environment, and a digest of the affected company-object identity.
It never copies canonical provider input, provider output, credentials, headers, or vault
references out of Connector Broker storage. A hosted deployment records it through an audited,
service-role-only RPC in the tenant/project/workspace namespace; local mode writes an atomic
current-user-only ledger under `.loopgraph/apps/operation-actions.json`.

The read-only `loopgraph_app_operation_actions_get` tool gives Hermes, CLI, MCP, and the Installed
App screen the same filtered ownership records. The App operating topology renders prepared actions
and their human gates next to the exact owned loop, while expired records are derived visibly rather
than mistaken for executable work. A record is evidence that an action was prepared; it is not an
approval or a commit receipt.

### App-owned approval boundary

The installed App operations page approves an action by its Loopgraph App action ID. The browser never submits the provider, connection, provider operation, Broker action ID, or fingerprint. The server reloads the immutable action record, verifies the current pinned App artifact, loop ownership, rollout mode, and capability binding, and only then creates the Connector Broker approval for the stored fingerprint.

Approval requires the `integrations.manage` permission and hosted step-up authentication. Loopgraph appends a secret-free `approval_granted` lifecycle event containing the action-record digest, approval receipt identity, expiry, accountable actor, and a digest of the review reason. Review text remains in the authoritative Connector Broker control plane. An approval does not run the provider write; the later Hermes commit path must still revalidate the exact route and consume the receipt.

The same operator can revoke one prepared or approved App action without disabling the provider connection. Revocation takes only the App installation/action identity and a human reason from the browser. The server re-derives the Broker connection, action, and fingerprint, atomically changes the Broker action and every unused approval to `revoked`, writes an audited reason digest, and appends a matching App lifecycle event. A commit already in progress must be reconciled instead of being guessed safe; committed actions are immutable evidence and cannot be retroactively revoked.

This executor has no arbitrary HTTP fallback. Its separate
`loopgraph_app_operation_action_commit` method and workload-authenticated
`/api/hermes/apps/operations/commit` route accept only the App installation/action, original route
job, assigned agent, and stable call identity. They reload the immutable action and unexpired
approval event, re-resolve the pinned App operation, and revalidate the LoopSpec, company object,
route, durable assignment, connection health/scopes/environment, Broker prepared-action identity,
fingerprint, and absence of a revocation event before deriving the commit request. Commit-requested and terminal Broker receipt
facts are appended to the lifecycle ledger; canonical provider input remains only in Connector
Broker storage. The workload-authenticated `/api/hermes/apps/operations/invoke` route also rejects provider IDs,
operations, connection IDs, tenants, URLs, project roots, and workspace identities supplied by the
caller. That route requires its own durable, tenant-scoped `hermes.app_operations` workload grant;
the broader Connector Broker capability cannot substitute for it. The machine tenant is derived
from the verified deployment binding rather than a browser cookie. The Connector Broker
independently rechecks tenant identity, scopes, connection health, kill switches, idempotency, and
audit policy at the moment of use.

If Loopgraph records `commit_requested` but the App process stops before it can append the terminal
event, the action is treated as unknown—not safe to retry. The assigned Hermes route uses the
separate `loopgraph_app_operation_action_reconcile` method or workload-authenticated
`/api/hermes/apps/operations/reconcile` route. It supplies only the App action and original route
identity. Loopgraph re-derives the Broker tenant, action, fingerprint, operation, actor, and company
context, and the Broker looks up the original idempotency receipt. A matching durable response is
copied into secret-free terminal App evidence; `pending` causes Hermes to wait, while `unresolved`
requires operator investigation. Reconciliation never invokes a provider handler and never turns
an unknown outcome into permission for replacement work.

Hosted deployments also run `/api/cron/app-action-reconciliation` every five minutes under the
dedicated `schedule.app_action_reconciliation` workload capability. The worker considers only
`commit_requested` events older than one minute, excludes revoked or terminal actions, and sends at
most 25 exact App action identities through the same receipt-only reconciliation boundary. Stable
call identities and receipt-derived terminal timestamps make concurrent retries idempotent. The
worker response contains only action/request identities, bounded status codes, and counts—never
provider input, output, credentials, or raw errors.

## Rollout and graph state

App rollout is not a display-only installation flag. Activating an App atomically rewrites the
routing mode of every active LoopSpec owned by that installation through the canonical LoopSpec
registry. Shadow and recommend modes remain non-executing routes; execute-with-approval makes the
owned loops eligible to produce governed route jobs. Pause returns all owned LoopSpecs to shadow,
while resume restores the last approved App mode.

Rollout eligibility is also not a display-only maturity label. Before approval, the shared App
service derives a canonical activation gate from the exact artifact, current lifecycle state,
connector/configuration readiness, replay review, completed runs, observed outcomes, net-value
evidence, and permissions. Shadow requires connected maturity, recommend requires a passing and
fully labeled replay recommendation, and execute-with-approval requires production-proven maturity.
The approval receipt embeds that gate; consumption recomputes it and fails closed if evidence is no
longer sufficient. Human approval supplies accountability, not a bypass around missing evidence.

The transition verifies that the installation still owns a complete active LoopSpec set. Missing
specs or routing contracts block the change. Each synchronization is revision-bound and
content-addressed, so an exact retry is idempotent but a later pause/resume cycle creates a new graph
transaction. The LoopSpec change is committed before the App registry state: if registry persistence
is interrupted, the older App state remains the stricter provider-operation authority.

This binding and executor prove that a routed job has a bounded implementation, current trusted
connection, and exact approval-bound commit path. They do not prove that a new OAuth application has
been registered correctly or that a prepared write should be approved. Those facts still require
live tenant onboarding, sandbox verification, webhook/transformer validation, and the existing staged activation and action-commit
gates. The non-read `loopgraph.graph-change.propose` operation remains behind the existing semantic
graph proposal, review, and transaction boundary; it is not silently treated as a read or a provider
operation.
