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

  it("renders Hermes validation and simulation controls for fixture-backed workflow loops", () => {
    const html = renderToStaticMarkup(
      React.createElement(NodeInspector, {
        actions: {
          simulateManualEvent: async () => undefined,
          simulateFixture: async () => undefined,
          validateLoop: async () => undefined
        },
        node: workflowNode({
          metadata: {
            latestRun: {
              id: "run_latest",
              status: "WAITING_FOR_REVIEW"
            },
            runtime: {
              inputFixtures: [
                { id: "happy-path", label: "Happy Path", path: "fixtures/happy-path.json" },
                { id: "risk-escalation", label: "Risk Escalation", path: "fixtures/risk-escalation.json" }
              ],
              routing: {
                ready: true,
                activationMode: "shadow",
                problemTypes: ["paid_acquisition_efficiency_drop"],
                requiredConnections: ["ads.read", "crm.read"]
              }
            }
          }
        }),
        edges: [],
        onOpenLocal: () => undefined
      })
    );

    expect(html).toContain("Hermes local run controls");
    expect(html).toContain("Connect next");
    expect(html).toContain("Event source → Hermes");
    expect(html).toContain("do not point provider webhooks directly at this loop");
    expect(html).toContain("ads read");
    expect(html).toContain("crm read");
    expect(html).toContain("Human owner / approval");
    expect(html).toContain("Outcome evidence");
    expect(html).toContain("Routing ready");
    expect(html).toContain("paid acquisition efficiency drop");
    expect(html).toContain("ads.read");
    expect(html).toContain("Latest run:");
    expect(html).toContain("WAITING FOR REVIEW");
    expect(html).toContain("run_latest");
    expect(html).toContain("Validate loop");
    expect(html).toContain("Simulate Happy Path");
    expect(html).toContain("Simulate Risk Escalation");
    expect(html).toContain("Simulate custom event JSON");
    expect(html).toContain("manual_lead-qualification_001");
    expect(html).toContain("Use redacted synthetic data only");
  });
});

function workflowNode(overrides: Partial<BrainGraphNode> = {}): BrainGraphNode {
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
    },
    ...overrides
  };
}
