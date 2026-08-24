/**
 * Compile-time authority for operations supplied by Loopgraph itself.
 *
 * `registered` means the route-bound App executor can run the operation today.
 * Non-read graph changes intentionally remain in the semantic graph
 * proposal/review/transaction boundary.
 */
export const LOOPGRAPH_RUNTIME_OPERATION_CATALOG = [
  {
    providerOperation: "loopgraph.graph.read",
    operation: "graph.read",
    mode: "read",
    registered: true,
    description: "Read the bounded active company loop topology."
  },
  {
    providerOperation: "loopgraph.routing-decisions.read",
    operation: "routing-decisions.read",
    mode: "read",
    registered: true,
    description: "Read bounded Hermes routing decisions without provider payloads."
  },
  {
    providerOperation: "loopgraph.outcomes-value.read",
    operation: "outcomes-value.read",
    mode: "read",
    registered: true,
    description: "Read bounded observed outcome and value evidence."
  },
  {
    providerOperation: "loopgraph.graph-change.propose",
    operation: "graph-change.propose",
    mode: "prepare",
    registered: false,
    description: "Prepare a semantic graph proposal through the separate review boundary."
  }
] as const;
