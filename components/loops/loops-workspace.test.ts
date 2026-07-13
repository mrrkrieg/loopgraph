import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { LoopRecord } from "../../lib/loop-engineering-builder/types";
import { LoopList } from "./loop-list";
import { LoopsWorkspace } from "./loops-workspace";

describe("LoopsWorkspace", () => {
  it("renders loop list and detail layout without graph clutter", () => {
    const html = renderToStaticMarkup(
      React.createElement(LoopsWorkspace, {
        workspace: workspace(),
        department: "all",
        status: "all"
      })
    );

    expect(html).toContain("Loop list");
    expect(html).toContain("Lead Qualification Loop");
    expect(html).toContain("Contract");
    expect(html).not.toContain("react-flow");
  });

  it("shows catalog departments and an add department control", () => {
    const html = renderToStaticMarkup(
      React.createElement(LoopsWorkspace, {
        workspace: workspace(),
        department: "all",
        status: "all"
      })
    );

    expect(html).toContain("Engineering");
    expect(html).toContain("Operations &amp; Finance");
    expect(html).toContain("Add department");
  });

  it("renders an empty department setup state before a department has loops", () => {
    const html = renderToStaticMarkup(
      React.createElement(LoopsWorkspace, {
        workspace: workspace(),
        department: "engineering",
        status: "all"
      })
    );

    expect(html).toContain("No loops yet");
    expect(html).toContain("Create loop for Engineering");
    expect(html).toContain("/loops/new?department=engineering");
  });

  it("keeps the status badge visible on the selected loop card", () => {
    const data = workspaceFixture();
    const html = renderToStaticMarkup(
      React.createElement(LoopList, {
        loops: data.loops,
        selectedLoopId: data.loop.id
      })
    );

    expect(html).toContain("Active");
    expect(html).toContain("bg-white/10 text-white");
  });
});

function workspaceFixture() {
  return workspace() as {
    loop: LoopRecord;
    loops: LoopRecord[];
  };
}

function createLoopFixture(): LoopRecord {
  return {
    id: "lead-qualification",
    organizationId: "org_1",
    templateId: "sales-lead_qualification",
    name: "Lead Qualification Loop",
    department: "sales",
    loopType: "lead_qualification",
    status: "active",
    autonomyLevel: "draft_for_review",
    owner: "Sales lead",
    goal: "Qualify inbound leads with evidence.",
    targetMetric: "Qualified lead rate",
    businessOutcome: "Sales follows up with better qualified leads.",
    cadence: "Daily",
    specGenerated: true,
    implementationGenerated: true,
    openReviews: 0,
    improvementItems: 0
  };
}

function workspace() {
  const loop = createLoopFixture();

  return {
    loop,
    loops: [loop],
    progress: {
      percent: 100,
      answered: 10,
      totalRequired: 10,
      missing: 0
    },
    spec: {
      goal: "Qualify inbound leads with evidence.",
      trigger: "crm:lead_created",
      dataSources: [{ name: "CRM" }],
      routine: [{ stepName: "Score lead", toolRequired: "Draft follow-up" }],
      verification: [{ name: "policy_check" }],
      humanOwner: "sales_lead",
      metrics: [{ name: "Qualified lead rate" }]
    }
  } as never;
}
