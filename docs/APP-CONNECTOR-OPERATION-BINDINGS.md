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

Resolution itself never calls a provider and never returns secrets. A later executor must re-resolve
or verify the complete resolution, validate operation-specific inputs, and let the Connector Broker
recheck current tenant identity, scopes, connection health, kill switches, idempotency, and audit
policy at the moment of use. Provider writes must continue through exact prepared-action approval
and commit controls.

## Rollout and graph state

App rollout is not a display-only installation flag. Activating an App atomically rewrites the
routing mode of every active LoopSpec owned by that installation through the canonical LoopSpec
registry. Shadow and recommend modes remain non-executing routes; execute-with-approval makes the
owned loops eligible to produce governed route jobs. Pause returns all owned LoopSpecs to shadow,
while resume restores the last approved App mode.

The transition verifies that the installation still owns a complete active LoopSpec set. Missing
specs or routing contracts block the change. Each synchronization is revision-bound and
content-addressed, so an exact retry is idempotent but a later pause/resume cycle creates a new graph
transaction. The LoopSpec change is committed before the App registry state: if registry persistence
is interrupted, the older App state remains the stricter provider-operation authority.

This binding proves that a requested operation has a bounded implementation. It does not prove that
a real provider account is healthy or that an OAuth application has been registered. Those facts
still require live tenant onboarding, sandbox verification, webhook/transformer validation, and the
existing staged activation gates.
