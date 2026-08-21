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

This binding proves that a requested operation has a bounded implementation. It does not prove that
a real provider account is healthy or that an OAuth application has been registered. Those facts
still require live tenant onboarding, sandbox verification, webhook/transformer validation, and the
existing staged activation gates.
