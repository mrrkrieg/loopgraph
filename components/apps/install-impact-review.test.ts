import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { InstallImpactReview } from "./install-impact-review";

describe("InstallImpactReview", () => {
  it("renders the exact additions, reuse, conflicts, authority, metrics, and evidence edges", () => {
    const html = renderToStaticMarkup(React.createElement(InstallImpactReview, {
      appName: "Qualify and Route Inbound Leads",
      department: "sales",
      plan: {
        initialMode: "shadow",
        assets: [{ id: "loop.sales.qualify", kind: "loop_spec" }],
        graphDiff: { nodesAdded: ["sales.qualify"], edgesAdded: ["lead-to-qualify"] },
        requiredTests: ["routing", "ambiguous"],
        rollback: { preserveSharedAssets: true, removeStagedAssets: true }
      },
      impact: {
        additions: [{ id: "loop.sales.qualify", kind: "loop_spec" }],
        reusedAssets: [
          { id: "graph-node.object.account", kind: "graph_node" },
          { id: "connection-binding.hubspot.production", kind: "connection_binding" }
        ],
        reusedDependencies: [],
        conflicts: [{ kind: "shared_company_object", resourceId: "graph-node.object.account", reason: "Contract differs.", blocking: true }],
        permissions: [{ capability: "crm.lead.read", authority: "read", decision: "allow", reason: "Read lead evidence.", changedFromInstalled: false }],
        metrics: [{ id: "qualified-rate", loopName: "Lead Qualification", metric: "qualified lead rate", direction: "increase" }],
        evidenceEdges: [{ id: "account-to-qualify", source: "Account", target: "Lead Qualification", type: "evidence_in", reason: "Account evidence is required." }]
      }
    } as never));

    expect(html).toContain("What Loopgraph will add");
    expect(html).toContain("loop.sales.qualify");
    expect(html).toContain("What it will reuse");
    expect(html).toContain("connection-binding.hubspot.production");
    expect(html).toContain("Blocking conflicts must be resolved");
    expect(html).toContain("Read lead evidence");
    expect(html).toContain("qualified lead rate");
    expect(html).toContain("Account");
    expect(html).toContain("Lead Qualification");
    expect(html).toContain("Hermes Brain");
    expect(html).toContain("Preserve shared assets");
  });
});
