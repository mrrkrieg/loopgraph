import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { NodeInspector } from "./node-inspector";
import type { BrainGraphNode } from "./graph-types";

describe("NodeInspector", () => {
  it("renders a focused workflow loop summary", () => {
    const html = renderToStaticMarkup(
      React.createElement(NodeInspector, {
        node: workflowNode(),
        edges: [],
        onOpenLocal: () => undefined
      })
    );

    expect(html).toContain("Lead Qualification Loop");
    expect(html).toContain("workflow loop");
    expect(html).toContain("Primary metric");
    expect(html).toContain("Open loop detail");
  });
});

function workflowNode(): BrainGraphNode {
  return {
    id: "loop:lead-qualification",
    type: "workflow_loop",
    label: "Lead Qualification Loop",
    subtitle: "Qualifies inbound leads",
    purpose: "Qualify inbound leads with evidence and human review.",
    loopId: "lead-qualification",
    departmentId: "sales",
    status: "ready",
    health: 82,
    radius: 30,
    color: "#fff",
    stroke: "#2563eb",
    metadata: {
      trigger: "crm:lead_created",
      owner: "Sales lead",
      dataSources: ["CRM", "Website form"],
      routine: ["Score lead", "Draft follow-up"],
      verification: ["policy_check"],
      metrics: ["Qualified lead rate"]
    }
  };
}
